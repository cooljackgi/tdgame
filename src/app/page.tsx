
// src/app/page.tsx
"use client";

import { useState, useEffect, useCallback, Suspense, lazy } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Gem, Swords, Users, LogIn, Loader2, Play, BookOpen, BarChart2, TestTube2, Github } from 'lucide-react';
import type { Difficulty, GameSaveState } from '@/lib/game-data/types';
import { LOCAL_STORAGE_KEY, difficultyModifiers } from '@/lib/game-data/constants';
import { onAuthStateChanged, signInWithGoogle, logOut, type User } from '@/lib/firebase';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';

// Lazy-loaded components
const SinglePlayerGame = lazy(() => import('@/components/game/single-player-game'));
const Lobby = lazy(() => import('@/components/game/lobby'));

export default function Home() {
  const [difficulty, setDifficulty] = useState<Difficulty>('Normal');
  const [savedGame, setSavedGame] = useState<GameSaveState | null>(null);
  const [activeGame, setActiveGame] = useState<"singleplayer" | "coop" | null>(null);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [showCheats, setShowCheats] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  
  const { toast } = useToast();

  useEffect(() => {
    try {
      const savedData = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (savedData) {
        setSavedGame(JSON.parse(savedData));
      }
    } catch (e) {
      console.error("Failed to parse saved game data.", e);
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.key === 'c') {
        setShowCheats(prev => !prev);
        toast({ title: `Chaos-Modus ${!showCheats ? 'aktiviert' : 'deaktiviert'}` });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showCheats, toast]);

  const startGame = useCallback((mode: "singleplayer" | "coop") => {
    setActiveGame(mode);
    setShowTutorial(false);
  }, []);
  
  const startTutorial = useCallback(() => {
    setActiveGame('singleplayer');
    setShowTutorial(true);
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

      const gameDocRef = await addDoc(collection(db, "games"), {
        gameName: gameName,
        player1Id: user.uid,
        player2Id: null,
        members: { [user.uid]: true },
        difficulty: difficulty,
        players: {
            player1: { 
                id: 'player1',
                name: user.displayName || 'Spieler 1',
                avatarUrl: user.photoURL || null,
                resources: difficultyMod.startResources,
                unlockedElements: ['neutral']
            },
            player2: null
        },
        gameState: { lives: difficultyMod.startLives },
        gameStatus: 'waiting',
        currentWave: 0,
        isIntermission: true,
        waveStartCountdown: 999, // Some large number, lobby will control start
        createdAt: serverTimestamp(),
        towersByCell: {},
        lastDeltaTimestamp: null,
        delta: {},
      });
      
      setActiveGame('coop');
      // Directly navigate to the new game page
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

  const clearSavedGame = () => {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
    setSavedGame(null);
  };
  
  const renderContent = () => {
    if (activeGame === 'singleplayer') {
      return (
        <Suspense fallback={<div className="flex justify-center items-center h-full"><Loader2 className="h-16 w-16 animate-spin text-primary" /></div>}>
          <SinglePlayerGame 
            difficulty={difficulty}
            onExit={() => setActiveGame(null)}
            initialSavedGame={savedGame}
            isCheating={showCheats}
            startWithTutorial={showTutorial}
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
    
    // Main Menu
    return (
      <Card className="w-full max-w-lg border-white/10 bg-card/70 backdrop-blur-sm">
        <CardHeader className="items-center text-center">
          <Gem className="h-12 w-12 text-primary drop-shadow-[0_0_8px_hsl(var(--primary))]" />
          <CardTitle className="text-4xl font-bold tracking-tighter pt-2">Elementarer Nexus</CardTitle>
          <CardDescription>Ein Tower-Defense-Spiel der Elemente.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
            <div className="space-y-4">
                 <div className="space-y-2">
                    <label className="text-sm font-medium">Schwierigkeit</label>
                    <Select onValueChange={(val: Difficulty) => setDifficulty(val)} defaultValue={difficulty}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                        {Object.keys(difficultyModifiers).map(d => (
                            <SelectItem key={d} value={d}>{d}</SelectItem>
                        ))}
                        </SelectContent>
                    </Select>
                </div>
                
                 {savedGame && (
                     <Card className="p-4 bg-primary/10 border-primary/20">
                        <div className="flex justify-between items-center">
                            <div>
                               <p className="font-semibold">Gespeichertes Spiel</p>
                               <p className="text-xs text-muted-foreground">Welle {savedGame.currentWave + 1} - {savedGame.difficulty}</p>
                            </div>
                            <div className="flex gap-2">
                               <Button onClick={() => startGame('singleplayer')} size="sm"><Play className="mr-2"/>Fortsetzen</Button>
                               <Button onClick={clearSavedGame} variant="destructive" size="sm">Löschen</Button>
                            </div>
                        </div>
                     </Card>
                 )}

                 <Button onClick={startTutorial} variant="outline" className="w-full">
                   <BookOpen className="mr-2"/> Tutorial starten
                 </Button>
                <Button onClick={() => startGame('singleplayer')} className="w-full" size="lg" disabled={!!savedGame}>
                  <Swords className="mr-2" /> Neues Einzelspieler-Spiel
                </Button>
                
                {user ? (
                   <Button onClick={() => startGame('coop')} className="w-full" size="lg">
                    <Users className="mr-2" /> Multiplayer-Lobby
                  </Button>
                ) : (
                  <Button onClick={handleLogin} variant="secondary" className="w-full" size="lg">
                    {loading ? <Loader2 className="mr-2 animate-spin"/> : <LogIn className="mr-2" />}
                    Mit Google anmelden für Multiplayer
                  </Button>
                )}
            </div>

            <div className="flex justify-center items-center gap-4">
              <Link href="/balancing">
                 <Button variant="ghost" size="sm"><BarChart2 className="mr-2"/>Balancing</Button>
              </Link>
               <Link href="/explainer">
                 <Button variant="ghost" size="sm"><BookOpen className="mr-2"/>Wiki</Button>
              </Link>
               <Link href="/admin/coop-test">
                 <Button variant="ghost" size="sm"><TestTube2 className="mr-2"/>Koop-Test</Button>
              </Link>
            </div>
             <div className="text-center mt-4">
              <a href="https://github.com/firebase/firebase-studio" target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-foreground flex items-center justify-center gap-2">
                <Github className="h-4 w-4"/>
                Powered by Firebase Studio
              </a>
            </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 bg-gradient-to-br from-background to-slate-900/50 text-foreground">
      {renderContent()}
    </main>
  );
}

    