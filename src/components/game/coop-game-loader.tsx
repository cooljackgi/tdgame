

'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import type { User } from 'firebase/auth';
import { onAuthStateChanged, auth } from '@/lib/firebase';
import { doc, onSnapshot, Unsubscribe, updateDoc, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, functions } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { normalizePlayers } from '@/lib/player-utils';
import type { Player, GameState, GameStatus, PlacedTower, Difficulty, Tower, Element, Enemy, Attack, DamageNumber, SplashRing, Node, EnemyStatusEffect, TowerEffect, PingPayload, RequestPayload, RequestResolve, PingKind, LifeGainVfx, GravityWell, PersistentCloud, AuraBuffs, DoTEffect, DamageApplicationResult, ProcessAttackResult, SoundEvent, Worker, GhostFoundation, GameSessionState, Portal } from '@/lib/game-data/types';
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
  const [hostRevision, setHostRevision] = useState(0);
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
  const countdownRef = useRef<number | null>(null);
  const enemyIdCounter = useRef(0);
  const spawnQueueRef = useRef<any[]>([]);
  const waveStartTimeRef = useRef<number>(0);
  
  // Refs for stable access in game loop
  const currentPathRef = useRef(currentPath);
  useEffect(() => { currentPathRef.current = currentPath }, [currentPath]);
  
  const onFocusTower = (tower: PlacedTower) => {
    setSelectedTowerToBuild(null);
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

  // --- Refs to hold stable function references ---
  const sendActionRef = useRef<(type: string, payload: any) => void>(() => {});
  const sendGameDataRef = useRef<(type: string, payload: any) => void>(() => {});
  
    const startWave = useCallback((waveIndex: number) => {
        if (!isGameHost || !gameConfig) return;

        audioManager.play({ kind: 'sfx', name: 'wave_start' });
        audioManager.playWaveMusic();
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
        setIsIntermission(false);
        setCurrentWave(waveIndex);
        setWaveStartCountdown(0);
        setHostRevision(r => r + 1);

    }, [isGameHost, difficulty, gameConfig]);

    const onHostAction = useCallback((action:'build'|'upgrade'|'sell'|'pick_element'|'start_wave_now'|'move_worker'| 'place_portal', payload:any) => {
        if (!isGameHost || !gameConfig) return;
        
        const state: GameSessionState = { players, gameState, towersByCell, enemies, currentWave, difficulty, gameStatus, currentPath, waveStartCountdown, isIntermission, workers, ghosts, portals };

        switch(action){
            case 'place_portal': {
                const { entrance, exit, playerId } = payload;
                const workerId = playerId === 'player1' ? 'worker-1' : 'worker-2';
                const updatedState = enqueuePlacePortalOrder(state, workerId, entrance, exit, Date.now());
                setPlayers(updatedState.players);
                setWorkers(updatedState.workers);
                break;
            }
            case 'move_worker': {
                const { row, col, playerId } = payload;
                const workerId = playerId === 'player1' ? 'worker-1' : 'worker-2';
                const updatedState = enqueueMoveOrder(state, workerId, row, col);
                setWorkers(updatedState.workers);
                break;
            }
            case 'build': {
                const { row, col, towerId, playerId } = payload;
                const workerId = playerId === 'player1' ? 'worker-1' : 'worker-2';
                const updatedState = enqueueBuildOrder(state, workerId, row, col, towerId, Date.now());

                setPlayers(updatedState.players);
                setGhosts(updatedState.ghosts);
                setWorkers(updatedState.workers);
                break;
            }
            case 'upgrade': {
                const { row, col, upgradeId, playerId } = payload;
                const key = `${row}_${col}`;
                const existingTower = towersByCell[key];
                
                if (!existingTower || existingTower.ownerId !== playerId) return;

                const upgradeSpec = gameConfig.towers.find(t => t.id === upgradeId);
                const upgrader = players.find(p => p.id === playerId);

                if (!upgradeSpec || !upgrader) return;
                
                const cost = upgradeSpec.cost - Math.floor(existingTower.cost * 0.75);
                if (upgrader.resources < cost) return;

                const sound: SoundEvent = { kind: 'sfx', name: 'upgrade_tower' };
                audioManager.play(sound);
                sendGameDataRef.current('AUDIO_EVENT', sound);

                const upgradedTower: PlacedTower = {...existingTower, ...upgradeSpec, specId: upgradeSpec.id, health: upgradeSpec.maxHealth, id: existingTower.id };

                setTowersByCell(prev => ({ ...prev, [key]: upgradedTower }));
                setPlayers(prev => prev.map(p => p.id === playerId ? { ...p, resources: p.resources - cost } : p));
                
                // FEHLERBEHEBUNG: Der Host darf NICHT den Fokus für sich selbst setzen.
                // Dies wird nur durch eine lokale Benutzeraktion (Klick) ausgelöst.
                // setFocusedTower(upgradedTower); 

                setLastUpgradedTowerId(upgradedTower.id);
                setTimeout(()=>setLastUpgradedTowerId(null), 500);
                 if (sendGameDataRef.current) sendGameDataRef.current('TOWER_UPGRADE_VFX', { towerId: upgradedTower.id });

                break;
            }
            case 'sell': {
                 const { row, col, playerId } = payload;
                 const key = `${row}_${col}`;
                 const towerToSell = towersByCell[key];
                 if (!towerToSell || towerToSell.ownerId !== playerId) return;

                 const sound: SoundEvent = { kind: 'sfx', name: 'sell_tower' };
                 audioManager.play(sound);
                 sendGameDataRef.current('AUDIO_EVENT', sound);

                 const refund = Math.round(towerToSell.cost * 0.75);
                 setTowersByCell(prev => { const { [key]:_, ...rest } = prev; return rest; });
                 setPlayers(prev => prev.map(p => p.id === playerId ? { ...p, resources: p.resources + refund } : p));
                 setFocusedTower(null); // Unfocus after selling
                 break;
            }
            case 'pick_element': {
                const { playerId, element } = payload;
                const sound: SoundEvent = { kind: 'sfx', name: 'upgrade_tower' };
                audioManager.play(sound);
                sendGameDataRef.current('AUDIO_EVENT', sound);
                
                const waveForPick = currentWave;
                const needsToPick = waveForPick > 0 && waveForPick % 5 === 0;

                if (!needsToPick) {
                    console.warn(`[HOST] Element pick rejected: not an element wave. Wave is ${waveForPick}`);
                    return;
                }
            
                const updatedPlayers = players.map(p =>
                    p.id === playerId
                        ? { ...p, unlockedElements: Array.from(new Set([...p.unlockedElements, element])) }
                        : p
                );
                setPlayers(updatedPlayers);
            
                const expectedElementsAfterPick = 1 + Math.floor(waveForPick / 5);
                
                const activePlayers = updatedPlayers.filter(p => p && p.id !== 'spectator' && players.find(origP => origP.id === p.id));
                const allPlayersHavePicked = activePlayers.every(p => {
                    if (p.unlockedElements.length >= 8) return true; // Maxed out
                    return p.unlockedElements.length >= expectedElementsAfterPick;
                });

                if (allPlayersHavePicked) {
                    setCurrentWave(prev => prev + 1);
                    setIsIntermission(true);
                    setWaveStartCountdown(INTERMISSION_TIME);
                    setGameStatus("playing");
                }
                break;
            }
            case 'start_wave_now':
                if (gameStatus === 'waiting') {
                    if (players.some(p => p.id === 'player2')) {
                        setGameStatus('playing');
                        setIsIntermission(true);
                        setWaveStartCountdown(INTERMISSION_TIME);
                    } else {
                        toast({ title: "Warte auf Spieler 2", description: "Ein zweiter Spieler muss beitreten, bevor das Spiel gestartet werden kann.", variant: 'destructive'});
                    }
                } else if (isIntermission) {
                    if (countdownRef.current) window.clearInterval(countdownRef.current);
                    countdownRef.current = null;
                    startWave(currentWave);
                }
                break;
        }
        setHostRevision(r => r + 1);
    }, [players, towersByCell, isGameHost, startWave, isIntermission, currentWave, gameStatus, toast, workers, ghosts, portals, gameState, difficulty, currentPath, waveStartCountdown, gameConfig]);
    
  // --- WebRTC Logic ---
  
  const handleGameData = useCallback((msg: any) => {
    if (isGameHost) return;
    const { type, payload } = msg;

    switch(type) {
      case 'GAME_STATE_SNAPSHOT':
        setPlayers(payload.players);
        setEnemies(payload.enemies);
        
        if (focusedTower) {
            const updatedFocusedTower = payload.towersByCell[`${focusedTower.position.row}_${focusedTower.position.col}`];
            if (updatedFocusedTower) {
                if (updatedFocusedTower.specId !== focusedTower.specId) {
                    setFocusedTower(updatedFocusedTower);
                }
            } else {
                setFocusedTower(null);
            }
        }
        setTowersByCell(payload.towersByCell);
        
        setGameState(payload.gameState);
        setCurrentWave(payload.currentWave);
        setIsIntermission(payload.isIntermission);
        setWaveStartCountdown(payload.waveStartCountdown);
        setGameStatus(payload.gameStatus);
        setTotalKilled(payload.totalKilled);
        setTotalLeaked(payload.totalLeaked);
        setGravityWells(payload.gravityWells || []);
        setPersistentClouds(payload.persistentClouds || []);
        setWorkers(payload.workers || []);
        setGhosts(payload.ghosts || []);
        setPortals(payload.portals || []);
        if (payload.fps !== undefined) setFps(payload.fps);
        break;
      case 'AUDIO_EVENT':
        audioManager.play(payload);
        break;
      case 'VFX_ATTACK':
        gameBoardRef.current?.queueAttacks(payload);
        break;
      case 'VFX_DAMAGE_NUMBER':
        gameBoardRef.current?.queueDamageNumbers(payload);
        break;
      case 'VFX_SPLASH':
        gameBoardRef.current?.queueSplashRings(payload);
        break;
      case 'VFX_LIFE_GAIN':
        gameBoardRef.current?.queueLifeGainVfx(payload);
        break;
      case 'VFX_TOWER_FIRING':
        setFiringTowerIds(new Set(payload));
        setTimeout(() => setFiringTowerIds(new Set()), 150);
        break;
      case 'TOWER_UPGRADE_VFX':
        audioManager.play({ kind: 'sfx', name: 'upgrade_tower' });
        setLastUpgradedTowerId(payload.towerId);
        setTimeout(() => setLastUpgradedTowerId(null), 500);
        break;
      case 'TOWER_PLACE_VFX':
        audioManager.play({ kind: 'sfx', name: 'build_tower' });
        setJustPlacedTowerId(payload.towerId);
        setTimeout(() => setJustPlacedTowerId(null), 400);
        break;
      case 'PING':
        gameBoardRef.current?.queuePing(payload);
        return;
      case 'REQUEST':
        gameBoardRef.current?.queueRequest(payload);
        return;
      case 'REQUEST_RESOLVE':
        gameBoardRef.current?.resolveRequest(payload);
        return;
    }
  }, [isGameHost, focusedTower]);

    const handleActionData = useCallback((msg: any) => {
        if (!isGameHost) return;
        const { type, payload } = msg;

        switch (type) {
            case 'CLIENT_READY': {
                setHostRevision(r => r + 1);
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
                sendGameDataRef.current('PING', payload);
                return;
            case 'REQUEST':
                gameBoardRef.current?.queueRequest(payload);
                sendGameDataRef.current('REQUEST', payload);
                return;
            case 'REQUEST_RESOLVE':
                sendGameDataRef.current('REQUEST_RESOLVE', payload);
                return;
        }
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
      // Ensure the payload always has a playerId. Default to local player if not provided.
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
        sendGameDataRef.current('PING', payload);
      } else {
        sendActionRef.current('PING_REQUEST', payload);
      }
    };
    
    const broadcastSnapshot = useCallback(() => {
        if (!isGameHost) return;
        
        const snapshot = {
            players, enemies, towersByCell, gameState,
            currentWave, isIntermission, waveStartCountdown, gameStatus,
            totalKilled, totalLeaked,
            gravityWells,
            persistentClouds,
            workers, ghosts, portals,
            fps,
        };
        sendGameDataRef.current('GAME_STATE_SNAPSHOT', snapshot);
    }, [isGameHost, players, enemies, towersByCell, gameState, currentWave, isIntermission, waveStartCountdown, gameStatus, totalKilled, totalLeaked, gravityWells, persistentClouds, workers, ghosts, portals, fps]);
    
    useEffect(() => {
        if (!isGameHost || hostRevision === 0) return;
        broadcastSnapshot();
    }, [hostRevision, isGameHost, broadcastSnapshot]);


    const didSetLoadedRef = useRef(false);

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

        const unsub = onSnapshot(gameDocRef, (snap) => {
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

            if (role === 'player1' && !didSetLoadedRef.current) {
                setGameState(data.gameState || { lives: difficultyModifiers[data.difficulty || 'Normal'].startLives });
                setTowersByCell(data.towersByCell || {});
                setCurrentWave(data.currentWave || 0);
                setIsIntermission(data.isIntermission ?? true);
                setWaveStartCountdown(data.waveStartCountdown ?? INTERMISSION_TIME);
                setGameStatus(data.gameStatus || 'waiting');
                setWorkers(data.workers || [
                  { id: "worker-1", x: 64, y: 64, speed: 260, state: "idle", queue: [], moveTarget: null },
                  { id: "worker-2", x: 64 * 2, y: 64, speed: 260, state: "idle", queue: [], moveTarget: null }
                ]);
                setGhosts(data.ghosts || []);
                setPortals(data.portals || []);
            }
            
            setPlayers(normalizePlayers(data.players));
            setDifficulty(data.difficulty || 'Normal');
            
            if (!didSetLoadedRef.current) {
              didSetLoadedRef.current = true;
              setGameDataLoaded(true);
              setLoading(false);
            }

        }, (err) => {
            console.error("Error listening to game document:", err);
            toast({ title: "Verbindung zum Spiel verloren", variant: 'destructive'});
            router.push('/');
        });

        return () => unsub();
    }, [user, gameId, router, toast, configLoading]);
    
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
                    setHostRevision(r => r + 1);
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
          const state: GameSessionState = { players, gameState, towersByCell, enemies, currentWave, difficulty, gameStatus: currentStatus, currentPath, waveStartCountdown, isIntermission, workers, ghosts, portals };
          
          const workerState = tickWorkers(state, delta * (currentStatus === 'paused' ? 0.1 : 1), now, gameConfig.towers);
          setWorkers(workerState.workers);
          setGhosts(workerState.ghosts);
          if (Object.keys(workerState.towersByCell).length !== Object.keys(towersByCell).length) {
            setTowersByCell(workerState.towersByCell);
          }
           if (workerState.portals?.length !== (portals || []).length) {
            setPortals(workerState.portals || []);
          }

          if (currentStatus !== 'playing') {
            return;
          }

          const activePortals = (portals || []).filter(p => p.expiresAt > now);
          if (activePortals.length !== (portals || []).length) {
            setPortals(activePortals);
          }


          setPlayers(ps => ps.map(p => ({
              ...p,
              resources: p.resources + (p.incomePerSecond * (delta / 1000)),
          })));
          
          if (isIntermission) {
              setHostRevision(r => r + 1);
              return;
          }
          
          let livesLostThisTick = 0;
          let resourcesGainedThisTick = 0;
          let livesGainedThisTick = 0;
          let killedThisTick = 0;
          
          let allNewAttacks: Attack[] = [];
          let allNewDamageNumbers: DamageNumber[] = [];
          let allNewSplashRings: SplashRing[] = [];
          let allNewLifeGainVfx: LifeGainVfx[] = [];
          let allSoundEvents: SoundEvent[] = [];
          let newGravityWells: GravityWell[] = [];
          let newPersistentClouds: PersistentCloud[] = [];
          
          let currentEnemies = enemies.map(e => ({...e, wasHit: false }));
          
          const timeSinceWaveStart = Date.now() - waveStartTimeRef.current;
          if (spawnQueueRef.current.length > 0) {
              const enemiesToSpawnNow = spawnQueueRef.current.filter(e => e._spawnTime <= timeSinceWaveStart);
              if (enemiesToSpawnNow.length > 0) {
                  spawnQueueRef.current = spawnQueueRef.current.filter(e => e._spawnTime > timeSinceWaveStart);
                  const nowEpoch = Date.now();
                  const newEnemiesThisFrame = enemiesToSpawnNow.map(e => ({...e, lastMove: nowEpoch, path: currentPathRef.current}));
                  currentEnemies.push(...newEnemiesThisFrame);
              }
          }
          
          let firingIds = new Set<string>();

          for (const tower of Object.values(towersByCell)) {
              if (now - tower.lastAttack < tower.attackSpeed) continue;

              const auraTowers = Object.values(towersByCell).filter(t => t.effects?.some(e => e.type === 'aura'));
              let isBuffed = false;
              for (const aura of auraTowers) {
                  const distSq = (tower.position.col - aura.position.col)**2 + (tower.position.row - aura.position.row)**2;
                  if (distSq <= (aura.range ** 2)) {
                      isBuffed = true;
                      break;
                  }
              }

              let targets: Enemy[] = [];
              if (tower.effects?.some(e => e.type === 'multishot')) {
                  const effect = tower.effects.find(e => e.type === 'multishot')!;
                  const potentialTargets = currentEnemies.filter(enemy => {
                      if (enemy.deathTimestamp) return false;
                      const distSq = (tower.position.col - enemy.position.col) ** 2 + (tower.position.row - enemy.position.row) ** 2;
                      return distSq <= tower.range * tower.range;
                  }).sort((a,b) => a.pathIndex - b.pathIndex).slice(0, effect.targets);
                  targets.push(...potentialTargets);
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
                  if (target) targets.push(target);
              }

              if (targets.length > 0) {
                  tower.lastAttack = now;
                  firingIds.add(tower.id);
                  
                  let enemiesForThisTick = [...currentEnemies];
                  for (const target of targets) {
                      const result = processAttack(tower, target, enemiesForThisTick, now, isBuffed);
                      enemiesForThisTick = result.updatedEnemies;
                      
                      allNewAttacks.push(...result.newAttacks);
                      allNewDamageNumbers.push(...result.damageNumbers);
                      allNewSplashRings.push(...result.splashRings);
                      allNewLifeGainVfx.push(...result.lifeGainVfx);
                      allSoundEvents.push(...result.soundEvents);
                      if (result.newPersistentClouds.length > 0) newPersistentClouds.push(...result.newPersistentClouds);
                      if (result.newGravityWells.length > 0) newGravityWells.push(...result.newGravityWells);

                      if (result.resourcesGained > 0) resourcesGainedThisTick += result.resourcesGained;
                      if (result.livesGained > 0) livesGainedThisTick += result.livesGained;
                      if (result.killed > 0) killedThisTick += result.killed;
                  }
                  currentEnemies = enemiesForThisTick;
              }
          }
          
          if (firingIds.size > 0) {
            setFiringTowerIds(firingIds);
            sendGameDataRef.current('VFX_TOWER_FIRING', Array.from(firingIds));
            setTimeout(() => setFiringTowerIds(new Set()), 150);
          }
          if (allNewAttacks.length > 0) {
            gameBoardRef.current?.queueAttacks(allNewAttacks);
            sendGameDataRef.current('VFX_ATTACK', allNewAttacks);
          }
          if (allNewDamageNumbers.length > 0) {
            gameBoardRef.current?.queueDamageNumbers(allNewDamageNumbers);
            sendGameDataRef.current('VFX_DAMAGE_NUMBER', allNewDamageNumbers);
          }
          if (allNewSplashRings.length > 0) {
            gameBoardRef.current?.queueSplashRings(allNewSplashRings);
            sendGameDataRef.current('VFX_SPLASH', allNewSplashRings);
          }
          if (allNewLifeGainVfx.length > 0) {
            gameBoardRef.current?.queueLifeGainVfx(allNewLifeGainVfx);
            sendGameDataRef.current('VFX_LIFE_GAIN', allNewLifeGainVfx);
          }
          if (allSoundEvents.length > 0) {
            allSoundEvents.forEach(ev => {
              audioManager.play(ev);
              sendGameDataRef.current('AUDIO_EVENT', ev);
            });
          }

          const stillAlive: Enemy[] = [];
          const activeGravityWells = [...(gravityWells || []), ...newGravityWells].filter(w => w.expires > now);
          const activePersistentClouds = [...(persistentClouds || []), ...newPersistentClouds].filter(c => c.expires > now);

          for (let enemy of currentEnemies) {
              if (enemy.deathTimestamp && now - enemy.deathTimestamp > 2500) {
                  continue;
              }

              if (enemy.deathTimestamp) {
                  stillAlive.push(enemy);
                  continue;
              }
              
              let updatedEnemy: Enemy | null = { ...enemy, wasHit: false, vx: 0, vy: 0, effects: enemy.effects.filter(e => e.expires > now) };
              const dotResult = tickDots(updatedEnemy, delta);
              if (dotResult.totalDamage > 0) {
                  const dmgNum: DamageNumber = {id: crypto.randomUUID(), amount: dotResult.totalDamage, targetId: enemy.id, color: '#f97316'};
                  gameBoardRef.current?.queueDamageNumbers([dmgNum]);
                  sendGameDataRef.current('VFX_DAMAGE_NUMBER', [dmgNum]);
              }
              if (dotResult.killed && !updatedEnemy.deathTimestamp) {
                  updatedEnemy.deathTimestamp = now;
              }
              if (updatedEnemy.deathTimestamp) {
                  stillAlive.push(updatedEnemy);
                  continue;
              }
              
              const stunEffect = updatedEnemy.effects.find(e => e.type === 'stun');
              if (stunEffect) {
                  stillAlive.push(updatedEnemy);
                  continue;
              }

              // Portal Logic
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
              if (teleported) {
                  stillAlive.push(updatedEnemy);
                  continue;
              }
              
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
                      const sound: SoundEvent = { kind: 'sfx', name: 'enemy_leak' };
                      audioManager.play(sound);
                      sendGameDataRef.current('AUDIO_EVENT', sound);
                      updatedEnemy = null;
                      break;
                  }
              }
              
              if(updatedEnemy) {
                if (updatedEnemy.health <= 0 && !updatedEnemy.deathTimestamp) {
                    updatedEnemy.deathTimestamp = now;
                }
                stillAlive.push(updatedEnemy);
              }
          }
          
          setEnemies(stillAlive);
          setGravityWells(activeGravityWells);
          setPersistentClouds(activePersistentClouds);
          

          if (livesLostThisTick > 0) {
              setGameState(gs => {
                  const newLives = Math.max(0, gs.lives - livesLostThisTick);
                  if (newLives === 0 && gameStatus !== 'gameover') {
                      onGameEnd(gameId, user, difficulty, currentWave + 1, false, towersByCell);
                      setGameStatus('gameover');
                  }
                  return { ...gs, lives: newLives };
              });
              setTotalLeaked(l => l + livesLostThisTick);
          }
          
          if (livesGainedThisTick > 0) {
             setGameState(gs => ({ ...gs, lives: gs.lives + livesGainedThisTick }));
          }

          if (resourcesGainedThisTick > 0) {
              setTotalKilled(k => k + killedThisTick);
              setPlayers(ps => ps.map(p => ({ ...p, resources: p.resources + resourcesGainedThisTick })));
          }

            if (stillAlive.filter(e => !e.deathTimestamp).length === 0 && spawnQueueRef.current.length === 0 && !isIntermission) {
                const nextWaveIndex = currentWave + 1;
                setCurrentWave(nextWaveIndex);
                
                if (gameConfig.waves.length > nextWaveIndex) {
                    if ((nextWaveIndex) % 5 === 0 && (players.some(p => p.unlockedElements.length < 8))) {
                        setGameStatus('picking-element');
                    } else {
                        setIsIntermission(true);
                        setWaveStartCountdown(INTERMISSION_TIME);
                    }
                } else {
                    onGameEnd(gameId, user, difficulty, currentWave + 1, true, towersByCell);
                    setGameStatus('gameover');
                }
            }
          

          setHostRevision(r => r + 1);
      };

      if(isGameHost){
          gameLoopRef = requestAnimationFrame(gameLoop);
      }
      
      return () => {
          if (gameLoopRef) cancelAnimationFrame(gameLoopRef);
      }
  }, [isGameHost, gameStatus, isIntermission, enemies, user, gameId, difficulty, towersByCell, onGameEnd, currentWave, currentPath, players, gravityWells, persistentClouds, portals, startWave, gameState, workers, ghosts, gameConfig]);


  useEffect(() => {
    const isPickingElement = gameStatus === 'picking-element' && localPlayer && localPlayer.unlockedElements.length < 1 + Math.floor(currentWave / 5);
    setIsPicking(isPickingElement);
  }, [gameStatus, localPlayer, currentWave]);

  const toggleMute = () => {
    setIsMuted(current => {
      const newMuted = !current;
      if (newMuted) audioManager.mute();
      else audioManager.unmute();
      return newMuted;
    });
  };
  
  const onEnterPortalMode = useCallback(() => {
    cancelInteractions();
    setPortalPhase('entrance');
    audioManager.play({ kind: 'sfx', name: 'ui_click' });
  }, [cancelInteractions]);
  
  const handlePlaceTower = useCallback((row: number, col: number) => {
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
    }
    
    if (selectedTowerToBuild) {
        dispatchAction('build', { row, col, towerId: selectedTowerToBuild.id });
    } else {
        dispatchAction('move_worker', { row, col });
    }
  }, [portalPhase, portalEntrance, selectedTowerToBuild, dispatchAction, cancelInteractions]);
  
  if (loading || configLoading || !gameDataLoaded || !localPlayerId || !localPlayer || !gameConfig) {
    return <div className="w-full h-full flex items-center justify-center bg-background"><Loader2 className="h-16 w-16 animate-spin text-primary" /> <p className="ml-4 text-lg">Lade Spiel...</p></div>;
  }
  
  const handleUpgradeTower = (upgradeId: string) => focusedTower && dispatchAction('upgrade', { row: focusedTower.position.row, col: focusedTower.position.col, upgradeId });
  const handleSellTower = () => focusedTower && dispatchAction('sell', { row: focusedTower.position.row, col: focusedTower.position.col, playerId: focusedTower.ownerId });
  const onElementPick = (element: Element) => dispatchAction('pick_element', { element, playerId: localPlayerId });
  const handleStartNextWaveNow = () => dispatchAction('start_wave_now', {});
  
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
                handleGameControl={() => {}} 
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
                handlePlaceTower={handlePlaceTower}
                onFocusTower={onFocusTower} 
                selectedTowerToBuild={selectedTowerToBuild}
                portalEntrance={portalEntrance}
                focusedTower={focusedTower}
                gameBoardRef={gameBoardRef}
                interactionPrompt={interactionPrompt} 
                cancelInteractions={cancelInteractions}
                onSelectTowerToBuild={onSelectTowerToBuild}
                onEnterPortalMode={onEnterPortalMode}
                handleUpgradeTower={handleUpgradeTower}
                handleSellTower={handleSellTower}
                setFocusedTower={setFocusedTower}
                spawnedThisWave={isIntermission ? 0 : (gameConfig.waves[currentWave]?.enemies.count - spawnQueueRef.current.length)}
                totalEnemiesInWave={gameConfig.waves[currentWave]?.enemies.count || 0}
                totalKilled={totalKilled}
                totalLeaked={totalLeaked}
                isIntermission={isIntermission}
                waveStartCountdown={Math.max(0, Math.ceil(waveStartCountdown))}
                intermissionTime={INTERMISSION_TIME} 
                handleStartNextWaveNow={handleStartNextWaveNow}
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
