

"use client";

import GameSession from "@/components/game/game-session";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { onAuthStateChanged, auth, functions } from "@/lib/firebase";
import { doc, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useWebRTC } from '@/hooks/use-webrtc';
import { useToast } from '@/hooks/use-toast';
import { normalizePlayers } from '@/lib/player-utils';
import type { User } from "firebase/auth";
import type { Player, GameState, GameStatus, PlacedTower, Attack, DamageNumber, SplashRing, GameResult, Difficulty, GameDelta, Tower } from '@/lib/game-data/types';
import { DeltaType } from "@/lib/game-data/types";
import { INTERMISSION_TIME, difficultyModifiers } from '@/lib/game-data/constants';
import { httpsCallable } from "firebase/functions";
import { Loader2 } from "lucide-react";
import { towers as initialTowers } from '@/lib/game-data/towers';


function CoopGame() {
  const { gameId } = useParams<{ gameId: string }>();
  const router = useRouter();
  const { toast } = useToast();
  
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // --- Core Synced State ---
  const [players, setPlayers] = useState<Player[]>([]);
  const [gameState, setGameState] = useState<GameState>({ lives: 20 });
  const [towersByCell, setTowersByCell] = useState<Record<string, PlacedTower>>({});
  const [currentWave, setCurrentWave] = useState(0);
  const [gameStatus, setGameStatus] = useState<GameStatus>('waiting');
  const [isIntermission, setIsIntermission] = useState(true);
  const [waveStartCountdown, setWaveStartCountdown] = useState(INTERMISSION_TIME);
  const [enemies, setEnemies] = useState<any[]>([]); // Using any for simplicity in coop
  const [spawnedThisWave, setSpawnedThisWave] = useState(0);
  const [difficulty, setDifficulty] = useState<Difficulty>('Normal');

  // --- Local Client State ---
  const [localPlayerId, setLocalPlayerId] = useState<'player1' | 'player2' | 'spectator' | null>(null);
  const isGameHost = useMemo(() => localPlayerId === 'player1', [localPlayerId]);
  
  // --- VFX State ---
  const [attacks, setAttacks] = useState<Attack[]>([]);
  const [damageNumbers, setDamageNumbers] = useState<DamageNumber[]>([]);
  const [splashRings, setSplashRings] = useState<SplashRing[]>([]);
  const [lastUpgradedTowerId, setLastUpgradedTowerId] = useState<string | null>(null);
  const [firingTowerIds, setFiringTowerIds] = useState<Set<string>>(new Set());
  const [finalGameResult, setFinalGameResult] = useState<GameResult | null>(null);
  
  // --- Stats State ---
  const [fps, setFps] = useState(0);
  const [totalKilled, setTotalKilled] = useState(0);
  const [totalLeaked, setTotalLeaked] = useState(0);
  
  const rtc = useWebRTC(gameId, isGameHost, user);

  const applyDeltas = useCallback((deltas: GameDelta[]) => {
    if (deltas.length === 0) return;

    deltas.forEach(delta => {
        const type = delta[0];
        const payload = delta[1];
        switch(type) {
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
             case DeltaType.TOWERS_UPDATE: setTowersByCell(payload); break;
             case DeltaType.PLAYER_UPDATE: setPlayers(prev => prev.map(p => ({...p, ...(payload[p.id] || {})}))); break;
             case DeltaType.ENEMY_SPAWN: setEnemies(prev => [...prev, payload]); break;
             case DeltaType.ENEMY_DIE: setEnemies(prev => prev.filter(e => e.id !== payload)); break;
             // Other delta types can be handled here for VFX, etc.
        }
    });
  }, []);
    
  // Subscribe to Firestore for initial setup and role determination
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
                
                let currentRole: 'player1' | 'player2' | 'spectator' = 'spectator';
                if(gameData.player1Id === uid) currentRole = 'player1';
                else if(gameData.player2Id === uid) currentRole = 'player2';

                if (currentRole === 'spectator' && !gameData.player2Id && !gameData.isTestGame) {
                    try {
                        const joinGameCallable = httpsCallable(functions, 'joinGame');
                        await joinGameCallable({ gameId });
                        toast({ title: "Spiel beigetreten!", description: "Du bist jetzt Spieler 2." });
                        // onSnapshot will re-trigger, so we don't need to do anything else here
                        return;
                    } catch(e: any) {
                       toast({ title: "Beitritt fehlgeschlagen", description: e.message, variant: 'destructive'});
                       router.push('/');
                       return;
                    }
                }

                setLocalPlayerId(currentRole);
                setDifficulty(gameData.difficulty || 'Normal');
                setPlayers(normalizePlayers(gameData.players));
                setGameState(gameData.gameState || { lives: difficultyModifiers[gameData.difficulty || 'Normal'].startLives });
                setGameStatus(gameData.gameStatus || 'waiting');
                setCurrentWave(gameData.currentWave || 0);
                setIsIntermission(gameData.isIntermission ?? true);
                setWaveStartCountdown(gameData.waveStartCountdown ?? INTERMISSION_TIME);
                setTowersByCell(gameData.towersByCell || {});
                
                setLoading(false);
            }, (error) => {
              console.error("Error listening to game document:", error);
              toast({ title: "Verbindung zum Spiel verloren", variant: 'destructive'});
              router.push('/');
            });
            
        } catch (e: any) {
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
  }, [user, gameId, router, toast]);

  // Auth listener
  useEffect(() => {
    const authUnsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
      } else {
         toast({ title: "Authentifizierung erforderlich.", variant: 'destructive' });
         router.push('/');
      }
    });
    return () => authUnsubscribe();
  }, [router, toast]);
  
  // WebRTC message listeners
  useEffect(() => {
    if (!rtc.gameDataChannel) return;
    const handleMessage = (event: MessageEvent) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'game_delta_batch') {
                applyDeltas(data.payload);
            }
        } catch (e) { console.error("Failed to parse game delta", e)}
    }
    rtc.gameDataChannel.addEventListener('message', handleMessage);
    return () => rtc.gameDataChannel?.removeEventListener('message', handleMessage);
  }, [rtc.gameDataChannel, applyDeltas]);

  useEffect(() => {
    if (!rtc.actionsChannel || !isGameHost) return;

    const handleActionMessage = (ev: MessageEvent) => {
        try {
            const m = JSON.parse(ev.data);
            if (m.kind !== 'ACTION') return;

            // Host processes actions from client
            // This part will be implemented in the GameSession component
            // to keep logic centralized. For now, we just log it.
            console.log("[HOST-RECV-ACTION]", m);

        } catch (e) {
            console.error("Failed to handle action message:", e);
        }
    };

    rtc.actionsChannel.addEventListener('message', handleActionMessage);
    return () => rtc.actionsChannel?.removeEventListener('message', handleActionMessage);
  }, [rtc.actionsChannel, isGameHost]);


  const onLocalAction = useCallback((action: 'build' | 'upgrade' | 'sell', payload: any) => {
    if (localPlayerId === 'spectator' || !localPlayerId) return;

    // For build actions, we need to get the currently selected towerId from the document
    if (action === 'build') {
      const towerId = (document as any).__SELECTED_TOWER_ID;
      if (!towerId) return; // Don't send build request if no tower is selected
      payload = { ...payload, towerId };
    }
  
    if (!isGameHost) {
      // Client sends action request to host
        if (!rtc.actionsChannel || rtc.actionsChannel.readyState !== 'open') {
          console.warn('Actions channel not open, cannot send action.');
          return;
        }

        const type = action === 'build' ? String(DeltaType.BUILD_TOWER_REQUEST)
                   : action === 'upgrade' ? String(DeltaType.UPGRADE_TOWER_REQUEST)
                   : String(DeltaType.SELL_TOWER_REQUEST);
        
        const msg = { kind: 'ACTION', type, payload: { ...payload, playerId: localPlayerId } };
        
        rtc.actionsChannel.send(JSON.stringify(msg));
    }
    // If it's the host, the action will be handled inside GameSession directly
  }, [localPlayerId, isGameHost, rtc.actionsChannel]);
  
  if (loading || !localPlayerId || players.length === 0) {
    return <div className="w-full h-full flex items-center justify-center bg-background"><Loader2 className="h-16 w-16 animate-spin text-primary" /> <p className="ml-4 text-lg">Verbinde mit Spiel...</p></div>;
  }
  
  // Use a dummy user if not available, mainly for dev/testing
  const activeUser = user || { displayName: 'Spieler', photoURL: null, uid: 'unknown-uid' };

  return (
    <GameSession 
        // --- Initial State & Config ---
        initialPlayers={players}
        initialGameState={gameState}
        initialTowersByCell={towersByCell}
        initialEnemies={enemies}
        initialCurrentWave={currentWave}
        initialDifficulty={difficulty}
        initialIsIntermission={isIntermission}
        initialWaveStartCountdown={waveStartCountdown}
        isCoop={true}
        isGameHost={isGameHost}
        localPlayerId={localPlayerId}
        user={activeUser as User}
        onExit={() => router.push('/')}

        // --- CO-OP Props ---
        broadcastGameData={() => {}} // Host logic is inside GameSession
        applyDeltas={applyDeltas}
        onGameEnd={() => {}} // Host logic is inside GameSession
        onLocalAction={onLocalAction}

        // --- VFX and Stats (passed down) ---
        damageNumbersFromParent={damageNumbers}
        splashRingsFromParent={splashRings}
        lastUpgradedTowerIdFromParent={lastUpgradedTowerId}
        firingTowerIdsFromParent={firingTowerIds}
        fpsFromParent={fps}
        isWsConnected={rtc.isConnected}
        hostPacketsPerSecond={rtc.sentPacketsPerSecond} hostBytesSentPerSecond={rtc.sentBytesPerSecond}
        clientPacketsPerSecond={rtc.packetsPerSecond} clientBytesReceivedPerSecond={rtc.bytesPerSecond}
        averagePacketSize={rtc.averagePacketSize}
        finalGameResultFromParent={finalGameResult}
        totalKilledFromParent={totalKilled}
        totalLeakedFromParent={totalLeaked}
        allTowers={initialTowers}
    />
  );
}

export default CoopGame;
