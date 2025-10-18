"use client";

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Users, Play, Eye, Trash, Swords } from 'lucide-react';
import type { User } from 'firebase/auth';
import { collection, query, where, onSnapshot, orderBy, updateDoc, doc, limit } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { Player } from '@/lib/game-data/types';
import { INTERMISSION_TIME } from '@/lib/game-data/constants';

type GameLobbyInfo = {
  id: string;
  gameName: string;
  player1: Player | null;
  player2: Player | null;
  player1Id: string | null;
  gameStatus: 'waiting' | 'playing' | 'gameover' | 'archived';
};

const Lobby = ({ currentUser, onNewGame }: { currentUser: User, onNewGame: () => void }) => {
  const [openGames, setOpenGames] = useState<GameLobbyInfo[]>([]);
  const [activeUserGameId, setActiveUserGameId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [joiningGameId, setJoiningGameId] = useState<string | null>(null);
  const router = useRouter();
  const { toast } = useToast();
  const didRedirectRef = useRef(false);
  
  // Stream 1: List ONLY open games for players to join
  useEffect(() => {
    const gamesQuery = query(
      collection(db, 'games'),
      where('gameStatus', '==', 'waiting'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(gamesQuery, (snapshot) => {
      const gamesList: GameLobbyInfo[] = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          gameName: data.gameName || `Spiel ${doc.id.substring(0, 5)}`,
          player1: data.players?.player1 || null,
          player2: data.players?.player2 || null,
          player1Id: data.player1Id || null,
          gameStatus: data.gameStatus,
        };
      });
      setOpenGames(gamesList);
      setLoading(false);
    }, (error) => {
        console.error("Error fetching open lobby games:", error);
        setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Stream 2: Find if the current user is ALREADY in a game (waiting or playing)
  useEffect(() => {
      if (!currentUser?.uid) return;

      // This query finds the single active game the user is a member of.
      const userGamesQuery = query(
        collection(db, 'games'),
        where('members', 'array-contains', currentUser.uid),
        where('gameStatus', 'in', ['waiting', 'playing']),
        orderBy('createdAt', 'desc'),
        limit(1)
      );
      
      const unsubscribe = onSnapshot(userGamesQuery, (snapshot) => {
          if (!snapshot.empty) {
              const gameDoc = snapshot.docs[0];
              setActiveUserGameId(gameDoc.id);
          } else {
              setActiveUserGameId(null);
          }
      });
      
      return () => unsubscribe();
  }, [currentUser.uid]);
  
  // Stream 3: Listen to the specific active game and redirect if it starts
  useEffect(() => {
    if (!activeUserGameId || !currentUser.uid) return;
    
    const unsub = onSnapshot(doc(db, 'games', activeUserGameId), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      
      const isMember = data.members && Object.prototype.hasOwnProperty.call(data.members, currentUser.uid);
      if (!isMember) return;

      // If the game status changes to playing, redirect.
      if (data.gameStatus === 'playing' && !didRedirectRef.current) {
        didRedirectRef.current = true; // Prevents multiple redirects
        toast({ title: "Spiel startet!", description: "Du wirst zum Spiel weitergeleitet..."});
        router.push(`/game/${activeUserGameId}`);
      }
    });

    return () => unsub();
  }, [activeUserGameId, currentUser.uid, router, toast]);


  const handleJoinGame = async (gameId: string) => {
    setJoiningGameId(gameId);
    try {
      const joinGameCallable = httpsCallable(functions, 'joinGame');
      await joinGameCallable({ gameId });
      // After successfully joining, immediately navigate.
      // The listeners will handle picking up the game state on the game page.
      router.push(`/game/${gameId}`);
    } catch (error: any) {
      console.error("Failed to join game:", error);
      toast({
        title: "Beitritt fehlgeschlagen",
        description: error.message || "Das Spiel ist möglicherweise voll oder existiert nicht mehr.",
        variant: "destructive",
      });
       setJoiningGameId(null);
    }
  };

  const handleStartGame = async (gameId: string) => {
    try {
        const gameRef = doc(db, 'games', gameId);
        // Atomically set the game to playing and start the first intermission
        await updateDoc(gameRef, { 
            gameStatus: 'playing',
            isIntermission: true,
            waveStartCountdown: INTERMISSION_TIME 
        });
        // Host is redirected by the same listener as P2
    } catch (error: any) {
        toast({ title: "Starten fehlgeschlagen", description: error.message, variant: "destructive" });
    }
  };

  const handleSpectateGame = (gameId: string) => {
    router.push(`/game/${gameId}`);
  };

  const handleArchiveGame = async (gameId: string) => {
      try {
        const archiveGameCallable = httpsCallable(functions, 'archiveGame');
        await archiveGameCallable({ gameId });
        toast({ title: "Spiel archiviert", description: "Das Spiel wurde aus der Lobby entfernt."});
      } catch (error: any) {
        console.error("Error archiving game:", error);
        toast({ title: "Archivieren fehlgeschlagen", description: error.message || "Das Spiel konnte nicht archiviert werden.", variant: "destructive" });
      }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center mt-8">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        <p>Lade Lobby...</p>
      </div>
    );
  }

  return (
    <Card className="mt-8 text-left max-w-2xl mx-auto border-white/10 bg-card/70 backdrop-blur-sm">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-xl">Multiplayer-Lobby</CardTitle>
        <Button onClick={onNewGame}>
            <Swords className="mr-2"/> Neues Spiel
        </Button>
      </CardHeader>
      <CardContent>
        {openGames.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">Keine offenen Spiele gefunden. Erstelle ein neues, um zu beginnen!</p>
        ) : (
          <ul className="space-y-4">
            {openGames.map(game => {
              const player1 = game.player1;
              const player2 = game.player2;
              const isFull = !!player2;
              const isCreator = game.player1Id === currentUser.uid;
              const isJoiningThisGame = joiningGameId === game.id;
              
              return (
                <li key={game.id} className="flex items-center justify-between p-3 bg-background/50 rounded-md border border-white/5">
                  <div>
                    <p className="font-semibold">{game.gameName}</p>
                    <p className="text-sm text-muted-foreground flex items-center">
                      {player1?.avatarUrl && <img src={player1.avatarUrl} alt="P1" className="h-5 w-5 rounded-full mr-1"/>}
                      {player1?.name || 'Spieler 1'} vs.
                      {player2 ? <>{player2.avatarUrl && <img src={player2.avatarUrl} alt="P2" className="h-5 w-5 rounded-full ml-1 mr-1"/>} {player2.name}</> : ' Wartet...'}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    { isCreator ? (
                         <Button onClick={() => handleStartGame(game.id)} disabled={!isFull}>
                            <Play className="mr-2" /> {!isFull ? 'Warte auf P2...' : 'Starten'}
                        </Button>
                    ) : !isFull ? (
                         <Button onClick={() => handleJoinGame(game.id)} disabled={isJoiningThisGame}>
                            {isJoiningThisGame ? <Loader2 className="mr-2 animate-spin" /> : <Users className="mr-2" />}
                            {isJoiningThisGame ? 'Beitreten...' : 'Beitreten'}
                        </Button>
                    ) : (
                         <p className="text-sm text-muted-foreground">Spiel voll</p>
                    )}
                    
                    {isCreator && (
                       <AlertDialog>
                        <AlertDialogTrigger asChild>
                           <Button variant="destructive" size="icon">
                              <Trash className="h-4 w-4" />
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Spiel archivieren?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Das Spiel wird aus der öffentlichen Lobby entfernt, aber die Daten bleiben für die Analyse erhalten.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleArchiveGame(game.id)}>
                              Archivieren
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default Lobby;
