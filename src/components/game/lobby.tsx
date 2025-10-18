
"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Users, Play, Eye, Trash, Swords } from 'lucide-react';
import type { User } from 'firebase/auth';
import { collection, query, where, onSnapshot, orderBy, updateDoc, doc } from 'firebase/firestore';
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
  const [games, setGames] = useState<GameLobbyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [joiningGameId, setJoiningGameId] = useState<string | null>(null);
  const router = useRouter();
  const { toast } = useToast();
  
  useEffect(() => {
    const gamesQuery = query(
      collection(db, 'games'),
      where('gameStatus', 'in', ['waiting', 'playing']),
      orderBy('gameStatus', 'asc'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(gamesQuery, (snapshot) => {
      const gamesList: GameLobbyInfo[] = snapshot.docs.map(doc => {
        const data = doc.data();
        const player1 = data.players?.player1 || null;
        const player2 = data.players?.player2 || null;

        return {
          id: doc.id,
          gameName: data.gameName || `Spiel ${doc.id.substring(0, 5)}`,
          player1,
          player2,
          player1Id: data.player1Id || null,
          gameStatus: data.gameStatus,
        };
      });
      setGames(gamesList);
      setLoading(false);
    }, (error) => {
        console.error("Error fetching lobby games:", error);
        setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleJoinGame = async (gameId: string) => {
    setJoiningGameId(gameId);
    try {
      const joinGameCallable = httpsCallable(functions, 'joinGame');
      await joinGameCallable({ gameId });
      // The joinGame function now sets the state, we can navigate directly
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
        // Set the game to playing and start the first intermission
        await updateDoc(gameRef, { 
            gameStatus: 'playing',
            isIntermission: true,
            waveStartCountdown: INTERMISSION_TIME 
        });
        // Navigate the host to the game page
        router.push(`/game/${gameId}`);
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
        {games.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">Keine offenen Spiele gefunden. Erstelle ein neues, um zu beginnen!</p>
        ) : (
          <ul className="space-y-4">
            {games.map(game => {
              const player1 = game.player1;
              const player2 = game.player2;
              const isFull = !!player2;
              const isCreator = game.player1Id === currentUser.uid;
              const isJoiningThisGame = joiningGameId === game.id;
              const isPlaying = game.gameStatus === 'playing';

              return (
                <li key={game.id} className="flex items-center justify-between p-3 bg-background/50 rounded-md border border-white/5">
                  <div>
                    <p className="font-semibold">{game.gameName}</p>
                    <p className="text-sm text-muted-foreground flex items-center">
                      {player1?.avatarUrl && <img src={player1.avatarUrl} alt="P1" className="h-5 w-5 rounded-full mr-1"/>}
                      {player1?.name || 'Spieler 1'} vs.
                      {player2 ? <>{player2.avatarUrl && <img src={player2.avatarUrl} alt="P2" className="h-5 w-5 rounded-full ml-1 mr-1"/>} {player2.name}</> : ' Wartet...'}
                      <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${isPlaying ? 'bg-primary/20 text-primary' : 'bg-amber-500/20 text-amber-400'}`}>
                        {isPlaying ? 'Läuft' : 'Wartet'}
                      </span>
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {isPlaying ? (
                        (isCreator || (player2 && player2.id === currentUser.uid)) ? (
                            <Button onClick={() => router.push(`/game/${game.id}`)} variant="outline">
                                <Play className="mr-2" /> Zurück zum Spiel
                            </Button>
                        ) : (
                             <Button onClick={() => handleSpectateGame(game.id)} variant="secondary">
                                <Eye className="mr-2" /> Zuschauen
                            </Button>
                        )
                    ) : (
                        isCreator ? (
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
                        )
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
