

"use client";

import GameSession from "@/components/game/game-session";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { onAuthStateChanged, auth, functions } from "@/lib/firebase";
import { doc, onSnapshot, updateDoc, getDoc, Unsubscribe, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useWebRTC } from '@/hooks/use-webrtc';
import { useToast } from '@/hooks/use-toast';
import { normalizePlayers } from '@/lib/player-utils';
import type { User } from "firebase/auth";
import type { Player, GameState, GameStatus, PlacedTower, Attack, DamageNumber, SplashRing, GameResult, Difficulty, GameDelta, Node, Enemy, EnemyStatusEffect, Element, MovementPattern } from '@/lib/game-data/types';
import { Loader2 } from "lucide-react";
import { DeltaType } from "@/lib/game-data/types";
import { INTERMISSION_TIME, GRID_ROWS, GRID_COLS, difficultyModifiers } from "@/lib/game-data/constants";
import { audioManager } from "@/lib/audio/audio-manager";
import { findPath } from '@/lib/pathfinding';
import { waves } from "@/lib/game-data/enemies";
import { httpsCallable } from "firebase/functions";

function CoopGame() {
  const { gameId } = useParams<{ gameId: string }>();
  const router = useRouter();
  const { toast } = useToast();
  
  console.log(`[CoopGame] Component Rendering for game: ${gameId}`);

  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // --- Synced State ---
  const [players, setPlayers] = useState<Player[]>([]);
  const [gameState, setGameState] = useState<GameState>({ lives: 20 });
  const [towersByCell, setTowersByCell] = useState<Record<string, PlacedTower>>({});
  const [currentWave, setCurrentWave] = useState(0);
  const [gameStatus, setGameStatus] = useState<GameStatus>('waiting');
  const [difficulty, setDifficulty] = useState<Difficulty>('Normal');
  const [isIntermission, setIsIntermission] = useState(true);
  const [waveStartCountdown, setWaveStartCountdown] = useState(INTERMISSION_TIME);
  const [enemies, setEnemies] = useState<Enemy[]>([]);
  const [spawnedThisWave, setSpawnedThisWave] = useState(0);

  // --- Local State ---
  const [localPlayerId, setLocalPlayerId] = useState<'player1' | 'player2' | 'spectator' | null>(null);
  const isGameHost = useMemo(() => localPlayerId === 'player1', [localPlayerId]);
  
  // --- VFX State ---
  const [attacks, setAttacks] = useState<Attack[]>([]);
  const [damageNumbers, setDamageNumbers] = useState<DamageNumber[]>([]);
  const [splashRings, setSplashRings] = useState<SplashRing[]>([]);
  const [lastUpgradedTowerId, setLastUpgradedTowerId] = useState<string|null>(null);
  const [firingTowerIds, setFiringTowerIds] = useState<Set<string>>(new Set());
  const [finalGameResult, setFinalGameResult] = useState<GameResult | null>(null);
  
  // --- Stats State ---
  const [fps, setFps] = useState(0);
  
  const rtc = useWebRTC(gameId, isGameHost, user);

  // Refs for wave spawning logic
  const spawnerRef = useRef<NodeJS.Timeout>();
  const waveInProgressRef = useRef(false);
  const enemyIdCounter = useRef(0);

  const START_NODE = { row: 1, col: 1 };
  const END_NODE = { row: GRID_ROWS, col: GRID_COLS };
  const currentPath = useMemo(() => findPath(START_NODE, END_NODE, Object.values(towersByCell).map(t => t.position), GRID_ROWS, GRID_COLS) || [], [towersByCell]);

  const applyDeltas = useCallback((deltas: GameDelta[]) => {
    deltas.forEach(delta => {
        const type = delta[0];
        const payload = delta[1];
        switch(type) {
            case DeltaType.ENEMY_SPAWN: {
                // The path is now included in the payload
                const newEnemy = payload as Enemy;
                setEnemies(prev => [...prev, newEnemy]);
                break;
            }
            case DeltaType.ENEMY_MOVE: {
                const [id, pathIndex, now] = delta.slice(1);
                setEnemies(prev => prev.map(e => {
                    if (e.id === id) {
                        return { ...e, pathIndex, lastMove: now, position: currentPath[pathIndex] || e.position };
                    }
                    return e;
                }));
                break;
            }
            case DeltaType.ENEMY_PATH_UPDATE: {
                const [id, newPath, newPathIndex] = delta.slice(1);
                setEnemies(prev => prev.map(e => e.id === id ? { ...e, path: newPath, pathIndex: newPathIndex } : e));
                break;
            }
            case DeltaType.ENEMY_DAMAGE: {
                const [id, damage] = delta.slice(1);
                setEnemies(prev => prev.map(e => e.id === id ? { ...e, health: e.health - (damage as number), wasHit: true } : e));
                setTimeout(() => setEnemies(prev => prev.map(e => e.id === id ? { ...e, wasHit: false } : e)), 150);
                break;
            }
            case DeltaType.ENEMY_DIE: {
                const id = payload;
                setEnemies(prev => prev.filter(e => e.id !== id));
                break;
            }
            case DeltaType.ENEMY_REACH_END: {
                const id = payload;
                setEnemies(prev => prev.filter(e => e.id !== id));
                setGameState(s => ({ ...s, lives: Math.max(0, s.lives - 1) }));
                break;
            }
            case DeltaType.ENEMY_ADD_EFFECT: {
                const [id, effect] = delta.slice(1) as [string, EnemyStatusEffect];
                setEnemies(prev => prev.map(e => {
                    if (e.id === id) {
                        const newEffects = e.effects.filter(ef => ef.type !== effect.type);
                        newEffects.push(effect);
                        return { ...e, effects: newEffects };
                    }
                    return e;
                }));
                break;
            }
             case DeltaType.ENEMY_REMOVE_EFFECT: {
                const [id, effectType] = delta.slice(1);
                setEnemies(prev => prev.map(e =>
                  e.id === id ? { ...e, effects: e.effects.filter(ef => ef.type !== effectType) } : e
                ));
                break;
            }
            case DeltaType.TOWER_ATTACK:
                setAttacks(prev => [...prev.slice(-200), payload]);
                audioManager.playSfx('shoot', 0.3);
                setFiringTowerIds(prev => new Set(prev).add((payload as Attack).towerId));
                setTimeout(() => setFiringTowerIds(prev => {
                    const s = new Set(prev);
                    s.delete((payload as Attack).towerId);
                    return s;
                }), 150);
                break;
            case DeltaType.VFX_DAMAGE_NUMBER:
                setDamageNumbers(prev => [...prev.slice(-100), payload]);
                break;
            case DeltaType.VFX_SPLASH:
                setSplashRings(prev => [...prev.slice(-50), payload]);
                break;
             case DeltaType.CLIENT_STATS_UPDATE:
                // This state update is handled by the useWebRTC hook itself, no action needed here.
                break;
            case DeltaType.GAME_STATE_UPDATE: {
                const newState = payload as Partial<GameState & { gameStatus: GameStatus, currentWave: number, isIntermission: boolean, waveStartCountdown: number, spawnedThisWave: number }>;
                if (newState.gameStatus) setGameStatus(newState.gameStatus);
                if (newState.currentWave !== undefined) setCurrentWave(newState.currentWave);
                if (newState.isIntermission !== undefined) setIsIntermission(newState.isIntermission);
                if (newState.waveStartCountdown !== undefined) setWaveStartCountdown(newState.waveStartCountdown);
                if (newState.lives !== undefined) setGameState(s => ({...s, lives: newState.lives!}));
                if (newState.spawnedThisWave !== undefined) setSpawnedThisWave(newState.spawnedThisWave);
                break;
            }
             case DeltaType.TOWERS_UPDATE:
                setTowersByCell(payload);
                break;
            case DeltaType.PLAYER_UPDATE:
                 const playerUpdates = payload as Record<string, Partial<Player>>;
                 setPlayers(prev => prev.map(p => {
                    const update = playerUpdates[p.id];
                    if (update) {
                        return {...p, ...update};
                    }
                    return p;
                 }));
                break;
            case DeltaType.TOWER_UPGRADE_VFX:
                const { towerId } = payload as { towerId: string, position: Node };
                setLastUpgradedTowerId(towerId);
                setTimeout(() => setLastUpgradedTowerId(null), 1000);
                break;
            case DeltaType.BUILD_TOWER_REQUEST:
            case DeltaType.UPGRADE_TOWER_REQUEST:
            case DeltaType.SELL_TOWER_REQUEST:
                 if (isGameHost) {
                    console.log("[CoopGame] Host received action request, dispatching event:", { type, payload });
                    document.dispatchEvent(new CustomEvent('hostActionRequest', { detail: { type, payload } }));
                }
                break;
        }
    });
  }, [currentPath, isGameHost]);
    
  const broadcastGameData = useCallback((deltas: GameDelta[]) => {
      if (deltas.length === 0) return;
      if (isGameHost) {
         rtc.sendMessage({ type: 'game_delta_batch', payload: deltas });
      }
      applyDeltas(deltas);
  }, [rtc, isGameHost, applyDeltas]);

  // Wave Spawning Logic (HOST ONLY) - Now triggered from game-session
  const startWave = useCallback(() => {
    if (!isGameHost) return;
    
    if (currentWave >= waves.length || waveInProgressRef.current) return;
    
    waveInProgressRef.current = true;
    if (spawnerRef.current) clearTimeout(spawnerRef.current);
    spawnerRef.current = undefined;

    setSpawnedThisWave(0);

    const waveData = waves[currentWave];
    let spawnedCount = 0;
  
    const spawnEnemy = () => {
      if (gameStatus !== 'playing') {
        if (spawnerRef.current) clearTimeout(spawnerRef.current);
        spawnerRef.current = undefined;
        waveInProgressRef.current = false;
        return;
      }
      if (spawnedCount >= waveData.enemies.count) {
        if (spawnerRef.current) clearTimeout(spawnerRef.current);
        spawnerRef.current = undefined;
        return;
      }
  
      const difficultyMod = difficultyModifiers[difficulty];
      const health = Math.round(waveData.enemies.health * difficultyMod.enemyHealth);
      
      let movementPattern: MovementPattern;
      switch(waveData.enemies.type) {
        case 'schnell': movementPattern = 'zigzag'; break;
        case 'gepanzert': case 'boss': movementPattern = 'straight'; break;
        default: movementPattern = 'wobble'; break;
      }

      const enemyId = `enemy-${enemyIdCounter.current++}`;
      const newEnemy: Enemy = {
        id: enemyId, ...waveData.enemies, health, maxHealth: health,
        pathIndex: 0, position: START_NODE, isBlocked: false, effects: [],
        lastMove: performance.now(), wasHit: false, targetNode: END_NODE,
        movementPattern: movementPattern, path: [], // Path is added in the broadcast delta
      };
      
      // CRITICAL FIX: Include the currentPath in the spawn delta payload
      broadcastGameData([[DeltaType.ENEMY_SPAWN, { ...newEnemy, path: currentPath }]]);
      
      spawnedCount++;
      setSpawnedThisWave(c => c + 1); // Local update for host UI
      spawnerRef.current = setTimeout(spawnEnemy, waveData.enemies.spawnDelay);
    };

    spawnEnemy();
  }, [isGameHost, currentWave, gameStatus, difficulty, broadcastGameData, START_NODE, END_NODE, currentPath]);

  useEffect(() => {
    if (!user || !gameId) {
      console.log("[CoopGame] Waiting for user and gameId...", { user, gameId });
      return;
    }

    let gameUnsubscribe: Unsubscribe;
    console.log(`[CoopGame] Setting up listeners for user ${user.uid} and game ${gameId}`);

    const setupListeners = async (uid: string) => {
        try {
            console.log("[CoopGame] Getting initial game document...");
            const gameDocRef = doc(db, 'games', gameId);
            const gameSnap = await getDoc(gameDocRef);
            if (!gameSnap.exists()) {
                 toast({ title: "Spiel nicht gefunden", variant: 'destructive'});
                 router.push('/');
                 return;
            }
            
            console.log("[CoopGame] Initial game data found:", gameSnap.data());
            const gameData = gameSnap.data();
            let isPlayer1 = gameData.player1Id === uid;
            let isPlayer2 = gameData.player2Id === uid;

            if (!isPlayer1 && !isPlayer2 && !gameData.player2Id && !gameData.isTestGame) {
                console.log("[CoopGame] User is not a player, attempting to join...");
                const joinGameCallable = httpsCallable(functions, 'joinGame');
                await joinGameCallable({ gameId });
                isPlayer2 = true;
                toast({ title: "Spiel beigetreten!", description: "Du bist jetzt Spieler 2." });
                console.log("[CoopGame] Successfully joined as Player 2.");
            }

            const currentRole = isPlayer1 ? 'player1' : (isPlayer2 ? 'player2' : 'spectator');
            setLocalPlayerId(currentRole);
            console.log(`[CoopGame] User role set to: ${currentRole}`);

            console.log("[CoopGame] Subscribing to Firestore updates...");
            gameUnsubscribe = onSnapshot(gameDocRef, (snap) => {
                if (!snap.exists()) {
                    console.error("[CoopGame] Game document no longer exists.");
                    toast({ title: "Spiel nicht mehr vorhanden", variant: 'destructive'});
                    router.push('/');
                    return;
                }
                const data = snap.data();
                if (!data) return;

                console.log("[CoopGame] Firestore data received:", data);

                const normalized = normalizePlayers(data.players);
                setPlayers(normalized);

                const currentIsHost = data.player1Id === user.uid;
                setLocalPlayerId(currentIsHost ? 'player1' : (data.player2Id === user.uid ? 'player2' : 'spectator'));

                setGameState(data.gameState || { lives: 20 });
                setDifficulty(data.difficulty || 'Normal');
                setGameStatus(data.gameStatus || 'waiting');
                setCurrentWave(data.currentWave || 0);
                setIsIntermission(data.isIntermission ?? true);
                setWaveStartCountdown(data.waveStartCountdown ?? INTERMISSION_TIME);
                setTowersByCell(data.towersByCell || {});
                setSpawnedThisWave(data.spawnedThisWave || 0);
                
                console.log(`[CoopGame] State updated: status=${data.gameStatus}, wave=${data.currentWave}, intermission=${data.isIntermission}`);

                if (data.lastUpgradedTowerId) {
                  setLastUpgradedTowerId(data.lastUpgradedTowerId);
                  setTimeout(() => setLastUpgradedTowerId(null), 1000);
                  if(isGameHost) updateDoc(gameDocRef, {lastUpgradedTowerId: null});
                }
                setLoading(false);
            }, (error) => {
              console.error("Error listening to game document:", error);
              toast({ title: "Verbindung zum Spiel verloren", variant: 'destructive'});
              router.push('/');
            });
            
        } catch (e:any) {
            console.error("Error joining/setting up game:", e);
            toast({ title: "Fehler beim Beitreten", description: e.message, variant: 'destructive'});
            router.push('/');
        }
    };

    setupListeners(user.uid);

    return () => {
        if (gameUnsubscribe) {
            console.log("[CoopGame] Unsubscribing from Firestore listener.");
            gameUnsubscribe();
        }
    };
  }, [user, gameId, router, toast, isGameHost]);

  useEffect(() => {
    const authUnsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (!currentUser) {
         if (process.env.NODE_ENV === 'development') {
            const devUser: User = {
                uid: 'dev-user-' + Math.random().toString(36).substring(2, 9),
                displayName: 'Dev Spieler',
                email: 'dev@example.com',
                photoURL: `https://i.pravatar.cc/150?u=dev-user-id`,
                providerId: 'password',
                emailVerified: true, isAnonymous: false, metadata: {}, providerData: [], refreshToken: '', tenantId: null,
                delete: async () => {}, getIdToken: async () => '', getIdTokenResult: async () => ({} as any), reload: async () => {}, toJSON: () => ({}),
            };
            setUser(devUser);
        } else {
            toast({ title: "Authentifizierung erforderlich.", variant: 'destructive' });
            router.push('/');
        }
      } else {
        setUser(currentUser);
      }
    });
    return () => authUnsubscribe();
  }, [router, toast]);
  

  useEffect(() => {
    if (!rtc.lastMessage) return;
    
    const { type, payload } = rtc.lastMessage;

    if (type === 'game_delta_batch') {
      applyDeltas(payload as GameDelta[]);
    }
  }, [rtc.lastMessage, applyDeltas, isGameHost]);


  const handleGameEnd = useCallback(async (result: GameResult) => {
    if (gameId && isGameHost) {
        if(gameStatus === 'gameover') return;
      const logData = {
          ...result,
          timestamp: serverTimestamp(),
          hostPacketsPerSecond: rtc.packetsPerSecond,
          hostBytesSentPerSecond: rtc.bytesPerSecond,
          clientPacketsPerSecond: 0, // Placeholder
          clientBytesReceivedPerSecond: 0, // Placeholder
          averagePacketSize: rtc.averagePacketSize,
          enemyCount: enemies.length,
          towerCount: Object.keys(towersByCell).length,
          fps,
      };
      await addDoc(collection(db, `games/${gameId}/game_logs`), logData);
      await updateDoc(doc(db, 'games', gameId), { gameStatus: 'gameover' });
    }
  }, [gameId, isGameHost, gameStatus, enemies.length, Object.keys(towersByCell).length, fps, rtc.packetsPerSecond, rtc.bytesPerSecond, rtc.averagePacketSize]);
  
  if (loading || !localPlayerId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <Loader2 className="h-16 w-16 animate-spin text-primary" />
        <p className="ml-4 text-lg">Verbinde mit Spiel...</p>
      </div>
    );
  }

  return (
    <GameSession 
      players={players} setPlayers={setPlayers}
      gameState={gameState} setGameState={setGameState}
      towersByCell={towersByCell} setTowersByCell={setTowersByCell}
      currentWave={currentWave} setCurrentWave={setCurrentWave}
      gameStatus={gameStatus} setGameStatus={setGameStatus}
      difficulty={difficulty} setDifficulty={setDifficulty}
      isIntermission={isIntermission} setIsIntermission={setIsIntermission}
      waveStartCountdown={waveStartCountdown} setWaveStartCountdown={setWaveStartCountdown}
      currentPath={currentPath}
      enemies={enemies}
      setEnemies={setEnemies}
      spawnedThisWave={spawnedThisWave}
      setSpawnedThisWave={setSpawnedThisWave}
      isCoop={true}
      isGameHost={isGameHost}
      localPlayerId={localPlayerId}
      broadcastGameData={broadcastGameData}
      sendActionRequest={rtc.sendActionRequest}
      applyDeltas={applyDeltas}
      onGameEnd={handleGameEnd}
      onExit={() => router.push('/')}
      attacks={attacks}
      damageNumbers={damageNumbers}
      splashRings={splashRings}
      lastUpgradedTowerId={lastUpgradedTowerId}
      setLastUpgradedTowerId={setLastUpgradedTowerId}
      firingTowerIds={firingTowerIds}
      setFiringTowerIds={setFiringTowerIds}
      fps={fps}
      setFps={setFps}
      isWsConnected={rtc?.isConnected}
      hostPacketsPerSecond={rtc.packetsPerSecond}
      hostBytesSentPerSecond={rtc.bytesPerSecond}
      clientPacketsPerSecond={rtc.packetsPerSecond} // Note: This is an approximation from client perspective
      clientBytesReceivedPerSecond={rtc.bytesPerSecond} // Note: This is an approximation from client perspective
      averagePacketSize={rtc.averagePacketSize}
      finalGameResult={finalGameResult}
      startWave={startWave} // Pass down the wave start function
    />
  );
}

export default CoopGame;
