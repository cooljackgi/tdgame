'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import type { User } from 'firebase/auth';
import { onAuthStateChanged, auth, functions } from '@/lib/firebase';
import { doc, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { normalizePlayers } from '@/lib/player-utils';
import type { Player, GameState, GameStatus, PlacedTower, Difficulty, GameDelta, Tower } from '@/lib/game-data/types';
import { INTERMISSION_TIME, difficultyModifiers } from '@/lib/game-data/constants';
import { httpsCallable } from 'firebase/functions';
import { Loader2 } from 'lucide-react';
import { GameSession } from './game-session';
import { towers as initialTowers } from '@/lib/game-data/towers';


export default function CoopGameLoader() {
  const { gameId } = useParams<{ gameId: string }>();
  const router = useRouter();
  const { toast } = useToast();
  
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const [players, setPlayers] = useState<Player[]>([]);
  const [gameState, setGameState] = useState<GameState>({ lives: 20 });
  const [towersByCell, setTowersByCell] = useState<Record<string, PlacedTower>>({});
  const [currentWave, setCurrentWave] = useState(0);
  const [gameStatus, setGameStatus] = useState<GameStatus>('waiting');
  const [isIntermission, setIsIntermission] = useState(true);
  const [waveStartCountdown, setWaveStartCountdown] = useState(INTERMISSION_TIME);
  const [enemies] = useState<any[]>([]); 
  const [difficulty, setDifficulty] = useState<Difficulty>('Normal');
  const [localPlayerId, setLocalPlayerId] = useState<'player1' | 'player2' | 'spectator' | null>(null);
  
  const isGameHost = useMemo(() => localPlayerId === 'player1', [localPlayerId]);

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
  

  const onLocalAction = useCallback((action: 'build' | 'upgrade' | 'sell', payload: any) => {
    // This is a placeholder for coop action sending logic
  }, []);
  
  if (loading || !localPlayerId || players.length === 0) {
    return <div className="w-full h-full flex items-center justify-center bg-background"><Loader2 className="h-16 w-16 animate-spin text-primary" /> <p className="ml-4 text-lg">Verbinde mit Spiel...</p></div>;
  }
  
  const activeUser = user || { displayName: 'Spieler', photoURL: null, uid: 'unknown-uid' };

  return (
    <GameSession 
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
        onLocalAction={onLocalAction}
        allTowers={initialTowers}
    />
  );
}