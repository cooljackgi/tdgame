

'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import type { User } from 'firebase/auth';
import { onAuthStateChanged, auth } from '@/lib/firebase';
import { doc, onSnapshot, Unsubscribe, getDoc } from 'firebase/firestore';
import { db, functions } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { normalizePlayers } from '@/lib/player-utils';
import type { Player, PlayerGameState, GameStatus, Tower, Difficulty, Node, PlacedTower, VersusEnemyToSend, GameSessionState, GameDelta, Worker, GhostFoundation } from '@/lib/game-data/types';
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
import { processAttack, tickDots, tickWorkers } from '@/lib/game-logic';


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
  const [versusState, setVersusState] = useState<any>({ player1: { spawnQueue: [] }, player2: { spawnQueue: [] }});
  
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
  const frameCountRef = useRef(0);
  const lastFpsUpdateRef = useRef(Date.now());
  const pendingSnapshotRef = useRef(false);


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
  const versusStateRef = useRef(versusState);
  useEffect(() => { versusStateRef.current = versusState; }, [versusState]);
  
  const localPlayer = useMemo(() => {
    return players.find(p => p.id === localPlayerId);
  }, [players, localPlayerId]);

  const localPlayerState = useMemo(() => {
    if (!localPlayerId || localPlayerId === 'spectator' || !playerStates) return null;
    return playerStates[localPlayerId as 'player1' | 'player2'];
  }, [localPlayerId, playerStates]);

  const onExit = () => router.push('/');
  const cancelInteractions = useCallback(() => { setSelectedTowerToBuild(null); setFocusedTower(null); }, []);
  
  const onHostAction = useCallback((actionType: string, payload: any) => {
    const { playerId, row, col, towerId, upgradeId, type: enemyType, cost, incomeBonus } = payload;
    if (!playerId || !gameConfig) return;

    setPlayerStates(currentPlayerStates => {
        const playerStateKey = playerId as 'player1' | 'player2';
        const playerState = currentPlayerStates[playerStateKey];
        if (!playerState) return currentPlayerStates;

        let newPlayerState: PlayerGameState = JSON.parse(JSON.stringify(playerState));

        setPlayers(currentPlayers => {
            const playerIndex = currentPlayers.findIndex(p => p.id === playerId);
            if (playerIndex === -1) return currentPlayers;
            
            let newPlayers = JSON.parse(JSON.stringify(currentPlayers));
            let player = newPlayers[playerIndex];

            const tempSessionState: GameSessionState = {
                gameMode: 'versus', players: newPlayers, playerStates: { [playerStateKey]: newPlayerState } as any,
                currentWave: 0, difficulty: 'Normal', gameStatus: 'playing', waveStartCountdown: 0, isIntermission: false
            };

            switch(actionType) {
                case 'BUILD_TOWER_REQUEST': {
                    const tempResult = enqueueBuildOrder(tempSessionState, player.id.includes('1') ? 'worker-1' : 'worker-2', row, col, towerId, Date.now());
                    newPlayerState.ghosts = tempResult.ghosts;
                    newPlayerState.workers = tempResult.workers;
                    newPlayers = tempResult.players;
                    break;
                }
                case 'SEND_ENEMY_REQUEST': {
                    if (player.resources < cost) break;
                    player.resources -= cost;
                    player.incomePerSecond += incomeBonus;
                    setVersusState(currentVersusState => {
                        let newVersusState = JSON.parse(JSON.stringify(currentVersusState));
                        const opponentId = playerId === 'player1' ? 'player2' : 'player1';
                        newVersusState[opponentId].spawnQueue.push({ type: enemyType, count: 1 });
                        return newVersusState;
                    });
                    break;
                }
                case 'START_WAVE_NOW_REQUEST': {
                    if (gameStatusRef.current === 'waiting') {
                        setGameStatus('playing');
                        setIsIntermission(true);
                        setWaveStartCountdown(INTERMISSION_TIME);
                    }
                    break;
                }
            }
            
            return newPlayers;
        });

        return { ...currentPlayerStates, [playerStateKey]: newPlayerState };
    });

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
                  setPlayers(state.players!);
                  setPlayerStates(state.playerStates!);
                  setCurrentWave(state.currentWave);
                  setIsIntermission(state.isIntermission);
                  setWaveStartCountdown(state.waveStartCountdown);
                  setGameStatus(state.gameStatus);
                  setDifficulty(state.difficulty);
                  setVersusState(state.versusState || { player1: { spawnQueue: [] }, player2: { spawnQueue: [] }});
                  break;
                 case DeltaType.PLAYER_UPDATE: setPlayers(deltaPayload); break;
                 case DeltaType.PLAYER_STATES_UPDATE: setPlayerStates(deltaPayload); break;
                 case DeltaType.VERSUS_STATE_UPDATE: setVersusState(deltaPayload); break;
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
  
  const onHostActionRef = useRef(onHostAction);
  useEffect(() => { onHostActionRef.current = onHostAction; }, [onHostAction]);

  const handleActionData = useCallback((msg: any) => {
    if (!isGameHost) return;
    const { type, payload } = msg;

    if (type === 'CLIENT_READY') {
        pendingSnapshotRef.current = true;
        return;
    }

    onHostActionRef.current(type, payload);
  }, [isGameHost]);

  const { sendAction, sendGameData, isConnected, ...stats } = useWebRTC(
    localPlayerId ? gameId : null, 
    isGameHost, 
    user, 
    false,
    handleGameData,
    handleActionData
  );

  useEffect(() => {
    if (!isGameHost || !isConnected || !pendingSnapshotRef.current) return;
    
    const ps = playerStatesRef.current;
    const pls = playersRef.current;
    if (!ps.player1 || !ps.player2 || pls.length < 2) {
        console.warn("Host received CLIENT_READY, but state is not fully initialized yet. Waiting for state update.");
        return;
    }
    
    const fullState: GameSessionState = {
        gameMode: 'versus', players: pls, playerStates: ps,
        currentWave: currentWaveRef.current, difficulty: difficultyRef.current,
        gameStatus: gameStatusRef.current, waveStartCountdown: waveStartCountdownRef.current,
        isIntermission: isIntermissionRef.current, versusState: versusStateRef.current,
    };
    sendGameData('deltas', [[DeltaType.SNAPSHOT, fullState]]);
    pendingSnapshotRef.current = false;
    
  }, [isGameHost, isConnected, sendGameData, players, playerStates]);


  useEffect(() => {
      if (isConnected && !isGameHost && localPlayerId === 'player2') {
          sendAction('CLIENT_READY', {});
      }
  }, [isConnected, isGameHost, localPlayerId, sendAction]);

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

            const normalized = normalizePlayers(data.players);
            setPlayers(normalized);
            setDifficulty(data.difficulty || 'Normal');
            setGameStatus(data.gameStatus);
            setIsIntermission(data.isIntermission ?? true);
            setCurrentWave(data.currentWave || 0);

            if (data.playerStates) {
                 setPlayerStates(data.playerStates);
            }
            if (data.versusState) {
                setVersusState(data.versusState);
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
  
  
  useEffect(() => {
    if (!isGameHost || configLoading || !gameConfig) return;
  
    const gameLoop = () => {
      gameLoopRef.current = requestAnimationFrame(gameLoop);
      const now = performance.now();
      const delta = now - lastTickRef.current;
      if (delta === 0) return;
      lastTickRef.current = now;
  
      const epochNow = Date.now();
      
      frameCountRef.current++;
      if (epochNow - lastFpsUpdateRef.current >= 1000) {
          setFps(frameCountRef.current);
          frameCountRef.current = 0;
          lastFpsUpdateRef.current = epochNow;
      }
  
      if (gameStatusRef.current !== 'playing') {
        // Send frequent state updates even when not "playing" to keep clients in sync
        if (epochNow - lastDeltaSentRef.current > 1000) {
            deltaQueueRef.current.push([DeltaType.GAME_STATE_UPDATE, { currentWave: currentWaveRef.current, gameStatus: gameStatusRef.current, isIntermission: isIntermissionRef.current, waveStartCountdown: waveStartCountdownRef.current, lives: 0 }]);
        }
      } else {
         // Full game logic only when playing
         setPlayerStates(currentStates => {
            let p1State = currentStates.player1;
            let p2State = currentStates.player2;

            if (p1State) {
                const tickResult = tickWorkers({ players: playersRef.current, playerStates: {player1: p1State, player2: p2State!}, gameMode: 'versus' } as GameSessionState, delta, epochNow, gameConfig.towers);
                p1State = { ...p1State, workers: tickResult.workers.filter(w => w.id === 'worker-1'), ghosts: tickResult.ghosts.filter(g => g.id.startsWith('p1-')), towersByCell: tickResult.towersByCell };
            }

             if (p2State) {
                const tickResult = tickWorkers({ players: playersRef.current, playerStates: {player1: p1State!, player2: p2State}, gameMode: 'versus' } as GameSessionState, delta, epochNow, gameConfig.towers);
                p2State = { ...p2State, workers: tickResult.workers.filter(w => w.id === 'worker-2'), ghosts: tickResult.ghosts.filter(g => g.id.startsWith('p2-')), towersByCell: tickResult.towersByCell };
            }

            return { player1: p1State, player2: p2State };
        });
      }

      if (epochNow - lastDeltaSentRef.current > 100) {
        deltaQueueRef.current.push([DeltaType.PLAYER_STATES_UPDATE, playerStatesRef.current]);
        deltaQueueRef.current.push([DeltaType.VERSUS_STATE_UPDATE, versusStateRef.current]);
        deltaQueueRef.current.push([DeltaType.PLAYER_UPDATE, playersRef.current]);
        const deltasToSend = [...deltaQueueRef.current];
        if (deltasToSend.length > 0) {
           sendGameData('deltas', deltasToSend);
        }
        deltaQueueRef.current = [];
        lastDeltaSentRef.current = epochNow;
      }
  
    };
  
    gameLoopRef.current = requestAnimationFrame(gameLoop);
    return () => { if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current); };
  
  }, [isGameHost, configLoading, gameConfig, sendGameData]);


  if (loading || configLoading || !localPlayer) {
    return <div className="w-full h-full flex flex-col items-center justify-center bg-background"><Loader2 className="h-10 w-10 animate-spin text-primary mb-4" /><p className="text-muted-foreground">{loadingMessage}</p></div>;
  }
  
  if (!isGameHost && !isSpectator && !localPlayerState) {
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
          placedTowers={Object.values(localPlayerState?.towersByCell ?? {})}
          enemies={localPlayerState?.enemies ?? []}
          workers={localPlayerState?.workers ?? []}
          ghosts={localPlayerState?.ghosts ?? []}
          portals={localPlayerState?.portals ?? []}
          damageNumbers={[]}
          splashRings={[]}
          persistentClouds={[]}
          currentPath={localPlayerState?.currentPath ?? []}
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
          handleStartNextWaveNow={() => dispatchAction('START_WAVE_NOW_REQUEST', {})}
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
          onSendEnemy={(payload) => dispatchAction('SEND_ENEMY_REQUEST', payload as any)}
          gameMode="versus"
        />
      </div>
    </div>
  );
}
