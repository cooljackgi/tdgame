
'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import type { User } from 'firebase/auth';
import { onAuthStateChanged, auth } from '@/lib/firebase';
import { doc, onSnapshot, Unsubscribe, getDoc } from 'firebase/firestore';
import { db, functions } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { normalizePlayers } from '@/lib/player-utils';
import type { Player, PlayerGameState, GameStatus, Tower, Difficulty, Node, PlacedTower, VersusEnemyToSend, GameSessionState, GameDelta, WorkerOrder } from '@/lib/game-data/types';
import { INTERMISSION_TIME, difficultyModifiers, GRID_COLS, GRID_ROWS } from '@/lib/game-data/constants';
import { httpsCallable } from 'firebase/functions';
import { Loader2 } from 'lucide-react';
import { useWebRTC } from '@/hooks/use-webrtc';
import { useIsMobile } from '@/hooks/use-mobile';
import { VersusDesktopLayout } from '@/components/layouts/versus-desktop-layout';
import { VersusMobileLayout } from '@/components/layouts/versus-mobile-layout';
import Header from './header';
import type { GameBoardHandle } from './game-board';
import { loadGameConfig, type GameConfig } from '@/lib/game-config-loader';
import { DeltaType } from '@/lib/game-data/types';
import { findPath } from '@/lib/pathfinding';
import { enqueueBuildOrder, enqueueMoveOrder } from '@/lib/commands';

export default function VersusGameLoader() {
  const { gameId } = useParams<{ gameId: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  
  const [gameConfig, setGameConfig] = useState<GameConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState('Lade Spiel...');
  const [localPlayerId, setLocalPlayerId] = useState<'player1' | 'player2' | 'spectator' | null>(null);

  // --- Core Game State ---
  const [players, setPlayers] = useState<Player[]>([]);
  const [playerStates, setPlayerStates] = useState<{ player1: PlayerGameState | null, player2: PlayerGameState | null }>({ player1: null, player2: null });
  const [currentWave, setCurrentWave] = useState(0);
  const [gameStatus, setGameStatus] = useState<GameStatus>('waiting');
  const [isIntermission, setIsIntermission] = useState(true);
  const [waveStartCountdown, setWaveStartCountdown] = useState(INTERMISSION_TIME);
  const [difficulty, setDifficulty] = useState<Difficulty>('Normal');
  
  const [fps, setFps] = useState(0);

  // --- UI/Interaction State ---
  const [selectedTowerToBuild, setSelectedTowerToBuild] = useState<Tower | null>(null);
  const [portalPhase, setPortalPhase] = useState<'idle' | 'entrance' | 'exit'>('idle');
  const [portalEntrance, setPortalEntrance] = useState<Node | null>(null);
  const [focusedTower, setFocusedTower] = useState<PlacedTower | null>(null);
  const [lastUpgradedTowerId, setLastUpgradedTowerId] = useState<string | null>(null);
  const gameBoardRef = useRef<GameBoardHandle>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  
  // Game Loop refs
  const gameLoopRef = useRef<number>();
  const lastTickRef = useRef(performance.now());
  const deltaQueueRef = useRef<GameDelta[]>([]);
  const lastDeltaSentRef = useRef(0);

  const isGameHost = useMemo(() => localPlayerId === 'player1', [localPlayerId]);
  const isSpectator = useMemo(() => localPlayerId === 'spectator', [localPlayerId]);

  // Refs for stable access in callbacks
  const playersRef = useRef(players);
  useEffect(() => { playersRef.current = players; }, [players]);
  const playerStatesRef = useRef(playerStates);
  useEffect(() => { playerStatesRef.current = playerStates; }, [playerStates]);
  const currentWaveRef = useRef(currentWave);
  useEffect(() => { currentWaveRef.current = currentWave; }, [currentWave]);
  const difficultyRef = useRef(difficulty);
  useEffect(() => { difficultyRef.current = difficulty; }, [difficulty]);
  const gameStatusRef = useRef(gameStatus);
  useEffect(() => { gameStatusRef.current = gameStatus; }, [gameStatus]);
  const isIntermissionRef = useRef(isIntermission);
  useEffect(() => { isIntermissionRef.current = isIntermission; }, [isIntermission]);
  const waveStartCountdownRef = useRef(waveStartCountdown);
  useEffect(() => { waveStartCountdownRef.current = waveStartCountdown; }, [waveStartCountdown]);
  
  const localPlayer = useMemo(() => {
    return players.find(p => p.id === localPlayerId);
  }, [players, localPlayerId]);

  const localPlayerState = useMemo(() => {
    if (!localPlayerId || localPlayerId === 'spectator' || !playerStates) return null;
    return playerStates[localPlayerId as 'player1' | 'player2'];
  }, [localPlayerId, playerStates]);

  const onHostAction = useCallback((actionType: string, payload: any) => {
    const { playerId, row, col, towerId, upgradeId } = payload;
    if (!playerId || !gameConfig) return;

    const playerStateKey = playerId as 'player1' | 'player2';
    const currentPlayerState = playerStatesRef.current[playerStateKey];
    const player = playersRef.current.find(p => p.id === playerId);

    if (!currentPlayerState || !player) return;

    let newState: PlayerGameState = JSON.parse(JSON.stringify(currentPlayerState));

    switch(actionType) {
        case 'BUILD_TOWER_REQUEST': {
            const towerSpec = gameConfig.towers.find(t => t.id === towerId);
            if (!towerSpec) break;

            const cost = towerSpec.cost;
            if (player.resources < cost) break;

            const isOccupied = Object.values(newState.towersByCell).some(t => t.position.row === row && t.position.col === col) || newState.ghosts.some(g => g.row === row && g.col === col);
            if (isOccupied) break;

            const newBlocked = [...Object.values(newState.towersByCell).map(t => t.position), {row, col}];
            if (!findPath({row:1,col:1}, {row:GRID_ROWS,col:GRID_COLS}, newBlocked, GRID_ROWS, GRID_COLS)) break;

            player.resources -= cost;

            const buildTimeMs = towerSpec.buildTimeMs ?? 2000;
            const ghostId = `ghost-${row}-${col}-${Date.now()}`;
            newState.ghosts.push({
                id: ghostId,
                row: row,
                col: col,
                towerId: towerId,
                startedAt: Date.now(), // Building starts now
                buildTimeMs: buildTimeMs,
                progress: 0,
            });
            break;
        }
        case 'SEND_ENEMY_REQUEST': {
            // Logic to add enemy to opponent's spawn queue
            const opponentId = playerId === 'player1' ? 'player2' : 'player1';
            //...
            break;
        }
    }
    
    setPlayers([...playersRef.current]); // Trigger re-render for resource changes
    setPlayerStates(prev => ({
        ...prev,
        [playerStateKey]: newState
    }));

  }, [gameConfig]);


  const handleGameData = useCallback((msg: any) => {
    if (isGameHost) return;
    if (msg.type === 'deltas') {
        const deltas = msg.payload as GameDelta[];
        for (const delta of deltas) {
            const deltaType = delta[0];
            const deltaPayload = delta[1] as any;
            switch(deltaType) {
                case DeltaType.SNAPSHOT:
                  const state = deltaPayload as GameSessionState;
                  setPlayers(state.players);
                  setPlayerStates(state.playerStates!);
                  setCurrentWave(state.currentWave);
                  setIsIntermission(state.isIntermission);
                  setWaveStartCountdown(state.waveStartCountdown);
                  setGameStatus(state.gameStatus);
                  setDifficulty(state.difficulty);
                  break;
                 case DeltaType.PLAYER_UPDATE: setPlayers(deltaPayload); break;
                 case DeltaType.VERSUS_STATE_UPDATE: setPlayerStates(deltaPayload); break;
                 case DeltaType.GAME_STATE_UPDATE:
                    setCurrentWave(deltaPayload.currentWave);
                    setGameStatus(deltaPayload.gameStatus);
                    setIsIntermission(deltaPayload.isIntermission);
                    setWaveStartCountdown(deltaPayload.waveStartCountdown);
                    break;
            }
        }
    }
  }, [isGameHost]);

  const handleActionData = useCallback((msg: any) => {
    if (!isGameHost) return;

    if (msg.type === 'CLIENT_READY') {
      const currentState: GameSessionState = {
        gameMode: 'versus',
        players: playersRef.current,
        playerStates: playerStatesRef.current,
        currentWave: currentWaveRef.current,
        difficulty: difficultyRef.current,
        gameStatus: gameStatusRef.current,
        waveStartCountdown: waveStartCountdownRef.current,
        isIntermission: isIntermissionRef.current,
      };
      sendGameData('deltas', [[DeltaType.SNAPSHOT, currentState]]);
      return;
    }
    
    const { type, payload } = msg;
    onHostAction(type, payload);
  }, [isGameHost, onHostAction, sendGameData]);

  const { sendAction, sendGameData, isConnected, ...stats } = useWebRTC(
    localPlayerId ? gameId : null, 
    isGameHost, 
    user, 
    false,
    handleGameData,
    handleActionData
  );
  
  const dispatchAction = useCallback((actionType: string, payload: any) => {
    if (isSpectator) return;
    
    const finalPayload = { ...payload, playerId: payload.playerId ?? localPlayerId };
    
    if (isGameHost) {
      onHostAction(actionType, finalPayload);
    } else {
      sendAction(actionType, finalPayload);
    }
  }, [isGameHost, onHostAction, sendAction, localPlayerId, isSpectator]);


  useEffect(() => {
    if (isConnected && !isGameHost && localPlayerId === 'player2') {
      sendAction('CLIENT_READY', {});
    }
  }, [isConnected, isGameHost, localPlayerId, sendAction]);

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
            console.error("Failed to load game config:", error);
            toast({ title: 'Fehler beim Laden der Konfiguration', variant: 'destructive' });
        } finally {
            setConfigLoading(false);
        }
    }
    fetchConfig();
  }, [toast]);
  
  useEffect(() => {
    if (!user || !gameId || configLoading) return;

    const gameDocRef = doc(db, 'games', gameId);
    let unsub: Unsubscribe | undefined;

    const joinAndListen = async () => {
        setLoadingMessage('Trete Spiel bei...');
        const gameSnap = await getDoc(gameDocRef);
        if (!gameSnap.exists() || gameSnap.data().gameMode !== 'versus') {
            toast({ title: "Spiel nicht gefunden oder falscher Modus.", variant: 'destructive' });
            router.push('/');
            return;
        }

        const initialData = gameSnap.data();
        if (initialData.player1Id !== user.uid && !initialData.player2Id) {
            const joinGameCallable = httpsCallable(functions, 'joinGame');
            await joinGameCallable({ gameId });
        }

        setLoadingMessage('Warte auf Spiel-Daten...');
        unsub = onSnapshot(gameDocRef, (snap) => {
            const data = snap.data();
            if (!data) return;

            let role: 'player1' | 'player2' | 'spectator' = 'spectator';
            if (data.player1Id === user.uid) role = 'player1';
            else if (data.player2Id === user.uid) role = 'player2';
            setLocalPlayerId(role);

            setPlayers(normalizePlayers(data.players));
            setDifficulty(data.difficulty || 'Normal');
            setGameStatus(data.gameStatus);
            setIsIntermission(data.isIntermission ?? true);
            setCurrentWave(data.currentWave || 0);

            // Host has the authoritative state, clients receive it via snapshot
            if (role === 'player1') {
                 setPlayerStates(data.playerStates);
            }
            
            setLoading(false);
        });
    };

    joinAndListen().catch(err => {
        console.error("Error in joinAndListen", err);
        toast({ title: 'Fehler beim beitreten.', variant: 'destructive' });
        router.push('/');
    });

    return () => unsub?.();
  }, [user, gameId, router, toast, configLoading]);
  
  const onExit = () => router.push('/');
  const cancelInteractions = useCallback(() => { setSelectedTowerToBuild(null); setFocusedTower(null); }, []);
  
    useEffect(() => {
      if (!isGameHost || configLoading || !gameConfig) return;
  
      const gameLoop = () => {
          const now = performance.now();
          const delta = now - lastTickRef.current;
          lastTickRef.current = now;
  
          // Minimal loop for host to process logic and send updates
          // This is where you'd add enemy movement, attacks etc. later
          
          setPlayerStates(currentStates => {
              const newStates = {...currentStates};
              
              const processPlayerState = (state: PlayerGameState | null): PlayerGameState | null => {
                  if (!state) return null;
                  
                  const updatedGhosts = state.ghosts.filter(g => {
                      const elapsed = now - g.startedAt;
                      g.progress = Math.min(1, elapsed / g.buildTimeMs);
                      if (g.progress >= 1) {
                          const towerSpec = gameConfig.towers.find(t => t.id === g.towerId)!;
                          const cellKey = `${g.row}_${g.col}`;
                          state.towersByCell[cellKey] = {
                              ...towerSpec,
                              id: `tower-${g.row}-${g.col}-${now}`,
                              specId: towerSpec.id,
                              position: { row: g.row, col: g.col },
                              lastAttack: 0,
                              health: towerSpec.maxHealth,
                              ownerId: state === newStates.player1 ? 'player1' : 'player2',
                          };
                          return false; // remove from ghosts
                      }
                      return true; // keep in ghosts
                  });
                  
                  return { ...state, ghosts: updatedGhosts };
              }

              newStates.player1 = processPlayerState(newStates.player1);
              newStates.player2 = processPlayerState(newStates.player2);

              return newStates;
          });

          // Send updates periodically
          if (now - lastDeltaSentRef.current > 100) {
            deltaQueueRef.current.push([DeltaType.VERSUS_STATE_UPDATE, playerStatesRef.current]);
            deltaQueueRef.current.push([DeltaType.PLAYER_UPDATE, playersRef.current]);
            
            const deltasToSend = [...deltaQueueRef.current];
            if (deltasToSend.length > 0) {
               sendGameData('deltas', deltasToSend);
            }
            deltaQueueRef.current = [];
            lastDeltaSentRef.current = now;
          }
  
          gameLoopRef.current = requestAnimationFrame(gameLoop);
      };
  
      gameLoopRef.current = requestAnimationFrame(gameLoop);
      return () => {
          if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current);
      };
    }, [isGameHost, configLoading, gameConfig, sendGameData]);


  if (loading || configLoading || !localPlayer) {
    return <div className="w-full h-full flex flex-col items-center justify-center bg-background"><Loader2 className="h-10 w-10 animate-spin text-primary mb-4" /><p className="text-muted-foreground">{loadingMessage}</p></div>;
  }
  
  if (!isGameHost && !localPlayerState) {
    return <div className="w-full h-full flex flex-col items-center justify-center bg-background"><Loader2 className="h-10 w-10 animate-spin text-primary mb-4" /><p className="text-muted-foreground">Warte auf Spielzustand vom Host...</p></div>;
  }
  
  const LayoutComponent = isMobile ? VersusMobileLayout : VersusDesktopLayout;

  return (
    <div className="w-full h-full flex flex-col">
      <Header onExit={onExit} isMuted={isMuted} toggleMute={() => setIsMuted(m => !m)} fps={isGameHost ? fps : stats.fps} />
      <div className="flex-grow p-2">
        <LayoutComponent
          players={players}
          setPlayers={setPlayers}
          gameState={localPlayerState!}
          localPlayer={localPlayer}
          currentWave={currentWave}
          totalWaves={gameConfig?.waves.length ?? 0}
          difficulty={difficulty}
          handleGameControl={() => {}}
          gameStatus={gameStatus}
          resetGame={onExit}
          towers={gameConfig?.towers ?? []}
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
          handlePlaceTower={(row, col) => dispatchAction('BUILD_TOWER_REQUEST', {row, col, towerId: selectedTowerToBuild?.id})}
          onFocusTower={setFocusedTower}
          selectedTowerToBuild={selectedTowerToBuild}
          portalEntrance={portalEntrance}
          focusedTower={focusedTower}
          gameBoardRef={gameBoardRef}
          interactionPrompt="Versus Mode"
          cancelInteractions={cancelInteractions}
          onSelectTowerToBuild={setSelectedTowerToBuild}
          onEnterPortalMode={() => {}}
          handleUpgradeTower={(upgradeId) => focusedTower && dispatchAction('UPGRADE_TOWER_REQUEST', {row: focusedTower.position.row, col: focusedTower.position.col, upgradeId})}
          handleSellTower={() => focusedTower && dispatchAction('SELL_TOWER_REQUEST', {row: focusedTower.position.row, col: focusedTower.position.col})}
          setFocusedTower={setFocusedTower}
          spawnedThisWave={0}
          totalEnemiesInWave={0}
          totalKilled={0}
          totalLeaked={0}
          isIntermission={isIntermission}
          waveStartCountdown={waveStartCountdown}
          intermissionTime={INTERMISSION_TIME}
          handleStartNextWaveNow={() => {}}
          lastUpgradedTowerId={lastUpgradedTowerId}
          isCoop={false}
          playerRole={localPlayerId}
          handleLoadTestLayout={() => {}}
          handleLoadAllTowersLayout={() => {}}
          isCheating={false}
          cheat_unlockAll={() => {}}
          firingTowerIds={new Set()}
          allTowers={gameConfig?.towers ?? []}
          isWsConnected={isConnected}
          onPing={() => {}}
          isPlacingPortalEntrance={portalPhase !== 'idle'}
          onSendEnemy={(payload: any) => dispatchAction('SEND_ENEMY_REQUEST', payload)}
          gameMode="versus"
        />
      </div>
    </div>
  );
}

