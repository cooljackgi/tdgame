
"use client";

import GameSession from "@/components/game/game-session";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback, useMemo } from "react";
import { onAuthStateChanged, auth, functions } from "@/lib/firebase";
import { doc, onSnapshot, updateDoc, getDoc, Unsubscribe, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useWebRTC } from '@/hooks/use-webrtc';
import { useToast } from '@/hooks/use-toast';
import { normalizePlayers } from '@/lib/player-utils';
import type { User } from "firebase/auth";
import type { Player, GameState, GameStatus, PlacedTower, Attack, DamageNumber, SplashRing, GameResult, Difficulty, GameDelta, Node, Enemy, EnemyStatusEffect, Element } from '@/lib/game-data/types';
import { Loader2 } from "lucide-react";
import { DeltaType } from "@/lib/game-data/types";
import { INTERMISSION_TIME, GRID_ROWS, GRID_COLS } from "@/lib/game-data/constants";
import { audioManager } from "@/lib/audio/audio-manager";
import { findPath } from '@/lib/pathfinding';
import { towers as initialTowers } from '@/lib/game-data/towers';
import { httpsCallable } from "firebase/functions";

function CoopGame() {
  const { gameId } = useParams<{ gameId: string }>();
  const router = useRouter();
  const { toast } = useToast();
  
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
  const [clientPacketsPerSecond, setClientPacketsPerSecond] = useState(0);
  const [clientBytesReceivedPerSecond, setClientBytesReceivedPerSecond] = useState(0);

  // --- Local State ---
  const [localPlayerId, setLocalPlayerId] = useState<'player1' | 'player2' | 'spectator' | null>(null);
  const [isGameHost, setIsGameHost] = useState(false);
  
  // --- VFX State ---
  const [attacks, setAttacks] = useState<Attack[]>([]);
  const [damageNumbers, setDamageNumbers] = useState<DamageNumber[]>([]);
  const [splashRings, setSplashRings] = useState<SplashRing[]>([]);
  const [lastUpgradedTowerId, setLastUpgradedTowerId] = useState<string|null>(null);
  const [firingTowerIds, setFiringTowerIds] = useState<Set<string>>(new Set());
  const [finalGameResult, setFinalGameResult] = useState<GameResult | null>(null);
  
  // --- Stats State ---
  const [fps, setFps] = useState(0);
  const [hostPacketsPerSecond, setHostPacketsPerSecond] = useState(0);
  const [hostBytesSentPerSecond, setHostBytesSentPerSecond] = useState(0);
  const [averagePacketSize, setAveragePacketSize] = useState(0);

  const rtc = useWebRTC(gameId, isGameHost, user);

  const START_NODE = { row: 1, col: 1 };
  const END_NODE = { row: GRID_ROWS, col: GRID_COLS };
  const currentPath = useMemo(() => findPath(START_NODE, END_NODE, Object.values(towersByCell).map(t => t.position), GRID_ROWS, GRID_COLS) || [], [towersByCell]);

  const applyDeltas = useCallback((deltas: GameDelta[]) => {
    deltas.forEach(delta => {
        const type = delta[0];
        switch(type) {
            case DeltaType.ENEMY_SPAWN: {
                const newEnemy = { ...delta[1], path: currentPath };
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
            case DeltaType.ENEMY_DAMAGE: {
                const [id, damage] = delta.slice(1);
                setEnemies(prev => prev.map(e => e.id === id ? { ...e, health: e.health - (damage as number), wasHit: true } : e));
                setTimeout(() => setEnemies(prev => prev.map(e => e.id === id ? { ...e, wasHit: false } : e)), 150);
                break;
            }
            case DeltaType.ENEMY_DIE: {
                const id = delta[1];
                setEnemies(prev => prev.filter(e => e.id !== id));
                break;
            }
            case DeltaType.ENEMY_REACH_END: {
                const id = delta[1];
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
                setEnemies(prev => prev.map(e => e.id === id ? { ...e, effects: e.effects.filter(ef => ef.type !== effectType) } : e));
                break;
            }
            case DeltaType.TOWER_ATTACK:
                setAttacks(prev => [...prev.slice(-200), delta[1]]);
                audioManager.playSfx('shoot', 0.3);
                setFiringTowerIds(prev => new Set(prev).add((delta[1] as Attack).towerId));
                setTimeout(() => setFiringTowerIds(prev => {
                    const s = new Set(prev);
                    s.delete((delta[1] as Attack).towerId);
                    return s;
                }), 150);
                break;
            case DeltaType.VFX_DAMAGE_NUMBER:
                setDamageNumbers(prev => [...prev.slice(-100), delta[1]]);
                break;
            case DeltaType.VFX_SPLASH:
                setSplashRings(prev => [...prev.slice(-50), delta[1]]);
                break;
             case DeltaType.CLIENT_STATS_UPDATE:
                if (isGameHost) {
                  const stats = delta[1] as { pps: number, bps: number, avgSize: number };
                  setClientPacketsPerSecond(stats.pps);
                  setClientBytesReceivedPerSecond(stats.bps);
                }
                break;
            case DeltaType.GAME_STATE_UPDATE: {
                const newState = delta[1] as Partial<GameState & { gameStatus: GameStatus, currentWave: number, isIntermission: boolean, waveStartCountdown: number, spawnedThisWave: number }>;
                if (newState.gameStatus) setGameStatus(newState.gameStatus);
                if (newState.currentWave !== undefined) setCurrentWave(newState.currentWave);
                if (newState.isIntermission !== undefined) setIsIntermission(newState.isIntermission);
                if (newState.waveStartCountdown !== undefined) setWaveStartCountdown(newState.waveStartCountdown);
                if (newState.lives !== undefined) setGameState(s => ({...s, lives: newState.lives!}));
                if (newState.spawnedThisWave !== undefined) setSpawnedThisWave(newState.spawnedThisWave);
                break;
            }
             case DeltaType.TOWERS_UPDATE:
                setTowersByCell(delta[1]);
                break;
            case DeltaType.PLAYER_UPDATE:
                 const playerUpdates = delta[1] as Record<string, Partial<Player>>;
                 setPlayers(prev => prev.map(p => {
                    const update = playerUpdates[p.id];
                    if (update) {
                        return {...p, ...update};
                    }
                    return p;
                 }));
                break;
        }
    });
  }, [currentPath, isGameHost]);
    
  const broadcastGameData = useCallback((deltas: GameDelta[]) => {
      if (deltas.length === 0) return;
      
      // Send to other players
      if(isGameHost) {
         rtc.sendMessage({ type: 'game_delta_batch', payload: deltas });
      }
      
      // Apply locally for the host. For clients, this is a no-op as they wait for server confirmation.
      applyDeltas(deltas);
  }, [rtc, isGameHost, applyDeltas]);


  const handlePlaceTower = useCallback(async (row: number, col: number) => {
    const localPlayer = players.find(p => p.id === localPlayerId);
    // For now, only base tower can be built. A proper `selectedTowerToBuild` should be managed.
    const selectedTowerToBuild = initialTowers.find(t => t.isBase);

    if (!selectedTowerToBuild || !localPlayer || localPlayerId === 'spectator') return;

    const cellKey = `${row}_${col}`;
    const cost = selectedTowerToBuild.cost;

    if (towersByCell[cellKey]) {
        toast({ title: "Bau nicht möglich", description: "Feld ist bereits belegt.", variant: "destructive" });
        return;
    }
    
    const newTower: PlacedTower = {
      ...selectedTowerToBuild,
      id: `tower-${row}-${col}-${Math.random()}`,
      specId: selectedTowerToBuild.id,
      position: { row, col },
      lastAttack: 0,
      health: selectedTowerToBuild.maxHealth,
      ownerId: localPlayer.id,
    };
    
    const currentPlacedTowers = Object.values(towersByCell).map(t => t.position);
    const newPath = findPath(START_NODE, END_NODE, [...currentPlacedTowers, { row, col }], GRID_ROWS, GRID_COLS);
    if (!newPath) {
        toast({ title: "Bau fehlgeschlagen", description: "Der Weg für die Gegner darf nicht blockiert werden.", variant: 'destructive' });
        return;
    }
    if (localPlayer.resources < cost) {
        toast({ title: "Bau fehlgeschlagen", description: "Nicht genügend Ressourcen.", variant: 'destructive' });
        return;
    }
    const newTowersByCell = { ...towersByCell, [cellKey]: newTower };
    const playerUpdates = { [localPlayer.id]: { resources: localPlayer.resources - cost } };

    broadcastGameData([
        [DeltaType.TOWERS_UPDATE, newTowersByCell],
        [DeltaType.PLAYER_UPDATE, playerUpdates]
    ]);

    audioManager.playSfx('build_tower');
  }, [players, localPlayerId, towersByCell, broadcastGameData, toast, START_NODE, END_NODE]);

  useEffect(() => {
    if (!user || !gameId) return;

    let gameUnsubscribe: Unsubscribe;
    const logCollectionRef = collection(db, `games/${gameId}/game_logs`);

    const setupListeners = async (uid: string) => {
        try {
            const gameDocRef = doc(db, 'games', gameId);
            const gameSnap = await getDoc(gameDocRef);
            if (!gameSnap.exists()) {
                 toast({ title: "Spiel nicht gefunden", variant: 'destructive'});
                 router.push('/');
                 return;
            }
            const gameData = gameSnap.data();
            const isPlayer1 = gameData.player1Id === uid;
            let isPlayer2 = gameData.player2Id === uid;
            const isFull = !!gameData.player2Id;

            if (!isPlayer1 && !isPlayer2 && !isFull && !gameData.isTestGame) {
                const joinGameCallable = httpsCallable(functions, 'joinGame');
                await joinGameCallable({ gameId });
                isPlayer2 = true;
                toast({ title: "Spiel beigetreten!", description: "Du bist jetzt Spieler 2." });
            }

            const currentRole = isPlayer1 ? 'player1' : (isPlayer2 ? 'player2' : 'spectator');
            setIsGameHost(currentRole === 'player1');
            setLocalPlayerId(currentRole);

            gameUnsubscribe = onSnapshot(gameDocRef, (snap) => {
                if (!snap.exists()) {
                    toast({ title: "Spiel nicht mehr vorhanden", variant: 'destructive'});
                    router.push('/');
                    return;
                }
                const data = snap.data();
                if (!data) return;

                const normalized = normalizePlayers(data.players);
                setPlayers(normalized);

                const currentIsHost = data.player1Id === user.uid;
                setIsGameHost(currentIsHost);
                setLocalPlayerId(currentIsHost ? 'player1' : (normalized.some(p => p.id === 'player2') ? 'player2' : 'spectator'));

                // This is now the single source of truth for these states,
                // driven by Firestore and then overridden by deltas.
                setGameState(data.gameState || { lives: 20 });
                setDifficulty(data.difficulty || 'Normal');
                setGameStatus(data.gameStatus || 'waiting');
                setCurrentWave(data.currentWave || 0);
                setIsIntermission(data.isIntermission ?? false);
                setWaveStartCountdown(data.waveStartCountdown ?? INTERMISSION_TIME);
                setTowersByCell(data.towersByCell || {});
                setSpawnedThisWave(data.spawnedThisWave || 0);
                
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
        if (gameUnsubscribe) gameUnsubscribe();
    };
  }, [user, gameId, router, toast, isGameHost, rtc]);

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
    if (!rtc?.lastMessage || isGameHost) return;
    const { type, payload } = rtc.lastMessage;
    if (type === 'game_delta_batch') {
      applyDeltas(payload as GameDelta[]);
    } else if (type === 'client_stats_update' && isGameHost) { // Host processes stats
      applyDeltas([[DeltaType.CLIENT_STATS_UPDATE, payload]]);
    }
  }, [rtc?.lastMessage, isGameHost, applyDeltas]);

  const handleGameEnd = useCallback(async (result: GameResult) => {
    if (gameId && isGameHost) {
        if(gameStatus === 'gameover') return;
      const logCollectionRef = collection(db, `games/${gameId}/game_logs`);
      const logData = {
          ...result,
          timestamp: serverTimestamp(),
          hostPacketsPerSecond,
          hostBytesSentPerSecond,
          clientPacketsPerSecond,
          clientBytesReceivedPerSecond,
          averagePacketSize,
          enemyCount: enemies.length,
          towerCount: Object.keys(towersByCell).length,
          fps,
      };
      await addDoc(logCollectionRef, logData);
      await updateDoc(doc(db, 'games', gameId), { gameStatus: 'gameover' });
    }
  }, [gameId, isGameHost, gameStatus, hostPacketsPerSecond, hostBytesSentPerSecond, clientPacketsPerSecond, clientBytesReceivedPerSecond, averagePacketSize, enemies.length, Object.keys(towersByCell).length, fps]);
  
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
      applyDeltas={applyDeltas}
      onGameEnd={handleGameEnd}
      onExit={() => router.push('/')}
      handlePlaceTower={handlePlaceTower}
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
      hostPacketsPerSecond={hostPacketsPerSecond}
      hostBytesSentPerSecond={hostBytesSentPerSecond}
      clientPacketsPerSecond={clientPacketsPerSecond}
      clientBytesReceivedPerSecond={clientBytesReceivedPerSecond}
      averagePacketSize={averagePacketSize}
      finalGameResult={finalGameResult}
    />
  );
}

export default CoopGame;
