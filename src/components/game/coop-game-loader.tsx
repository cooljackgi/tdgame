

'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import type { User } from 'firebase/auth';
import { onAuthStateChanged, auth } from '@/lib/firebase';
import { doc, onSnapshot, Unsubscribe, updateDoc, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, functions } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { normalizePlayers } from '@/lib/player-utils';
import type { Player, GameState, GameStatus, PlacedTower, Difficulty, Tower, Element, Enemy, Attack, DamageNumber, SplashRing, Node, EnemyStatusEffect, TowerEffect, PingPayload, RequestPayload, RequestResolve, PingKind, LifeGainVfx, GravityWell, PersistentCloud, SoundEvent, Worker, GhostFoundation, GameSessionState, Portal, GameDelta } from '@/lib/game-data/types';
import { DeltaType } from '@/lib/game-data/types';
import { INTERMISSION_TIME, difficultyModifiers, GRID_ROWS, GRID_COLS } from '@/lib/game-data/constants';
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
import { onGameEnd } from '@/lib/game-end';
import type { GameBoardHandle } from './game-board';
import { loadGameConfig, type GameConfig } from '@/lib/game-config-loader';


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
  const [gameState, setGameState] = useState<GameState>({ lives: 20 });
  const [towersByCell, setTowersByCell] = useState<Record<string, PlacedTower>>({});
  const [enemies, setEnemies] = useState<Enemy[]>([]);
  const [currentWave, setCurrentWave] = useState(0);
  const [gameStatus, setGameStatus] = useState<GameStatus>('waiting');
  const [isIntermission, setIsIntermission] = useState(true);
  const [waveStartCountdown, setWaveStartCountdown] = useState(INTERMISSION_TIME);
  const [difficulty, setDifficulty] = useState<Difficulty>('Normal');
  const [localPlayerId, setLocalPlayerId] = useState<'player1' | 'player2' | 'spectator' | null>(null);
  const [gameDataLoaded, setGameDataLoaded] = useState(false);
  const [totalKilled, setTotalKilled] = useState(0);
  const [totalLeaked, setTotalLeaked] = useState(0);
  const [gravityWells, setGravityWells] = useState<GravityWell[]>([]);
  const [persistentClouds, setPersistentClouds] = useState<PersistentCloud[]>([]);
  const [fps, setFps] = useState(0);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [ghosts, setGhosts] = useState<GhostFoundation[]>([]);
  const [portals, setPortals] = useState<Portal[]>([]);
  const [currentPath, setCurrentPath] = useState<Node[]>([]);

  
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
  const [isPicking, setIsPicking] = useState(false);

  // VFX State
  const [firingTowerIds, setFiringTowerIds] = useState<Set<string>>(new Set());
  
  const isGameHost = useMemo(() => localPlayerId === 'player1', [localPlayerId]);
  
  const localPlayer = useMemo(() => {
    const p = players.find(p => p.id === localPlayerId);
    if (p) return p;
    // Fallback (verhindert Crashes in Kindkomponenten)
    return localPlayerId ? { id: localPlayerId, name: 'Wird geladen…', avatarUrl: null, resources: 0, unlockedElements: ['neutral'], incomePerSecond: 5, portalCooldownUntilWave: 0 } : null;
  }, [players, localPlayerId]);


  // Host-side Game Loop & State Refs
  const deltaQueueRef = useRef<GameDelta[]>([]);
  const lastDeltaSentRef = useRef(0);
  const countdownRef = useRef<number | null>(null);
  const enemyIdCounter = useRef(0);
  const spawnQueueRef = useRef<any[]>([]);
  const waveStartTimeRef = useRef<number>(0);
  
  // Refs for stable access in game loop
  const currentPathRef = useRef(currentPath);
  useEffect(() => { currentPathRef.current = currentPath }, [currentPath]);
  
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

  // --- Refs to hold stable function references ---
  const sendActionRef = useRef<(type: string, payload: any) => void>(() => {});
  const sendGameDataRef = useRef<(type: string, payload: any) => void>(() => {});
  
    const startWave = useCallback((waveIndex: number) => {
        if (!isGameHost || !gameConfig) return;

        const spec = gameConfig.waves[waveIndex];
        if (!spec) return;

        const difficultyMod = difficultyModifiers[difficulty];
        const enemiesToSpawn = Array.from({ length: spec.enemies.count }).map((_, i) => {
            const health = Math.round(spec.enemies.health * difficultyMod.enemyHealth);
            return {
                id: `enemy-${waveIndex}-${enemyIdCounter.current++}`,
                type: spec.enemies.type,
                health: health,
                maxHealth: health,
                armor: spec.enemies.armor,
                speed: spec.enemies.speed,
                damage: spec.enemies.damage,
                bounty: spec.enemies.bounty,
                path: currentPathRef.current,
                pathIndex: 0,
                position: { row: 1, col: 1 },
                effects: [],
                lastMove: 0, // Set on actual spawn
                wasHit: false,
                targetNode: { row: GRID_ROWS, col: GRID_COLS },
                movementPattern: spec.enemies.type === 'schnell' ? 'zigzag' : 'wobble',
                vx: 0,
                vy: 0,
                _spawnTime: i * spec.enemies.spawnDelay,
            };
        });

        spawnQueueRef.current = enemiesToSpawn;
        waveStartTimeRef.current = Date.now();
        
        setEnemies([]); // Clear old enemies before wave
        setIsIntermission(false);
        setCurrentWave(waveIndex);
        setWaveStartCountdown(0);
        audioManager.play({ kind: 'sfx', name: 'wave_start' });
        
        // This is a state update batch
        deltaQueueRef.current.push([
            DeltaType.GAME_STATE_UPDATE,
            { lives: gameState.lives, currentWave: waveIndex, gameStatus: 'playing', isIntermission: false, waveStartCountdown: 0 }
        ]);

    }, [isGameHost, difficulty, gameConfig, gameState]);

    const onHostAction = useCallback((action:'build'|'upgrade'|'sell'|'pick_element'|'start_wave_now'|'move_worker'| 'place_portal', payload:any) => {
        if (!isGameHost || !gameConfig) return;
        
        let stateChanged = false;
        
        const performUpdate = () => {
            setPlayers(prevPlayers => {
                let currentPlayers = [...prevPlayers];
                const tempState: GameSessionState = { players: currentPlayers, gameState, towersByCell, enemies, currentWave, difficulty, gameStatus, currentPath, waveStartCountdown, isIntermission, workers, ghosts, portals };

                switch(action){
                    case 'place_portal': {
                        const { entrance, exit, playerId } = payload;
                        const workerId = playerId === 'player1' ? 'worker-1' : 'worker-2';
                        const updatedState = enqueuePlacePortalOrder(tempState, workerId, entrance, exit, Date.now());
                        
                        setWorkers(updatedState.workers);
                        if (updatedState.portals) setPortals(updatedState.portals);
                        stateChanged = true;
                        currentPlayers = updatedState.players;
                        break;
                    }
                    case 'move_worker': {
                        const { row, col, playerId } = payload;
                        const workerId = playerId === 'player1' ? 'worker-1' : 'worker-2';
                        const updatedState = enqueueMoveOrder(tempState, workerId, row, col);
                        
                        setWorkers(updatedState.workers);
                        stateChanged = true;
                        // Player state doesn't change on move
                        break;
                    }
                    case 'build': {
                        const { playerId, row, col, towerId } = payload;
                        const workerId = playerId === 'player1' ? 'worker-1' : 'worker-2';
                        const updatedState = enqueueBuildOrder(tempState, workerId, row, col, towerId, Date.now());
                        
                        setGhosts(updatedState.ghosts);
                        setWorkers(updatedState.workers);
                        stateChanged = true;
                        currentPlayers = updatedState.players;
                        break;
                    }
                    case 'upgrade': {
                        const { row, col, upgradeId, playerId } = payload;
                        const key = `${row}_${col}`;
                        const existingTower = towersByCell[key];
                        if (!existingTower || existingTower.ownerId !== playerId) break;

                        const upgradeSpec = gameConfig.towers.find(t => t.id === upgradeId);
                        const upgrader = currentPlayers.find(p => p.id === playerId);
                        if (!upgradeSpec || !upgrader) break;
                        
                        const cost = upgradeSpec.cost - Math.floor(existingTower.cost * 0.75);
                        if (upgrader.resources < cost) break;

                        const sound: SoundEvent = { kind: 'sfx', name: 'upgrade_tower' };
                        audioManager.play(sound);
                        deltaQueueRef.current.push([DeltaType.AUDIO, sound]);

                        const upgradedTower: PlacedTower = {...existingTower, ...upgradeSpec, specId: upgradeSpec.id, health: upgradeSpec.maxHealth, id: existingTower.id };

                        setTowersByCell(prev => ({ ...prev, [key]: upgradedTower }));
                        setLastUpgradedTowerId(upgradedTower.id);
                        setTimeout(()=>setLastUpgradedTowerId(null), 500);
                        deltaQueueRef.current.push([DeltaType.VFX_TOWER_UPGRADE, { towerId: upgradedTower.id }]);
                        stateChanged = true;
                        currentPlayers = currentPlayers.map(p => p.id === playerId ? { ...p, resources: p.resources - cost } : p);
                        break;
                    }
                    case 'sell': {
                         const { row, col, playerId } = payload;
                         const key = `${row}_${col}`;
                         const towerToSell = towersByCell[key];
                         if (!towerToSell || towerToSell.ownerId !== playerId) break;

                         const sound: SoundEvent = { kind: 'sfx', name: 'sell_tower' };
                         audioManager.play(sound);
                         deltaQueueRef.current.push([DeltaType.AUDIO, sound]);

                         const refund = Math.round(towerToSell.cost * 0.75);
                         setTowersByCell(prev => { const { [key]:_, ...rest } = prev; return rest; });
                         stateChanged = true;
                         currentPlayers = currentPlayers.map(p => p.id === playerId ? { ...p, resources: p.resources + refund } : p);
                         break;
                    }
                    case 'pick_element': {
                        if (gameStatus !== 'picking-element') break;
                        const { element } = payload;
                        
                        const expectedElements = 1 + Math.floor((currentWave + 1) / 5);

                        currentPlayers = currentPlayers.map(p => {
                            if (p.id !== payload.playerId) return p;
                            // Safety check: Don't allow pick if player already has enough elements
                            if (p.unlockedElements.length >= expectedElements) return p;
                            
                            audioManager.play({ kind: 'sfx', name: 'upgrade_tower' });
                            deltaQueueRef.current.push([DeltaType.AUDIO, { kind: 'sfx', name: 'upgrade_tower' }]);
                            
                            return { 
                              ...p, 
                              unlockedElements: Array.from(new Set([...p.unlockedElements, element])) 
                            };
                        });
                        
                        const someoneStillNeedsPick = currentPlayers.some(
                          p => p && p.id !== 'spectator' && p.unlockedElements.length < expectedElements && p.unlockedElements.length < 8
                        );

                        if (!someoneStillNeedsPick) {
                            setCurrentWave(currentWave + 1);
                            setIsIntermission(true);
                            setWaveStartCountdown(INTERMISSION_TIME);
                            setGameStatus('playing');
                        }
                        
                        stateChanged = true;
                        break;
                    }
                }
                return currentPlayers;
            });
        };
        
        if (action === 'start_wave_now') {
            if (gameStatus === 'waiting') {
                const activePlayers = players.filter(p => p && p.id !== 'spectator');
                if (activePlayers.length >= 2) {
                    setGameStatus('playing');
                    setIsIntermission(true);
                    setWaveStartCountdown(INTERMISSION_TIME);
                } else {
                    toast({ title: "Warte auf Spieler 2", description: "Ein zweiter Spieler muss beitreten, bevor das Spiel gestartet werden kann.", variant: 'destructive'});
                }
            } else if (gameStatus === 'playing' && isIntermission) {
                 startWave(currentWave);
            }
        } else {
            performUpdate();
        }

    }, [players, towersByCell, isGameHost, startWave, isIntermission, currentWave, gameStatus, toast, workers, ghosts, portals, gameState, difficulty, currentPath, waveStartCountdown, gameConfig]);
    
  // --- WebRTC Logic ---
  
  const handleGameData = useCallback((msg: NetMsg) => {
    if (isGameHost) return;
    
    if (msg.type === 'deltas') {
        const deltas = msg.payload as GameDelta[];
        for (const delta of deltas) {
            const deltaType = delta[0];
            const deltaPayload = delta[1];
            switch(deltaType) {
                case DeltaType.SNAPSHOT:
                  setPlayers((deltaPayload as GameSessionState).players);
                  setEnemies((deltaPayload as GameSessionState).enemies);
                  setTowersByCell((deltaPayload as GameSessionState).towersByCell);
                  setGameState((deltaPayload as GameSessionState).gameState);
                  setCurrentWave((deltaPayload as GameSessionState).currentWave);
                  setIsIntermission((deltaPayload as GameSessionState).isIntermission);
                  setWaveStartCountdown((deltaPayload as GameSessionState).waveStartCountdown);
                  setGameStatus((deltaPayload as GameSessionState).gameStatus);
                  setWorkers((deltaPayload as GameSessionState).workers);
                  setGhosts((deltaPayload as GameSessionState).ghosts);
                  setPortals((deltaPayload as GameSessionState).portals || []);
                  break;
                case DeltaType.ENEMY_UPDATE: setEnemies(deltaPayload as Enemy[]); break;
                case DeltaType.PLAYER_UPDATE: setPlayers(deltaPayload as Player[]); break;
                case DeltaType.TOWERS_UPDATE: setTowersByCell(deltaPayload as Record<string, PlacedTower>); break;
                case DeltaType.GAME_STATE_UPDATE: 
                    setGameState(gs => ({...gs, lives: deltaPayload.lives}));
                    setCurrentWave(deltaPayload.currentWave);
                    setGameStatus(deltaPayload.gameStatus);
                    setIsIntermission(deltaPayload.isIntermission);
                    setWaveStartCountdown(deltaPayload.waveStartCountdown);
                    break;
                case DeltaType.STATS_UPDATE:
                    setTotalKilled(deltaPayload.totalKilled);
                    setTotalLeaked(deltaPayload.totalLeaked);
                    break;
                case DeltaType.WORKER_UPDATE: setWorkers(deltaPayload as Worker[]); break;
                case DeltaType.GHOST_UPDATE: setGhosts(deltaPayload as GhostFoundation[]); break;
                case DeltaType.PORTAL_UPDATE: setPortals(deltaPayload as Portal[]); break;
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
  }, [isGameHost]);

    const handleActionData = useCallback((msg: any) => {
        if (!isGameHost) return;
        const { type, payload } = msg;

        switch (type) {
            case 'CLIENT_READY': {
                deltaQueueRef.current.push([DeltaType.SNAPSHOT, { players, enemies, towersByCell, gameState, currentWave, isIntermission, waveStartCountdown, gameStatus, difficulty, currentPath, workers, ghosts, portals }]);
                return;
            }
            case 'PLACE_PORTAL_REQUEST':   onHostAction('place_portal', payload); return;
            case 'BUILD_TOWER_REQUEST':      onHostAction('build', payload); return;
            case 'MOVE_WORKER_REQUEST':      onHostAction('move_worker', payload); return;
            case 'UPGRADE_TOWER_REQUEST':    onHostAction('upgrade', payload); return;
            case 'SELL_TOWER_REQUEST':       onHostAction('sell', payload); return;
            case 'PICK_ELEMENT_REQUEST':     onHostAction('pick_element', payload); return;
            case 'START_WAVE_NOW_REQUEST':   onHostAction('start_wave_now', payload); return;
            case 'PING_REQUEST':
                console.log('[P1] received PING_REQUEST -> broadcasting PING');
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
    }, [isGameHost, onHostAction, players, enemies, towersByCell, gameState, currentWave, isIntermission, waveStartCountdown, gameStatus, difficulty, currentPath, workers, ghosts, portals]);
    
    const { sendAction, sendGameData, isConnected, ...stats } = useWebRTC(
        localPlayerId ? gameId : null, 
        isGameHost, 
        user, 
        false, 
        handleGameData, 
        handleActionData
    );

    useEffect(() => {
      sendActionRef.current = sendAction;
      sendGameDataRef.current = sendGameData;
    }, [sendAction, sendGameData]);

  useEffect(() => {
      if (isConnected && !isGameHost && localPlayerId === 'player2') {
          sendActionRef.current('CLIENT_READY', {});
      }
  }, [isConnected, isGameHost, localPlayerId]);

  const onLocalAction = useCallback((action: 'build' | 'upgrade' | 'sell' | 'pick_element' | 'start_wave_now' | 'move_worker' | 'place_portal', payload: any) => {
      if (!localPlayerId || localPlayerId === 'spectator' || isGameHost) return;
      
      const actionTypeMap = {
        build: 'BUILD_TOWER_REQUEST',
        move_worker: 'MOVE_WORKER_REQUEST',
        place_portal: 'PLACE_PORTAL_REQUEST',
        upgrade: 'UPGRADE_TOWER_REQUEST',
        sell: 'SELL_TOWER_REQUEST',
        pick_element: 'PICK_ELEMENT_REQUEST',
        start_wave_now: 'START_WAVE_NOW_REQUEST',
      }
      const actionType = actionTypeMap[action];
      sendActionRef.current(actionType, { ...payload, playerId: localPlayerId });
  }, [localPlayerId, isGameHost]);
  
  const dispatchAction = useCallback((action: 'build' | 'upgrade' | 'sell' | 'pick_element' | 'start_wave_now' | 'move_worker' | 'place_portal', payload: any) => {
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
        sendActionRef.current('PING_REQUEST', payload);
      }
    };
    
    useEffect(() => {
      audioManager.init();
      const onFirstPointer = () => audioManager.primeHaptics();
      window.addEventListener('pointerdown', onFirstPointer, { once: true });
      window.addEventListener('touchstart', onFirstPointer, { once: true });
      return () => {
          window.removeEventListener('pointerdown', onFirstPointer);
          window.removeEventListener('touchstart', onFirstPointer);
      };
    }, []);

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
                // Try to join the game. The function is idempotent.
                const joinGameCallable = httpsCallable(functions, 'joinGame');
                setLoadingMessage('Trete Spiel bei...');
                await joinGameCallable({ gameId });
                setLoadingMessage('Synchronisiere Spielzustand...');

                // Once joined, start listening for updates.
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

                    setDifficulty(data.difficulty || 'Normal');
                    
                    const playersData = normalizePlayers(data.players);
                    setPlayers(playersData);
                    const hasTwoPlayers = playersData.length === 2 && !!playersData[1];


                    if (role === 'player1' && !gameDataLoaded) {
                        setGameState(data.gameState || { lives: difficultyModifiers[data.difficulty || 'Normal'].startLives });
                        setTowersByCell(data.towersByCell || {});
                        setCurrentWave(data.currentWave || 0);
                        setIsIntermission(data.isIntermission ?? true);
                        setWaveStartCountdown(data.waveStartCountdown ?? INTERMISSION_TIME);
                        setGameStatus(data.gameStatus); // Use status from DB
                        setWorkers(data.workers || [
                          { id: "worker-1", x: 64, y: 64, speed: 260, state: "idle", queue: [], moveTarget: null },
                          { id: "worker-2", x: 64 * 2, y: 64, speed: 260, state: "idle", queue: [], moveTarget: null }
                        ]);
                        setGhosts(data.ghosts || []);
                        setPortals(data.portals || []);
                    } else if (!gameDataLoaded) {
                         // Client just gets minimal state to start, snapshot will provide the rest
                         setGameStatus(data.gameStatus);
                    }
                    
                    if (!gameDataLoaded) {
                      setGameDataLoaded(true);
                      setLoading(false);
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
    }, [user, gameId, router, toast, configLoading, gameDataLoaded]);
    
    useEffect(() => {
      const newPath = findPath({row:1,col:1},{row:GRID_ROWS,col:GRID_COLS}, Object.values(towersByCell).map(t => t.position), GRID_ROWS, GRID_COLS) ?? [];
      setCurrentPath(newPath);
    }, [towersByCell]);

    useEffect(() => {
        if (!isGameHost) {
            if (countdownRef.current) clearInterval(countdownRef.current);
            return;
        }

        if(gameStatus !== 'playing') return;

        if(isIntermission) {
            countdownRef.current = window.setInterval(() => {
                setWaveStartCountdown(prev => {
                    const newTime = Math.max(0, prev - 1);
                    if (newTime === 0) {
                        if (countdownRef.current) clearInterval(countdownRef.current);
                        countdownRef.current = undefined;
                        startWave(currentWave);
                    }
                    return newTime;
                });
            }, 1000);
        }

        return () => {
            if (countdownRef.current) clearInterval(countdownRef.current);
            countdownRef.current = undefined;
        };
    }, [isGameHost, isIntermission, gameStatus, startWave, currentWave]);
  
  const lastFpsUpdateRef = useRef(Date.now());
  const frameCountRef = useRef(0);
  useEffect(() => {
      if (!gameConfig || !isGameHost) return;
      let gameLoopRef: number;
      let lastTick = Date.now();

      const gameLoop = () => {
          gameLoopRef = requestAnimationFrame(gameLoop);
          const now = Date.now();
          const delta = now - lastTick;
          if (delta < 16) return;
          lastTick = now;

          frameCountRef.current++;
          if (now - lastFpsUpdateRef.current >= 1000) {
            setFps(frameCountRef.current);
            frameCountRef.current = 0;
            lastFpsUpdateRef.current = now;
          }

          const currentStatus = gameStatus;
          const hasTwoPlayers = players.length >= 2;
          
          if (currentStatus === 'paused') {
            return; // Completely halt game logic when paused
          }

          // **FIX**: The game loop now runs if the game is 'waiting' but has two players.
          if (currentStatus === 'waiting' && !hasTwoPlayers) {
            return;
          }
          
          let stateToUpdate: GameSessionState = { players, gameState, towersByCell, enemies, currentWave, difficulty, gameStatus: currentStatus, currentPath, waveStartCountdown, isIntermission, workers, ghosts, portals };
          
          const workerState = tickWorkers(stateToUpdate, delta, now, gameConfig.towers);
          
          setWorkers(workerState.workers);
          setGhosts(workerState.ghosts);
          if (workerState.portals?.length !== (portals?.length || 0)) {
            setPortals(workerState.portals);
          }
          if (Object.keys(workerState.towersByCell).length !== Object.keys(towersByCell).length) {
            setTowersByCell(workerState.towersByCell);
          }
           setPlayers(workerState.players); // Players might have spent resources

          // Only run combat logic if the game is actually playing a wave
          if (currentStatus === 'playing' && !isIntermission) {
            
              const updatedPlayersWithIncome = players.map(p => ({
                  ...p,
                  resources: p.resources + (p.incomePerSecond * (delta / 1000)),
              }));
              setPlayers(updatedPlayersWithIncome);
              
              if (isIntermission) {
                  setWaveStartCountdown(prev => Math.max(0, prev - (delta/1000)));
                  if (waveStartCountdown <= 0) startWave(currentWave);
                  return;
              }
              
              let livesLostThisTick = 0;
              let killedThisTick = 0;
              let resourcesGainedThisTick = { player1: 0, player2: 0 };
              
              let newAttacks: Attack[] = [];
              let newDamageNumbers: DamageNumber[] = [];
              let newSplashRings: SplashRing[] = [];
              let newLifeGainVfx: LifeGainVfx[] = [];
              let newSoundEvents: SoundEvent[] = [];
              let newGravityWells: GravityWell[] = [];
              let newPersistentClouds: PersistentCloud[] = [];
              
              let currentEnemies = enemies.map(e => ({...e, wasHit: false }));
              let updatedTowers = { ...towersByCell }; 

               // --- Spawning Logic (moved inside game loop) ---
                const timeSinceWaveStart = Date.now() - waveStartTimeRef.current;
                if (spawnQueueRef.current.length > 0) {
                    const enemiesToSpawnNow = spawnQueueRef.current.filter(e => e._spawnTime <= timeSinceWaveStart);
                    if(enemiesToSpawnNow.length > 0) {
                        spawnQueueRef.current = spawnQueueRef.current.filter(e => e._spawnTime > timeSinceWaveStart);
                        const nowEpoch = Date.now();
                        const newEnemiesThisFrame = enemiesToSpawnNow.map(e => ({...e, lastMove: nowEpoch, path: currentPath}));
                        currentEnemies.push(...newEnemiesThisFrame);
                    }
                }
              
              let firingIds = new Set<string>();

              Object.values(updatedTowers).forEach(tower => {
                  if (now - tower.lastAttack >= tower.attackSpeed) {
                      const isBuffed = false; // Simplified
                      let target: Enemy | null = null;
                      let minDistanceSq = tower.range * tower.range;

                      currentEnemies.forEach(enemy => {
                          if (enemy.deathTimestamp) return;
                          const distSq = (tower.position.col - enemy.position.col)**2 + (tower.position.row - enemy.position.row)**2;
                          if (distSq <= minDistanceSq) {
                              minDistanceSq = distSq;
                              target = enemy;
                          }
                      });

                      if (target) {
                          updatedTowers[tower.id] = { ...tower, lastAttack: now };
                          firingIds.add(tower.id);
                          
                          const result = processAttack(tower, target, currentEnemies, now, isBuffed);
                          
                          currentEnemies = result.updatedEnemies;
                          newAttacks.push(...result.newAttacks);
                          newDamageNumbers.push(...result.damageNumbers);
                          newSplashRings.push(...result.splashRings);
                          newLifeGainVfx.push(...result.lifeGainVfx);
                          newSoundEvents.push(...result.soundEvents);
                          if (result.newPersistentClouds.length > 0) newPersistentClouds.push(...result.newPersistentClouds);
                          if (result.newGravityWells.length > 0) newGravityWells.push(...result.newGravityWells);

                          if (result.resourcesGained > 0) {
                              players.forEach(p => {
                                  const key = p.id as 'player1' | 'player2';
                                  if(resourcesGainedThisTick[key] !== undefined) {
                                    resourcesGainedThisTick[key] += result.resourcesGained;
                                  }
                              });
                          }
                          if (result.livesGained > 0) {
                              setGameState(gs => ({...gs, lives: gs.lives + result.livesGained}));
                          }
                          if (result.killed > 0) killedThisTick += result.killed;
                      }
                  }
              });
              
              setTowersByCell(updatedTowers);
              if (firingIds.size > 0) {
                 setFiringTowerIds(new Set(firingIds));
                 setTimeout(() => setFiringTowerIds(new Set()), 150);
              }
              
              if (newAttacks.length > 0) deltaQueueRef.current.push([DeltaType.VFX_ATTACK, newAttacks]);
              if (newDamageNumbers.length > 0) deltaQueueRef.current.push([DeltaType.VFX_DAMAGE, newDamageNumbers]);
              if (newSplashRings.length > 0) deltaQueueRef.current.push([DeltaType.VFX_SPLASH, newSplashRings]);
              if (newLifeGainVfx.length > 0) gameBoardRef.current?.queueLifeGainVfx(newLifeGainVfx);
              if (newSoundEvents.length > 0) newSoundEvents.forEach(ev => deltaQueueRef.current.push([DeltaType.AUDIO, ev]));


              const stillAlive: Enemy[] = [];
              const activeGravityWells = [...(gravityWells || []), ...newGravityWells].filter(w => w.expires > now);
              const activePersistentClouds = [...(persistentClouds || []), ...newPersistentClouds].filter(c => c.expires > now);
              const activePortals = (portals ?? []).filter(p => p.expiresAt > now || p.expiresAt === 0);

              for (let enemy of currentEnemies) {
                  if (enemy.deathTimestamp && now - enemy.deathTimestamp > 2500) continue;
                  if (enemy.deathTimestamp) { stillAlive.push(enemy); continue; }
                  
                  let updatedEnemy: Enemy | null = { ...enemy, wasHit: false, vx: 0, vy: 0, effects: enemy.effects.filter(e => e.expires > now) };
                  const dotResult = tickDots(updatedEnemy, delta);
                  if (dotResult.totalDamage > 0) gameBoardRef.current?.queueDamageNumbers([{id: crypto.randomUUID(), amount: dotResult.totalDamage, targetId: enemy.id, color: '#f97316'}]);
                  if (dotResult.killed && !updatedEnemy.deathTimestamp) updatedEnemy.deathTimestamp = now;
                  if (updatedEnemy.deathTimestamp) { stillAlive.push(updatedEnemy); continue; }
                  
                  const stunEffect = updatedEnemy.effects.find(e => e.type === 'stun');
                  if (stunEffect) { stillAlive.push(updatedEnemy); continue; }

                  let teleported = false;
                  for (const portal of activePortals) {
                      if (!portal.active) continue;
                      const entranceDistSq = (updatedEnemy.position.col - portal.entrance.col) ** 2 + (updatedEnemy.position.row - portal.entrance.row) ** 2;
                      if (entranceDistSq < 0.5 && now - (updatedEnemy.lastTeleportAt || 0) > portal.perEnemyCooldownMs) {
                          updatedEnemy.position = { ...portal.exit };
                          updatedEnemy.lastTeleportAt = now;
                          updatedEnemy.teleportsUsed = (updatedEnemy.teleportsUsed || 0) + 1;
                          updatedEnemy.path = findPath(portal.exit, {row: GRID_ROWS, col: GRID_COLS}, Object.values(towersByCell).map(t => t.position), GRID_ROWS, GRID_COLS) ?? [];
                          updatedEnemy.pathIndex = 0;
                          updatedEnemy.lastMove = now;
                          teleported = true;
                          break; 
                      }
                  }
                  if (teleported) { stillAlive.push(updatedEnemy); continue; }
                  
                  const slowEffect = updatedEnemy.effects.find(e => e.type === 'slow');
                  const speed = updatedEnemy.speed * (slowEffect ? (1 - (slowEffect.potency ?? 0)) : 1);
                  const stepMs = 1000 / Math.max(0.01, speed);
                  let timeToMove = now - updatedEnemy.lastMove;
                  
                  while (timeToMove >= stepMs) {
                      if (updatedEnemy.pathIndex < updatedEnemy.path.length - 1) {
                          updatedEnemy.pathIndex += 1;
                          updatedEnemy.position = updatedEnemy.path[updatedEnemy.pathIndex];
                          timeToMove -= stepMs;
                          updatedEnemy.lastMove += stepMs;
                      } else {
                          livesLostThisTick++;
                          audioManager.play({ kind: 'sfx', name: 'enemy_leak' });
                          updatedEnemy = null;
                          break;
                      }
                  }
                  if(updatedEnemy) stillAlive.push(updatedEnemy);
              }
              
              setEnemies(stillAlive);
              setGravityWells(activeGravityWells);
              setPersistentClouds(activePersistentClouds);
              if (killedThisTick > 0) setTotalKilled(k => k + killedThisTick);
              
              if (livesLostThisTick > 0) {
                  setTotalLeaked(l => l + livesLostThisTick);
                  setGameState(gs => {
                      const newLives = Math.max(0, gs.lives - livesLostThisTick);
                      if (newLives <= 0 && gameStatus !== 'gameover') {
                          onGameEnd(gameId, user, difficulty, currentWave + 1, false, towersByCell);
                          setGameStatus('gameover');
                      }
                      return { ...gs, lives: newLives };
                  });
              }
              
              setPlayers(prev => prev.map(p => {
                  const gain = resourcesGainedThisTick[p.id as 'player1' | 'player2'] || 0;
                  return { ...p, resources: p.resources + gain };
              }));
              
              const enemiesLeft = stillAlive.filter(e => !e.deathTimestamp).length === 0;
              const spawnQueueEmpty = spawnQueueRef.current.length === 0;

              if (enemiesLeft && spawnQueueEmpty && !isIntermission) {
                  const nextWaveIndex = currentWave + 1;
                  if (gameConfig.waves.length > nextWaveIndex) {
                      const expectedElements = 1 + Math.floor(nextWaveIndex / 5);
                      const someoneNeedsPick = players.some(p => p.id !== 'spectator' && p.unlockedElements.length < expectedElements && p.unlockedElements.length < 8);
                      if ((nextWaveIndex) % 5 === 0 && someoneNeedsPick) {
                          setGameStatus('picking-element');
                      } else {
                          setCurrentWave(nextWaveIndex);
                          setIsIntermission(true);
                          setWaveStartCountdown(INTERMISSION_TIME);
                          setPortals(prev => prev.map(p => ({...p, expiresAt: now + 500})));
                      }
                  } else {
                      onGameEnd(gameId, user, difficulty, currentWave + 1, true, towersByCell);
                      setGameStatus('gameover');
                  }
              }
          }
          
          if (now > lastDeltaSentRef.current + 100) { // Send updates every 100ms
              if (deltaQueueRef.current.length === 0) {
                 deltaQueueRef.current.push([DeltaType.ENEMY_UPDATE, enemies]);
              }
              deltaQueueRef.current.push([DeltaType.PLAYER_UPDATE, players]);
              deltaQueueRef.current.push([DeltaType.TOWERS_UPDATE, towersByCell]);
              deltaQueueRef.current.push([DeltaType.GAME_STATE_UPDATE, { lives: gameState.lives, currentWave, gameStatus, isIntermission, waveStartCountdown }]);
              deltaQueueRef.current.push([DeltaType.STATS_UPDATE, { totalKilled, totalLeaked }]);
              deltaQueueRef.current.push([DeltaType.WORKER_UPDATE, workers]);
              deltaQueueRef.current.push([DeltaType.GHOST_UPDATE, ghosts]);
              deltaQueueRef.current.push([DeltaType.PORTAL_UPDATE, portals]);

              const deltasToSend = [...deltaQueueRef.current];
              deltaQueueRef.current = [];
              if (deltasToSend.length > 0) {
                 sendGameDataRef.current('deltas', deltasToSend);
              }
              lastDeltaSentRef.current = now;
          }
      };

      if(isGameHost){
          gameLoopRef = requestAnimationFrame(gameLoop);
      }
      
      return () => {
          if (gameLoopRef) cancelAnimationFrame(gameLoopRef);
      }
  }, [isGameHost, gameStatus, isIntermission, enemies, user, gameId, difficulty, towersByCell, currentWave, currentPath, players, gravityWells, persistentClouds, portals, startWave, gameState, workers, ghosts, gameConfig, onGameEnd, waveStartCountdown, onHostAction, totalKilled, totalLeaked]);


  useEffect(() => {
    setIsPicking(gameStatus === 'picking-element');
  }, [gameStatus]);

  const toggleMute = () => {
    setIsMuted(current => {
      const newMuted = !current;
      if (newMuted) audioManager.mute();
      else audioManager.unmute();
      return newMuted;
    });
  };
  
  const handlePlaceAction = useCallback((row: number, col: number) => {
    const state: GameSessionState = { players, gameState, towersByCell, enemies, currentWave, difficulty, gameStatus, currentPath, waveStartCountdown, isIntermission, workers, ghosts, portals };
    
    if (portalPhase !== 'idle') {
        if (portalPhase === 'entrance') {
            setPortalEntrance({ row, col });
            setPortalPhase('exit');
            return;
        } else if (portalPhase === 'exit' && portalEntrance) {
            dispatchAction('place_portal', { entrance: portalEntrance, exit: { row, col } });
            cancelInteractions();
            return;
        }
    } else if (selectedTowerToBuild) {
        dispatchAction('build', { row, col, towerId: selectedTowerToBuild.id });
    } else {
        dispatchAction('move_worker', { row, col });
    }
  }, [portalPhase, portalEntrance, selectedTowerToBuild, cancelInteractions, dispatchAction, players, gameState, towersByCell, enemies, currentWave, difficulty, gameStatus, currentPath, waveStartCountdown, isIntermission, workers, ghosts, portals]);

  if (loading || configLoading || !gameDataLoaded || !localPlayer || !gameConfig) {
    return <div className="w-full h-full flex items-center justify-center bg-background"><Loader2 className="h-16 w-16 animate-spin text-primary" /> <p className="ml-4 text-lg">{loadingMessage}</p></div>;
  }
  
  const handleUpgradeTowerAction = (upgradeId: string) => focusedTower && dispatchAction('upgrade', { row: focusedTower.position.row, col: focusedTower.position.col, upgradeId });
  const handleSellTowerAction = () => focusedTower && dispatchAction('sell', { row: focusedTower.position.row, col: focusedTower.position.col, playerId: focusedTower.ownerId });
  const onElementPick = (element: Element) => dispatchAction('pick_element', { element, playerId: localPlayerId });
  
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

  return (
    <div className="w-full h-full flex flex-col" onClick={() => { if (!hasInteracted) { audioManager.init(); setHasInteracted(true); }}}>
       <Header onExit={onExit} isMuted={isMuted} toggleMute={toggleMute} fps={isGameHost ? fps : stats.fps} />
        <div className="flex-grow p-2">
            <LayoutComponent
                players={players} 
                setPlayers={setPlayers} 
                gameState={gameState} 
                localPlayer={localPlayer!}
                currentWave={currentWave} 
                totalWaves={gameConfig.waves.length} 
                difficulty={difficulty} 
                handleGameControl={handleGameControlAction}
                gameStatus={gameStatus} 
                resetGame={onExit}
                towers={gameConfig.towers} 
                setTowers={() => {}} 
                placedTowers={Object.values(towersByCell)} 
                enemies={enemies}
                workers={workers}
                ghosts={ghosts}
                portals={portals}
                damageNumbers={[]} 
                splashRings={[]}
                persistentClouds={persistentClouds}
                currentPath={currentPath} 
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
                spawnedThisWave={isIntermission ? 0 : (gameConfig.waves[currentWave]?.enemies.count - spawnQueueRef.current.length)}
                totalEnemiesInWave={gameConfig.waves[currentWave]?.enemies.count || 0}
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
                />
            </div>
            {localPlayer && (
                <ElementPickDialog
                    isOpen={isPicking}
                    onElementPick={onElementPick}
                    playerName={localPlayer.name}
                    currentWave={currentWave}
                    unlockedElements={new Set(localPlayer.unlockedElements)}
                />
            )}
      </div>
  );
}

