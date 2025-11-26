
"use client";

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Users, Play, Eye, Trash, Swords, RefreshCw } from 'lucide-react';
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
import { Separator } from '../ui/separator';

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
  const [activeGame, setActiveGame] = useState<GameLobbyInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [joiningGameId, setJoiningGameId] = useState<string | null>(null);
  const router = useRouter();
  const { toast } = useToast();
  const didRedirectRef = useRef(false);
  
  useEffect(() => {
    // Corrected query: Only show games that are waiting AND have no player 2
    const gamesQuery = query(
      collection(db, 'games'),
      where('gameStatus', '==', 'waiting'),
      where('player2Id', '==', null), 
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
      }).filter(game => game.player1Id !== currentUser.uid); // Still filter out user's own games from join list
      
      setOpenGames(gamesList);
      setLoading(false);
    }, (error) => {
        console.error("Error fetching open lobby games:", error);
        setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser.uid]);

  useEffect(() => {
      if (!currentUser?.uid) return;

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
              const data = gameDoc.data();
              const gameData = {
                 id: gameDoc.id,
                 gameName: data.gameName || `Spiel ${gameDoc.id.substring(0, 5)}`,
                 player1: data.players?.player1 || null,
                 player2: data.players?.player2 || null,
                 player1Id: data.player1Id || null,
                 gameStatus: data.gameStatus,
              };
              setActiveGame(gameData);
          } else {
              setActiveGame(null);
          }
      });
      
      return () => unsubscribe();
  }, [currentUser.uid, router, toast]);
  
  useEffect(() => {
    if (!activeGame || !currentUser.uid) return;
    
    // This listener handles the automatic redirection for the HOST when P2 joins.
    const unsub = onSnapshot(doc(db, 'games', activeGame.id), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      
      const isMyGame = Array.isArray(data.members) && data.members.includes(currentUser.uid);
      if (!isMyGame) return;

      if (data.gameStatus === 'playing' && !didRedirectRef.current) {
        didRedirectRef.current = true;
        toast({ title: "Spiel startet!", description: "Du wirst zum Spiel weitergeleitet..."});
        router.push(`/game/${activeGame.id}`);
      }
    });

    return () => unsub();
  }, [activeGame, currentUser.uid, router, toast]);


  const handleJoinGame = async (gameId: string) => {
    setJoiningGameId(gameId);
    try {
      const joinGameCallable = httpsCallable(functions, 'joinGame');
      await joinGameCallable({ gameId });
      toast({ title: "Beitritt erfolgreich!", description: "Du wirst zum Spiel weitergeleitet..." });
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
        await updateDoc(gameRef, { 
            gameStatus: 'playing',
            isIntermission: true,
            waveStartCountdown: INTERMISSION_TIME 
        });
        // The host will be redirected by the useEffect listener that watches for 'playing' status.
    } catch (error: any) {
        toast({ title: "Starten fehlgeschlagen", description: error.message, variant: "destructive" });
    }
  };

  const handleRejoinGame = (gameId: string) => {
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

  const isCreatorOfActiveGame = activeGame?.player1Id === currentUser.uid;

  return (
    <div className="mt-8 text-left max-w-2xl mx-auto space-y-6">
        {activeGame && (
             <Card className="border-primary/50 bg-primary/10 animate-fade-in">
                <CardHeader>
                    <CardTitle className="text-lg">Dein aktives Spiel</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                     <p className="font-semibold">{activeGame.gameName}</p>
                     <p className="text-sm text-muted-foreground flex items-center">
                      {activeGame.player1?.avatarUrl && <img src={activeGame.player1.avatarUrl} alt="P1" className="h-5 w-5 rounded-full mr-1"/>}
                      {activeGame.player1?.name || 'Spieler 1'} vs.
                      {activeGame.player2 ? <>{activeGame.player2.avatarUrl && <img src={activeGame.player2.avatarUrl} alt="P2" className="h-5 w-5 rounded-full ml-1 mr-1"/>} {activeGame.player2.name}</> : ' Wartet...'}
                    </p>
                    <div className="flex gap-2">
                        {isCreatorOfActiveGame && activeGame.gameStatus === 'waiting' ? (
                             <Button onClick={() => handleStartGame(activeGame.id)} disabled={!activeGame.player2} className="flex-1">
                                <Play className="mr-2" /> {!activeGame.player2 ? 'Warte auf P2...' : 'Jetzt Starten'}
                            </Button>
                        ) : (
                             <Button onClick={() => handleRejoinGame(activeGame.id)} className="flex-1">
                                <RefreshCw className="mr-2" /> Wieder beitreten
                            </Button>
                        )}
                       <AlertDialog>
                        <AlertDialogTrigger asChild>
                           <Button variant="destructive" size="icon">
                              <Trash className="h-4 w-4" />
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Spiel verlassen & archivieren?</AlertDialogTitle>
                            <AlertDialogDescription>
                                Das Spiel wird aus der öffentlichen Lobby entfernt und beendet. Diese Aktion kann nicht rückgängig gemacht werden.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleArchiveGame(activeGame.id)}>
                              Verlassen & Archivieren
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                </CardContent>
             </Card>
        )}

        <Card className="border-white/10 bg-card/70 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-xl">Offene Spiele</CardTitle>
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
                  const isJoiningThisGame = joiningGameId === game.id;
                  
                  return (
                    <li key={game.id} className="flex items-center justify-between p-3 bg-background/50 rounded-md border border-white/5">
                      <div>
                        <p className="font-semibold">{game.gameName}</p>
                        <p className="text-sm text-muted-foreground flex items-center">
                          {player1?.avatarUrl && <img src={player1.avatarUrl} alt="P1" className="h-5 w-5 rounded-full mr-1"/>}
                          {player1?.name || 'Spieler 1'} vs. ...
                        </p>
                      </div>
                      <div className="flex gap-2">
                         <Button onClick={() => handleJoinGame(game.id)} disabled={isJoiningThisGame}>
                            {isJoiningThisGame ? <Loader2 className="mr-2 animate-spin" /> : <Users className="mr-2" />}
                            {isJoiningThisGame ? 'Beitreten...' : 'Beitreten'}
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
    </Card>
  </div>
  );
};

export default Lobby;
