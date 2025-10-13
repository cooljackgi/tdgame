
"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Head from 'next/head';
import { Loader2, Play, Users, Settings, LogIn, LogOut, Swords, Crown, BookOpen, HelpCircle, BarChart2, Waves, Music, AreaChart, TestTube2, Trophy } from 'lucide-react';
import type { User } from 'firebase/auth';
import { onAuthStateChanged, auth, signInWithGoogle, logOut } from '@/lib/firebase';
import { doc, setDoc, serverTimestamp, getDoc, collection, addDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { difficultyModifiers, ALL_PICKABLE_ELEMENTS, LOCAL_STORAGE_KEY } from '@/lib/game-data/constants';
import type { Difficulty, GameSaveState, Element } from '@/lib/game-data/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import Lobby from '@/components/game/lobby';
import SinglePlayerGame from '@/components/game/single-player-game';
import type { Player } from '@/lib/game-data/types';
import Link from 'next/link';
import { normalizePlayers } from '@/lib/player-utils';
import { audioManager } from '@/lib/audio/audio-manager';


type GameMode = 'menu' | 'single' | 'coop-lobby' | 'cheat';


export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [gameMode, setGameMode] = useState<GameMode>('menu');
  const [difficulty, setDifficulty] = useState<Difficulty>('Normal');
  const [creatingGame, setCreatingGame] = useState(false);
  const [savedGame, setSavedGame] = useState<GameSaveState | null>(null);
  const [startWithTutorial, setStartWithTutorial] = useState(false);


  const router = useRouter();
  
  useEffect(() => {
    // Stop any game music when returning to the menu
    audioManager.stopMusic();
  }, []);

  useEffect(() => {
    const handleAuthState = (currentUser: User | null) => {
        if (currentUser) {
            setUser(currentUser);
            setLoading(false);
        } else if (process.env.NODE_ENV === 'development') {
             const devUser: User = {
                uid: 'dev-user-id',
                displayName: 'Dev Spieler',
                email: 'dev@example.com',
                photoURL: `https://i.pravatar.cc/150?u=dev-user-id`,
                providerId: 'password',
                emailVerified: true, isAnonymous: false, metadata: {}, providerData: [], refreshToken: '', tenantId: null,
                delete: async () => {}, getIdToken: async () => '', getIdTokenResult: async () => ({} as any), reload: async () => {}, toJSON: () => ({}),
            };
            setUser(devUser);
            setLoading(false);
        } else {
            setUser(null);
            setLoading(false);
        }
    };

    const unsubscribe = onAuthStateChanged(auth, handleAuthState);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    try {
        const savedGameData = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (savedGameData) {
            const parsed = JSON.parse(savedGameData);
            setSavedGame(parsed);
        }
    } catch (e) {
        console.warn("Could not load saved game from localStorage", e);
    }
  }, []);

  const handleSignIn = async () => {
    try {
      await signInWithGoogle();
    } catch (error) {
      console.error("Sign in failed", error);
    }
  };

  const handleCreateCoopGame = async () => {
      if (!user) return;
      setCreatingGame(true);
      try {
          const gameName = `${user.displayName}'s Spiel`;
          const difficultyMod = difficultyModifiers[difficulty];

          const player1Data: Player = {
              id: 'player1',
              name: user.displayName || 'Spieler 1',
              resources: difficultyMod.startResources,
              unlockedElements: ['neutral'],
              avatarUrl: user.photoURL,
          };
          
          const gameDocRef = await addDoc(collection(db, 'games'), {
              gameName: gameName,
              player1Id: user.uid,
              player2Id: null,
              difficulty: difficulty,
              gameState: {
                  lives: difficultyMod.startLives,
              },
              players: {
                player1: player1Data,
                player2: null,
              },
              members: { [user.uid]: true },
              gameStatus: 'waiting',
              currentWave: 0,
              isIntermission: true,
              waveStartCountdown: 15,
              createdAt: serverTimestamp(),
              towersByCell: {},
              delta: {},
              lastDeltaTimestamp: null,
          });
          
          router.push(`/game/${gameDocRef.id}`);

      } catch(e) {
          console.error("Failed to create coop game:", e);
      } finally {
          setCreatingGame(false);
      }
  }
  
  const handleExitGame = () => {
    setGameMode('menu');
    setStartWithTutorial(false);
  };

  const handleDeleteSave = () => {
      try {
        localStorage.removeItem(LOCAL_STORAGE_KEY);
        setSavedGame(null);
      } catch (e) {
          console.error("Could not delete saved game", e);
      }
  }

  const startSinglePlayer = (withTutorial = false, isCheating = false) => {
    setStartWithTutorial(withTutorial);
    setGameMode(isCheating ? 'cheat' : 'single');
  }

  
  const renderMenu = () => (
    <div className="text-center p-8 max-w-6xl w-full">
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
      </Head>
      <h1 className="text-5xl font-bold tracking-tighter bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">
        Elementarer Nexus
      </h1>
      <p className="text-muted-foreground mt-4 max-w-2xl mx-auto">
        Ein strategisches Koop-Tower-Defense-Spiel. Verteidige den Nexus allein oder mit einem Freund gegen Wellen von Gegnern.
      </p>

      {loading ? (
        <Loader2 className="mx-auto mt-8 h-12 w-12 animate-spin" />
      ) : user ? (
        <div className="mt-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-4xl mx-auto">
            <Card className="text-left">
                <CardHeader>
                    <CardTitle>Einzelspieler</CardTitle>
                    <CardDescription>Spiele alleine und teste deine Fähigkeiten.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Schwierigkeit</label>
                        <Select value={difficulty} onValueChange={(v) => setDifficulty(v as Difficulty)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="Einfach">Einfach</SelectItem>
                                <SelectItem value="Normal">Normal</SelectItem>
                                <SelectItem value="Schwer">Schwer</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                     <Button className="w-full" onClick={() => startSinglePlayer(false)}>
                        <Play className="mr-2" /> Neues Spiel starten
                    </Button>
                    {savedGame && (
                        <>
                        <Button className="w-full" variant="outline" onClick={() => setGameMode('single')}>
                            <BookOpen className="mr-2"/> Spielstand laden (Welle {savedGame.currentWave+1})
                        </Button>
                        <Button className="w-full text-xs" variant="link" onClick={handleDeleteSave}>
                            Gespeichertes Spiel löschen
                        </Button>
                        </>
                    )}
                </CardContent>
            </Card>

            <Card className="text-left">
                 <CardHeader>
                    <CardTitle>Multiplayer & Tools</CardTitle>
                    <CardDescription>Spiele mit Freunden oder analysiere das Spiel.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                    <Button className="w-full" onClick={() => setGameMode('coop-lobby')}>
                        <Users className="mr-2" /> Zur Lobby
                    </Button>
                     <Button className="w-full" onClick={() => startSinglePlayer(false, true)}>
                        <Crown className="mr-2" /> Chaos-Modus
                    </Button>
                    <Link href="/admin/coop-test" className="w-full">
                        <Button className="w-full" variant="secondary">
                            <TestTube2 className="mr-2" /> Koop-Test
                        </Button>
                    </Link>
                     <Link href="/admin/analytics" className="w-full">
                        <Button className="w-full" variant="secondary">
                            <AreaChart className="mr-2" /> Analyse-Dashboard
                        </Button>
                    </Link>
                     <Link href="/balancing" className="w-full">
                        <Button className="w-full" variant="secondary">
                            <BarChart2 className="mr-2" /> Turm-Dashboard
                        </Button>
                    </Link>
                     <Link href="/balancing/waves" className="w-full">
                        <Button className="w-full" variant="secondary">
                            <Waves className="mr-2" /> Wellen-Dashboard
                        </Button>
                    </Link>
                </CardContent>
            </Card>
            <Card className="text-left md:col-span-2 lg:col-span-1">
                 <CardHeader>
                    <CardTitle>Spielanleitung</CardTitle>
                    <CardDescription>Lerne die Grundlagen und sieh deine Erfolge.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                    <Link href="/explainer" className="w-full">
                        <Button className="w-full" variant="outline">
                            <HelpCircle className="mr-2" /> Anleitung ansehen
                        </Button>
                    </Link>
                     <Link href="/scoreboard" className="w-full">
                        <Button className="w-full" variant="outline">
                            <Trophy className="mr-2" /> Scoreboard
                        </Button>
                    </Link>
                     <Button className="w-full" variant="outline" onClick={() => startSinglePlayer(true)}>
                        <BookOpen className="mr-2" /> Tutorial starten
                    </Button>
                </CardContent>
            </Card>
        </div>
      ) : (
        <div className="mt-8">
          <Button onClick={handleSignIn}>
            <LogIn className="mr-2" /> Mit Google anmelden
          </Button>
        </div>
      )}

      {user && (
          <div className="absolute top-4 right-4 flex items-center gap-4">
            <div className="flex items-center gap-2">
                {user.photoURL && <img src={user.photoURL} alt="Avatar" className="h-8 w-8 rounded-full" />}
                <span className="text-sm hidden md:inline">{user.displayName}</span>
            </div>
            <Button variant="ghost" onClick={() => logOut()}><LogOut className="mr-2" /> Abmelden</Button>
          </div>
      )}
    </div>
  );

  const renderLobby = () => (
    <div className="w-full max-w-4xl mx-auto p-4">
        <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold">Co-op Lobby</h1>
             <Button onClick={() => setGameMode('menu')}>Zurück zum Menü</Button>
        </div>
       
        <div className="flex justify-end mb-4">
             <Button onClick={handleCreateCoopGame} disabled={creatingGame}>
                {creatingGame ? <Loader2 className="mr-2 animate-spin" /> : <Swords className="mr-2"/>}
                {creatingGame ? 'Erstelle...' : 'Neues Spiel erstellen'}
            </Button>
        </div>

        {user && <Lobby currentUser={user} />}
    </div>
  );

  const renderContent = () => {
    switch (gameMode) {
      case 'menu':
        return renderMenu();
      case 'coop-lobby':
        return renderLobby();
      case 'single':
      case 'cheat':
        return <SinglePlayerGame 
                    difficulty={difficulty} 
                    onExit={handleExitGame}
                    initialSavedGame={gameMode === 'single' ? savedGame : null}
                    isCheating={gameMode === 'cheat'}
                    startWithTutorial={startWithTutorial}
                    user={user}
                />;
      default:
        return renderMenu();
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground font-body">
      <main className="flex-grow flex items-center justify-center">
        {renderContent()}
      </main>
    </div>
  );
}
