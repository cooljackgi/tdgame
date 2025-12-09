

'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import type { User } from 'firebase/auth';
import { onAuthStateChanged, auth } from '@/lib/firebase';
import { doc, onSnapshot, Unsubscribe, updateDoc, collection, addDoc, serverTimestamp, getDoc } from 'firebase/firestore';
import { db, functions } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { normalizePlayers } from '@/lib/player-utils';
import type { Player, GameState, GameStatus, PlacedTower, Difficulty, Tower, Element, Enemy, Attack, DamageNumber, SplashRing, Node, EnemyStatusEffect, TowerEffect, PingPayload, RequestPayload, RequestResolve, PingKind, LifeGainVfx, GravityWell, PersistentCloud, SoundEvent, Worker, GhostFoundation, GameSessionState, Portal, GameDelta, VersusState, PlayerGameState } from '@/lib/game-data/types';
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
  const [playerStates, setPlayerStates] = useState<Record<Player['id'], PlayerGameState>>({
      player1: { lives: 20, towersByCell: {}, enemies: [], workers: [], ghosts: [], portals: [], currentPath: [] },
      player2: { lives: 20, towersByCell: {}, enemies: [], workers: [], ghosts: [], portals: [], currentPath: [] },
      spectator: { lives: 0, towersByCell: {}, enemies: [], workers: [], ghosts: [], portals: [], currentPath: [] },
  });
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
  const [gameMode, setGameMode] = useState<'coop' | 'versus'>('coop');
  const [versusState, setVersusState] = useState<VersusState | null>(null);
  
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
    const p = players.find(p => p.id === localPlayerId);
    if (p) return p;
    // Fallback (verhindert Crashes in Kindkomponenten)
    return localPlayerId ? { id: localPlayerId, name: 'Wird geladen…', avatarUrl: null, resources: 0, unlockedElements: ['neutral'], incomePerSecond: 5, portalCooldownUntilWave: 0 } : null;
  }, [players, localPlayerId]);


  // Host-side Game Loop & State Refs
  const gameLoopRef = useRef<number>();
  const lastTickRef = useRef(performance.now());
  const frameCountRef = useRef(0);
  const lastFpsUpdateRef = useRef(Date.now());
  const fpsRef = useRef(0);

  const deltaQueueRef = useRef<GameDelta[]>([]);
  const lastDeltaSentRef = useRef(0);
  const countdownRef = useRef<number>();
  const enemyIdCounter = useRef(0);
  const spawnQueueRef = useRef<any[]>([]);
  const waveStartTimeRef = useRef(0);
  
  // Refs for stable access in game loop
  const gameStatusRef = useRef(gameStatus);
  useEffect(() => { gameStatusRef.current = gameStatus }, [gameStatus]);
  const isIntermissionRef = useRef(isIntermission);
  useEffect(() => { isIntermissionRef.current = isIntermission }, [isIntermission]);
  const playersRef = useRef(players);
  useEffect(() => { playersRef.current = players; }, [players]);
  const isLogicPausedRef = useRef(isLogicPaused);
  useEffect(() => { isLogicPausedRef.current = isLogicPaused; }, [isLogicPaused]);
  const playerStatesRef = useRef(playerStates);
  useEffect(() => { playerStatesRef.current = playerStates; }, [playerStates]);
  const currentWaveRef = useRef(currentWave);
  useEffect(() => { currentWaveRef.current = currentWave }, [currentWave]);
  const versusStateRef = useRef(versusState);
  useEffect(() => { versusStateRef.current = versusState; }, [versusState]);
  
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
                  // For client, snapshot contains everything
                  setPlayers((deltaPayload as GameSessionState).players);
                  setPlayerStates((deltaPayload as GameSessionState).playerStates);
                  setCurrentWave((deltaPayload as GameSessionState).currentWave);
                  setIsIntermission((deltaPayload as GameSessionState).isIntermission);
                  setWaveStartCountdown((deltaPayload as GameSessionState).waveStartCountdown);
                  setGameStatus((deltaPayload as GameSessionState).gameStatus);
                  setGameMode((deltaPayload as GameSessionState).gameMode || 'coop');
                  setVersusState((deltaPayload as GameSessionState).versusState || null);
                  break;
                case DeltaType.PLAYER_UPDATE: setPlayers(deltaPayload as Player[]); break;
                case DeltaType.PLAYER_STATE_UPDATE: setPlayerStates(deltaPayload); break; // New
                case DeltaType.GAME_STATE_UPDATE: 
                    setCurrentWave(deltaPayload.currentWave);
                    setGameStatus(deltaPayload.gameStatus);
                    setIsIntermission(deltaPayload.isIntermission);
                    setWaveStartCountdown(deltaPayload.waveStartCountdown);
                    break;
                case DeltaType.STATS_UPDATE:
                    setTotalKilled(deltaPayload.totalKilled);
                    setTotalLeaked(deltaPayload.totalLeaked);
                    break;
                case DeltaType.VERSUS_STATE_UPDATE: setVersusState(deltaPayload as VersusState); break;
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

  const startWave = useCallback((waveIndex: number) => {
    if (!isGameHost || !gameConfig) return;

    // TODO: In versus mode, this logic will change.
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
            path: [], // Will be set per player
            pathIndex: 0,
            position: { row: 1, col: 1 },
            effects: [],
            lastMove: 0,
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
    
    setPlayerStates(ps => ({
      player1: { ...ps.player1, enemies: [] },
      player2: { ...ps.player2, enemies: [] },
      spectator: ps.spectator,
    }));
    setIsIntermission(false);
    setCurrentWave(waveIndex);
    setWaveStartCountdown(0);
    audioManager.play({ kind: 'sfx', name: 'wave_start' });
    
    deltaQueueRef.current.push([
        DeltaType.GAME_STATE_UPDATE,
        { lives: 0, currentWave: waveIndex, gameStatus: 'playing', isIntermission: false, waveStartCountdown: 0 }
    ]);

  }, [isGameHost, difficulty, gameConfig]);

  const onHostAction = useCallback((action:'build'|'upgrade'|'sell'|'pick_element'|'start_wave_now'|'move_worker'| 'place_portal' | 'send_enemy', payload:any) => {
    if (!isGameHost || !gameConfig) return;
    
    const { playerId } = payload;
    
    setPlayers(currentPlayers => {
        let tempPlayers = JSON.parse(JSON.stringify(currentPlayers));
        const playerIndex = tempPlayers.findIndex((p: Player) => p.id === playerId);
        if (playerIndex === -1) return currentPlayers;
        
        let player = tempPlayers[playerIndex];
        
        setPlayerStates(currentStates => {
            let tempStates = JSON.parse(JSON.stringify(currentStates));
            let playerState = tempStates[playerId];

            switch(action){
                case 'send_enemy': {
                    const { enemyType, cost, incomeBonus } = payload;
                    if (player.resources < cost) break;

                    player.resources -= cost;
                    player.incomePerSecond += incomeBonus;
                    
                    const opponentKey = player.id === 'player1' ? 'player2' : 'player1';

                    setVersusState(vs => {
                        const newVs = JSON.parse(JSON.stringify(vs || {}));
                        if (!newVs[opponentKey]) newVs[opponentKey] = { spawnQueue: [] };

                        const existing = newVs[opponentKey].spawnQueue.find((item: any) => item.type === enemyType);
                        if (existing) {
                            existing.count++;
                        } else {
                            newVs[opponentKey].spawnQueue.push({ type: enemyType, count: 1 });
                        }
                        deltaQueueRef.current.push([DeltaType.VERSUS_STATE_UPDATE, newVs]);
                        return newVs;
                    });
                    break;
                }
                case 'build': {
                    const { row, col, towerId } = payload;
                    const towerSpec = gameConfig.towers.find(t => t.id === towerId);
                    if (!towerSpec || player.resources < towerSpec.cost) break;
                    
                    const isOccupied = Object.values(playerState.towersByCell).some((t:any) => t.position.row === row && t.position.col === col) || playerState.ghosts.some((g:any) => g.row === row && g.col === col);
                    if (isOccupied) break;
                    
                    const newBlocked = [...Object.values(playerState.towersByCell).map((t:any) => t.position), {row, col}];
                    if (!findPath({row:1,col:1}, {row:GRID_ROWS,col:GRID_COLS}, newBlocked, GRID_ROWS, GRID_COLS)) break;
                    
                    player.resources -= towerSpec.cost;
                    const buildTimeMs = towerSpec.buildTimeMs ?? 2000;
                    const ghost: GhostFoundation = { id: `ghost-${row}-${col}-${Date.now()}`, row, col, towerId, startedAt: Date.now(), buildTimeMs, progress: 0 };
                    playerState.ghosts.push(ghost);

                    if (playerId === localPlayerId && isMobile) {
                       setSelectedTowerToBuild(null);
                    }
                    break;
                }
                case 'upgrade': {
                    const { row, col, upgradeId } = payload;
                    const key = `${row}_${col}`;
                    const existingTower = playerState.towersByCell[key];
                    if (!existingTower || existingTower.ownerId !== player.id) break;

                    const upgradeSpec = gameConfig.towers.find(t => t.id === upgradeId);
                    if (!upgradeSpec) break;
                    
                    const hasRequiredElements = upgradeSpec.elements.every(el => player.unlockedElements.includes(el));
                    if (!hasRequiredElements) break;
                    
                    const cost = upgradeSpec.cost - Math.floor(existingTower.cost * 0.75);
                    if (player.resources < cost) break;
                    
                    player.resources -= cost;

                    const sound: SoundEvent = { kind: 'sfx', name: 'upgrade_tower' };
                    audioManager.play(sound);
                    deltaQueueRef.current.push([DeltaType.AUDIO, sound]);

                    const upgradedTower: PlacedTower = {...existingTower, ...upgradeSpec, specId: upgradeSpec.id, health: upgradeSpec.maxHealth, id: existingTower.id };
                    playerState.towersByCell[key] = upgradedTower;
                    
                    deltaQueueRef.current.push([DeltaType.VFX_TOWER_UPGRADE, { towerId: upgradedTower.id, playerId: playerId }]);
                    
                    if (player.id === localPlayerId) {
                        setLastUpgradedTowerId(upgradedTower.id);
                        setTimeout(() => setLastUpgradedTowerId(null), 500);
                        setFocusedTower(upgradedTower);
                    }
                    break;
                }
                case 'sell': {
                     const { row, col } = payload;
                     const key = `${row}_${col}`;
                     const towerToSell = playerState.towersByCell[key];
                     if (!towerToSell || towerToSell.ownerId !== player.id) break;

                     const sound: SoundEvent = { kind: 'sfx', name: 'sell_tower' };
                     audioManager.play(sound);
                     deltaQueueRef.current.push([DeltaType.AUDIO, sound]);

                     const refund = Math.round(towerToSell.cost * 0.75);
                     player.resources += refund;
                     delete playerState.towersByCell[key];
                     
                     if (player.id === localPlayerId) {
                         setFocusedTower(null);
                     }
                     break;
                }
                case 'pick_element': {
                    const { element } = payload;
                    if (!player) break;

                    const newUnlocked = Array.from(new Set([...player.unlockedElements, element]));
                    player.unlockedElements = newUnlocked;
                    
                    audioManager.play({ kind: 'sfx', name: 'upgrade_tower' });

                    const allPlayersPicked = tempPlayers.every((p: Player) => {
                        if (!p) return true;
                        const expectedElements = 1 + Math.floor((currentWaveRef.current + 1) / 5);
                        return (p.unlockedElements?.length ?? 0) >= expectedElements;
                    });

                    if (allPlayersPicked) {
                        setCurrentWave(prev => prev + 1);
                        setIsIntermission(true);
                        setWaveStartCountdown(INTERMISSION_TIME);
                        setGameStatus('playing');
                        setIsLogicPaused(false);
                    }
                    break;
                }
                case 'start_wave_now': {
                    if (gameStatusRef.current === 'waiting') {
                        if (playersRef.current.length < 2) break;
                        setGameStatus('playing');
                        setIsIntermission(true);
                        setWaveStartCountdown(INTERMISSION_TIME);
                    } else if (isIntermissionRef.current) {
                        startWave(currentWaveRef.current);
                    }
                    break;
                }
            }
            
            deltaQueueRef.current.push([DeltaType.PLAYER_STATE_UPDATE, tempStates]);
            return tempStates;
        });

        tempPlayers[playerIndex] = player;
        deltaQueueRef.current.push([DeltaType.PLAYER_UPDATE, tempPlayers]);
        return tempPlayers;
    });

  }, [difficulty, waveStartCountdown, isIntermission, gameConfig, localPlayerId, cancelInteractions, isMobile, startWave, gameMode]);
    
    const handleActionData = useCallback((msg: any) => {
        if (!isGameHost) return;
        const { type, payload } = msg;

        switch (type) {
            case 'CLIENT_READY': {
                deltaQueueRef.current.push([DeltaType.SNAPSHOT, { players: playersRef.current, playerStates: playerStatesRef.current, currentWave: currentWaveRef.current, isIntermission: isIntermissionRef.current, waveStartCountdown, gameStatus: gameStatusRef.current, difficulty, gameMode: gameMode, versusState: versusStateRef.current }]);
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
    }, [isGameHost, onHostAction, waveStartCountdown, difficulty, gameMode]);
    
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

                    if (role === 'player1' && !gameDataLoaded) {
                         setDifficulty(data.difficulty || 'Normal');
                         setGameMode(data.gameMode || 'coop');
                         setPlayers(normalizePlayers(data.players));
                         setGameStatus(data.gameStatus);
                         setIsIntermission(data.isIntermission ?? true);
                         setWaveStartCountdown(data.waveStartCountdown ?? INTERMISSION_TIME);
                         setVersusState(data.versusState || null);
                         
                         const diffMods = difficultyModifiers[data.difficulty || 'Normal'];
                         const initialPlayerStates = {
                             player1: { lives: diffMods.startLives, towersByCell: data.player1?.towersByCell || {}, enemies: [], workers: [], ghosts: [], portals: [], currentPath: findPath({row:1,col:1},{row:GRID_ROWS,col:GRID_COLS}, [], GRID_ROWS, GRID_COLS) || [] },
                             player2: { lives: diffMods.startLives, towersByCell: data.player2?.towersByCell || {}, enemies: [], workers: [], ghosts: [], portals: [], currentPath: findPath({row:1,col:1},{row:GRID_ROWS,col:GRID_COLS}, [], GRID_ROWS, GRID_COLS) || [] },
                             spectator: { lives: 0, towersByCell: {}, enemies: [], workers: [], ghosts: [], portals: [], currentPath: [] },
                         };
                         setPlayerStates(initialPlayerStates);

                         setGameDataLoaded(true);
                         setLoading(false);
                    } else if (role !== 'player1') {
                        setGameMode(data.gameMode || 'coop');
                        setPlayers(normalizePlayers(data.players));
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
    }, [user, gameId, router, toast, configLoading, gameDataLoaded]);
    
  const onGameEnd = useCallback(async (won: boolean) => {
    if(gameStatusRef.current === 'gameover') return;
    // performGameEndActions(gameId, user, difficulty, currentWaveRef.current + 1, won, {});
    setGameStatus('gameover');
  }, [gameId, user, difficulty]);

  const handleEndOfWave = useCallback(() => {
    if (!isGameHost || !gameConfig) return;
    
    // This logic needs to be revisited for versus mode.
    // For now, let's assume it only works for coop.
    if(gameMode === 'coop') {
        const anyEnemiesLeft = Object.values(playerStatesRef.current).some(ps => ps.enemies.length > 0 && ps.enemies.some(e => !e.deathTimestamp));
        
        if (spawnQueueRef.current.length === 0 && !anyEnemiesLeft) {
            
            logGameStats(gameId, 'host', { 
                fps: fpsRef.current, 
                enemyCount: 0,
                towerCount: Object.values(playerStatesRef.current.player1.towersByCell).length,
                wave: currentWaveRef.current
            });
            
            setIsLogicPaused(true);
            const nextWaveIndex = currentWaveRef.current + 1;

            if (nextWaveIndex >= gameConfig.waves.length) {
                onGameEnd(true);
                return;
            }
            
            const expectedElements = 1 + Math.floor(nextWaveIndex / 5);
            const playersNeedingPick = playersRef.current.filter(p => p && p.id !== 'spectator' && (p.unlockedElements?.length ?? 0) < expectedElements);

            if (playersNeedingPick.length > 0 && nextWaveIndex % 5 === 0) {
                setGameStatus('picking-element');
                setIsIntermission(true);
            } else {
                setCurrentWave(nextWaveIndex);
                setIsIntermission(true);
                setWaveStartCountdown(INTERMISSION_TIME);
                setPlayerStates(ps => ({
                    player1: { ...ps.player1, portals: [] },
                    player2: { ...ps.player2, portals: [] },
                    spectator: ps.spectator,
                }));
                setIsLogicPaused(false);
            }
        }
    }
  }, [isGameHost, gameConfig, onGameEnd, gameId, gameMode]);

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

          if (gameIsPaused) {
            return;
          }
              
          if (currentStatus === 'playing') {
            
              const updatedPlayersWithIncome = playersRef.current.map(p => ({
                  ...p,
                  resources: p.resources + (p.incomePerSecond * (delta / 1000)),
              }));
              setPlayers(updatedPlayersWithIncome);
              deltaQueueRef.current.push([DeltaType.PLAYER_UPDATE, updatedPlayersWithIncome]);
              
              if (isIntermissionRef.current) {
                  setWaveStartCountdown(prev => Math.max(0, prev - (delta/1000)));
              } else {
                 // Active wave logic would go here
              }
          }
      };

      if(isGameHost){
          gameLoop();
      }
      
      return () => {
          stopped = true;
          if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current);
      }
  }, [isGameHost, user, gameId, difficulty, onGameEnd, handleEndOfWave, totalKilled, totalLeaked, sendGameData, gameConfig, waveStartCountdown, gameMode]);


  useEffect(() => {
    if(gameStatus === 'picking-element' && localPlayer?.id === 'player2') {
    } else if (gameStatus === 'picking-element' && isGameHost) {
    }
  }, [gameStatus, localPlayer?.id, isGameHost]);

  const toggleMute = () => {
    setIsMuted(current => {
      const newMuted = !current;
      if (newMuted) audioManager.mute();
      else audioManager.unmute();
      return newMuted;
    });
  };
  
  const handlePlaceAction = useCallback((row: number, col: number) => {
    const payload = { row, col, playerId: localPlayerId };
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
        dispatchAction('build', { ...payload, towerId: selectedTowerToBuild.id });
    } else {
        dispatchAction('move_worker', payload);
    }
  }, [portalPhase, portalEntrance, selectedTowerToBuild, cancelInteractions, dispatchAction, localPlayerId]);

  if (configLoading || !gameConfig || !localPlayer) {
    return <div className="w-full h-full flex flex-col items-center justify-center bg-background"><Loader2 className="h-10 w-10 animate-spin text-primary mb-4" /><p className="text-muted-foreground">{loadingMessage}</p></div>;
  }
  
  const handleUpgradeTowerAction = (upgradeId: string) => focusedTower && dispatchAction('upgrade', { row: focusedTower.position.row, col: focusedTower.position.col, upgradeId });
  const handleSellTowerAction = () => focusedTower && dispatchAction('sell', { row: focusedTower.position.row, col: focusedTower.position.col, playerId: focusedTower.ownerId });
  const handleSendEnemy = (payload: { enemyType: string, cost: number, incomeBonus: number }) => dispatchAction('send_enemy', payload);

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
  
  const localPlayerState = playerStates[localPlayer.id as keyof typeof playerStates];


  return (
        <div className="w-full h-full flex flex-col" onClick={() => { if(!hasInteracted) { audioManager.init(); setHasInteracted(true); }}}>
             <Header onExit={onExit} isMuted={isMuted} toggleMute={toggleMute} fps={isGameHost ? fps : stats.fps} />
             <div className="flex-grow p-2">
                <LayoutComponent
                    players={players} 
                    setPlayers={setPlayers} 
                    gameState={{lives: 0}}
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
                    placedTowers={Object.values(localPlayerState.towersByCell)} 
                    enemies={localPlayerState.enemies}
                    workers={localPlayerState.workers}
                    ghosts={localPlayerState.ghosts}
                    portals={localPlayerState.portals}
                    damageNumbers={[]} 
                    splashRings={[]}
                    persistentClouds={[]}
                    currentPath={localPlayerState.currentPath} 
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



