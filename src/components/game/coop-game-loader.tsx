

'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import type { User } from 'firebase/auth';
import { onAuthStateChanged, auth } from '@/lib/firebase';
import { doc, onSnapshot, Unsubscribe, updateDoc, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, functions } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { normalizePlayers } from '@/lib/player-utils';
import type { Player, GameState, GameStatus, PlacedTower, Difficulty, Tower, Element, Enemy, Attack, DamageNumber, SplashRing, Node, EnemyStatusEffect, TowerEffect, PingPayload, RequestPayload, RequestResolve, PingKind, LifeGainVfx, GravityWell } from '@/lib/game-data/types';
import { INTERMISSION_TIME, difficultyModifiers, GRID_ROWS, GRID_COLS } from '@/lib/game-data/constants';
import { httpsCallable } from 'firebase/functions';
import { Loader2 } from 'lucide-react';
import { towers as initialTowers } from '@/lib/game-data/towers';
import { useWebRTC } from '@/hooks/use-webrtc';
import { findPath } from '@/lib/pathfinding';
import { useIsMobile } from '@/hooks/use-mobile';
import { DesktopLayout } from '@/components/layouts/desktop-layout';
import { MobileLayout } from '@/components/layouts/mobile-layout';
import { waves } from '@/lib/game-data/enemies';
import type { GameBoardHandle } from './game-board';
import { ElementPickDialog } from './element-pick-dialog';
import Header from './header';
import { audioManager } from '@/lib/audio/audio-manager';
import { onGameEnd, processAttack } from '@/lib/game-logic';


export default function CoopGameLoader() {
  const { gameId } = useParams<{ gameId: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  
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
  const [fps, setFps] = useState(0);

  
  // UI State
  const [selectedTowerToBuild, setSelectedTowerToBuild] = useState<Tower | null>(null);
  const [focusedTower, setFocusedTower] = useState<PlacedTower | null>(null);
  const [justPlacedTowerId, setJustPlacedTowerId] = useState<string | null>(null);
  const [lastUpgradedTowerId, setLastUpgradedTowerId] = useState<string | null>(null);
  const gameBoardRef = useRef<GameBoardHandle>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [hostRevision, setHostRevision] = useState(0);

  // VFX State
  const [firingTowerIds, setFiringTowerIds] = useState<Set<string>>(new Set());
  
  const isGameHost = useMemo(() => localPlayerId === 'player1', [localPlayerId]);
  const placedTowers = useMemo(() => Object.values(towersByCell), [towersByCell]);
  const currentPath = useMemo(() => findPath({ row: 1, col: 1 }, { row: 12, col: 12 }, placedTowers.map(t => t.position), 12, 12) || [], [placedTowers]);
  
  const localPlayer = useMemo(() => {
    const p = players.find(p => p.id === localPlayerId);
    if (p) return p;
    // Fallback (verhindert Crashes in Kindkomponenten)
    return localPlayerId ? { id: localPlayerId, name: 'Wird geladen…', avatarUrl: null, resources: 0, unlockedElements: ['neutral'], incomePerSecond: 1 } : null;
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

  const cancelInteractions = () => {
    setSelectedTowerToBuild(null);
    setFocusedTower(null);
  };

  const onSelectTowerToBuild = (tower: Tower | null) => {
    cancelInteractions();
    setSelectedTowerToBuild(tower);
  };

  // --- Refs to hold stable function references ---
  const sendActionRef = useRef<(type: string, payload: any) => void>(() => {});
  const sendGameDataRef = useRef<(type: string, payload: any) => void>(() => {});
  
    const hostCanPlace = useCallback((row: number, col: number) => {
        const occupied = Object.values(towersByCell).map(t => t.position);
        const tentative = [...occupied, { row, col }];
        const start = { row: 1, col: 1 };
        const goal  = { row: GRID_ROWS, col: GRID_COLS };
        return !!findPath(start, goal, tentative, GRID_ROWS, GRID_COLS);
    }, [towersByCell]);

    const startWave = useCallback((waveIndex: number) => {
        if (!isGameHost) return;

        const spec = waves[waveIndex];
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

    }, [isGameHost, difficulty]);

    const onHostAction = useCallback((action:'build'|'upgrade'|'sell'|'pick_element'|'start_wave_now', payload:any) => {
        if (!isGameHost) return;
        
        switch(action){
            case 'build': {
                const { row, col, towerId, playerId } = payload;
                const key = `${row}_${col}`;
                const existingTower = towersByCell[key];
                
                if (existingTower) return;
                if (!hostCanPlace(row, col)) {
                    console.warn(`[HOST] Invalid build request at ${row},${col}. Path blocked.`);
                    return;
                }

                const towerSpec = initialTowers.find(t => t.id === towerId);
                const builder = players.find(p => p.id === playerId);

                if(!towerSpec || !builder || builder.resources < towerSpec.cost) return;
                
                const newTower: PlacedTower = {
                    ...towerSpec,
                    id: crypto.randomUUID(),
                    specId: towerSpec.id,
                    position: { row, col },
                    lastAttack: 0,
                    health: towerSpec.maxHealth,
                    ownerId: playerId,
                };
                
                setTowersByCell(prev => ({ ...prev, [key]: newTower }));
                setPlayers(prev => prev.map(p => p.id === playerId ? {...p, resources: p.resources - towerSpec.cost} : p));

                setJustPlacedTowerId(newTower.id);
                setTimeout(() => setJustPlacedTowerId(null), 400);
                if (sendGameDataRef.current) sendGameDataRef.current('TOWER_PLACE_VFX', { towerId: newTower.id });
                break;
            }
            case 'upgrade': {
                const { row, col, upgradeId, playerId } = payload;
                const key = `${row}_${col}`;
                const existingTower = towersByCell[key];
                
                if (!existingTower || existingTower.ownerId !== playerId) return;

                const upgradeSpec = initialTowers.find(t => t.id === upgradeId);
                const upgrader = players.find(p => p.id === playerId);

                if (!upgradeSpec || !upgrader) return;
                
                const cost = upgradeSpec.cost - Math.floor(existingTower.cost * 0.75);
                if (upgrader.resources < cost) return;

                const upgradedTower: PlacedTower = {...existingTower, ...upgradeSpec, specId: upgradeSpec.id, health: upgradeSpec.maxHealth, id: existingTower.id };

                setTowersByCell(prev => ({ ...prev, [key]: upgradedTower }));
                setPlayers(prev => prev.map(p => p.id === playerId ? { ...p, resources: p.resources - cost } : p));
                
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

                 const refund = Math.round(towerToSell.cost * 0.75);
                 setTowersByCell(prev => { const { [key]:_, ...rest } = prev; return rest; });
                 setPlayers(prev => prev.map(p => p.id === playerId ? { ...p, resources: p.resources + refund } : p));
                 break;
            }
            case 'pick_element': {
                const { playerId, element } = payload;
                // Correctly checks if the current wave number is an element-picking wave.
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
            
                // Logic to check if all players have picked their element.
                // Uses the correct wave number (currentWave) to determine the expected number of elements.
                const expectedElementsAfterPick = 1 + Math.floor(waveForPick / 5);
                
                const activePlayers = updatedPlayers.filter(p => p && p.id !== 'spectator' && players.find(origP => origP.id === p.id));
                const allPlayersHavePicked = activePlayers.every(p => {
                    if (p.unlockedElements.length >= 8) return true; // Maxed out
                    return p.unlockedElements.length >= expectedElementsAfterPick;
                });

                if (allPlayersHavePicked) {
                    // This is the correct moment to advance to the next wave's intermission.
                    setCurrentWave(prev => prev + 1);
                    setIsIntermission(true);
                    setWaveStartCountdown(INTERMISSION_TIME);
                    setGameStatus("playing");
                }
                break;
            }
            case 'start_wave_now':
                if (gameStatus === 'waiting') {
                    // Check if player 2 is present before starting
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
    }, [players, towersByCell, hostCanPlace, isGameHost, startWave, isIntermission, currentWave, gameStatus, toast]);
    
  // --- WebRTC Logic ---
  
  const handleGameData = useCallback((msg: any) => {
    if (isGameHost) return;
    const { type, payload } = msg;

    switch(type) {
      case 'GAME_STATE_SNAPSHOT':
        setPlayers(payload.players);
        setEnemies(payload.enemies);
        setTowersByCell(payload.towersByCell);
        setGameState(payload.gameState);
        setCurrentWave(payload.currentWave);
        setIsIntermission(payload.isIntermission);
        setWaveStartCountdown(payload.waveStartCountdown);
        setGameStatus(payload.gameStatus);
        setTotalKilled(payload.totalKilled);
        setTotalLeaked(payload.totalLeaked);
        setGravityWells(payload.gravityWells || []);
        if (payload.fps !== undefined) setFps(payload.fps);
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
        setLastUpgradedTowerId(payload.towerId);
        setTimeout(() => setLastUpgradedTowerId(null), 500);
        break;
      case 'TOWER_PLACE_VFX':
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
  }, [isGameHost]);

    const handleActionData = useCallback((msg: any) => {
        if (!isGameHost) return;
        const { type, payload } = msg;

        switch (type) {
            case 'CLIENT_READY': {
                setHostRevision(r => r + 1);
                return;
            }
            case 'BUILD_TOWER_REQUEST':      onHostAction('build', payload); return;
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
    
    // --- Hook that provides the send functions ---
    // IMPORTANT: This hook is only called AFTER localPlayerId is determined.
    const { sendAction, sendGameData, isConnected, ...stats } = useWebRTC(
        localPlayerId ? gameId : null, 
        isGameHost, 
        user, 
        false, 
        handleGameData, 
        handleActionData
    );

    // --- Update refs whenever the functions from useWebRTC change ---
    useEffect(() => {
      sendActionRef.current = sendAction;
      sendGameDataRef.current = sendGameData;
    }, [sendAction, sendGameData]);

  useEffect(() => {
      if (isConnected && !isGameHost && localPlayerId === 'player2') {
          sendActionRef.current('CLIENT_READY', {});
      }
  }, [isConnected, isGameHost, localPlayerId]);

  const onLocalAction = useCallback((action: 'build' | 'upgrade' | 'sell' | 'pick_element' | 'start_wave_now', payload: any) => {
      if (!localPlayerId || localPlayerId === 'spectator' || isGameHost) return;
      
      const actionTypeMap = {
        build: 'BUILD_TOWER_REQUEST',
        upgrade: 'UPGRADE_TOWER_REQUEST',
        sell: 'SELL_TOWER_REQUEST',
        pick_element: 'PICK_ELEMENT_REQUEST',
        start_wave_now: 'START_WAVE_NOW_REQUEST',
      }
      const actionType = actionTypeMap[action];
      sendActionRef.current(actionType, { ...payload, playerId: localPlayerId });
  }, [localPlayerId, isGameHost]);
  
  const dispatchAction = useCallback((action: 'build' | 'upgrade' | 'sell' | 'pick_element' | 'start_wave_now', payload: any) => {
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

    const sendRequest = (req: Omit<RequestPayload,'id'|'from'|'createdAt'>) => {
      const currentLocalPlayerId = localPlayerIdRef.current;
      if (!currentLocalPlayerId || currentLocalPlayerId === 'spectator') return;
      const payload: RequestPayload = { id: crypto.randomUUID(), from: currentLocalPlayerId as 'player1' | 'player2', createdAt: Date.now(), ...req };
      if (isGameHost) {
        gameBoardRef.current?.queueRequest(payload);
        sendGameDataRef.current('REQUEST', payload);
      } else {
        sendActionRef.current('REQUEST', payload);
      }
    };
    
    const broadcastSnapshot = useCallback(() => {
        if (!isGameHost) return;
        
        const snapshot = {
            players, enemies, towersByCell, gameState,
            currentWave, isIntermission, waveStartCountdown, gameStatus,
            totalKilled, totalLeaked,
            gravityWells,
            fps,
        };
        sendGameDataRef.current('GAME_STATE_SNAPSHOT', snapshot);
    }, [isGameHost, players, enemies, towersByCell, gameState, currentWave, isIntermission, waveStartCountdown, gameStatus, totalKilled, totalLeaked, gravityWells, fps]);
    
    useEffect(() => {
        if (!isGameHost || hostRevision === 0) return;
        broadcastSnapshot();
    }, [hostRevision, isGameHost, broadcastSnapshot]);


    const didSetLoadedRef = useRef(false);

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
        if (!user || !gameId) return;
        const gameDocRef = doc(db, 'games', gameId);

        const unsub = onSnapshot(gameDocRef, (snap) => {
            if (!snap.exists()) {
                toast({ title: "Spiel nicht gefunden", variant: 'destructive'});
                router.push('/');
                return;
            }
            const data = snap.data();
            if (!data) return;

            // Rolle bestimmen
            let role: 'player1' | 'player2' | 'spectator' = 'spectator';
            if (data.player1Id === user.uid) role = 'player1';
            else if (data.player2Id === user.uid) role = 'player2';
            setLocalPlayerId(role);

            // Host lädt nur einmal initial, Client vertraut DB initial
            if (role === 'player1' && !didSetLoadedRef.current) {
                setGameState(data.gameState || { lives: difficultyModifiers[data.difficulty || 'Normal'].startLives });
                setTowersByCell(data.towersByCell || {});
                setCurrentWave(data.currentWave || 0);
                setIsIntermission(data.isIntermission ?? true);
                setWaveStartCountdown(data.waveStartCountdown ?? INTERMISSION_TIME);
                setGameStatus(data.gameStatus || 'waiting');
            }
            
            // Players IMMER normalisieren
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
    }, [user, gameId, router, toast]);

    // Intermission countdown timer (HOST ONLY)
    useEffect(() => {
        if (!isGameHost || !isIntermission || gameStatus !== 'playing') {
            if (countdownRef.current) window.clearInterval(countdownRef.current);
            countdownRef.current = null;
            return;
        }

        countdownRef.current = window.setInterval(() => {
            setWaveStartCountdown(prev => {
                const newTime = Math.max(0, prev - 1);
                if (newTime === 0) {
                    window.clearInterval(countdownRef.current!);
                    countdownRef.current = null;
                    startWave(currentWave);
                }
                setHostRevision(r => r + 1); // Broadcast countdown changes
                return newTime;
            });
        }, 1000);

        return () => {
            if (countdownRef.current) window.clearInterval(countdownRef.current);
            countdownRef.current = null;
        };
    }, [isGameHost, isIntermission, gameStatus, startWave, currentWave]);
  
  // MAIN GAME LOOP (HOST ONLY)
  const lastFpsUpdateRef = useRef(Date.now());
  const frameCountRef = useRef(0);
  useEffect(() => {
      let gameLoopRef: number;
      let lastTick = Date.now();

      const gameLoop = () => {
          gameLoopRef = requestAnimationFrame(gameLoop);
          const now = Date.now();
          const delta = now - lastTick;
          if (delta < 16) return; // Cap at ~60fps
          lastTick = now;

          // FPS calculation
          frameCountRef.current++;
          if (now - lastFpsUpdateRef.current >= 1000) {
            setFps(frameCountRef.current);
            frameCountRef.current = 0;
            lastFpsUpdateRef.current = now;
          }

          if (gameStatus !== 'playing') return;

          setPlayers(ps => ps.map(p => ({
              ...p,
              resources: p.resources + (p.incomePerSecond * (delta / 1000)),
          })));

          if (isIntermission) return;
          
          let livesLostThisTick = 0;
          let resourcesGainedThisTick = 0;
          let livesGainedThisTick = 0;
          let killedThisTick = 0;
          
          let allNewAttacks: Attack[] = [];
          let allNewDamageNumbers: DamageNumber[] = [];
          let allNewSplashRings: SplashRing[] = [];
          let allNewLifeGainVfx: LifeGainVfx[] = [];
          let newGravityWells: GravityWell[] = [];
          
          let currentEnemies = enemies.map(e => ({...e, wasHit: false})); // Reset wasHit
          
          // --- Spawning Logic ---
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
          
          // 1. Tower attack logic
          const towers = Object.values(towersByCell);
          const currentBuffedTowerIds = new Set<string>();
          const auraTowers = towers.filter(t => t.effect?.type === 'aura');
          if (auraTowers.length > 0) {
              towers.forEach(tower => {
                if (tower.effect?.type === 'aura') return;
                for (const auraTower of auraTowers) {
                  const distSq = Math.pow(tower.position.col - auraTower.position.col, 2) + Math.pow(tower.position.row - auraTower.position.row, 2);
                  if (distSq <= Math.pow(auraTower.effect!.radius!, 2)) {
                    currentBuffedTowerIds.add(tower.id);
                    break;
                  }
                }
              });
          }
          
          let firingIds = new Set<string>();

          for (const tower of towers) {
              if (now - tower.lastAttack >= tower.attackSpeed) {
                  const isBuffed = currentBuffedTowerIds.has(tower.id);
                  let targets: Enemy[] = [];

                  if (tower.effect?.type === 'multishot' && tower.effect.targets) {
                      const potentialTargets = currentEnemies.filter(enemy => {
                          if (enemy.deathTimestamp) return false;
                          const distSq = (tower.position.col - enemy.position.col) ** 2 + (tower.position.row - enemy.position.row) ** 2;
                          return distSq <= tower.range * tower.range;
                      }).sort((a,b) => a.pathIndex - b.pathIndex).slice(0, tower.effect.targets);
                      targets.push(...potentialTargets);
                  } else {
                      let target: Enemy | null = null;
                      let minDistanceSq = tower.range * tower.range;
                      currentEnemies.forEach(enemy => {
                          if (enemy.deathTimestamp) return; // Ignore dying enemies
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
 
                           if (result.resourcesGained > 0) resourcesGainedThisTick += result.resourcesGained;
                           if (result.killed > 0) killedThisTick += result.killed;
                           if (result.livesGained > 0) livesGainedThisTick += result.livesGained;
                           
                           if (tower.effect?.type === 'pull' && tower.effect.radius && tower.effect.duration && tower.effect.potency) {
                                newGravityWells.push({
                                    id: `well-${now}`,
                                    x: target.position.col,
                                    y: target.position.row,
                                    radius: tower.effect.radius,
                                    potency: tower.effect.potency,
                                    expires: now + tower.effect.duration
                                });
                            }
                      }
                      currentEnemies = enemiesForThisTick;
                  }
              }
          }
          
          // 2. Queue VFX for broadcasting AND local rendering for the host
          if (firingIds.size > 0) {
            setFiringTowerIds(firingIds); // Local update
            sendGameDataRef.current('VFX_TOWER_FIRING', Array.from(firingIds));
            setTimeout(() => setFiringTowerIds(new Set()), 150); // Clear after a bit
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

          // 3. Enemy movement and effects logic
          const stillAlive: Enemy[] = [];
          const activeGravityWells = [...(gravityWells || []), ...newGravityWells].filter(w => w.expires > now);

          for (let enemy of currentEnemies) {
              if (enemy.deathTimestamp && now - enemy.deathTimestamp > 2500) {
                continue; // Remove after death animation
              }
              if (enemy.deathTimestamp) {
                stillAlive.push(enemy);
                continue;
              }

              let updatedEnemy: Enemy | null = { ...enemy, effects: enemy.effects.filter(e => e.expires > now) };

              const burnEffect = updatedEnemy.effects.find(e => e.type === 'burn');
              if (burnEffect && (!burnEffect.lastTick || now - burnEffect.lastTick >= 1000)) {
                  const burnDamage = burnEffect.potency ?? 0;
                  updatedEnemy.health -= burnDamage;
                  burnEffect.lastTick = now;
                  gameBoardRef.current?.queueDamageNumbers([{ id: crypto.randomUUID(), amount: burnDamage, targetId: updatedEnemy.id, color: '#f97316' }]);
                  sendGameDataRef.current('VFX_DAMAGE_NUMBER', [{ id: crypto.randomUUID(), amount: burnDamage, targetId: updatedEnemy.id, color: '#f97316' }]);
                  if (updatedEnemy.health <= 0) {
                    if (!updatedEnemy.deathTimestamp) {
                      updatedEnemy.deathTimestamp = now;
                    }
                  }
              }

              const stunEffect = updatedEnemy.effects.find(e => e.type === 'stun');
              if (stunEffect) {
                  stillAlive.push(updatedEnemy);
                  continue;
              }
              
              let vx = 0, vy = 0;
              for (const well of activeGravityWells) {
                  const dx = well.x - updatedEnemy.position.col;
                  const dy = well.y - updatedEnemy.position.row;
                  const distSq = dx * dx + dy * dy;
                  if (distSq <= well.radius * well.radius) {
                      const dist = Math.sqrt(distSq);
                      if (dist > 0.1) {
                          const pullStrength = well.potency;
                          vx += (dx / dist) * pullStrength;
                          vy += (dy / dist) * pullStrength;
                      }
                  }
              }
              updatedEnemy.vx = vx;
              updatedEnemy.vy = vy;

              const slowEffect = updatedEnemy.effects.find(e => e.type === 'slow');
              const speedMultiplier = slowEffect ? (1 - (slowEffect.potency ?? 0)) : 1;
              const speed = updatedEnemy.speed * speedMultiplier;
              
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
          
          
          // 4. Update state based on tick results
          setEnemies(stillAlive);
          setGravityWells(activeGravityWells);


          if (livesLostThisTick > 0) {
              setGameState(gs => ({ ...gs, lives: Math.max(0, gs.lives - livesLostThisTick) }));
              setTotalLeaked(l => l + livesLostThisTick);
              if (gameState.lives - livesLostThisTick <= 0 && gameStatus !== 'gameover') {
                  onGameEnd(gameId, user, difficulty, currentWave + 1, false, towersByCell);
                  setGameStatus('gameover');
              }
          }
          if (livesGainedThisTick > 0) {
              setGameState(gs => ({ ...gs, lives: gs.lives + livesGainedThisTick }));
          }
          if (resourcesGainedThisTick > 0) {
              setPlayers(ps => ps.map(p => ({ ...p, resources: p.resources + Math.floor(resourcesGainedThisTick / ps.length) })));
              setTotalKilled(k => k + killedThisTick);
          }

            if (stillAlive.filter(e => !e.deathTimestamp).length === 0 && spawnQueueRef.current.length === 0 && !isIntermission) {
                const nextWaveIndex = currentWave + 1;
                // Correct: Set currentWave first, then check if it's an element pick round.
                setCurrentWave(nextWaveIndex);
                
                if (waves.length > nextWaveIndex) {
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
  }, [isGameHost, gameStatus, isIntermission, enemies, user, gameId, difficulty, towersByCell, gameState.lives, onGameEnd, currentWave, currentPathRef, players, gravityWells]);


  const toggleMute = () => {
    setIsMuted(current => {
      const newMuted = !current;
      if (newMuted) audioManager.mute();
      else audioManager.unmute();
      return newMuted;
    });
  };

  if (loading || !gameDataLoaded || !localPlayerId || !localPlayer) {
    return <div className="w-full h-full flex items-center justify-center bg-background"><Loader2 className="h-16 w-16 animate-spin text-primary" /> <p className="ml-4 text-lg">Verbinde mit Spiel...</p></div>;
  }
  
  const onPlaceTower = (row: number, col: number) => {
    if(selectedTowerToBuild) {
        dispatchAction('build', { row, col, towerId: selectedTowerToBuild.id });
    }
  };
  const onUpgradeTower = (upgradeId: string) => focusedTower && dispatchAction('upgrade', { row: focusedTower.position.row, col: focusedTower.position.col, upgradeId });
  const onSellTower = () => focusedTower && dispatchAction('sell', { row: focusedTower.position.row, col: focusedTower.position.col });
  const onElementPick = (element: Element) => dispatchAction('pick_element', { element, playerId: localPlayerId });
  const handleStartNextWaveNow = () => dispatchAction('start_wave_now', {});
  
  const LayoutComponent = isMobile ? MobileLayout : DesktopLayout;

  return (
    <div className="w-full h-full flex flex-col" onClick={() => { if (!hasInteracted) { audioManager.init(); setHasInteracted(true); }}}>
       <Header onExit={() => router.push('/')} isMuted={isMuted} toggleMute={toggleMute} fps={isGameHost ? fps : stats.fps} />
        <div className="flex-grow p-2">
            <LayoutComponent
                players={players} 
                setPlayers={setPlayers} 
                gameState={gameState} 
                localPlayer={localPlayer!}
                currentWave={currentWave} 
                totalWaves={waves.length} 
                difficulty={difficulty} 
                handleGameControl={() => {}} 
                gameStatus={gameStatus} 
                resetGame={() => router.push('/')}
                towers={initialTowers} 
                setTowers={() => {}} 
                placedTowers={placedTowers} 
                enemies={enemies} 
                damageNumbers={[]} 
                splashRings={[]}
                currentPath={currentPath} 
                handlePlaceTower={onPlaceTower}
                onFocusTower={onFocusTower} 
                selectedTowerToBuild={selectedTowerToBuild}
                focusedTower={focusedTower}
                gameBoardRef={gameBoardRef}
                interactionPrompt={""} 
                cancelInteractions={cancelInteractions}
                onSelectTowerToBuild={onSelectTowerToBuild} 
                handleUpgradeTower={onUpgradeTower}
                handleSellTower={onSellTower}
                setFocusedTower={setFocusedTower}
                spawnedThisWave={isIntermission ? 0 : (waves[currentWave]?.enemies.count - spawnQueueRef.current.length)}
                totalEnemiesInWave={waves[currentWave]?.enemies.count || 0}
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
                allTowers={initialTowers}
                isWsConnected={isConnected} 
                onPing={sendPing}
                hostPacketsPerSecond={stats.sentPacketsPerSecond} 
                hostBytesSentPerSecond={stats.sentBytesPerSecond}
                clientPacketsPerSecond={stats.packetsPerSecond}
                clientBytesReceivedPerSecond={stats.bytesPerSecond}
                averagePacketSize={stats.averagePacketSize}
                />
            </div>
            {localPlayer && (
                <ElementPickDialog
                    isOpen={gameStatus === 'picking-element'}
                    onElementPick={onElementPick}
                    playerName={localPlayer.name}
                    currentWave={currentWave}
                    unlockedElements={new Set(localPlayer.unlockedElements)}
                />
            )}
      </div>
  );
}

    

    




    

    







