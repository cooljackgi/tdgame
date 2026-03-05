

'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import type { User } from 'firebase/auth';
import { onAuthStateChanged, auth } from '@/lib/firebase';
import { doc, onSnapshot, Unsubscribe, getDoc } from 'firebase/firestore';
import { db, functions } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { normalizePlayers } from '@/lib/player-utils';
import type { Player, PlayerGameState, GameStatus, Tower, Difficulty, Node, PlacedTower, VersusEnemyToSend, GameSessionState, GameDelta, Worker, GhostFoundation, Attack, DamageNumber, SplashRing, PersistentCloud, LifeGainVfx, GravityWell, SoundEvent, VersusState, Enemy, ProcessAttackResult, Element } from '@/lib/game-data/types';
import { INTERMISSION_TIME, difficultyModifiers, GRID_COLS, GRID_ROWS, ALL_PICKABLE_ELEMENTS } from '@/lib/game-data/constants';
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
import { ElementPickDialog } from './element-pick-dialog';

const VERSUS_WAVE_INTERVAL = 60; // 60 seconds

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
  const [waveStartCountdown, setWaveStartCountdown] = useState(VERSUS_WAVE_INTERVAL);
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
  const [firingTowerIds, setFiringTowerIds] = useState<Set<string>>(new Set());
  
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
    if (!isGameHost || !playerStates.player1?.towersByCell) return;
    const newPath = findPath({row:1,col:1},{row:GRID_ROWS,col:GRID_COLS}, Object.values(playerStates.player1.towersByCell).map(t => t.position), GRID_ROWS, GRID_COLS) ?? [];
    setPlayerStates(current => ({ ...current, player1: { ...current.player1, currentPath: newPath }}));
  }, [isGameHost, playerStates.player1.towersByCell]);

  useEffect(() => {
      if (!isGameHost || !playerStates.player2?.towersByCell) return;
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
                 case DeltaType.VFX_DAMAGE: gameBoardRef.current?.queueDamageNumbers(deltaPayload); break;
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
            console.error("Failed to load game config, using defaults:", error);
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

            if (role === 'player1' && !gameDataLoaded) {
                 if (data.playerStates) {
                    setPlayerStates(data.playerStates);
                 }
                 setGameDataLoaded(true);
                 setLoading(false);
            } else if (role !== 'player1') {
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

    audioManager.play({ kind: 'sfx', name: 'wave_start' });
    const difficultyMod = difficultyModifiers[difficultyRef.current];

    const createEnemiesForPlayer = (targetPlayerId: 'player1' | 'player2') => {
        const sendingPlayerId = targetPlayerId === 'player1' ? 'player2' : 'player1';
        const spawnQueue = versusStateRef.current[sendingPlayerId]?.spawnQueue || [];
        let enemiesToSpawn: any[] = [];
        
        if (spawnQueue.length > 0) {
            spawnQueue.forEach(item => {
                const baseEnemy = gameConfig.waves.find(w => w.enemies.type === item.type)?.enemies;
                if(baseEnemy) {
                    for(let i = 0; i < item.count; i++) {
                         const health = Math.round(baseEnemy.health * difficultyMod.enemyHealth);
                         enemiesToSpawn.push({
                            id: `enemy-${targetPlayerId}-${currentWaveRef.current}-${enemyIdCounter.current++}`,
                            owner: targetPlayerId, type: item.type,
                            health, maxHealth: health, armor: baseEnemy.armor, speed: baseEnemy.speed, damage: baseEnemy.damage, bounty: baseEnemy.bounty,
                            path: [], pathIndex: 0, position: { row: 1, col: 1 }, isBlocked: false, effects: [],
                            lastMove: 0, wasHit: false, targetNode: { row: GRID_ROWS, col: GRID_COLS }, movementPattern: 'wobble', vx: 0, vy: 0,
                            _spawnTime: enemiesToSpawn.length * 500, // Stagger spawns
                         });
                    }
                }
            });
        } else {
            // Default wave if nothing was sent
            const baseEnemy = gameConfig.waves.find(w => w.enemies.type === 'standard')?.enemies;
            if (baseEnemy) {
                for(let i = 0; i < 5; i++) {
                     const health = Math.round(baseEnemy.health * difficultyMod.enemyHealth);
                     enemiesToSpawn.push({
                        id: `enemy-${targetPlayerId}-${currentWaveRef.current}-${enemyIdCounter.current++}`,
                        owner: targetPlayerId, type: 'standard',
                        health, maxHealth: health, armor: baseEnemy.armor, speed: baseEnemy.speed, damage: baseEnemy.damage, bounty: baseEnemy.bounty,
                        path: [], pathIndex: 0, position: { row: 1, col: 1 }, isBlocked: false, effects: [],
                        lastMove: 0, wasHit: false, targetNode: { row: GRID_ROWS, col: GRID_COLS }, movementPattern: 'wobble', vx: 0, vy: 0,
                        _spawnTime: i * 800,
                     });
                }
            }
        }
        return enemiesToSpawn;
    };
    
    p1SpawnQueueRef.current = createEnemiesForPlayer('player1');
    p2SpawnQueueRef.current = createEnemiesForPlayer('player2');
    
    setVersusState(v => ({
      ...v,
      player1: { ...v.player1, spawnQueue: [] },
      player2: { ...v.player2, spawnQueue: [] },
    }));

    waveStartTimeRef.current = Date.now();
  }, [gameConfig]);
  
  const onHostAction = useCallback((type: string, payload: any) => {
    if (!gameConfig) return;

    const { playerId, row, col, towerId, cost, incomeBonus, type: enemyType, upgradeId, element } = payload;
    
    const players = playersRef.current;
    const playerStates = playerStatesRef.current;
    const versusState = versusStateRef.current;

    switch (type) {
        case 'PICK_ELEMENT_REQUEST': {
            const playerToUpdate = players.find(p => p.id === playerId);
            if (playerToUpdate) {
                playerToUpdate.unlockedElements = Array.from(new Set([...playerToUpdate.unlockedElements, element]));

                const allPlayersPicked = players.every((p: Player) => {
                    if (!p) return true;
                    // Corrected logic for expected elements
                    const expectedElements = 1 + Math.floor(currentWaveRef.current / 5);
                    return (p.unlockedElements?.length ?? 0) >= expectedElements;
                });

                if (allPlayersPicked) {
                    gameStatusRef.current = 'playing';
                    isIntermissionRef.current = true;
                    waveStartCountdownRef.current = VERSUS_WAVE_INTERVAL;
                    setGameStatus('playing');
                    setIsIntermission(true);
                    setWaveStartCountdown(VERSUS_WAVE_INTERVAL);
                    
                    // CRITICAL: Send game state update to client so they know intermission started
                    deltaQueueRef.current.push([DeltaType.GAME_STATE_UPDATE, {
                        currentWave: currentWaveRef.current,
                        gameStatus: 'playing',
                        isIntermission: true,
                        waveStartCountdown: VERSUS_WAVE_INTERVAL
                    }]);
                }
            }
            break;
        }
        case 'BUILD_TOWER_REQUEST':
        case 'UPGRADE_TOWER_REQUEST':
        case 'SELL_TOWER_REQUEST': {
            const playerStateKey = playerId as keyof typeof playerStates;
            let playerState = playerStates[playerStateKey];
            let player = players.find(p => p.id === playerId);
            if (!playerState || !player) break;

            if (type === 'BUILD_TOWER_REQUEST') {
                const buildResult = enqueueBuildOrder({ gameMode: 'versus', players, playerStates, currentWave: currentWaveRef.current, difficulty: difficultyRef.current, gameStatus: 'playing', isIntermission: false, waveStartCountdown: 0 }, player.id.includes('1') ? 'worker-1' : 'worker-2', row, col, towerId, Date.now());
                player = buildResult.players.find(p => p.id === playerId)!;
                playerState = buildResult.playerStates![playerStateKey];
            } else if (type === 'UPGRADE_TOWER_REQUEST') {
                const key = `${row}_${col}`;
                const existingTower = playerState.towersByCell[key];
                if (!existingTower || existingTower.ownerId !== player.id) break;
                const upgradeSpec = gameConfig!.towers.find(t => t.id === upgradeId);
                if(!upgradeSpec) break;
                const upgradeCost = upgradeSpec.cost - Math.floor(existingTower.cost * 0.75);
                if (player.resources < upgradeCost) break;

                player.resources -= upgradeCost;
                playerState.towersByCell[key] = { ...existingTower, ...upgradeSpec, specId: upgradeSpec.id, health: upgradeSpec.maxHealth, id: existingTower.id };
            } else if (type === 'SELL_TOWER_REQUEST') {
                const key = `${row}_${col}`;
                const towerToSell = playerState.towersByCell[key];
                if (!towerToSell || towerToSell.ownerId !== player.id) break;
                player.resources += Math.round(towerToSell.cost * 0.75);
                delete playerState.towersByCell[key];
            }
            break;
        }

        case 'SEND_ENEMY_REQUEST': {
            const player = players.find(p => p.id === playerId);
            if (player && player.resources >= cost) {
                player.resources -= cost;
                player.incomePerSecond += incomeBonus;
                
                const queueKey = player.id as 'player1' | 'player2';
                const existingEntryIndex = versusState[queueKey].spawnQueue.findIndex(e => e.type === enemyType);
                let newQueue;
                if (existingEntryIndex > -1) {
                    newQueue = [...versusState[queueKey].spawnQueue];
                    newQueue[existingEntryIndex] = { ...newQueue[existingEntryIndex], count: newQueue[existingEntryIndex].count + 1 };
                } else {
                    newQueue = [...versusState[queueKey].spawnQueue, { type: enemyType, count: 1 }];
                }
                versusState[queueKey] = { spawnQueue: newQueue };
            }
            break;
        }
        
        case 'START_WAVE_NOW_REQUEST': {
            if (gameStatusRef.current === 'waiting') setGameStatus('playing');
            setIsIntermission(false);
            setWaveStartCountdown(0);
            setCurrentWave(w => w + 1);
            startWave();
            break;
        }
    }
    
    setPlayers([...players]);
    setPlayerStates({...playerStates});
    setVersusState({...versusState});

  }, [gameConfig, startWave]);

  const handleEndOfWave = useCallback(() => {
    if (!isGameHost) return;

    const nextWaveIndex = currentWaveRef.current + 1;
    if (nextWaveIndex % 5 === 0) {
        setGameStatus('picking-element');
    } else {
        setIsIntermission(true);
        setWaveStartCountdown(VERSUS_WAVE_INTERVAL);
    }
  }, [isGameHost]);

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
      if (!ps.player1 || !ps.player2) {
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
      
      playersRef.current.forEach(p => {
          p.resources += (p.incomePerSecond * (delta / 1000));
      });
      setPlayers([...playersRef.current]);

      const updatedStates = tickWorkers({ gameMode: 'versus', players: playersRef.current, playerStates: playerStatesRef.current, currentWave: currentWaveRef.current, difficulty: difficultyRef.current, gameStatus: 'playing', isIntermission: false, waveStartCountdown: 0 }, delta, epochNow, gameConfig.towers);
      playersRef.current = updatedStates.players;
      playerStatesRef.current = updatedStates.playerStates!;
      setPlayerStates({...playerStatesRef.current});
      
      if (gameStatusRef.current !== 'playing') return;

      if(isIntermissionRef.current) {
          setWaveStartCountdown(prev => {
              const newTime = prev - delta / 1000;
              if (newTime <= 0) {
                  setIsIntermission(false);
                  setWaveStartCountdown(0);
                  setCurrentWave(w => w + 1);
                  startWave();
                  return 0;
              }
              return newTime;
          });
      } else {
          const playerIds: ('player1' | 'player2')[] = ['player1', 'player2'];
          const allNewDamageNumbers: DamageNumber[] = [];
          
          for (const pId of playerIds) {
              const pState = playerStatesRef.current[pId] as PlayerGameState;
              const player = playersRef.current.find(p => p.id === pId)!;

              if (!pState) continue;
              
              const spawnQueue = pId === 'player1' ? p1SpawnQueueRef : p2SpawnQueueRef;
              const path = pState.currentPath;
              if (spawnQueue.current.length > 0) {
                  const timeSinceWaveStart = epochNow - waveStartTimeRef.current;
                  const toSpawn = spawnQueue.current.filter((e:any) => e._spawnTime <= timeSinceWaveStart);
                  if (toSpawn.length > 0) {
                      spawnQueue.current = spawnQueue.current.filter((e:any) => e._spawnTime > timeSinceWaveStart);
                      pState.enemies.push(...toSpawn.map((e: any) => ({ ...e, lastMove: epochNow, path })));
                  }
              }
              
              const newFiringTowerIds = new Set<string>();
              Object.values(pState.towersByCell).forEach((tower: PlacedTower) => {
                  if (epochNow - tower.lastAttack >= tower.attackSpeed) {
                      let targets: Enemy[] = [];
                      const potentialTargets = pState.enemies.filter((e: Enemy) => {
                          if (e.deathTimestamp) return false;
                          const distSq = (tower.position.col - e.position.col) ** 2 + (tower.position.row - e.position.row) ** 2;
                          return distSq <= tower.range * tower.range;
                      });
                      if (potentialTargets.length > 0) {
                          targets.push(potentialTargets.sort((a,b) => b.pathIndex - a.pathIndex)[0]);
                      }
                      
                      if (targets.length > 0) {
                          tower.lastAttack = epochNow;
                          newFiringTowerIds.add(tower.id);
                          
                          for (const target of targets) {
                              const result = processAttack(tower, target, pState.enemies, epochNow, false);
                              pState.enemies = result.updatedEnemies;
                              allNewDamageNumbers.push(...result.damageNumbers);

                              if (result.killed > 0) {
                                  player.resources += target.bounty;
                              }
                          }
                      }
                  }
              });
              setFiringTowerIds(newFiringTowerIds);

              const stillAlive: Enemy[] = [];
              for (const enemy of pState.enemies) {
                  if (enemy.deathTimestamp && epochNow - enemy.deathTimestamp > 2500) continue;
                  if (enemy.deathTimestamp) { stillAlive.push(enemy); continue; }

                  const dotResult = tickDots(enemy, delta);
                   if (dotResult.totalDamage > 0) {
                        allNewDamageNumbers.push({ id: crypto.randomUUID(), amount: dotResult.totalDamage, targetId: enemy.id, color: '#f97316' });
                    }
                  if(dotResult.killed) { 
                      enemy.deathTimestamp = epochNow; 
                      stillAlive.push(enemy);
                      player.resources += enemy.bounty;
                      continue; 
                  }

                  const stunEffect = enemy.effects.find(e => e.type === 'stun' && e.expires > epochNow);
                  if (stunEffect) { stillAlive.push(enemy); continue; }

                  let timeToMove = epochNow - enemy.lastMove;
                  const stepMs = 1000 / Math.max(0.01, enemy.speed);
                  
                  while (timeToMove >= stepMs) {
                    if (enemy.pathIndex < enemy.path.length - 1) {
                      enemy.pathIndex++;
                      enemy.position = enemy.path[enemy.pathIndex];
                      timeToMove -= stepMs;
                      enemy.lastMove += stepMs;
                    } else {
                      pState.lives = Math.max(0, pState.lives - 1);
                      enemy.health = 0;
                      enemy.deathTimestamp = epochNow; 
                      break;
                    }
                  }
                  if (!enemy.deathTimestamp) stillAlive.push(enemy);
              }
              pState.enemies = stillAlive;
          }

            const p1Enemies = playerStatesRef.current.player1.enemies;
            const p2Enemies = playerStatesRef.current.player2.enemies;
            const p1QueueEmpty = p1SpawnQueueRef.current.length === 0;
            const p2QueueEmpty = p2SpawnQueueRef.current.length === 0;

            if (p1QueueEmpty && p2QueueEmpty && p1Enemies.every(e => e.deathTimestamp) && p2Enemies.every(e => e.deathTimestamp)) {
                handleEndOfWave();
            }

          if (allNewDamageNumbers.length > 0) {
              gameBoardRef.current?.queueDamageNumbers(allNewDamageNumbers);
              deltaQueueRef.current.push([DeltaType.VFX_DAMAGE, allNewDamageNumbers]);
          }
      }

      if (epochNow - lastDeltaSentRef.current > 100) {
        deltaQueueRef.current.push([DeltaType.PLAYER_STATES_UPDATE, playerStatesRef.current]);
        deltaQueueRef.current.push([DeltaType.PLAYER_UPDATE, playersRef.current]);
        deltaQueueRef.current.push([DeltaType.GAME_STATE_UPDATE, { lives: 0, currentWave: currentWaveRef.current, gameStatus: gameStatusRef.current, isIntermission: isIntermissionRef.current, waveStartCountdown: waveStartCountdownRef.current, }]);
        deltaQueueRef.current.push([DeltaType.VERSUS_STATE_UPDATE, versusStateRef.current]);
        
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
  
  }, [isGameHost, configLoading, gameConfig, sendGameData, onHostAction, startWave, handleEndOfWave]);

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
          waveStartCountdown={Math.ceil(waveStartCountdown)}
          intermissionTime={VERSUS_WAVE_INTERVAL}
          handleStartNextWaveNow={handleStartNextWaveNow}
          lastUpgradedTowerId={lastUpgradedTowerId}
          isCoop={false}
          playerRole={localPlayerId}
          handleLoadTestLayout={() => {}}
          handleLoadAllTowersLayout={() => {}}
          isCheating={isCheating}
          cheat_unlockAll={() => {}}
          firingTowerIds={firingTowerIds}
          allTowers={gameConfig?.towers ?? []}
          isWsConnected={isConnected}
          onPing={() => {}}
          isPlacingPortalEntrance={portalPhase !== 'idle'}
          onSendEnemy={(payload) => dispatchAction('SEND_ENEMY_REQUEST', payload as any)}
          gameMode="versus"
        />
      </div>
      {players.map(p => {
            if (!p || p.id !== localPlayerId) return null;
            
            const expectedElements = 1 + Math.floor(currentWave / 5);
            const shouldPick = gameStatus === 'picking-element' && (p.unlockedElements?.length ?? 0) < expectedElements;

            return (
                <ElementPickDialog
                    key={p.id}
                    isOpen={shouldPick}
                    onElementPick={(element) => dispatchAction('PICK_ELEMENT_REQUEST', { element })}
                    playerName={p.name}
                    currentWave={currentWave}
                    unlockedElements={new Set(p.unlockedElements)}
                />
            );
        })}
    </div>
  );
}
