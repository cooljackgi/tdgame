

'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import type { User } from 'firebase/auth';
import { onAuthStateChanged, auth } from '@/lib/firebase';
import { doc, onSnapshot, Unsubscribe, updateDoc, collection, addDoc, serverTimestamp, getDoc } from 'firebase/firestore';
import { db, functions } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { normalizePlayers } from '@/lib/player-utils';
import type { Player, GameState, GameStatus, PlacedTower, Difficulty, Tower, Element, Enemy, Attack, DamageNumber, SplashRing, Node, EnemyStatusEffect, TowerEffect, PingPayload, RequestPayload, RequestResolve, PingKind, LifeGainVfx, GravityWell, PersistentCloud, SoundEvent, Worker, GhostFoundation, GameSessionState, Portal, GameDelta } from '@/lib/game-data/types';
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
  
  const [isLogicPaused, setIsLogicPaused] = useState(false);
  
  const placedTowers = useMemo(() => Object.values(towersByCell), [towersByCell]);

  
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
    return localPlayerId ? { id: localPlayerId, name: 'Wird geladen…', avatarUrl: null, resources: 0, unlockedElements: ['neutral' as Element], incomePerSecond: 5, portalCooldownUntilWave: 0 } : null;
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
  const currentPathRef = useRef(currentPath);
  useEffect(() => { currentPathRef.current = currentPath }, [currentPath]);
  const gameStatusRef = useRef(gameStatus);
  useEffect(() => { gameStatusRef.current = gameStatus }, [gameStatus]);
  const isIntermissionRef = useRef(isIntermission);
  useEffect(() => { isIntermissionRef.current = isIntermission }, [isIntermission]);
  const playersRef = useRef(players);
  useEffect(() => { playersRef.current = players; }, [players]);
  const isLogicPausedRef = useRef(isLogicPaused);
  useEffect(() => { isLogicPausedRef.current = isLogicPaused; }, [isLogicPaused]);
  const gameStateRef = useRef(gameState);
  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);
  const currentWaveRef = useRef(currentWave);
  useEffect(() => { currentWaveRef.current = currentWave }, [currentWave]);
  const towersByCellRef = useRef(towersByCell);
  useEffect(() => { towersByCellRef.current = towersByCell; }, [towersByCell]);
  const enemiesRef = useRef(enemies);
  useEffect(() => { enemiesRef.current = enemies; }, [enemies]);
  const workersRef = useRef(workers);
  useEffect(() => { workersRef.current = workers }, [workers]);
  const ghostsRef = useRef(ghosts);
  useEffect(() => { ghostsRef.current = ghosts }, [ghosts]);
  const portalsRef = useRef(portals);
  useEffect(() => { portalsRef.current = portals }, [portals]);
  const gravityWellsRef = useRef(gravityWells);
  useEffect(() => { gravityWellsRef.current = gravityWells; }, [gravityWells]);
  const persistentCloudsRef = useRef(persistentClouds);
  useEffect(() => { persistentCloudsRef.current = persistentClouds; }, [persistentClouds]);
  
  const onFocusTower = (tower: PlacedTower) => {
    cancelInteractions();
    setFocusedTower(tower);
  };
  
  const onExit = () => {
    router.push('/');
  };

    const persistGameOverview = useCallback(async (payload: Record<string, unknown>) => {
        if (!isGameHost || !gameId) return;
        try {
            await updateDoc(doc(db, 'games', gameId), {
                ...payload,
                lastPlayedAt: serverTimestamp(),
            });
        } catch (error) {
            console.error('Failed to persist game overview:', error);
        }
    }, [isGameHost, gameId]);

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
            const [deltaType, deltaPayload] = delta;
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
                case DeltaType.TOWERS_UPDATE: 
                  setTowersByCell(deltaPayload as Record<string, PlacedTower>);
                  // Check if focused tower should be closed
                  setFocusedTower(currentFocused => {
                      if (!currentFocused) return null;
                      const updatedTower = (deltaPayload as Record<string, PlacedTower>)[`${currentFocused.position.row}_${currentFocused.position.col}`];
                      if (!updatedTower || !updatedTower.upgradesTo) return null; // Tower sold or no more upgrades
                      
                      const unlocked = new Set(localPlayer?.unlockedElements || []);
                      const hasMoreUpgrades = updatedTower.upgradesTo.some(upgId => {
                          const nextSpec = gameConfig?.towers.find(t => t.id === upgId);
                          return nextSpec && (nextSpec.elements.every(el => unlocked.has(el)));
                      });
                      
                      if (!hasMoreUpgrades) return null;
                      return updatedTower; // Keep it open and updated
                  });
                  break;
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
  }, [isGameHost, gameConfig, localPlayer]);

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
        { lives: gameStateRef.current.lives, currentWave: waveIndex, gameStatus: 'playing', isIntermission: false, waveStartCountdown: 0 }
    ]);

        void persistGameOverview({
            currentWave: waveIndex,
            gameStatus: 'playing',
            isIntermission: false,
            waveStartCountdown: 0,
        });

    }, [isGameHost, difficulty, gameConfig, persistGameOverview]);

  const onHostAction = useCallback((action:'build'|'upgrade'|'sell'|'pick_element'|'start_wave_now'|'move_worker'| 'place_portal', payload:any) => {
    if (!isGameHost || !gameConfig) return;
    
    setPlayers(currentPlayers => {
        const tempPlayers = JSON.parse(JSON.stringify(currentPlayers));
        const playerIndex = tempPlayers.findIndex((p: Player) => p.id === payload.playerId);
        if (playerIndex === -1) return currentPlayers;

        const player = tempPlayers[playerIndex];
        const tempTowersByCell = JSON.parse(JSON.stringify(towersByCellRef.current));
        
        const tempState: GameSessionState = { gameMode: 'coop', players: tempPlayers, gameState: gameStateRef.current, towersByCell: tempTowersByCell, enemies: enemiesRef.current, currentWave: currentWaveRef.current, difficulty, gameStatus: gameStatusRef.current, currentPath: currentPathRef.current, waveStartCountdown, isIntermission, workers: workersRef.current, ghosts: ghostsRef.current, portals: portalsRef.current };

        switch(action){
            case 'place_portal': {
                const { entrance, exit, playerId } = payload;
                const workerId = playerId === 'player1' ? 'worker-1' : 'worker-2';
                const updatedState = enqueuePlacePortalOrder(tempState, workerId, entrance, exit, Date.now());
                setWorkers(updatedState.workers);
                setPortals(updatedState.portals || []);
                if (playerId === localPlayerId) cancelInteractions();
                return updatedState.players;
            }
            case 'move_worker': {
                const { row, col, playerId } = payload;
                const workerId = playerId === 'player1' ? 'worker-1' : 'worker-2';
                const updatedState = enqueueMoveOrder(tempState, workerId, row, col);
                setWorkers(updatedState.workers);
                return updatedState.players;
            }
            case 'build': {
                const { playerId, row, col, towerId } = payload;
                const workerId = playerId === 'player1' ? 'worker-1' : 'worker-2';
                const updatedState = enqueueBuildOrder(tempState, workerId, row, col, towerId, Date.now());
                setGhosts(updatedState.ghosts);
                setWorkers(updatedState.workers);
                if (playerId === localPlayerId && isMobile) {
                   setSelectedTowerToBuild(null);
                }
                return updatedState.players;
            }
            case 'upgrade': {
                const { row, col, upgradeId } = payload;
                const key = `${row}_${col}`;
                const existingTower = tempTowersByCell[key];
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
                tempTowersByCell[key] = upgradedTower;
                setTowersByCell(tempTowersByCell);

                deltaQueueRef.current.push([DeltaType.VFX_TOWER_UPGRADE, { towerId: upgradedTower.id }]);
                deltaQueueRef.current.push([DeltaType.TOWERS_UPDATE, tempTowersByCell]);

                const hasFurtherUpgrades = upgradeSpec.upgradesTo?.some(upgId => {
                    const nextSpec = gameConfig.towers.find(t => t.id === upgId);
                    return nextSpec && (player.unlockedElements || []).some(el => nextSpec.elements.includes(el));
                });
                
                if (player.id === localPlayerId) {
                    setLastUpgradedTowerId(upgradedTower.id);
                    setTimeout(() => setLastUpgradedTowerId(null), 500);

                    if (!hasFurtherUpgrades) {
                        setFocusedTower(null); 
                    } else {
                        setFocusedTower(upgradedTower);
                    }
                }
                break;
            }
            case 'sell': {
                 const { row, col } = payload;
                 const key = `${row}_${col}`;
                 const towerToSell = tempTowersByCell[key];
                 if (!towerToSell || towerToSell.ownerId !== player.id) break;

                 const sound: SoundEvent = { kind: 'sfx', name: 'sell_tower' };
                 audioManager.play(sound);
                 deltaQueueRef.current.push([DeltaType.AUDIO, sound]);

                 const refund = Math.round(towerToSell.cost * 0.75);
                 player.resources += refund;
                 delete tempTowersByCell[key];
                 setTowersByCell(tempTowersByCell);
                 deltaQueueRef.current.push([DeltaType.TOWERS_UPDATE, tempTowersByCell]);
                 
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

                // Check if ALL players have made their choice for this round
                const allPlayersPicked = tempPlayers.every((p: Player) => {
                    if (!p) return true; // Ignore empty player slots
                    const expectedElements = 1 + Math.floor((currentWaveRef.current + 1) / 5);
                    return (p.unlockedElements?.length ?? 0) >= expectedElements;
                });

                if (allPlayersPicked) {
                    setCurrentWave(prev => prev + 1);
                    setIsIntermission(true);
                    setWaveStartCountdown(INTERMISSION_TIME);
                    setGameStatus('playing');
                    setIsLogicPaused(false);
                    void persistGameOverview({
                      currentWave: currentWaveRef.current + 1,
                      gameStatus: 'playing',
                      isIntermission: true,
                      waveStartCountdown: INTERMISSION_TIME,
                    });
                }
                break;
            }
            case 'start_wave_now': {
                if (gameStatusRef.current === 'waiting') {
                    if (playersRef.current.length < 2) break;
                    setGameStatus('playing');
                    setIsIntermission(true);
                    setWaveStartCountdown(INTERMISSION_TIME);
                    void persistGameOverview({
                      gameStatus: 'playing',
                      isIntermission: true,
                      waveStartCountdown: INTERMISSION_TIME,
                    });
                } else if (isIntermissionRef.current) {
                    startWave(currentWaveRef.current);
                }
                break;
            }
        }
        
        return tempPlayers;
    });

    }, [difficulty, waveStartCountdown, isIntermission, gameConfig, localPlayerId, cancelInteractions, isMobile, startWave, persistGameOverview]);
    
    const handleActionData = useCallback((msg: any) => {
        if (!isGameHost) return;
        const { type, payload } = msg;

        switch (type) {
            case 'CLIENT_READY': {
                deltaQueueRef.current.push([DeltaType.SNAPSHOT, { gameMode: 'coop', players: playersRef.current, enemies: enemiesRef.current, towersByCell: towersByCellRef.current, gameState: gameStateRef.current, currentWave: currentWaveRef.current, isIntermission: isIntermissionRef.current, waveStartCountdown, gameStatus: gameStatusRef.current, difficulty, currentPath: currentPathRef.current, workers: workersRef.current, ghosts: ghostsRef.current, portals: portalsRef.current }]);
                return;
            }
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
    }, [isGameHost, onHostAction, waveStartCountdown, difficulty]);
    
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
      sendAction(actionType, { ...payload, playerId: localPlayerId });
  }, [localPlayerId, isGameHost, sendAction]);
  
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
                    // This is a spectator joining
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
                         setDifficulty(data.difficulty || 'Normal');
                         setPlayers(normalizePlayers(data.players));
                         setGameState(data.gameState || { lives: difficultyModifiers[data.difficulty || 'Normal'].startLives });
                         setTowersByCell(data.towersByCell || {});
                         setGameStatus(data.gameStatus);
                         setIsIntermission(data.isIntermission ?? true);
                         setWaveStartCountdown(data.waveStartCountdown ?? INTERMISSION_TIME);
                         setWorkers(data.workers || [
                          { id: "worker-1", x: 64, y: 64, speed: 260, state: "idle", queue: [], moveTarget: null },
                          { id: "worker-2", x: 64 * 2, y: 64, speed: 260, state: "idle", queue: [], moveTarget: null }
                        ]);
                         setGhosts(data.ghosts || []);
                         setPortals(data.portals || []);
                         setGameDataLoaded(true); // Lock it
                         setLoading(false);
                    } else if (role !== 'player1') {
                        // CLIENT: Only update players from DB, rest comes via WebRTC
                        setPlayers(normalizePlayers(data.players));
                        if (!gameDataLoaded) {
                            setGameDataLoaded(true); // Still set to true to prevent re-loading
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
    
  const onGameEnd = useCallback(async (won: boolean) => {
    if(gameStatusRef.current === 'gameover') return;
    performGameEndActions(gameId, user, difficulty, currentWaveRef.current + 1, won, towersByCellRef.current);
    setGameStatus('gameover');
        void persistGameOverview({
            gameStatus: 'gameover',
            isIntermission: false,
            currentWave: currentWaveRef.current,
            endedAt: serverTimestamp(),
            result: won ? 'won' : 'lost',
        });
    }, [gameId, user, difficulty, persistGameOverview]);

  const handleEndOfWave = useCallback(() => {
    if (!isGameHost || !gameConfig) return;
    
    // Check if the game is already over
    if (gameStateRef.current.lives <= 0) {
        onGameEnd(false);
        return;
    }
    
    logGameStats(gameId, 'host', { 
        fps: fpsRef.current, 
        enemyCount: enemiesRef.current.filter(e => !e.deathTimestamp).length, 
        towerCount: Object.keys(towersByCellRef.current).length,
        wave: currentWaveRef.current
    });

    setIsLogicPaused(true);
    const nextWaveIndex = currentWaveRef.current + 1;

    // Check for win condition
    if (nextWaveIndex >= gameConfig.waves.length) {
        onGameEnd(true);
        return;
    }
    
    const expectedElements = 1 + Math.floor(nextWaveIndex / 5);
    const playersNeedingPick = playersRef.current.filter(p => p && p.id !== 'spectator' && (p.unlockedElements?.length ?? 0) < expectedElements);

    if (playersNeedingPick.length > 0 && nextWaveIndex % 5 === 0) {
        setGameStatus('picking-element');
        setIsIntermission(true);
        // This is now sent reliably due to the loop change
        deltaQueueRef.current.push([
            DeltaType.GAME_STATE_UPDATE,
            { lives: gameStateRef.current.lives, currentWave: currentWaveRef.current, gameStatus: 'picking-element', isIntermission: true, waveStartCountdown: waveStartCountdown }
        ]);
        void persistGameOverview({
          currentWave: currentWaveRef.current,
          gameStatus: 'picking-element',
          isIntermission: true,
          waveStartCountdown,
        });
        return; 
    }
    
    // Normaler Übergang zur nächsten Welle
    setCurrentWave(nextWaveIndex);
    setIsIntermission(true);
    setWaveStartCountdown(INTERMISSION_TIME);
    setPortals(prev => prev.map(p => ({ ...p, expiresAt: Date.now() + 500 })));
    setIsLogicPaused(false);
        void persistGameOverview({
            currentWave: nextWaveIndex,
            gameStatus: 'playing',
            isIntermission: true,
            waveStartCountdown: INTERMISSION_TIME,
        });
    }, [isGameHost, gameConfig, onGameEnd, waveStartCountdown, gameId, persistGameOverview]);

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
          // FPS Calculation & Network Sending
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
              deltaQueueRef.current.push([DeltaType.GAME_STATE_UPDATE, {
                    lives: gameStateRef.current.lives,
                    currentWave: currentWaveRef.current,
                    gameStatus: gameStatusRef.current,
                    isIntermission: isIntermissionRef.current,
                    waveStartCountdown: waveStartCountdown,
              }]);
              deltaQueueRef.current.push([DeltaType.STATS_UPDATE, {
                    totalKilled: totalKilled,
                    totalLeaked: totalLeaked,
              }]);
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
              
          const stateToUpdate: GameSessionState = { gameMode: 'coop', players: playersRef.current, gameState: gameStateRef.current, towersByCell: towersByCellRef.current, enemies: enemiesRef.current, currentWave: currentWaveRef.current, difficulty, gameStatus: currentStatus, currentPath: currentPathRef.current, waveStartCountdown, isIntermission: isIntermissionRef.current, workers: workersRef.current, ghosts: ghostsRef.current, portals: portalsRef.current };
          
          const { workers: nextWorkers, towersByCell: towersAfterBuild, ghosts: nextGhosts, portals: nextPortals, players: playersAfterBuild } = tickWorkers(stateToUpdate, delta, epochNow, gameConfig.towers);
          
          const towersChanged = Object.keys(towersAfterBuild).length !== Object.keys(towersByCellRef.current).length;
          const ghostsChanged = nextGhosts.length !== ghostsRef.current.length;
          const portalsChanged = nextPortals?.length !== (portalsRef.current?.length || 0);

          setWorkers(nextWorkers);
          setPlayers(playersAfterBuild);
          if (ghostsChanged) { setGhosts(nextGhosts); deltaQueueRef.current.push([DeltaType.GHOST_UPDATE, nextGhosts]); }
          if (towersChanged) { setTowersByCell(towersAfterBuild); deltaQueueRef.current.push([DeltaType.TOWERS_UPDATE, towersAfterBuild]); }
          if (portalsChanged) { setPortals(nextPortals); deltaQueueRef.current.push([DeltaType.PORTAL_UPDATE, nextPortals]); }
          
          if(ghostsChanged || towersChanged || portalsChanged) {
            deltaQueueRef.current.push([DeltaType.WORKER_UPDATE, nextWorkers]);
            deltaQueueRef.current.push([DeltaType.PLAYER_UPDATE, playersAfterBuild]);
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
              } else { // Welle ist aktiv
              
              let livesLostThisTick = 0;
              let killedThisTick = 0;
              let resourcesGained = { player1: 0, player2: 0 };
              
              let newAttacks: Attack[] = [];
              let newDamageNumbers: DamageNumber[] = [];
              let newSplashRings: SplashRing[] = [];
              let newLifeGainVfx: LifeGainVfx[] = [];
              let newSoundEvents: SoundEvent[] = [];
              let newGravityWells: GravityWell[] = [];
              let newPersistentClouds: PersistentCloud[] = [];
              
              let currentEnemies = [...enemiesRef.current];
              let updatedTowers = {...towersByCellRef.current};

                const timeSinceWaveStart = Date.now() - waveStartTimeRef.current;
                if (spawnQueueRef.current.length > 0) {
                    const enemiesToSpawnNow = spawnQueueRef.current.filter(e => e._spawnTime <= timeSinceWaveStart);
                    if (enemiesToSpawnNow.length > 0) {
                        spawnQueueRef.current = spawnQueueRef.current.filter(e => e._spawnTime > timeSinceWaveStart);
                        const nowEpoch = Date.now();
                        const newEnemiesThisFrame = enemiesToSpawnNow.map(e => ({ ...e, lastMove: nowEpoch, path: currentPathRef.current }));
                        currentEnemies.push(...newEnemiesThisFrame);
                    }
                }
              
              let firingIds = new Set<string>();

              Object.values(updatedTowers).forEach(tower => {
                  if (epochNow - tower.lastAttack >= tower.attackSpeed) {
                      const isBuffed = false;
                      let targets: Enemy[] = [];
                      if (tower.effects?.some(e => e.type === 'multishot')) {
                          const effect = tower.effects.find(e => e.type === 'multishot')!;
                          targets = currentEnemies.filter(enemy => {
                              if (enemy.deathTimestamp) return false;
                              const distSq = (tower.position.col - enemy.position.col) ** 2 + (tower.position.row - enemy.position.row) ** 2;
                              return distSq <= tower.range * tower.range;
                          }).sort((a,b) => a.pathIndex - b.pathIndex).slice(0, effect.targets);
                      } else {
                          let target: Enemy | null = null;
                          let minDistanceSq = tower.range * tower.range;
                          currentEnemies.forEach(enemy => {
                              if (enemy.deathTimestamp) return;
                              const distSq = (tower.position.col - enemy.position.col) ** 2 + (tower.position.row - enemy.position.row) ** 2;
                              if (distSq <= minDistanceSq) {
                                  minDistanceSq = distSq;
                                  target = enemy;
                              }
                          });
                          if(target) targets.push(target);
                      }

                      if (targets.length > 0) {
                          tower.lastAttack = epochNow;
                          firingIds.add(tower.id);
                          
                          for (const target of targets) {
                            const result = processAttack(tower, target, currentEnemies, epochNow, isBuffed);
                            currentEnemies = result.updatedEnemies;
                            
                            newAttacks.push(...result.newAttacks);
                            newDamageNumbers.push(...result.damageNumbers);
                            newSplashRings.push(...result.splashRings);
                            newLifeGainVfx.push(...result.lifeGainVfx);
                            newSoundEvents.push(...result.soundEvents);
                            if (result.newPersistentClouds.length > 0) newPersistentClouds.push(...result.newPersistentClouds);
                            if (result.newGravityWells.length > 0) newGravityWells.push(...result.newGravityWells);

                            if (result.resourcesGained > 0) {
                                playersRef.current.forEach(p => {
                                    const key = p.id as 'player1' | 'player2';
                                    if(resourcesGained[key] !== undefined) {
                                      resourcesGained[key] += result.resourcesGained;
                                    }
                                });
                            }
                            if (result.livesGained > 0) {
                                setGameState(gs => ({...gs, lives: gs.lives + result.livesGained}));
                            }
                            if (result.killed > 0) killedThisTick += result.killed;
                        }
                      }
                  }
              });
              
              setTowersByCell(currentTowers => ({ ...currentTowers, ...updatedTowers }));

              if (firingIds.size > 0) {
                 setFiringTowerIds(new Set(firingIds));
                 setTimeout(() => setFiringTowerIds(new Set()), 150);
              }
              
              if (newAttacks.length > 0) { gameBoardRef.current?.queueAttacks(newAttacks); deltaQueueRef.current.push([DeltaType.VFX_ATTACK, newAttacks]); }
              if (newDamageNumbers.length > 0) { gameBoardRef.current?.queueDamageNumbers(newDamageNumbers); deltaQueueRef.current.push([DeltaType.VFX_DAMAGE, newDamageNumbers]); }
              if (newSplashRings.length > 0) { gameBoardRef.current?.queueSplashRings(newSplashRings); deltaQueueRef.current.push([DeltaType.VFX_SPLASH, newSplashRings]); }
              newSoundEvents.forEach(ev => { audioManager.play(ev); deltaQueueRef.current.push([DeltaType.AUDIO, ev]); });


              const stillAlive: Enemy[] = [];
              const activeGravityWells = [...(gravityWellsRef.current || []), ...newGravityWells].filter(w => w.expires > epochNow);
              const activePersistentClouds = [...(persistentCloudsRef.current || []), ...newPersistentClouds].filter(c => c.expires > epochNow);
              const activePortals = (portalsRef.current ?? []).filter(p => p.expiresAt > epochNow || p.expiresAt === 0);

              for (let enemy of currentEnemies) {
                  if (enemy.deathTimestamp && epochNow - enemy.deathTimestamp > 2500) continue;
                  if (enemy.deathTimestamp) { stillAlive.push(enemy); continue; }
                  
                  let updatedEnemy: Enemy | null = { ...enemy, wasHit: false, vx: 0, vy: 0, effects: enemy.effects.filter(e => e.expires > epochNow) };
                  const dotResult = tickDots(updatedEnemy, delta);
                  if (dotResult.totalDamage > 0) gameBoardRef.current?.queueDamageNumbers([{id: crypto.randomUUID(), amount: dotResult.totalDamage, targetId: updatedEnemy.id, color: '#f97316'}]);
                  if (dotResult.killed && !updatedEnemy.deathTimestamp) updatedEnemy.deathTimestamp = epochNow;
                  if (updatedEnemy.deathTimestamp) { stillAlive.push(updatedEnemy); continue; }
                  
                  const stunEffect = updatedEnemy.effects.find(e => e.type === 'stun');
                  if (stunEffect) { stillAlive.push(updatedEnemy); continue; }

                  let teleported = false;
                  for (const portal of activePortals) {
                      if (!portal.active) continue;
                      const entranceDistSq = (updatedEnemy.position.col - portal.entrance.col) ** 2 + (updatedEnemy.position.row - portal.entrance.row) ** 2;
                      if (entranceDistSq < 0.5 && epochNow - (updatedEnemy.lastTeleportAt || 0) > portal.perEnemyCooldownMs) {
                          updatedEnemy.position = { ...portal.exit };
                          updatedEnemy.lastTeleportAt = epochNow;
                          updatedEnemy.teleportsUsed = (updatedEnemy.teleportsUsed || 0) + 1;
                          updatedEnemy.path = findPath(portal.exit, {row: GRID_ROWS, col: GRID_COLS}, Object.values(towersByCellRef.current).map(t => t.position), GRID_ROWS, GRID_COLS) ?? [];
                          updatedEnemy.pathIndex = 0;
                          updatedEnemy.lastMove = epochNow;
                          teleported = true;
                          break; 
                      }
                  }
                  if (teleported) { stillAlive.push(updatedEnemy); continue; }
                  
                  const slowEffect = updatedEnemy.effects.find(e => e.type === 'slow');
                  const speed = updatedEnemy.speed * (slowEffect ? (1 - (slowEffect.potency ?? 0)) : 1);
                  const stepMs = 1000 / Math.max(0.01, speed);
                  let timeToMove = epochNow - updatedEnemy.lastMove;
                  
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
                  
                   if (updatedEnemy) {
                     if (updatedEnemy.health <= 0 && !updatedEnemy.deathTimestamp) {
                          updatedEnemy.deathTimestamp = epochNow;
                     }
                     stillAlive.push(updatedEnemy);
                   }
              }
              
              setEnemies(stillAlive);
              deltaQueueRef.current.push([DeltaType.ENEMY_UPDATE, stillAlive]);
              
              setGravityWells(activeGravityWells);
              setPersistentClouds(activePersistentClouds);
              
              if (livesLostThisTick > 0) {
                  setTotalLeaked(prev => prev + livesLostThisTick);
                  setGameState(gs => {
                      const newLives = gs.lives - livesLostThisTick;
                      if (newLives <= 0) {
                            onGameEnd(false);
                            setGameStatus('gameover');
                      }
                      return { ...gs, lives: newLives };
                  });
              }
              
              setPlayers(prev => prev.map(p => {
                  const gainP1 = resourcesGained.player1 || 0;
                  const gainP2 = resourcesGained.player2 || 0;
                  if (p.id === 'player1') return { ...p, resources: p.resources + gainP1 };
                  if (p.id === 'player2') return { ...p, resources: p.resources + gainP2 };
                  return p;
              }));
              
              const spawnQueueEmpty = spawnQueueRef.current.length === 0;
              const activeEnemies = stillAlive.filter(e => !e.deathTimestamp);

              if (spawnQueueEmpty && activeEnemies.length === 0 && !isIntermissionRef.current) {
                  handleEndOfWave();
              }
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
  }, [isGameHost, user, gameId, difficulty, onGameEnd, handleEndOfWave, totalKilled, totalLeaked, sendGameData, gameConfig, waveStartCountdown]);


  useEffect(() => {
    // This effect handles the UI change for the dialog.
    if(gameStatus === 'picking-element' && localPlayer?.id === 'player2') {
       // Client-side UI is driven by gameStatus
    } else if (gameStatus === 'picking-element' && isGameHost) {
       // Host-side UI is driven by gameStatus
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
    const state: GameSessionState = { gameMode: 'coop', players: playersRef.current, gameState: gameStateRef.current, towersByCell: towersByCellRef.current, enemies: enemiesRef.current, currentWave: currentWaveRef.current, difficulty, gameStatus: gameStatusRef.current, currentPath: currentPathRef.current, waveStartCountdown, isIntermission: isIntermissionRef.current, workers: workersRef.current, ghosts: ghostsRef.current, portals: portalsRef.current };
    
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
  }, [portalPhase, portalEntrance, selectedTowerToBuild, cancelInteractions, dispatchAction, difficulty, waveStartCountdown, isIntermission]);

  if (configLoading || !gameConfig || !localPlayer) {
    return <div className="w-full h-full flex flex-col items-center justify-center bg-background"><Loader2 className="h-10 w-10 animate-spin text-primary mb-4" /><p className="text-muted-foreground">{loadingMessage}</p></div>;
  }
  
  const handleUpgradeTowerAction = (upgradeId: string) => focusedTower && dispatchAction('upgrade', { row: focusedTower.position.row, col: focusedTower.position.col, upgradeId });
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

  return (
        <div className="w-full h-full flex flex-col" onClick={() => { if(!hasInteracted) { audioManager.init(); setHasInteracted(true); }}}>
             <Header onExit={onExit} isMuted={isMuted} toggleMute={toggleMute} fps={isGameHost ? fps : stats.fps} />
             <div className={isMobile ? "flex-grow min-h-0 overflow-hidden" : "flex-grow min-h-0 overflow-hidden p-2"}>
                <LayoutComponent
                    players={players} 
                    setPlayers={setPlayers} 
                    gameState={gameState} 
                    localPlayer={localPlayer!}
                    currentWave={currentWave} 
                    totalWaves={gameConfig.waves.length} 
                    difficulty={difficulty} 
                    handleGameControl={() => {}}
                    gameStatus={gameStatus} 
                    resetGame={onExit}
                    towers={gameConfig.towers} 
                    waves={gameConfig.waves}
                    setTowers={() => {}} 
                    placedTowers={placedTowers} 
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
                    cheat_addResources={() => {}}
                    cheat_skipWaves={() => {}}
                    cheat_heal={() => {}}
                    cheat_unlockAll={() => {}}
                    firingTowerIds={firingTowerIds} 
                    allTowers={gameConfig.towers}
                    isWsConnected={isConnected} 
                    onPing={sendPing}
                    hostPacketsPerSecond={stats.sentPacketsPerSecond} 
                    hostBytesSentPerSecond={stats.sentBytesPerSecond}
                    clientPacketsPerSecond={stats.packetsPerSecond}
                    clientBytesReceivedPerSecond={stats.bytesPerSecond}
                    averagePacketSize={stats.averagePacketSize}
                    isPlacingPortalEntrance={portalPhase !== 'idle'}
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

