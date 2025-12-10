

'use client';

// This is a new, dedicated file for the Versus mode logic.
// It's a copy of the coop-game-loader and will be modified.

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import type { User } from 'firebase/auth';
import { onAuthStateChanged, auth } from '@/lib/firebase';
import { doc, onSnapshot, Unsubscribe, updateDoc, collection, addDoc, serverTimestamp, getDoc } from 'firebase/firestore';
import { db, functions } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { normalizePlayers } from '@/lib/player-utils';
import type { Player, GameState, GameStatus, PlacedTower, Difficulty, Tower, Element, Enemy, Attack, DamageNumber, SplashRing, Node, EnemyStatusEffect, TowerEffect, PingPayload, RequestPayload, RequestResolve, PingKind, LifeGainVfx, GravityWell, PersistentCloud, SoundEvent, Worker, GhostFoundation, GameSessionState, Portal, VersusEnemyToSend, PlayerGameState } from '@/lib/game-data/types';
import { DeltaType } from '@/lib/game-data/types';
import { INTERMISSION_TIME, difficultyModifiers, GRID_ROWS, GRID_COLS, ALL_PICKABLE_ELEMENTS } from '@/lib/game-data/constants';
import { httpsCallable } from 'firebase/functions';
import { Loader2 } from 'lucide-react';
import { useWebRTC } from '@/hooks/use-webrtc';
import { findPath } from '@/lib/pathfinding';
import { useIsMobile } from '@/hooks/use-mobile';
import { VersusDesktopLayout } from '@/components/layouts/versus-desktop-layout';
import { VersusMobileLayout } from '@/components/layouts/versus-mobile-layout';
import { ElementPickDialog } from './element-pick-dialog';
import Header from './header';
import { audioManager } from '@/lib/audio/audio-manager';
import { processAttack, tickDots, tickWorkers } from '@/lib/game-logic';
import { enqueueBuildOrder, enqueueMoveOrder, enqueuePlacePortalOrder } from '@/lib/commands';
import { onGameEnd as performGameEndActions } from '@/lib/game-end';
import type { GameBoardHandle } from './game-board';
import { loadGameConfig, type GameConfig } from '@/lib/game-config-loader';
import { logGameStats } from '@/lib/logging';


export default function VersusGameLoader() {
  const { gameId } = useParams<{ gameId: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  
  // --- Config Loading State ---
  const [gameConfig, setGameConfig] = useState<GameConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState('Lade Spiel...');

  // Core Game State
  const [players, setPlayers] = useState<Player[]>([]);
  
  // VERSUS STATE: Each player has their own game state
  const [playerStates, setPlayerStates] = useState<{
    player1: PlayerGameState;
    player2: PlayerGameState;
  } | null>(null);

  const [currentWave, setCurrentWave] = useState(0);
  const [gameStatus, setGameStatus] = useState<GameStatus>('waiting');
  const [isIntermission, setIsIntermission] = useState(true);
  const [waveStartCountdown, setWaveStartCountdown] = useState(INTERMISSION_TIME);
  const [difficulty, setDifficulty] = useState<Difficulty>('Normal');
  const [localPlayerId, setLocalPlayerId] = useState<'player1' | 'player2' | 'spectator' | null>(null);
  const [gameDataLoaded, setGameDataLoaded] = useState(false);
  const [totalKilled, setTotalKilled] = useState(0);
  const [totalLeaked, setTotalLeaked] = useState(0);
  const [fps, setFps] = useState(0);
  
  const [isLogicPaused, setIsLogicPaused] = useState(false);
  
  // UI State
  const [selectedTowerToBuild, setSelectedTowerToBuild] = useState<Tower | null>(null);
  const [portalPhase, setPortalPhase] = useState<'idle' | 'entrance' | 'exit'>('idle');
  const [portalEntrance, setPortalEntrance] = useState<Node | null>(null);
  const [focusedTower, setFocusedTower] = useState<PlacedTower | null>(null);
  const [justPlacedTowerId, setJustPlacedTowerId] = useState<string | null>(null);
  const [lastUpgradedTowerId, setLastUpgradedTowerId] = useState<string | null>(null);
  const gameBoardRef = useRef<GameBoardHandle>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);

  // VFX State
  const [firingTowerIds, setFiringTowerIds] = useState<Set<string>>(new Set());
  
  const isGameHost = useMemo(() => localPlayerId === 'player1', [localPlayerId]);
  
  const localPlayer = useMemo(() => {
    return players.find(p => p.id === localPlayerId);
  }, [players, localPlayerId]);
  
  const localPlayerState = useMemo(() => {
    if (!localPlayerId || localPlayerId === 'spectator' || !playerStates) return null;
    return playerStates[localPlayerId as 'player1' | 'player2'];
  }, [localPlayerId, playerStates]);

  const opponentPlayerState = useMemo(() => {
    if (!localPlayerId || localPlayerId === 'spectator' || !playerStates) return null;
    const opponentId = localPlayerId === 'player1' ? 'player2' : 'player1';
    return playerStates[opponentId];
  }, [localPlayerId, playerStates]);


  // Host-side Game Loop & State Refs
  const gameLoopRef = useRef<number>();
  const lastTickRef = useRef(performance.now());
  const frameCountRef = useRef(0);
  const lastFpsUpdateRef = useRef(Date.now());
  const fpsRef = useRef(0);

  const deltaQueueRef = useRef<GameDelta[]>([]);
  const lastDeltaSentRef = useRef(0);
  const enemyIdCounter = useRef(0);
  
  // Refs for stable access in game loop
  const gameStatusRef = useRef(gameStatus);
  useEffect(() => { gameStatusRef.current = gameStatus }, [gameStatus]);
  const isIntermissionRef = useRef(isIntermission);
  useEffect(() => { isIntermissionRef.current = isIntermission }, [isIntermission]);
  const playersRef = useRef(players);
  useEffect(() => { playersRef.current = players; }, [players]);
  const playerStatesRef = useRef(playerStates);
  useEffect(() => { playerStatesRef.current = playerStates; }, [playerStates]);

  const onFocusTower = (tower: PlacedTower) => {
    cancelInteractions();
    setFocusedTower(tower);
  };
  
  const onExit = () => {
    router.push('/');
  };

  const onSelectTowerToBuild = (tower: Tower | null) => {
    cancelInteractions();
    setSelectedTowerToBuild(tower);
    audioManager.play({ kind: 'sfx', name: 'ui_click' });
  };
  
  const cancelInteractions = useCallback(() => {
      setSelectedTowerToBuild(null);
      setFocusedTower(null);
      setPortalPhase('idle');
      setPortalEntrance(null);
  }, []);

  const onEnterPortalMode = useCallback(() => {
    cancelInteractions();
    setPortalPhase('entrance');
    audioManager.play({ kind: 'sfx', name: 'ui_click' });
  }, [cancelInteractions]);

  // --- WebRTC Logic ---
  
  const handleGameData = useCallback((msg: any) => {
    if (isGameHost) return;
    
    if (msg.type === 'deltas') {
        const deltas = msg.payload as GameDelta[];
        for (const delta of deltas) {
            const deltaType = delta[0];
            const deltaPayload = delta[1];
            switch(deltaType) {
                 case DeltaType.SNAPSHOT:
                  setPlayers((deltaPayload as GameSessionState).players);
                  setPlayerStates((deltaPayload as GameSessionState).playerStates || null);
                  setCurrentWave((deltaPayload as GameSessionState).currentWave);
                  setIsIntermission((deltaPayload as GameSessionState).isIntermission);
                  setWaveStartCountdown((deltaPayload as GameSessionState).waveStartCountdown);
                  setGameStatus((deltaPayload as GameSessionState).gameStatus);
                  break;
                case DeltaType.PLAYER_UPDATE: setPlayers(deltaPayload as Player[]); break;
                // Add other cases as needed
            }
        }
    }
  }, [isGameHost, gameConfig, localPlayer]);

  const handleSendEnemy = useCallback((payload: VersusEnemyToSend) => {
      dispatchAction('send_enemy', payload);
  }, []);

  const onHostAction = useCallback((action:'build'|'upgrade'|'sell'|'pick_element'|'start_wave_now'|'move_worker'| 'place_portal' | 'send_enemy', payload:any) => {
    if (!isGameHost || !gameConfig) return;
    
    // ... a lot of the logic will need to be duplicated inside a loop for each player state
    
    return;
  }, []);
    
    const handleActionData = useCallback((msg: any) => {
        if (!isGameHost) return;
        const { type, payload } = msg;

        // ...
    }, [isGameHost, onHostAction]);
    
    const { sendAction, sendGameData, isConnected, ...stats } = useWebRTC(
        localPlayerId ? gameId : null, 
        isGameHost, 
        user, 
        false, 
        handleGameData, 
        handleActionData
    );

    useEffect(() => {
      if (isConnected && !isGameHost && localPlayerId === 'player2') {
          sendAction('CLIENT_READY', {});
      }
    }, [isConnected, isGameHost, localPlayerId, sendAction]);

  const onLocalAction = useCallback((action: string, payload: any) => {
      if (!localPlayerId || localPlayerId === 'spectator' || isGameHost) return;
      
      const actionType = `VS_${action.toUpperCase()}_REQUEST`;
      sendAction(actionType, { ...payload, playerId: localPlayerId });
  }, [localPlayerId, isGameHost, sendAction]);
  
  const dispatchAction = useCallback((action: any, payload: any) => {
      const finalPayload = { ...payload, playerId: payload.playerId ?? localPlayerId };
      
      if (isGameHost) {
          onHostAction(action, finalPayload);
      } else {
          onLocalAction(action, finalPayload);
      }
  }, [isGameHost, onHostAction, onLocalAction, localPlayerId]);
  
    useEffect(() => {
      if (!gameId) return;

      const authUnsubscribe = onAuthStateChanged(auth, (currentUser) => {
        if (!currentUser) {
          toast({ title: "Authentifizierung erforderlich.", variant: 'destructive' });
          router.push('/');
          return;
        }
        setUser(currentUser);
      });

      return () => authUnsubscribe();
    }, [gameId, router, toast]);

    useEffect(() => {
        async function fetchConfig() {
            try {
                const config = await loadGameConfig();
                setGameConfig(config);
            } catch (error) {
                console.error("Failed to load game config, using defaults:", error);
                toast({ title: 'Fehler beim Laden der Konfiguration', description: 'Standardwerte werden verwendet.', variant: 'destructive' });
            } finally {
                setConfigLoading(false);
            }
        }
        fetchConfig();
    }, [toast]);


    useEffect(() => {
        if (!user || !gameId || configLoading) return;
        const gameDocRef = doc(db, 'games', gameId);

        let gameUnsub: Unsubscribe | null = null;

        const joinAndListen = async () => {
            try {
                const gameSnap = await getDoc(gameDocRef);
                if (!gameSnap.exists()) {
                    toast({ title: "Spiel nicht gefunden", variant: 'destructive'});
                    router.push('/');
                    return;
                }

                const initialData = gameSnap.data();
                if (initialData.player1Id !== user.uid && !initialData.player2Id) {
                    const joinGameCallable = httpsCallable(functions, 'joinGame');
                    setLoadingMessage('Trete Spiel bei...');
                    await joinGameCallable({ gameId });
                }

                gameUnsub = onSnapshot(gameDocRef, (snap) => {
                    if (!snap.exists()) {
                      toast({ title: "Spiel nicht gefunden", variant: 'destructive'});
                      router.push('/');
                      return;
                    };
                    const data = snap.data();
                    if (!data) return;

                    let role: 'player1' | 'player2' | 'spectator' = 'spectator';
                    if (data.player1Id === user.uid) role = 'player1';
                    else if (data.player2Id === user.uid) role = 'player2';
                    setLocalPlayerId(role);

                    // HOST ONLY: Load initial state ONCE
                    if (role === 'player1' && !gameDataLoaded) {
                         setDifficulty(data.difficulty || 'Normal');
                         setPlayers(normalizePlayers(data.players));
                         setPlayerStates(data.playerStates); // Load the whole object
                         setGameStatus(data.gameStatus);
                         setIsIntermission(data.isIntermission ?? true);
                         setWaveStartCountdown(data.waveStartCountdown ?? INTERMISSION_TIME);
                         
                         setGameDataLoaded(true);
                         setLoading(false);
                    } else if (role !== 'player1') {
                        // CLIENT: Update players, rest comes via WebRTC
                        setPlayers(normalizePlayers(data.players));
                        // Mark as loaded if host has initialized the states
                        if (!gameDataLoaded && data.playerStates?.player1) {
                            setGameDataLoaded(true);
                            setLoading(false);
                        }
                    } else if (role === 'player1' && gameDataLoaded) {
                        // HOST AFTER INITIAL LOAD: Only update other player's data
                        setPlayers(currentPlayers => {
                           const newPlayers = normalizePlayers(data.players);
                           const self = currentPlayers.find(p => p.id === 'player1');
                           const other = newPlayers.find(p => p.id === 'player2');
                           const finalPlayers = [self, other].filter(Boolean) as Player[];
                           return finalPlayers;
                        });
                    }
                });
            } catch (error: any) {
                console.error("Failed to join or listen to game:", error);
            }
        };

        joinAndListen();
        return () => { if (gameUnsub) gameUnsub(); }
    }, [user, gameId, router, toast, configLoading, gameDataLoaded]);
    
  
  const handleGameEnd = useCallback(async (won: boolean) => {
    // ...
  }, [gameId, user, difficulty]);

  useEffect(() => {
      // The game loop will now need to iterate over playerStates and run simulations for each.
      // This is a major refactor.
  }, [isGameHost, gameConfig, handleGameEnd]);
  
  const handleStartNextWaveNowAction = () => dispatchAction('start_wave_now', {});

  if (configLoading || loading || !gameConfig || !localPlayer || !playerStates) {
    return <div className="w-full h-full flex flex-col items-center justify-center bg-background"><Loader2 className="h-10 w-10 animate-spin text-primary mb-4" /><p className="text-muted-foreground">{loadingMessage}</p></div>;
  }
  
  const handleUpgradeTowerAction = (upgradeId: string) => focusedTower && dispatchAction('upgrade', { row: focusedTower.position.row, col: focusedTower.position.col, upgradeId });
  const handleSellTowerAction = () => focusedTower && dispatchAction('sell', { row: focusedTower.position.row, col: focusedTower.position.col, playerId: focusedTower.ownerId });
  const onElementPick = (element: Element) => dispatchAction('pick_element', { element, playerId: localPlayerId });
  const toggleMute = () => {}; // Placeholder
  const handlePlaceAction = (row: number, col: number) => {}; // Placeholder


  const LayoutComponent = isMobile ? VersusMobileLayout : VersusDesktopLayout;

  const interactionPrompt = "Versus Mode Active";

  return (
        <div className="w-full h-full flex flex-col" onClick={() => { if(!hasInteracted) { audioManager.init(); setHasInteracted(true); }}}>
             <Header onExit={onExit} isMuted={isMuted} toggleMute={toggleMute} fps={isGameHost ? fps : stats.fps} />
             <div className="flex-grow p-2">
                <LayoutComponent
                    gameMode="versus"
                    onSendEnemy={handleSendEnemy}
                    players={players} 
                    setPlayers={setPlayers} 
                    gameState={localPlayerState!} // Pass local player's state
                    localPlayer={localPlayer!}
                    currentWave={currentWave} 
                    totalWaves={gameConfig.waves.length} 
                    difficulty={difficulty} 
                    handleGameControl={() => {}}
                    gameStatus={gameStatus} 
                    resetGame={onExit}
                    towers={gameConfig.towers} 
                    setTowers={() => {}} 
                    placedTowers={Object.values(localPlayerState!.towersByCell)} 
                    enemies={localPlayerState!.enemies}
                    workers={localPlayerState!.workers}
                    ghosts={localPlayerState!.ghosts}
                    portals={localPlayerState!.portals}
                    damageNumbers={[]} 
                    splashRings={[]}
                    persistentClouds={[]}
                    currentPath={localPlayerState!.currentPath} 
                    handlePlaceTower={handlePlaceAction}
                    onFocusTower={onFocusTower} 
                    selectedTowerToBuild={selectedTowerToBuild}
                    portalEntrance={portalEntrance}
                    focusedTower={focusedTower}
                    gameBoardRef={gameBoardRef}
                    interactionPrompt={interactionPrompt} 
                    cancelInteractions={cancelInteractions}
                    onSelectTowerToBuild={onSelectTowerToBuild}
                    onEnterPortalMode={onEnterPortalMode}
                    handleUpgradeTower={handleUpgradeTowerAction}
                    handleSellTower={handleSellTowerAction}
                    setFocusedTower={setFocusedTower}
                    spawnedThisWave={0}
                    totalEnemiesInWave={0}
                    totalKilled={totalKilled}
                    totalLeaked={totalLeaked}
                    isIntermission={isIntermission}
                    waveStartCountdown={Math.max(0, Math.ceil(waveStartCountdown))}
                    intermissionTime={INTERMISSION_TIME} 
                    handleStartNextWaveNow={handleStartNextWaveNowAction}
                    lastUpgradedTowerId={lastUpgradedTowerId}
                    justPlacedTowerId={justPlacedTowerId}
                    isCoop={false} 
                    playerRole={localPlayerId}
                    handleLoadTestLayout={() => {}}
                    handleLoadAllTowersLayout={() => {}}
                    isCheating={false}
                    cheat_addResources={() => {}}
                    cheat_skipWaves={() => {}}
                    cheat_heal={() => {}}
                    cheat_unlockAll={() => {}}
                    firingTowerIds={firingTowerIds} 
                    allTowers={gameConfig.towers}
                    isWsConnected={isConnected} 
                    onPing={()=>{}}
                    hostPacketsPerSecond={stats.sentPacketsPerSecond} 
                    hostBytesSentPerSecond={stats.sentBytesSentPerSecond}
                    clientPacketsPerSecond={stats.packetsPerSecond}
                    clientBytesReceivedPerSecond={stats.bytesPerSecond}
                    averagePacketSize={stats.averagePacketSize}
                    isPlacingPortalEntrance={portalPhase !== 'idle'}
                    />
             </div>
        </div>
  );
}
