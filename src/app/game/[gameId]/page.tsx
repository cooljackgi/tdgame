

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
import type { Player, GameState, GameStatus, PlacedTower, Attack, DamageNumber, SplashRing, GameResult, Difficulty, GameDelta, Node, Enemy, EnemyStatusEffect, MovementPattern } from '@/lib/game-data/types';
import { DeltaType } from "@/lib/game-data/types";
import { INTERMISSION_TIME, GRID_ROWS, GRID_COLS, difficultyModifiers, elementProjectileColors } from "@/lib/game-data/constants";
import { audioManager } from "@/lib/audio/audio-manager";
import { findPath } from '@/lib/pathfinding';
import { waves } from "@/lib/game-data/enemies";
import { towers as allTowersData } from "@/lib/game-data/towers";
import { httpsCallable } from "firebase/functions";
import { Loader2 } from "lucide-react";


function CoopGame() {
  const { gameId } = useParams<{ gameId: string }>();
  const router = useRouter();
  const { toast } = useToast();
  
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // --- Synced State (via deltas) ---
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

  // --- Local Client State ---
  const [localPlayerId, setLocalPlayerId] = useState<'player1' | 'player2' | 'spectator' | null>(null);
  const isGameHost = useMemo(() => localPlayerId === 'player1', [localPlayerId]);
  
  // --- VFX State (fed by deltas) ---
  const [attacks, setAttacks] = useState<Attack[]>([]);
  const [damageNumbers, setDamageNumbers] = useState<DamageNumber[]>([]);
  const [splashRings, setSplashRings] = useState<SplashRing[]>([]);
  const [lastUpgradedTowerId, setLastUpgradedTowerId] = useState<string|null>(null);
  const [firingTowerIds, setFiringTowerIds] = useState<Set<string>>(new Set());
  const [finalGameResult, setFinalGameResult] = useState<GameResult | null>(null);
  
  // --- Stats State ---
  const [fps, setFps] = useState(0);
  const [totalKilled, setTotalKilled] = useState(0);
  const [totalLeaked, setTotalLeaked] = useState(0);
  
  const rtc = useWebRTC(gameId, isGameHost, user);
  const gameLoopRef = useRef<number>();
  const lastTickRef = useRef(performance.now());
  const enemyIdCounter = useRef(0);
  const spawnerStateRef = useRef<{ count: number; timer: number; waveData: any } | null>(null);

  // --- Stable Refs for Game Loop ---
  const enemiesRef = useRef(enemies);
  const playersRef = useRef(players);
  const towersByCellRef = useRef(towersByCell);
  const gameStateRef = useRef(gameState);
  const currentWaveRef = useRef(currentWave);
  const difficultyRef = useRef(difficulty);

  useEffect(() => { enemiesRef.current = enemies }, [enemies]);
  useEffect(() => { playersRef.current = players }, [players]);
  useEffect(() => { towersByCellRef.current = towersByCell }, [towersByCell]);
  useEffect(() => { gameStateRef.current = gameState }, [gameState]);
  useEffect(() => { currentWaveRef.current = currentWave }, [currentWave]);
  useEffect(() => { difficultyRef.current = difficulty }, [difficulty]);
  
  const currentPath = useMemo(() => findPath({ row: 1, col: 1 }, { row: GRID_ROWS, col: GRID_COLS }, Object.values(towersByCell).map(t => t.position), GRID_ROWS, GRID_COLS) || [], [towersByCell]);
  const currentPathRef = useRef(currentPath);
  useEffect(() => { currentPathRef.current = currentPath }, [currentPath]);

  const applyDeltas = useCallback((deltas: GameDelta[]) => {
    if (deltas.length > 0 && isGameHost) {
        console.log('[CLIENT-RECV]', deltas);
    }
    deltas.forEach(delta => {
        const type = delta[0];
        const payload = delta[1];
        switch(type) {
            case DeltaType.ENEMY_SPAWN: {
                const newEnemy = payload as Enemy;
                setEnemies(prev => [...prev, newEnemy]);
                break;
            }
            case DeltaType.ENEMY_MOVE: {
                const [id, pathIndex, now] = delta.slice(1);
                setEnemies(prev => prev.map(e => e.id === id ? { ...e, pathIndex, lastMove: now, position: currentPathRef.current[pathIndex] || e.position } : e));
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
                setTotalKilled(k => k + 1);
                break;
            }
            case DeltaType.ENEMY_REACH_END: {
                const id = payload;
                setEnemies(prev => prev.filter(e => e.id !== id));
                setTotalLeaked(l => l + 1);
                break;
            }
            case DeltaType.ENEMY_ADD_EFFECT: {
                const [id, effect] = delta.slice(1) as [string, EnemyStatusEffect];
                setEnemies(prev => prev.map(e => e.id === id ? { ...e, effects: [...e.effects.filter(ef => ef.type !== effect.type), effect] } : e));
                break;
            }
             case DeltaType.ENEMY_REMOVE_EFFECT: {
                const [id, effectType] = delta.slice(1);
                setEnemies(prev => prev.map(e => e.id === id ? { ...e, effects: e.effects.filter(ef => ef.type !== effectType) } : e));
                break;
            }
            case DeltaType.TOWER_ATTACK:
                setAttacks(prev => [...prev.slice(-200), payload]);
                audioManager.playSfx('shoot', 0.3);
                setFiringTowerIds(prev => new Set(prev).add((payload as Attack).towerId));
                setTimeout(() => setFiringTowerIds(prev => { const s = new Set(prev); s.delete((payload as Attack).towerId); return s; }), 150);
                break;
            case DeltaType.VFX_DAMAGE_NUMBER:
                setDamageNumbers(prev => [...prev.slice(-100), payload]);
                break;
            case DeltaType.VFX_SPLASH:
                setSplashRings(prev => [...prev.slice(-50), payload]);
                break;
            case DeltaType.GAME_STATE_UPDATE: {
                const newState = payload as Partial<GameState & { gameStatus: GameStatus, currentWave: number, isIntermission: boolean, waveStartCountdown: number, spawnedThisWave: number }>;
                if (newState.gameStatus !== undefined) setGameStatus(newState.gameStatus);
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
                 setPlayers(prev => prev.map(p => ({...p, ...(payload[p.id] || {})})));
                break;
            case DeltaType.TOWER_UPGRADE_VFX:
                setLastUpgradedTowerId((payload as { towerId: string }).towerId);
                setTimeout(() => setLastUpgradedTowerId(null), 1000);
                break;
            case DeltaType.BUILD_TOWER_REQUEST:
            case DeltaType.UPGRADE_TOWER_REQUEST:
            case DeltaType.SELL_TOWER_REQUEST:
                 if (isGameHost) {
                    document.dispatchEvent(new CustomEvent('hostActionRequest', { detail: { type, payload } }));
                }
                break;
        }
    });
  }, [isGameHost]);

  const broadcastGameData = useCallback((deltas: GameDelta[], reliable?: boolean) => {
      if (deltas.length === 0) return;
      
      console.log('[HOST-SEND]', deltas);
      if (isGameHost) {
         rtc.sendMessage({ type: 'game_delta_batch', payload: deltas });
      }
      applyDeltas(deltas);
  }, [rtc, isGameHost, applyDeltas]);
    
  useEffect(() => {
    let gameUnsubscribe: Unsubscribe | undefined;
    
    const setupListeners = async (uid: string) => {
        try {
            const gameDocRef = doc(db, 'games', gameId);
            gameUnsubscribe = onSnapshot(gameDocRef, async (snap) => {
                if (!snap.exists()) {
                     toast({ title: "Spiel nicht gefunden", variant: 'destructive'});
                     router.push('/');
                     return;
                }
                
                const gameData = snap.data();
                if (!gameData) return;
                
                let currentRole = 'spectator' as Player['id'];
                if(gameData.player1Id === uid) currentRole = 'player1';
                else if(gameData.player2Id === uid) currentRole = 'player2';

                if (currentRole === 'spectator' && !gameData.player2Id && !gameData.isTestGame) {
                    try {
                        const joinGameCallable = httpsCallable(functions, 'joinGame');
                        await joinGameCallable({ gameId });
                        toast({ title: "Spiel beigetreten!", description: "Du bist jetzt Spieler 2." });
                        // Let the next snapshot handle the role update
                        return;
                    } catch(e: any) {
                       toast({ title: "Beitritt fehlgeschlagen", description: e.message, variant: 'destructive'});
                       router.push('/');
                       return;
                    }
                }
                setLocalPlayerId(currentRole);

                if (!isGameHost) { // Clients & Spectators get their state primarily from Firestore initially
                    const normalized = normalizePlayers(gameData.players);
                    setPlayers(normalized);
                    setGameState(gameData.gameState || { lives: 20 });
                    setDifficulty(gameData.difficulty || 'Normal');
                    setGameStatus(gameData.gameStatus || 'waiting');
                    setCurrentWave(gameData.currentWave || 0);
                    setIsIntermission(gameData.isIntermission ?? true);
                    setWaveStartCountdown(gameData.waveStartCountdown ?? INTERMISSION_TIME);
                    setTowersByCell(gameData.towersByCell || {});
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

    if (user && gameId) {
        setupListeners(user.uid);
    }

    return () => {
        if (gameUnsubscribe) gameUnsubscribe();
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
    if (type === 'game_delta_batch') { applyDeltas(payload as GameDelta[]); }
  }, [rtc.lastMessage, applyDeltas]);


  const handleGameEnd = useCallback(async (result: GameResult) => {
    if (gameId && isGameHost && gameStatus !== 'gameover') {
      const logData = { ...result, timestamp: serverTimestamp() };
      await addDoc(collection(db, `games/${gameId}/game_logs`), logData);
      broadcastGameData([[DeltaType.GAME_STATE_UPDATE, { gameStatus: 'gameover' }]]);
    }
  }, [gameId, isGameHost, gameStatus, broadcastGameData]);
  
  useEffect(() => {
    if (!isGameHost || !gameStatus) return;

    const gameLoop = (now: number) => {
        gameLoopRef.current = requestAnimationFrame(gameLoop);
        
        if (gameStatus !== 'playing' || isIntermission) {
            lastTickRef.current = now;
            return;
        }
        
        const delta = now - lastTickRef.current;
        if (delta < 1000 / 65) return;
        lastTickRef.current = now;
        setFps(Math.round(1000 / delta));
        
        const deltas: GameDelta[] = [];
        
        // 1. Enemy Spawning
        if (!spawnerStateRef.current) {
            const waveData = waves[currentWaveRef.current];
            if (waveData) {
                spawnerStateRef.current = { count: 0, timer: 0, waveData: waveData.enemies };
                deltas.push([DeltaType.GAME_STATE_UPDATE, { spawnedThisWave: 0 }]);
            }
        }
        
        if (spawnerStateRef.current && currentPathRef.current.length > 0) {
            spawnerStateRef.current.timer += delta;
            if (spawnerStateRef.current.timer >= spawnerStateRef.current.waveData.spawnDelay) {
                if (spawnerStateRef.current.count < spawnerStateRef.current.waveData.count) {
                    spawnerStateRef.current.timer = 0;
                    const difficultyMod = difficultyModifiers[difficultyRef.current];
                    const health = Math.round(spawnerStateRef.current.waveData.health * difficultyMod.enemyHealth);
                    const movementPattern: Enemy['movementPattern'] = spawnerStateRef.current.waveData.type === 'schnell' ? 'zigzag' : 'wobble';
                    const newEnemy: Enemy = {
                        id: `enemy-${currentWaveRef.current}-${enemyIdCounter.current++}`, ...spawnerStateRef.current.waveData, health, maxHealth: health,
                        path: currentPathRef.current, pathIndex: 0, position: {row:1, col:1}, isBlocked: false, effects: [], lastMove: now, wasHit: false, targetNode: {row: GRID_ROWS, col: GRID_COLS}, movementPattern
                    };
                    deltas.push([DeltaType.ENEMY_SPAWN, newEnemy]);
                    deltas.push([DeltaType.GAME_STATE_UPDATE, { spawnedThisWave: spawnerStateRef.current.count + 1 }]);
                    spawnerStateRef.current.count++;
                }
            }
        }

        // 2. Tower Attacks
        Object.values(towersByCellRef.current).forEach(tower => {
            if (now - tower.lastAttack >= tower.attackSpeed) {
                const targets = enemiesRef.current.filter(e => Math.pow(tower.position.col - e.position.col, 2) + Math.pow(tower.position.row - e.position.row, 2) <= Math.pow(tower.range, 2));
                if (targets.length > 0) {
                    const mainTarget = targets.sort((a,b) => b.pathIndex - a.pathIndex)[0];
                    deltas.push([DeltaType.TOWER_ATTACK, { id: `attack-${now}-${Math.random()}`, towerId: tower.id, targetId: mainTarget.id, elements: tower.elements, projectile: 'beam' }]);
                    tower.lastAttack = now;
                }
            }
        });
        
        // 3. Enemy Damage & Effects
        enemiesRef.current.forEach(enemy => {
            deltas.forEach(delta => {
                if (delta[0] === DeltaType.TOWER_ATTACK && delta[1].targetId === enemy.id) {
                    const tower = Object.values(towersByCellRef.current).find(t => t.id === delta[1].towerId);
                    if (tower) {
                        deltas.push([DeltaType.ENEMY_DAMAGE, enemy.id, tower.damage]);
                        deltas.push([DeltaType.VFX_DAMAGE_NUMBER, { id: `dmg-${now}-${Math.random()}`, targetId: enemy.id, amount: tower.damage, color: elementProjectileColors[tower.elements[0]] || 'white', position: enemy.position }]);
                    }
                }
            });
        });

        // 4. Enemy Movement & Path End
        const liveEnemyIds = new Set(enemiesRef.current.map(e => e.id));
        deltas.filter(d => d[0] === DeltaType.ENEMY_DAMAGE).forEach(d => {
            const enemy = enemiesRef.current.find(e => e.id === d[1]);
            if (enemy) enemy.health -= d[2];
        });
        
        enemiesRef.current.forEach(enemy => {
             if (enemy.health <= 0) {
                if (liveEnemyIds.has(enemy.id)) {
                   deltas.push([DeltaType.ENEMY_DIE, enemy.id]);
                   const bounty = enemy.bounty;
                   deltas.push([DeltaType.PLAYER_UPDATE, { player1: { resources: playersRef.current[0].resources + bounty }, player2: { resources: playersRef.current[1]?.resources + bounty } }]);
                   liveEnemyIds.delete(enemy.id);
                }
                return;
             }
             const isStunned = enemy.effects.some(e => e.type === 'stun' && e.expires > now);
             if (!isStunned) {
                const slowEffect = enemy.effects.find(e => e.type === 'slow' && e.expires > now);
                const effectiveSpeed = enemy.speed * (slowEffect ? (1 - (slowEffect.potency ?? 0)) : 1);
                if (now - enemy.lastMove >= 1000 / effectiveSpeed) {
                     if (enemy.pathIndex < currentPathRef.current.length - 1) {
                        deltas.push([DeltaType.ENEMY_MOVE, enemy.id, enemy.pathIndex + 1, now]);
                    } else {
                        deltas.push([DeltaType.ENEMY_REACH_END, enemy.id]);
                        deltas.push([DeltaType.GAME_STATE_UPDATE, { lives: gameStateRef.current.lives - 1 }]);
                        liveEnemyIds.delete(enemy.id);
                    }
                }
             }
        });
        
        // 5. Wave Completion
        if (spawnerStateRef.current && spawnerStateRef.current.count >= spawnerStateRef.current.waveData.count && enemiesRef.current.every(e => e.health <= 0)) {
            spawnerStateRef.current = null;
            const nextWave = currentWaveRef.current + 1;
            if (nextWave >= waves.length) {
                handleGameEnd({ playerName: playersRef.current[0].name, playerUid: playersRef.current[0].id, date: new Date().toISOString(), difficulty: difficultyRef.current, wave: waves.length, won: true, finalTowers: towersByCellRef.current });
            } else {
                 deltas.push([DeltaType.GAME_STATE_UPDATE, { currentWave: nextWave, isIntermission: true, waveStartCountdown: INTERMISSION_TIME, spawnedThisWave: 0 }]);
            }
        }
        if (deltas.length > 0) { broadcastGameData(deltas); }
    };
    gameLoopRef.current = requestAnimationFrame(gameLoop);
    return () => { if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current); };
}, [isGameHost, gameStatus, isIntermission, broadcastGameData, handleGameEnd]);

  
  if (loading || !localPlayerId) {
    return <div className="flex flex-col items-center justify-center min-h-screen"><Loader2 className="h-16 w-16 animate-spin text-primary" /><p className="ml-4 text-lg">Verbinde mit Spiel...</p></div>;
  }

  const localPlayer = players.find(p => p.id === localPlayerId);

  return (
    <GameSession
        // State
        players={players} setPlayers={setPlayers}
        gameState={gameState} setGameState={setGameState}
        towersByCell={towersByCell} setTowersByCell={setTowersByCell}
        currentWave={currentWave} setCurrentWave={setCurrentWave}
        gameStatus={gameStatus} setGameStatus={setGameStatus}
        difficulty={difficulty} setDifficulty={setDifficulty}
        isIntermission={isIntermission} setIsIntermission={setIsIntermission}
        waveStartCountdown={waveStartCountdown} setWaveStartCountdown={setWaveStartCountdown}
        currentPath={currentPath}
        enemies={enemies} setEnemies={setEnemies}
        spawnedThisWave={spawnedThisWave} setSpawnedThisWave={setSpawnedThisWave}
        
        // Control
        isCoop={true}
        isGameHost={isGameHost}
        localPlayerId={localPlayerId}
        broadcastGameData={broadcastGameData}
        sendActionRequest={rtc.sendActionRequest}
        applyDeltas={applyDeltas}
        onGameEnd={handleGameEnd}
        onExit={() => router.push('/')}
        
        // VFX
        attacks={attacks} damageNumbers={damageNumbers} splashRings={splashRings}
        lastUpgradedTowerId={lastUpgradedTowerId} setLastUpgradedTowerId={setLastUpgradedTowerId}
        firingTowerIds={firingTowerIds} setFiringTowerIds={setFiringTowerIds}
        
        // Stats
        fps={fps} setFps={setFps}
        isWsConnected={rtc?.isConnected}
        hostPacketsPerSecond={rtc.packetsPerSecond} hostBytesSentPerSecond={rtc.bytesPerSecond}
        clientPacketsPerSecond={rtc.packetsPerSecond} clientBytesReceivedPerSecond={rtc.bytesPerSecond}
        averagePacketSize={rtc.averagePacketSize}
        finalGameResult={finalGameResult}
        totalKilled={totalKilled} setTotalKilled={setTotalKilled}
        totalLeaked={totalLeaked} setTotalLeaked={setTotalLeaked}
    />
  );
}

export default CoopGame;
