

'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import type { User } from 'firebase/auth';
import { onAuthStateChanged, auth } from '@/lib/firebase';
import { doc, onSnapshot, Unsubscribe, updateDoc, collection, addDoc, serverTimestamp, getDoc } from 'firebase/firestore';
import { db, functions } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { normalizePlayers } from '@/lib/player-utils';
import type { Player, GameState, GameStatus, PlacedTower, Difficulty, Tower, Element, Enemy, Attack, DamageNumber, SplashRing, Node, EnemyStatusEffect, TowerEffect, PingPayload, RequestPayload, RequestResolve, PingKind, LifeGainVfx, GravityWell, PersistentCloud, SoundEvent, Worker, GhostFoundation, GameSessionState, Portal, PlayerGameState, VersusState } from '@/lib/game-data/types';
import { DeltaType } from '@/lib/game-data/types';
import { INTERMISSION_TIME, difficultyModifiers, GRID_ROWS, GRID_COLS, ALL_PICKABLE_ELEMENTS } from '@/lib/game-data/constants';
import { httpsCallable } from 'firebase/functions';
import { Loader2 } from 'lucide-react';
import { useWebRTC } from '@/hooks/use-webrtc';
import { findPath } from '@/lib/pathfinding';
import { useIsMobile } from '@/hooks/use-mobile';
import { DesktopLayout } from '@/components/layouts/desktop-layout';
import { MobileLayout } from '@/components/layouts/mobile-layout';
import { ElementPickDialog } from './element-pick-dialog';
import Header from './header';
import { audioManager } from '@/lib/audio/audio-manager';
import { processAttack, tickDots, tickWorkers } from '@/lib/game-logic';
import { enqueueBuildOrder, enqueueMoveOrder, enqueuePlacePortalOrder } from '@/lib/commands';
import { onGameEnd as performGameEndActions } from '@/lib/game-end';
import type { GameBoardHandle } from './game-board';
import { loadGameConfig, type GameConfig } from '@/lib/game-config-loader';
import { logGameStats } from '@/lib/logging';


export default function CoopGameLoader() {
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
  const [playerStates, setPlayerStates] = useState<Record<string, PlayerGameState>>({});

  const [currentWave, setCurrentWave] = useState(0);
  const [gameStatus, setGameStatus] = useState<GameStatus>('waiting');
  const [isIntermission, setIsIntermission] = useState(true);
  const [waveStartCountdown, setWaveStartCountdown] = useState(INTERMISSION_TIME);
  const [difficulty, setDifficulty] = useState<Difficulty>('Normal');
  const [gameMode, setGameMode] = useState<'coop' | 'versus'>('coop');
  const [versusState, setVersusState] = useState<VersusState | null>(null);


  const [localPlayerId, setLocalPlayerId] = useState<'player1' | 'player2' | 'spectator' | null>(null);
  const [gameDataLoaded, setGameDataLoaded] = useState(false);
  
  // Stats
  const [totalKilled, setTotalKilled] = useState(0);
  const [totalLeaked, setTotalLeaked] = useState(0);

  // Host-specific states
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
    return players.find(p => p.id === localPlayerId) || null;
  }, [players, localPlayerId]);


  // Host-side Game Loop & State Refs
  const gameLoopRef = useRef<number>();
  const lastTickRef = useRef(performance.now());
  const frameCountRef = useRef(0);
  const lastFpsUpdateRef = useRef(Date.now());
  const fpsRef = useRef(0);

  const deltaQueueRef = useRef<any[]>([]);
  const lastDeltaSentRef = useRef(0);
  
  const playerStatesRef = useRef(playerStates);
  useEffect(() => { playerStatesRef.current = playerStates }, [playerStates]);

  const gameStatusRef = useRef(gameStatus);
  useEffect(() => { gameStatusRef.current = gameStatus }, [gameStatus]);
  const isIntermissionRef = useRef(isIntermission);
  useEffect(() => { isIntermissionRef.current = isIntermission }, [isIntermission]);
  const playersRef = useRef(players);
  useEffect(() => { playersRef.current = players; }, [players]);
  const isLogicPausedRef = useRef(isLogicPaused);
  useEffect(() => { isLogicPausedRef.current = isLogicPaused; }, [isLogicPaused]);
  const currentWaveRef = useRef(currentWave);
  useEffect(() => { currentWaveRef.current = currentWave }, [currentWave]);
  
  
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
        const deltas = msg.payload as any[];
        for (const delta of deltas) {
            const deltaType = delta[0];
            const deltaPayload = delta[1];
            switch(deltaType) {
                case DeltaType.SNAPSHOT:
                  setPlayers(deltaPayload.players);
                  setPlayerStates(deltaPayload.playerStates);
                  setCurrentWave(deltaPayload.currentWave);
                  setIsIntermission(deltaPayload.isIntermission);
                  setWaveStartCountdown(deltaPayload.waveStartCountdown);
                  setGameStatus(deltaPayload.gameStatus);
                  setGameMode(deltaPayload.gameMode);
                  if (deltaPayload.gameMode === 'versus') {
                      setVersusState(deltaPayload.versusState);
                  }
                  break;
                case DeltaType.PLAYER_UPDATE: setPlayers(deltaPayload); break;
                case DeltaType.GAME_STATE_UPDATE: 
                    const gs = deltaPayload;
                    setCurrentWave(gs.currentWave);
                    setGameStatus(gs.gameStatus);
                    setIsIntermission(gs.isIntermission);
                    setWaveStartCountdown(gs.waveStartCountdown);
                    break;
                case DeltaType.TOWERS_UPDATE:
                case DeltaType.ENEMY_UPDATE:
                case DeltaType.WORKER_UPDATE:
                case DeltaType.GHOST_UPDATE:
                case DeltaType.PORTAL_UPDATE:
                  setPlayerStates(prev => {
                      const newStates = { ...prev };
                      for (const playerId in deltaPayload) {
                          if (newStates[playerId as keyof typeof newStates]) {
                              newStates[playerId as keyof typeof newStates] = { ...newStates[playerId as keyof typeof newStates], ...deltaPayload[playerId] };
                          }
                      }
                      return newStates;
                  });
                  break;

                case DeltaType.STATS_UPDATE:
                    setTotalKilled(deltaPayload.totalKilled);
                    setTotalLeaked(deltaPayload.totalLeaked);
                    break;
                case DeltaType.AUDIO: audioManager.play(deltaPayload as SoundEvent); break;
                case DeltaType.VFX_ATTACK: gameBoardRef.current?.queueAttacks(deltaPayload as Attack[]); break;
                case DeltaType.VFX_DAMAGE: gameBoardRef.current?.queueDamageNumbers(deltaPayload as DamageNumber[]); break;
                case DeltaType.VFX_SPLASH: gameBoardRef.current?.queueSplashRings(deltaPayload as SplashRing[]); break;
                case DeltaType.VFX_TOWER_UPGRADE: 
                    audioManager.play({ kind: 'sfx', name: 'upgrade_tower' });
                    setLastUpgradedTowerId(deltaPayload.towerId);
                    setTimeout(() => setLastUpgradedTowerId(null), 500);
                    break;
                case DeltaType.VFX_TOWER_PLACE: 
                    audioManager.play({ kind: 'sfx', name: 'build_tower' });
                    setJustPlacedTowerId(deltaPayload.towerId);
                    setTimeout(() => setJustPlacedTowerId(null), 400);
                    break;
                case DeltaType.PING: gameBoardRef.current?.queuePing(deltaPayload as PingPayload); break;
                case DeltaType.REQUEST: gameBoardRef.current?.queueRequest(deltaPayload as RequestPayload); break;
                case DeltaType.REQUEST_RESOLVE: gameBoardRef.current?.resolveRequest(deltaPayload as RequestResolve); break;
            }
        }
    }
  }, [isGameHost, gameConfig, localPlayer]);

  const onHostAction = useCallback((action: 'build' | 'upgrade' | 'sell' | 'pick_element' | 'start_wave_now' | 'move_worker' | 'place_portal' | 'send_enemy', payload: any) => {
    if (!isGameHost || !gameConfig) return;
    
    // This is the core change. We now operate on playerStates.
    setPlayerStates(currentStates => {
      const newPlayerStates: Record<string, PlayerGameState> = JSON.parse(JSON.stringify(currentStates));

      // Determine which player's state to modify
      let targetPlayerId: 'player1' | 'player2' = payload.playerId;
      // For 'send_enemy', the target is the *other* player
      if (action === 'send_enemy') {
          targetPlayerId = payload.playerId === 'player1' ? 'player2' : 'player1';
      }
      
      let targetState = newPlayerStates[targetPlayerId as keyof typeof newPlayerStates];

      if (!targetState) {
        console.warn(`Action "${action}" targeted non-existent player state for ${targetPlayerId}`);
        return currentStates;
      }
       
      const actingPlayer = playersRef.current.find(p => p.id === payload.playerId);
      if(!actingPlayer) return currentStates;

      switch(action){
          case 'send_enemy': {
              const { type, cost, incomeBonus } = payload.enemy;
              if (actingPlayer.resources < cost) break;
              actingPlayer.resources -= cost;
              actingPlayer.incomePerSecond += incomeBonus;
              
              if (!versusState?.player1.spawnQueue) break; // Type guard

              const queueKey = targetPlayerId as 'player1' | 'player2';
              const queue = versusState![queueKey].spawnQueue;
              const existing = queue.find(item => item.type === type);
              if (existing) {
                  existing.count++;
              } else {
                  queue.push({ type, count: 1 });
              }
              deltaQueueRef.current.push([DeltaType.VERSUS_STATE_UPDATE, versusState!]);
              break;
          }
          case 'place_portal': {
              const { entrance, exit, playerId } = payload;
              const workerId = playerId === 'player1' ? 'worker-1' : 'worker-2';
              const stateToUpdate: GameSessionState = { players: playersRef.current, gameMode, ...targetState };
              const updatedState = enqueuePlacePortalOrder(stateToUpdate, workerId, entrance, exit, Date.now());
              targetState.workers = updatedState.workers;
              targetState.portals = updatedState.portals ?? [];
              if (playerId === localPlayerId) cancelInteractions();
              break;
          }
          case 'move_worker': {
              const { row, col, playerId } = payload;
              const workerId = playerId === 'player1' ? 'worker-1' : 'worker-2';
              const stateToUpdate: GameSessionState = { players: playersRef.current, gameMode, ...targetState };
              const updatedState = enqueueMoveOrder(stateToUpdate, workerId, row, col);
              targetState.workers = updatedState.workers;
              break;
          }
          case 'build': {
              const { playerId, row, col, towerId } = payload;
              const workerId = playerId === 'player1' ? 'worker-1' : 'worker-2';
              const stateToUpdate: GameSessionState = { players: playersRef.current, gameMode, ...targetState };
              const updatedState = enqueueBuildOrder(stateToUpdate, workerId, row, col, towerId, Date.now());
              targetState.ghosts = updatedState.ghosts;
              targetState.workers = updatedState.workers;
              
              // This is a direct mutation, but will be batched and sent
              const playerToUpdate = playersRef.current.find(p => p.id === playerId);
              if(playerToUpdate) playerToUpdate.resources = updatedState.players.find(p => p.id === playerId)!.resources;

              if (playerId === localPlayerId && isMobile) {
                 setSelectedTowerToBuild(null);
              }
              break;
          }
          // ... other actions (upgrade, sell, pick_element) would also need to target the correct playerState
      }
      
      // Batch updates for sending over network
      deltaQueueRef.current.push([DeltaType.PLAYER_UPDATE, playersRef.current]);
      deltaQueueRef.current.push([
          DeltaType.TOWERS_UPDATE, // Or a more specific type
          { [targetPlayerId]: { towersByCell: targetState.towersByCell, workers: targetState.workers, ghosts: targetState.ghosts, portals: targetState.portals } }
      ]);
      
      return newPlayerStates;
    });

  }, [isGameHost, gameConfig, localPlayerId, isMobile, cancelInteractions, gameMode, versusState]);
    
    const handleActionData = useCallback((msg: any) => {
        if (!isGameHost) return;
        const { type, payload } = msg;

        switch (type) {
            case 'CLIENT_READY': {
                const snapshot = {
                    players: playersRef.current,
                    playerStates: playerStatesRef.current,
                    currentWave: currentWaveRef.current,
                    isIntermission: isIntermissionRef.current,
                    waveStartCountdown: waveStartCountdown,
                    gameStatus: gameStatusRef.current,
                    difficulty,
                    gameMode,
                    versusState: gameMode === 'versus' ? versusState : undefined,
                };
                deltaQueueRef.current.push([DeltaType.SNAPSHOT, snapshot]);
                return;
            }
            case 'SEND_ENEMY_REQUEST':       onHostAction('send_enemy', payload); return;
            case 'PLACE_PORTAL_REQUEST':   onHostAction('place_portal', payload); return;
            case 'BUILD_TOWER_REQUEST':      onHostAction('build', payload); return;
            case 'MOVE_WORKER_REQUEST':      onHostAction('move_worker', payload); return;
            case 'UPGRADE_TOWER_REQUEST':    onHostAction('upgrade', payload); return;
            case 'SELL_TOWER_REQUEST':       onHostAction('sell', payload); return;
            case 'PICK_ELEMENT_REQUEST':     onHostAction('pick_element', payload); return;
            case 'START_WAVE_NOW_REQUEST':
              onHostAction('start_wave_now', payload);
              return;
            case 'PING_REQUEST':
                gameBoardRef.current?.queuePing(payload);
                deltaQueueRef.current.push([DeltaType.PING, payload]);
                return;
            case 'REQUEST':
                gameBoardRef.current?.queueRequest(payload);
                deltaQueueRef.current.push([DeltaType.REQUEST, payload]);
                return;
            case 'REQUEST_RESOLVE':
                deltaQueueRef.current.push([DeltaType.REQUEST_RESOLVE, payload]);
                return;
        }
    }, [isGameHost, onHostAction, waveStartCountdown, difficulty, gameMode, versusState]);
    
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

  const onLocalAction = useCallback((action: 'build' | 'upgrade' | 'sell' | 'pick_element' | 'start_wave_now' | 'move_worker' | 'place_portal' | 'send_enemy', payload: any) => {
      if (!localPlayerId || localPlayerId === 'spectator' || isGameHost) return;
      
      const actionTypeMap = {
        build: 'BUILD_TOWER_REQUEST',
        move_worker: 'MOVE_WORKER_REQUEST',
        place_portal: 'PLACE_PORTAL_REQUEST',
        upgrade: 'UPGRADE_TOWER_REQUEST',
        sell: 'SELL_TOWER_REQUEST',
        pick_element: 'PICK_ELEMENT_REQUEST',
        start_wave_now: 'START_WAVE_NOW_REQUEST',
        send_enemy: 'SEND_ENEMY_REQUEST',
      }
      const actionType = actionTypeMap[action];
      sendAction(actionType, { ...payload, playerId: localPlayerId });
  }, [localPlayerId, isGameHost, sendAction]);
  
  const dispatchAction = useCallback((action: 'build' | 'upgrade' | 'sell' | 'pick_element' | 'start_wave_now' | 'move_worker' | 'place_portal' | 'send_enemy', payload: any) => {
      const finalPayload = { ...payload, playerId: payload.playerId ?? localPlayerId };
      
      if (isGameHost) {
          onHostAction(action, finalPayload);
      } else {
          onLocalAction(action, finalPayload);
      }
  }, [isGameHost, onHostAction, onLocalAction, localPlayerId]);
  
  const localPlayerIdRef = useRef(localPlayerId);
  useEffect(() => {
      localPlayerIdRef.current = localPlayerId;
  }, [localPlayerId]);

  const sendPing = (kind: PingKind, row: number, col: number, msg?: string) => {
      const currentLocalPlayerId = localPlayerIdRef.current;
      if (!currentLocalPlayerId || currentLocalPlayerId === 'spectator') return;
      const payload: PingPayload = {
        id: crypto.randomUUID(),
        kind, from: currentLocalPlayerId as 'player1' | 'player2', row, col, msg, createdAt: Date.now(), ttl: 4000,
      };
      if (isGameHost) {
        gameBoardRef.current?.queuePing(payload);
        deltaQueueRef.current.push([DeltaType.PING, payload]);
      } else {
        sendAction('PING_REQUEST', payload);
      }
    };
    
    useEffect(() => {
      if (hasInteracted) return;
      const onFirstPointer = async () => {
        try {
            await audioManager.init();
            audioManager.primeHaptics();
            setHasInteracted(true);
        } catch {}
      };
      window.addEventListener('pointerdown', onFirstPointer, { once: true });
      window.addEventListener('touchstart', onFirstPointer, { once: true });
      return () => {
          window.removeEventListener('pointerdown', onFirstPointer);
          window.removeEventListener('touchstart', onFirstPointer);
      };
    }, [hasInteracted]);

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
        if (!user || !gameId || configLoading || !gameConfig) return;
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
                } else if (initialData.player1Id !== user.uid && initialData.player2Id !== user.uid) {
                    console.log("Joining as spectator.");
                }

                setLoadingMessage('Synchronisiere Spielzustand...');

                gameUnsub = onSnapshot(gameDocRef, (snap) => {
                    if (!snap.exists()) {
                        toast({ title: "Spiel nicht gefunden", variant: 'destructive'});
                        router.push('/');
                        return;
                    }
                    const data = snap.data();
                    if (!data) return;

                    let role: 'player1' | 'player2' | 'spectator' = 'spectator';
                    if (data.player1Id === user.uid) role = 'player1';
                    else if (data.player2Id === user.uid) role = 'player2';
                    setLocalPlayerId(role);

                    // HOST ONLY: Load initial state ONCE
                    if (role === 'player1' && !gameDataLoaded) {
                         setPlayers(normalizePlayers(data.players));
                         setDifficulty(data.difficulty || 'Normal');
                         const mode = data.gameMode || 'coop';
                         setGameMode(mode);
                         setGameStatus(data.gameStatus);
                         setIsIntermission(data.isIntermission ?? true);
                         setWaveStartCountdown(data.waveStartCountdown ?? INTERMISSION_TIME);
                         
                         const lives = data.gameState?.lives ?? difficultyModifiers[data.difficulty || 'Normal'].startLives;
                         
                        const p1Worker: Worker = { id: "worker-1", x: 64 * 3, y: 64 * 3, speed: 260, state: "idle", queue: [], moveTarget: null };
                        const p2Worker: Worker = { id: "worker-2", x: 64 * 3, y: 64 * 3, speed: 260, state: "idle", queue: [], moveTarget: null };
                        
                        let initialPlayerStates: Record<string, PlayerGameState>;
                        
                        if (mode === 'coop') {
                            const towersByCell = data.towersByCell || {};
                            const sharedState: PlayerGameState = {
                                lives,
                                towersByCell,
                                enemies: [],
                                workers: [p1Worker, p2Worker],
                                ghosts: [],
                                portals: [],
                                currentPath: findPath({row:1, col:1}, {row:GRID_ROWS, col:GRID_COLS}, Object.values(towersByCell).map(t => (t as PlacedTower).position), GRID_ROWS, GRID_COLS) ?? [],
                            };
                            initialPlayerStates = {
                                player1: sharedState,
                                player2: sharedState,
                            };
                        } else { // versus
                            const p1Towers = data.playerStates?.player1?.towersByCell || {};
                            const p2Towers = data.playerStates?.player2?.towersByCell || {};
                            initialPlayerStates = {
                               player1: {
                                 lives,
                                 towersByCell: p1Towers,
                                 enemies: [],
                                 workers: [p1Worker],
                                 ghosts: [],
                                 portals: [],
                                 currentPath: findPath({row:1, col:1}, {row:GRID_ROWS, col:GRID_COLS}, Object.values(p1Towers).map(t => (t as PlacedTower).position), GRID_ROWS, GRID_COLS) ?? [],
                               },
                               player2: {
                                 lives,
                                 towersByCell: p2Towers,
                                 enemies: [],
                                 workers: [p2Worker],
                                 ghosts: [],
                                 portals: [],
                                 currentPath: findPath({row:1, col:1}, {row:GRID_ROWS, col:GRID_COLS}, Object.values(p2Towers).map(t => (t as PlacedTower).position), GRID_ROWS, GRID_COLS) ?? [],
                               },
                             };
                        }
                         
                        setPlayerStates(initialPlayerStates);
                         
                         if(mode === 'versus') {
                            setVersusState(data.versusState || { nextWaveTimestamp: 0, player1: {spawnQueue: []}, player2: {spawnQueue: []} });
                         }

                         setGameDataLoaded(true);
                         setLoading(false);

                    } else if (role !== 'player1') {
                        setPlayers(normalizePlayers(data.players));
                        setGameMode(data.gameMode || 'coop');
                        if (!gameDataLoaded) {
                            setGameDataLoaded(true);
                            setLoading(false);
                        }
                    } else if (role === 'player1' && gameDataLoaded) {
                        setPlayers(currentPlayers => {
                           const newPlayers = normalizePlayers(data.players);
                           const self = currentPlayers.find(p => p.id === 'player1');
                           const other = newPlayers.find(p => p.id === 'player2');
                           const finalPlayers = [self, other].filter(Boolean) as Player[];
                           return finalPlayers;
                        });
                    }

                }, (err) => {
                    console.error("Error listening to game document:", err);
                    toast({ title: "Verbindung zum Spiel verloren", variant: 'destructive'});
                    router.push('/');
                });
            } catch (error: any) {
                console.error("Failed to join or listen to game:", error);
                toast({ title: "Beitritt fehlgeschlagen", description: error.message, variant: "destructive" });
                router.push('/');
            }
        };

        joinAndListen();

        return () => {
            if (gameUnsub) gameUnsub();
        }
    }, [user, gameId, router, toast, configLoading, gameDataLoaded, gameConfig]);
    

  const onGameEnd = useCallback(async (won: boolean, winningPlayerId?: Player['id']) => {
    if(gameStatusRef.current === 'gameover') return;
    setGameStatus('gameover');
  }, []);
  
  useEffect(() => {
      if (!gameConfig || !isGameHost) {
          if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current);
          return;
      }
      
      let stopped = false;
      lastTickRef.current = performance.now();

      const gameLoop = () => {
          if (stopped) return;
          gameLoopRef.current = requestAnimationFrame(gameLoop);
          
          const now = performance.now();
          const delta = now - lastTickRef.current;
          if (delta === 0) return;
          lastTickRef.current = now;

          // --- SECTION 1: ALWAYS RUN ---
          frameCountRef.current++;
          const epochNow = Date.now();
          if (epochNow - lastFpsUpdateRef.current >= 1000) {
            const currentFps = frameCountRef.current;
            setFps(currentFps);
            fpsRef.current = currentFps;
            frameCountRef.current = 0;
            lastFpsUpdateRef.current = epochNow;
          }

          if (epochNow > lastDeltaSentRef.current + 100) {
              const snapshot = {
                    players: playersRef.current,
                    playerStates: playerStatesRef.current,
                    currentWave: currentWaveRef.current,
                    isIntermission: isIntermissionRef.current,
                    waveStartCountdown: waveStartCountdown,
                    gameStatus: gameStatusRef.current,
                    difficulty,
                    gameMode,
                    versusState: gameMode === 'versus' ? versusState : undefined,
                };
              deltaQueueRef.current.push([DeltaType.SNAPSHOT, snapshot]);

              const deltasToSend = [...deltaQueueRef.current];
              if (deltasToSend.length > 0) {
                 sendGameData('deltas', deltasToSend);
              }
              deltaQueueRef.current = [];
              lastDeltaSentRef.current = epochNow;
          }

          // --- SECTION 2: PAUSABLE GAME LOGIC ---
          const currentStatus = gameStatusRef.current;
          const gameIsPaused = currentStatus === 'paused' || currentStatus === 'gameover' || currentStatus === 'picking-element' || isLogicPausedRef.current;

          if (gameIsPaused) return;

          // Update workers for all player states
          setPlayerStates(currentStates => {
            const newStates = JSON.parse(JSON.stringify(currentStates));
            for (const playerId in newStates) {
                if (playerId === 'spectator') continue;
                const pState = newStates[playerId as keyof typeof newStates];
                const sessionState: GameSessionState = { players: playersRef.current, gameMode, ...pState };
                const updated = tickWorkers(sessionState, delta, epochNow, gameConfig.towers);
                pState.workers = updated.workers;
                pState.ghosts = updated.ghosts;
                pState.portals = updated.portals ?? [];
                if (Object.keys(updated.towersByCell).length !== Object.keys(pState.towersByCell).length) {
                    pState.towersByCell = updated.towersByCell;
                }
            }
            return newStates;
          });
      };

      if(isGameHost){
          gameLoop();
      }
      
      return () => {
          stopped = true;
          if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current);
      }
  }, [isGameHost, user, gameId, difficulty, onGameEnd, sendGameData, gameConfig, waveStartCountdown, gameMode, versusState]);

  const toggleMute = () => {
    setIsMuted(current => {
      const newMuted = !current;
      if (newMuted) audioManager.mute();
      else audioManager.unmute();
      return newMuted;
    });
  };
  
  const handlePlaceAction = useCallback((row: number, col: number) => {
    if (!localPlayer) return;
    dispatchAction('move_worker', { row, col, playerId: localPlayer.id });

    if (portalPhase !== 'idle') {
        if (portalPhase === 'entrance') {
            setPortalEntrance({ row, col });
            setPortalPhase('exit');
            return;
        } else if (portalPhase === 'exit' && portalEntrance) {
            dispatchAction('place_portal', { entrance: portalEntrance, exit: { row, col }, playerId: localPlayer.id });
            cancelInteractions();
            return;
        }
    } else if (selectedTowerToBuild) {
        dispatchAction('build', { row, col, towerId: selectedTowerToBuild.id, playerId: localPlayer.id });
    }
  }, [portalPhase, portalEntrance, selectedTowerToBuild, cancelInteractions, dispatchAction, localPlayer]);

  if (configLoading || !gameConfig || !localPlayer) {
    return <div className="w-full h-full flex flex-col items-center justify-center bg-background"><Loader2 className="h-10 w-10 animate-spin text-primary mb-4" /><p className="text-muted-foreground">{loadingMessage}</p></div>;
  }
  
  const handleUpgradeTowerAction = (upgradeId: string) => focusedTower && dispatchAction('upgrade', { row: focusedTower.position.row, col: focusedTower.position.col, upgradeId, playerId: focusedTower.ownerId });
  const handleSellTowerAction = () => focusedTower && dispatchAction('sell', { row: focusedTower.position.row, col: focusedTower.position.col, playerId: focusedTower.ownerId });
  
  const onElementPick = (element: Element) => {
      dispatchAction('pick_element', { element, playerId: localPlayerId });
  };
  
  const handleStartWaveNowAction = () => dispatchAction('start_wave_now', {});
  const handleGameControlAction = (cmd: 'start' | 'start_wave_now' | 'pause' | 'resume') => {
      if (!isGameHost && cmd !== 'start_wave_now') return;

      if (cmd === 'start' || cmd === 'start_wave_now') {
          handleStartWaveNowAction();
      } else if (cmd === 'pause') {
          setGameStatus('paused');
      } else if (cmd === 'resume') {
          setGameStatus('playing');
      }
  };
  
  const LayoutComponent = isMobile ? MobileLayout : DesktopLayout;

  const interactionPrompt = portalPhase !== 'idle'
  ? (portalPhase === 'entrance' ? 'Wähle den Eingang des Portals' : 'Wähle den Ausgang des Portals')
  : selectedTowerToBuild
  ? `Wähle Bauplatz für: ${selectedTowerToBuild?.name}`
  : focusedTower
  ? `Fokus: ${focusedTower?.name}`
  : 'Wähle einen Turm zum Bauen oder einen Arbeiter';
  
  const handleSendEnemy = (enemy: any) => {
    if (!localPlayer) return;
    dispatchAction('send_enemy', { enemy: { type: enemy.type, cost: enemy.cost, incomeBonus: enemy.incomeBonus }, playerId: localPlayer.id });
  };
  
  const localPlayerState = playerStates[localPlayerId as keyof typeof playerStates];
  if (!localPlayerState) {
    if (gameDataLoaded) { // Only show loader if we expect data
        return <div className="w-full h-full flex flex-col items-center justify-center bg-background"><Loader2 className="h-10 w-10 animate-spin text-primary mb-4" /><p className="text-muted-foreground">Warte auf Spielerdaten...</p></div>;
    }
     return null; // Or some other placeholder
  }

  return (
        <div className="w-full h-full flex flex-col" onClick={() => { if(!hasInteracted) { audioManager.init(); setHasInteracted(true); }}}>
             <Header onExit={onExit} isMuted={isMuted} toggleMute={toggleMute} fps={isGameHost ? fps : stats.fps} />
             <div className="flex-grow p-2">
                <LayoutComponent
                    players={players} 
                    setPlayers={setPlayers} 
                    playerStates={playerStates}
                    localPlayer={localPlayer!}
                    currentWave={currentWave} 
                    totalWaves={gameConfig.waves.length} 
                    difficulty={difficulty} 
                    handleGameControl={() => {}}
                    gameStatus={gameStatus} 
                    resetGame={onExit}
                    towers={gameConfig.towers} 
                    setTowers={() => {}} 
                    // Pass individual states to layout for rendering
                    placedTowers={Object.values(localPlayerState.towersByCell)}
                    enemies={localPlayerState.enemies}
                    workers={localPlayerState.workers}
                    ghosts={localPlayerState.ghosts}
                    portals={localPlayerState.portals}
                    currentPath={localPlayerState.currentPath}
                    damageNumbers={[]} 
                    splashRings={[]}
                    persistentClouds={[]}
                    //
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
                    spawnedThisWave={0} // needs to be per-player in versus
                    totalEnemiesInWave={0} // needs to be per-player in versus
                    totalKilled={totalKilled}
                    totalLeaked={totalLeaked}
                    isIntermission={isIntermission}
                    waveStartCountdown={Math.max(0, Math.ceil(waveStartCountdown))}
                    intermissionTime={INTERMISSION_TIME} 
                    handleStartNextWaveNow={handleStartWaveNowAction}
                    lastUpgradedTowerId={lastUpgradedTowerId}
                    justPlacedTowerId={justPlacedTowerId}
                    isCoop={true} 
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
                    onPing={sendPing}
                    hostPacketsPerSecond={stats.sentPacketsPerSecond} 
                    hostBytesSentPerSecond={stats.sentBytesSentPerSecond}
                    clientPacketsPerSecond={stats.packetsPerSecond}
                    clientBytesReceivedPerSecond={stats.bytesPerSecond}
                    averagePacketSize={stats.averagePacketSize}
                    isPlacingPortalEntrance={portalPhase !== 'idle'}
                    gameMode={gameMode}
                    onSendEnemy={handleSendEnemy}
                    />
             </div>
             
            {players.map(p => {
                if (!p || p.id !== localPlayerId) return null;
                
                const expectedElements = 1 + Math.floor((currentWave + 1) / 5);
                const shouldPick = gameStatus === 'picking-element' && (p.unlockedElements?.length ?? 0) < expectedElements;

                return (
                    <ElementPickDialog
                        key={p.id}
                        isOpen={shouldPick}
                        onElementPick={onElementPick}
                        playerName={p.name}
                        currentWave={currentWave}
                        unlockedElements={new Set(p.unlockedElements)}
                    />
                );
            })}
        </div>
  );
}

