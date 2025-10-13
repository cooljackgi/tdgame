
"use client";

import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, orderBy, DocumentData, doc, deleteDoc } from 'firebase/firestore';
import { db, functions } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Users, Eye, Play, Trash } from 'lucide-react';
import type { User } from 'firebase/auth';
import { joinGame } from '@/lib/coop';
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
} from "@/components/ui/alert-dialog"
import type { Player } from '@/lib/game-data/types';
import { httpsCallable } from 'firebase/functions';

type GameLobbyInfo = {
  id: string;
  gameName: string;
  player1: Player | null;
  player2: Player | null;
  player1Id: string | null;
  gameStatus: 'waiting' | 'playing' | 'gameover' | 'archived';
};

type LobbyProps = {
  currentUser: User;
};

export default function Lobby({ currentUser }: LobbyProps) {
  const [games, setGames] = useState<GameLobbyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [joiningGameId, setJoiningGameId] = useState<string | null>(null);
  const router = useRouter();
  const { toast } = useToast();
  
  useEffect(() => {
    // Query now filters out 'archived' and 'gameover' games.
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
      await joinGame(functions, gameId);
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
      <CardHeader>
        <CardTitle className="text-xl">Multiplayer-Lobby</CardTitle>
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
              const isPlayerInGame = game.player1Id === currentUser.uid || player2?.id === currentUser.uid;
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
                      <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${game.gameStatus === 'waiting' ? 'bg-amber-500/20 text-amber-400' : 'bg-primary/20 text-primary'}`}>
                        {game.gameStatus === 'waiting' ? 'Wartet' : 'Läuft'}
                      </span>
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {isPlayerInGame ? (
                       <Button onClick={() => router.push(`/game/${game.id}`)} variant="outline">
                         <Play className="mr-2" /> Zurück ins Spiel
                       </Button>
                    ) : !isFull ? (
                      <Button onClick={() => handleJoinGame(game.id)} disabled={isJoiningThisGame}>
                        {isJoiningThisGame ? <Loader2 className="mr-2 animate-spin" /> : <Users className="mr-2" />}
                        {isJoiningThisGame ? 'Beitreten...' : 'Beitreten'}
                      </Button>
                    ) : (
                      <Button onClick={() => handleSpectateGame(game.id)} variant="secondary">
                        <Eye className="mr-2" /> Zuschauen
                      </Button>
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
