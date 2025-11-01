
// src/app/page.tsx
"use client";

import { useState, useEffect, useCallback, Suspense, lazy } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Gem, Swords, Users, LogIn, Loader2, Play, BookOpen, BarChart2, Github, Trophy, HelpCircle, Gamepad2, Trash2, LogOut } from 'lucide-react';
import type { Difficulty, GameSaveState, Player } from '@/lib/game-data/types';
import { LOCAL_STORAGE_KEY, difficultyModifiers } from '@/lib/game-data/constants';
import { onAuthStateChanged, signInWithGoogle, logOut, type User, auth } from '@/lib/firebase';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';
import { Separator } from '@/components/ui/separator';

const SinglePlayerGame = lazy(() => import('@/components/game/single-player-game'));
const Lobby = lazy(() => import('@/components/game/lobby'));

export default function Home() {
  const [difficulty, setDifficulty] = useState<Difficulty>('Normal');
  const [savedGame, setSavedGame] = useState<GameSaveState | null>(null);
  const [activeGame, setActiveGame] = useState<"singleplayer" | "coop" | null>(null);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [loadSavedGame, setLoadSavedGame] = useState(false);
  const [startTutorial, setStartTutorial] = useState(false);
  
  const { toast } = useToast();

  useEffect(() => {
    // Universal save game check, independent of difficulty
    try {
      const savedData = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (savedData) {
        setSavedGame(JSON.parse(savedData));
      } else {
        setSavedGame(null);
      }
    } catch (e) {
      console.error("Failed to parse saved game data.", e);
      setSavedGame(null);
    }
  }, []); 

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const startGame = useCallback((
      mode: "singleplayer" | "coop", 
      shouldLoadSaved: boolean = false, 
      isTutorial: boolean = false
  ) => {
    setLoadSavedGame(shouldLoadSaved);
    setStartTutorial(isTutorial);
    if (isTutorial) setDifficulty('Einfach');
    setActiveGame(mode);
  }, []);


  const handleNewCoopGame = useCallback(async () => {
    if (!user) {
      toast({ title: 'Anmeldung erforderlich', description: 'Bitte melde dich an, um ein Multiplayer-Spiel zu erstellen.', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const gameName = `${user.displayName}'s Spiel`;
      const difficultyMod = difficultyModifiers[difficulty];

      const player1: Player = { 
          id: 'player1',
          name: user.displayName || 'Spieler 1',
          avatarUrl: user.photoURL || null,
          resources: difficultyMod.startResources,
          unlockedElements: ['neutral'],
          incomePerSecond: 5,
          portalCooldownUntilWave: 0
      };

      const gameDocRef = await addDoc(collection(db, "games"), {
        gameName: gameName,
        player1Id: user.uid,
        player2Id: null,
        members: { [user.uid]: true },
        difficulty: difficulty,
        players: { player1: player1, player2: null },
        gameState: { lives: difficultyMod.startLives },
        gameStatus: 'waiting',
        currentWave: 0,
        isIntermission: true,
        waveStartCountdown: 999,
        createdAt: serverTimestamp(),
        towersByCell: {},
        lastDeltaTimestamp: null,
        delta: {},
      });
      
      setActiveGame('coop');
      window.location.href = `/game/${gameDocRef.id}`;

    } catch (error: any) {
      toast({ title: 'Fehler beim Erstellen des Spiels', description: error.message, variant: 'destructive' });
      setLoading(false);
    }
  }, [user, difficulty, toast]);

  const handleLogin = async () => {
    try {
      await signInWithGoogle();
    } catch (error) {
      toast({ title: 'Anmeldefehler', description: 'Die Anmeldung mit Google ist fehlgeschlagen.', variant: 'destructive' });
      console.error(error);
    }
  };
  
  const handleLogout = async () => {
    try {
      await logOut();
      toast({ title: 'Erfolgreich abgemeldet.' });
    } catch (error) {
      toast({ title: 'Abmeldefehler', description: 'Die Abmeldung ist fehlgeschlagen.', variant: 'destructive' });
      console.error(error);
    }
  };

  const clearSavedGame = () => {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
    setSavedGame(null);
    toast({title: 'Spielstand gelöscht!'});
  };
  
  const renderContent = () => {
    if (activeGame === 'singleplayer') {
      return (
        <Suspense fallback={<div className="flex justify-center items-center h-full"><Loader2 className="h-16 w-16 animate-spin text-primary" /></div>}>
          <SinglePlayerGame 
            difficulty={difficulty}
            onExit={() => setActiveGame(null)}
            initialSavedGame={loadSavedGame ? savedGame : null}
            startWithTutorial={startTutorial}
            user={user}
          />
        </Suspense>
      );
    }

    if (activeGame === 'coop') {
      if (loading || !user) {
        return (
          <div className="flex flex-col items-center justify-center text-center p-4">
            <Loader2 className="h-8 w-8 animate-spin mb-4" />
            <p>Verbinde mit Lobby...</p>
          </div>
        );
      }
      return (
        <>
            <Button onClick={() => setActiveGame(null)} className="absolute top-6 left-6 z-10">Zurück zum Menü</Button>
            <Suspense fallback={<div className="flex justify-center items-center h-full"><Loader2 className="h-16 w-16 animate-spin text-primary" /></div>}>
              <Lobby currentUser={user} onNewGame={handleNewCoopGame} />
            </Suspense>
        </>
      );
    }
    
    return (
        <div className="w-full max-w-6xl mx-auto space-y-8">
            <div className="text-center space-y-2">
                <h1 className="text-4xl md:text-5xl font-bold tracking-tighter bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                    Elementarer Nexus
                </h1>
                <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                    Ein strategisches Koop-Tower-Defense-Spiel. Verteidige den Nexus allein oder mit einem Freund gegen Wellen von Gegnern.
                </p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                
                <Card>
                    <CardHeader>
                        <CardTitle>Einzelspieler</CardTitle>
                        <CardDescription>Spiele alleine und teste deine Fähigkeiten.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div>
                            <label className="text-sm font-medium mb-2 block">Schwierigkeit</label>
                             <Select onValueChange={(val: Difficulty) => setDifficulty(val)} defaultValue={difficulty}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                {Object.keys(difficultyModifiers).map(d => (
                                    <SelectItem key={d} value={d}>{d}</SelectItem>
                                ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <Button onClick={() => startGame('singleplayer')} className="w-full" size="lg">
                            <Play className="mr-2" /> Neues Spiel starten
                        </Button>
                        {savedGame && (
                           <div className="space-y-2">
                            <Button 
                                onClick={() => startGame('singleplayer', true)}
                                variant="outline" 
                                className="w-full"
                            >
                                <Gamepad2 className="mr-2" /> Spielstand laden (Welle {savedGame.currentWave + 1})
                            </Button>
                             <Button onClick={clearSavedGame} variant="link" size="sm" className="w-full text-muted-foreground hover:text-destructive">
                                <Trash2 className="mr-2 h-4 w-4"/>
                                Spielstand löschen
                            </Button>
                           </div>
                        )}
                    </CardContent>
                </Card>
                
                <Card>
                    <CardHeader>
                        <CardTitle>Multiplayer & Tools</CardTitle>
                        <CardDescription>Spiele mit Freunden oder analysiere das Spiel.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        {user ? (
                           <div className="flex gap-2">
                             <Button onClick={() => startGame('coop')} className="w-full bg-cyan-500 hover:bg-cyan-600 text-white">
                               <Users className="mr-2" /> Zur Lobby
                             </Button>
                             <Button onClick={handleLogout} variant="outline" size="icon">
                               <LogOut />
                             </Button>
                           </div>
                        ) : (
                           <Button onClick={handleLogin} variant="secondary" className="w-full">
                            {loading ? <Loader2 className="mr-2 animate-spin"/> : <LogIn className="mr-2" />}
                            Anmelden für Multiplayer
                          </Button>
                        )}
                        <Separator className="my-2" />
                         <Link href="/admin/analytics" className="w-full block">
                            <Button variant="outline" className="w-full"><BarChart2 className="mr-2"/> Analyse-Dashboard</Button>
                        </Link>
                         <Link href="/balancing" className="w-full block">
                            <Button variant="outline" className="w-full"><BarChart2 className="mr-2"/> Turm-Dashboard</Button>
                        </Link>
                         <Link href="/balancing/waves" className="w-full block">
                            <Button variant="outline" className="w-full"><BarChart2 className="mr-2"/> Wellen-Dashboard</Button>
                        </Link>
                    </CardContent>
                </Card>
                
                <Card>
                    <CardHeader>
                        <CardTitle>Spielanleitung</CardTitle>
                        <CardDescription>Lerne die Grundlagen und sieh deine Erfolge.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2">
                         <Link href="/explainer" className="w-full block">
                            <Button variant="outline" className="w-full"><HelpCircle className="mr-2"/> Anleitung ansehen</Button>
                        </Link>
                         <Link href="/scoreboard" className="w-full block">
                            <Button variant="outline" className="w-full"><Trophy className="mr-2"/> Scoreboard</Button>
                        </Link>
                        <Button onClick={() => startGame('singleplayer', false, true)} variant="outline" className="w-full">
                           <BookOpen className="mr-2"/> Tutorial starten
                        </Button>
                    </CardContent>
                </Card>
            </div>
             <div className="text-center mt-4">
              <p className="text-xs text-muted-foreground">
                Programmiert mit viel Erinnerung und 'Arbeit, Arbeit!'
              </p>
            </div>
        </div>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 bg-gradient-to-br from-background to-slate-900/50 text-foreground">
      {renderContent()}
    </main>
  );
}
