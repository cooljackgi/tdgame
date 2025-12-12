
'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import type { User } from 'firebase/auth';
import { onAuthStateChanged, auth } from '@/lib/firebase';
import { doc, onSnapshot, Unsubscribe, getDoc } from 'firebase/firestore';
import { db, functions } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { normalizePlayers } from '@/lib/player-utils';
import type { Player, PlayerGameState, GameStatus, Tower, Difficulty, Node, PlacedTower, VersusEnemyToSend, GameSessionState, GameDelta, Worker, GhostFoundation, Attack, DamageNumber, SplashRing, PersistentCloud, LifeGainVfx, GravityWell, SoundEvent, VersusState, Enemy } from '@/lib/game-data/types';
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
import { audioManager } from '@/lib/audio/audio-manager';


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
  const [gameDataLoaded, setGameDataLoaded] = useState(false);

  // --- Core Game State ---
  const [players, setPlayers] = useState<Player[]>([]);
  const [playerStates, setPlayerStates] = useState<{ player1: PlayerGameState, player2: PlayerGameState }>({ player1: { lives: 20, towersByCell: {}, enemies: [], workers: [], ghosts: [], portals: [], currentPath: [] }, player2: { lives: 20, towersByCell: {}, enemies: [], workers: [], ghosts: [], portals: [], currentPath: [] } });
  const [currentWave, setCurrentWave] = useState(0);
  const [gameStatus, setGameStatus] = useState<GameStatus>('waiting');
  const [isIntermission, setIsIntermission] = useState(true);
  const [waveStartCountdown, setWaveStartCountdown] = useState(INTERMISSION_TIME);
  const [difficulty, setDifficulty] = useState<Difficulty>('Normal');
  const [versusState, setVersusState] = useState<VersusState>({ nextWaveTimestamp: 0, player1: { spawnQueue: [] }, player2: { spawnQueue: [] }});
  
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
  const enemyIdCounter = useRef(0);
  const waveStartTimeRef = useRef<number>(0);
  
  const p1SpawnQueueRef = useRef<any[]>([]);
  const p2SpawnQueueRef = useRef<any[]>([]);
  
  const actionQueueRef = useRef<{type: string, payload: any}[]>([]);


  const isGameHost = useMemo(() => localPlayerId === 'player1', [localPlayerId]);
  const isSpectator = useMemo(() => localPlayerId === 'spectator', [localPlayerId]);
  const isCheating = useMemo(() => difficulty === 'Chaos', [difficulty]);


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
  
  const opponentPlayerState = useMemo(() => {
    if (!localPlayerId || localPlayerId === 'spectator' || !playerStates) return null;
    const opponentId = localPlayerId === 'player1' ? 'player2' : 'player1';
    return playerStates[opponentId];
  }, [localPlayerId, playerStates]);

  useEffect(() => {
    if (!isGameHost || !playerStates.player1.towersByCell) return;
    const newPath = findPath({row:1,col:1},{row:GRID_ROWS,col:GRID_COLS}, Object.values(playerStates.player1.towersByCell).map(t => t.position), GRID_ROWS, GRID_COLS) ?? [];
    setPlayerStates(current => ({ ...current, player1: { ...current.player1, currentPath: newPath }}));
  }, [isGameHost, playerStates.player1.towersByCell]);

  useEffect(() => {
      if (!isGameHost || !playerStates.player2.towersByCell) return;
      const newPath = findPath({row:1,col:1},{row:GRID_ROWS,col:GRID_COLS}, Object.values(playerStates.player2.towersByCell).map(t => t.position), GRID_ROWS, GRID_COLS) ?? [];
      setPlayerStates(current => ({ ...current, player2: { ...current.player2, currentPath: newPath }}));
  }, [isGameHost, playerStates.player2.towersByCell]);


  const onExit = () => router.push('/');
  const cancelInteractions = useCallback(() => { setSelectedTowerToBuild(null); setFocusedTower(null); }, []);

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
                  if (state.players) setPlayers(state.players);
                  if (state.playerStates) setPlayerStates(state.playerStates);
                  setCurrentWave(state.currentWave);
                  setIsIntermission(state.isIntermission);
                  setWaveStartCountdown(state.waveStartCountdown);
                  setGameStatus(state.gameStatus);
                  setDifficulty(state.difficulty);
                  if(state.versusState) setVersusState(state.versusState);
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

  const handleActionData = useCallback((msg: any) => {
      if (!isGameHost) return;
      if (msg.type === 'CLIENT_READY') {
          pendingSnapshotRef.current = true;
          return;
      }
      actionQueueRef.current.push({ type: msg.type, payload: msg.payload });
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
    if (!isGameHost || !isConnected) return;
    
    if (pendingSnapshotRef.current) {
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
    }
    
  }, [isGameHost, isConnected, sendGameData, playerStates, players, gameStatus, currentWave, isIntermission, waveStartCountdown, versusState, difficulty]);

  useEffect(() => {
      if (isConnected && !isGameHost && localPlayerId === 'player2') {
          sendAction('CLIENT_READY', {});
      }
  }, [isConnected, isGameHost, localPlayerId, sendAction]);

  const dispatchAction = useCallback((actionType: string, payload: any) => {
    if (isSpectator) return;
    const finalPayload = { ...payload, playerId: payload.playerId ?? localPlayerId };
    
    if (isGameHost) {
      actionQueueRef.current.push({ type: actionType, payload: finalPayload });
    } else {
      sendAction(actionType, finalPayload);
    }
  }, [isGameHost, sendAction, localPlayerId, isSpectator]);

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

            if (data.versusState) setVersusState(data.versusState);

            // HOST: Load initial state ONCE
            if (role === 'player1' && !gameDataLoaded) {
                 if (data.playerStates) setPlayerStates(data.playerStates);
                 setGameDataLoaded(true);
                 setLoading(false);
            } else if (role !== 'player1') {
                // CLIENT: Let the host dictate state via WebRTC.
                // We only use Firestore for player info here.
                if (!gameDataLoaded) {
                    setGameDataLoaded(true);
                    setLoading(false);
                }
            }
        });
    };

    joinAndListen().catch(err => {
        console.error("Error in joinAndListen", err);
        toast({ title: 'Fehler beim beitreten.', variant: 'destructive' });
        router.push('/');
    });

    return () => unsub?.();
  }, [user, gameId, router, toast, configLoading, gameDataLoaded]);
  
  const startWave = useCallback(() => {
    if (!gameConfig) return;
    const waveData = gameConfig.waves[currentWaveRef.current];
    if (!waveData) return;

    audioManager.play({ kind: 'sfx', name: 'wave_start' });
    const difficultyMod = difficultyModifiers[difficultyRef.current];
    
    const createEnemiesForWave = (ownerId: Player['id']) => {
        return Array.from({ length: waveData.enemies.count }).map((_, i) => {
            const health = Math.round(waveData.enemies.health * difficultyMod.enemyHealth);
            return {
                id: `enemy-${ownerId}-${currentWaveRef.current}-${enemyIdCounter.current++}`,
                owner: ownerId, type: waveData.enemies.type,
                health, maxHealth: health, armor: waveData.enemies.armor, speed: waveData.enemies.speed, damage: waveData.enemies.damage, bounty: waveData.enemies.bounty,
                path: [], pathIndex: 0, position: { row: 1, col: 1 }, isBlocked: false, effects: [],
                lastMove: 0, wasHit: false, targetNode: { row: GRID_ROWS, col: GRID_COLS }, movementPattern: 'wobble', vx: 0, vy: 0,
                _spawnTime: i * waveData.enemies.spawnDelay,
            };
        });
    }

    p1SpawnQueueRef.current = createEnemiesForWave('player1');
    p2SpawnQueueRef.current = createEnemiesForWave('player2');
    
    waveStartTimeRef.current = Date.now();
  }, [gameConfig]);
  
  const onHostAction = useCallback((type: string, payload: any) => {
    const { playerId, row, col, towerId, cost, incomeBonus, type: enemyType } = payload;
          
    let updatedPlayers = [...playersRef.current];
    const playerIndex = updatedPlayers.findIndex(p => p.id === playerId);
    if (playerIndex === -1) return;

    let player = {...updatedPlayers[playerIndex]};
    
    let updatedPlayerStates = {...playerStatesRef.current};
    const playerStateKey = playerId as keyof typeof updatedPlayerStates;
    let playerState = updatedPlayerStates[playerStateKey] ? {...updatedPlayerStates[playerStateKey]!} : null;
    if (!playerState) return;

    if (type === 'BUILD_TOWER_REQUEST') {
        const buildResult = enqueueBuildOrder(
            { gameMode: 'versus', players: updatedPlayers, playerStates: updatedPlayerStates, currentWave: currentWaveRef.current, difficulty: difficultyRef.current, gameStatus: 'playing', isIntermission: false, waveStartCountdown: 0 },
            player.id.includes('1') ? 'worker-1' : 'worker-2',
            row, col, towerId, Date.now()
        );
        player = buildResult.players[playerIndex];
        playerState = buildResult.playerStates![playerStateKey];
    } else if (type === 'SEND_ENEMY_REQUEST') {
        if (player.resources >= cost) {
            player.resources -= cost;
            player.incomePerSecond += incomeBonus;
            const opponentId = playerId === 'player1' ? 'player2' : 'player1';
            
            const waveData = gameConfig!.waves[0]; 
            const health = Math.round((waveData.enemies.health * 0.8) + (currentWaveRef.current * 10));

            const newEnemy: Enemy = {
              id: `sent-${playerId}-${enemyIdCounter.current++}`, owner: playerId, type: enemyType,
              health, maxHealth: health, armor: waveData.enemies.armor, speed: waveData.enemies.speed, damage: waveData.enemies.damage, bounty: 0,
              path: [], pathIndex: 0, position: { row: 1, col: 1 }, isBlocked: false, effects: [],
              lastMove: 0, wasHit: false, targetNode: { row: GRID_ROWS, col: GRID_COLS }, movementPattern: 'wobble', vx: 0, vy: 0,
            };
            
            const opponentState = updatedPlayerStates[opponentId]!;
            opponentState.enemies = [...opponentState.enemies, newEnemy];
        }
    } else if (type === 'START_WAVE_NOW_REQUEST') {
        if (gameStatusRef.current === 'waiting') setGameStatus('playing');
        
        setIsIntermission(false);
        setWaveStartCountdown(0);
        setCurrentWave(w => w + 1);
        startWave();
    }
    
    updatedPlayers[playerIndex] = player;
    updatedPlayerStates[playerStateKey] = playerState;
    setPlayers(updatedPlayers);
    setPlayerStates(updatedPlayerStates);
  }, [gameConfig, startWave]);
  
  useEffect(() => {
    if (!isGameHost || !gameConfig) {
      if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current);
      return;
    }
  
    let stopped = false;
  
    const gameLoop = () => {
      if (stopped) return;
      gameLoopRef.current = requestAnimationFrame(gameLoop);
  
      const now = performance.now();
      const delta = now - lastTickRef.current;
      if (delta === 0) return;
      lastTickRef.current = now;
      
      const ps = playerStatesRef.current;
      if (!ps.player1 || !ps.player2 || gameStatusRef.current !== 'playing') {
          return;
      }
      
      const epochNow = Date.now();
      frameCountRef.current++;
      if (epochNow - lastFpsUpdateRef.current >= 1000) {
        setFps(frameCountRef.current);
        frameCountRef.current = 0;
        lastFpsUpdateRef.current = epochNow;
      }
  
      if (actionQueueRef.current.length > 0) {
        const currentActions = actionQueueRef.current.splice(0);
        for (const { type, payload } of currentActions) {
          onHostAction(type, payload);
        }
      }
      
      const updatedStates = tickWorkers({ gameMode: 'versus', players: playersRef.current, playerStates: playerStatesRef.current, currentWave: currentWaveRef.current, difficulty: difficultyRef.current, gameStatus: 'playing', isIntermission: false, waveStartCountdown: 0 }, delta, epochNow, gameConfig.towers);
      setPlayers(updatedStates.players);
      setPlayerStates(updatedStates.playerStates!);

      if (!isIntermissionRef.current) {
          const timeSinceWaveStart = Date.now() - waveStartTimeRef.current;
          let p1Enemies = [...playerStatesRef.current.player1.enemies];
          let p2Enemies = [...playerStatesRef.current.player2.enemies];

          const spawnEnemies = (queueRef: React.MutableRefObject<any[]>, path: Node[]) => {
              const toSpawn = queueRef.current.filter(e => e._spawnTime <= timeSinceWaveStart);
              if (toSpawn.length > 0) {
                  queueRef.current = queueRef.current.filter(e => e._spawnTime > timeSinceWaveStart);
                  return toSpawn.map(e => ({ ...e, lastMove: epochNow, path: path }));
              }
              return [];
          }
          
          p1Enemies.push(...spawnEnemies(p1SpawnQueueRef, playerStatesRef.current.player1.currentPath));
          p2Enemies.push(...spawnEnemies(p2SpawnQueueRef, playerStatesRef.current.player2.currentPath));

          setPlayerStates(current => ({
              ...current,
              player1: { ...current.player1, enemies: p1Enemies },
              player2: { ...current.player2, enemies: p2Enemies }
          }));
      }

      // --- Sync State ---
      if (epochNow - lastDeltaSentRef.current > 100) {
        deltaQueueRef.current.push([DeltaType.PLAYER_STATES_UPDATE, playerStatesRef.current]);
        deltaQueueRef.current.push([DeltaType.PLAYER_UPDATE, playersRef.current]);
        deltaQueueRef.current.push([DeltaType.GAME_STATE_UPDATE, {
          lives: 0, // Not used in versus, just to satisfy type
          currentWave: currentWaveRef.current,
          gameStatus: gameStatusRef.current,
          isIntermission: isIntermissionRef.current,
          waveStartCountdown: waveStartCountdownRef.current,
        }]);
        
        const deltasToSend = [...deltaQueueRef.current];
        if (deltasToSend.length > 0) {
           sendGameData('deltas', deltasToSend);
        }
        deltaQueueRef.current = [];
        lastDeltaSentRef.current = epochNow;
      }
    };
  
    gameLoopRef.current = requestAnimationFrame(gameLoop);
    return () => { stopped = true; if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current); };
  
  }, [isGameHost, configLoading, gameConfig, sendGameData, onHostAction]);

  const handleGameControl = useCallback(() => {
    if (!isGameHost) return;

    setGameStatus(prev => {
        if (prev === 'waiting') return 'playing';
        if (prev === 'playing') return 'paused';
        if (prev === 'paused') return 'playing';
        return prev;
    });
  }, [isGameHost]);

  const handleStartNextWaveNow = useCallback(() => {
      dispatchAction('START_WAVE_NOW_REQUEST', {});
  }, [dispatchAction]);

  if (loading || configLoading || !localPlayer || !localPlayerState) {
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
          gameState={localPlayerState}
          localPlayer={localPlayer}
          opponentPlayerState={opponentPlayerState}
          currentWave={currentWave}
          totalWaves={gameConfig?.waves.length ?? 0}
          difficulty={difficulty}
          handleGameControl={handleGameControl}
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
          handleStartNextWaveNow={handleStartNextWaveNow}
          lastUpgradedTowerId={lastUpgradedTowerId}
          isCoop={false}
          playerRole={localPlayerId}
          handleLoadTestLayout={() => {}}
          handleLoadAllTowersLayout={() => {}}
          isCheating={isCheating}
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
