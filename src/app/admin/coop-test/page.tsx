

// src/app/admin/coop-test/page.tsx
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { addDoc, collection, serverTimestamp, getDoc, updateDoc, doc } from 'firebase/firestore';
import { db, functions, auth, onAuthStateChanged } from '@/lib/firebase';
import type { User } from 'firebase/auth';
import { Button } from '@/components/ui/button';
import { Loader2, TestTube2, Home, RefreshCw, Link2 } from 'lucide-react';
import { difficultyModifiers } from '@/lib/game-data/constants';
import type { Player } from '@/lib/game-data/types';
import Link from 'next/link';
import { httpsCallable } from 'firebase/functions';
import CoopGame from '@/app/game/[gameId]/page';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';

const CLIENT_UID = 'test-client-uid';
const TEST_GAME_ID_KEY = 'coop-test-game-id';

export default function CoopTestPage() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const { toast } = useToast();

    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [loadingMessage, setLoadingMessage] = useState("Authentifiziere Test-Benutzer...");
    const [error, setError] = useState<string | null>(null);
    const [testGameId, setTestGameId] = useState<string | null>(searchParams.get('gameId'));
    const [inviteUrl, setInviteUrl] = useState('');

    useEffect(() => {
        const handleAuthState = (currentUser: User | null) => {
            if (process.env.NODE_ENV === 'development' && !currentUser) {
                const devUser: User = {
                    uid: 'dev-user-id-' + Math.random().toString(36).slice(2),
                    displayName: 'Host-Spieler',
                    email: 'host@example.com',
                    photoURL: `https://i.pravatar.cc/150?u=dev-user-id`,
                    providerId: 'password',
                    emailVerified: true, isAnonymous: false, metadata: {}, providerData: [], refreshToken: '', tenantId: null,
                    delete: async () => {}, getIdToken: async () => '', getIdTokenResult: async () => ({} as any), reload: async () => {}, toJSON: () => ({}),
                };
                setUser(devUser);
            } else if (currentUser) {
                setUser(currentUser);
            } else {
                setError("Authentifizierung erforderlich.");
                setIsLoading(false);
            }
        };
        const unsubscribe = onAuthStateChanged(auth, handleAuthState);
        return () => unsubscribe();
    }, []);

    const createTestGame = useCallback(async (hostUser: User) => {
        setIsLoading(true);
        setLoadingMessage("Erstelle neues Test-Spiel...");
        setError(null);

        try {
            const gameName = `[COOP-TEST] ${new Date().toLocaleTimeString()}`;
            const difficulty = 'Normal';
            const difficultyMod = difficultyModifiers[difficulty];
            
            const player1Data: Player = {
                id: 'player1',
                name: hostUser.displayName || 'Host-Spieler',
                resources: difficultyMod.startResources,
                unlockedElements: ['neutral'],
                avatarUrl: hostUser.photoURL || `https://i.pravatar.cc/150?u=${hostUser.uid}`,
            };

            const gameDocRef = await addDoc(collection(db, 'games'), {
                gameName: gameName,
                player1Id: hostUser.uid,
                player2Id: null,
                difficulty: difficulty,
                gameState: { lives: difficultyMod.startLives },
                players: { player1: player1Data, player2: null },
                members: { [hostUser.uid]: true },
                gameStatus: 'waiting',
                currentWave: 0,
                isIntermission: true,
                waveStartCountdown: 999,
                createdAt: serverTimestamp(),
                towersByCell: {},
                delta: {},
                lastDeltaTimestamp: null,
                isTestGame: true, 
            });
            
            // Update URL without reloading the page
            const newUrl = `${window.location.pathname}?gameId=${gameDocRef.id}`;
            window.history.pushState({ path: newUrl }, '', newUrl);

            setTestGameId(gameDocRef.id);
            setInviteUrl(window.location.href);
            
            // Client does not auto-join in this setup anymore.
            // Host waits for client to join via invite link.

        } catch (e: any) {
            console.error("Failed to create test game:", e);
            setError("Test-Spiel konnte nicht erstellt werden. Details in der Konsole.");
        } finally {
            setIsLoading(false);
        }
    }, []);
    
    useEffect(() => {
        if (!user) return;

        const initialize = async () => {
            setIsLoading(true);
            setLoadingMessage("Prüfe auf existierendes Spiel...");
            const gameIdFromUrl = searchParams.get('gameId');

            if (gameIdFromUrl) {
                 const gameRef = doc(db, 'games', gameIdFromUrl);
                 const gameSnap = await getDoc(gameRef);

                if (gameSnap.exists() && gameSnap.data().isTestGame) {
                    setTestGameId(gameIdFromUrl);
                    setInviteUrl(window.location.href);
                    setLoadingMessage("Verbinde mit existierendem Test-Spiel...");
                } else {
                     setError("Das Spiel in der URL wurde nicht gefunden oder ist kein Test-Spiel.");
                     setLoading(false);
                     return;
                }
            } else {
                // Kein Spiel in der URL, also sind wir der Host und erstellen eins
                await createTestGame(user);
            }
            setIsLoading(false);
        };

        initialize();

    }, [user, createTestGame, searchParams]);


    const handleRecreate = () => {
        if (user) {
            // Remove gameId from URL to trigger creation
            const newUrl = window.location.pathname;
            window.history.pushState({ path: newUrl }, '', newUrl);
            createTestGame(user);
        } else {
            setError("Authentifizierung läuft, bitte warten.");
        }
    }

    const copyInviteLink = () => {
        navigator.clipboard.writeText(inviteUrl);
        toast({ title: "Einladungslink kopiert!" });
    }

    return (
        <main className="w-full h-screen bg-muted/20 p-4 space-y-4 flex flex-col">
            <header className="flex-shrink-0 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <TestTube2 className="h-6 w-6 text-primary" />
                    <h1 className="text-2xl font-bold">Koop-Testwerkstatt</h1>
                </div>
                <div className="flex items-center gap-2">
                    <Button onClick={handleRecreate} variant="outline" disabled={isLoading}>
                       {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <RefreshCw className="mr-2 h-4 w-4" />}
                        Neues Testspiel
                    </Button>
                    <Link href="/">
                        <Button>
                            <Home className="mr-2 h-4 w-4" />
                            Hauptmenü
                        </Button>
                    </Link>
                </div>
            </header>

            {isLoading && (
                <div className="flex-grow flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin mr-3" />
                    <span>{loadingMessage}</span>
                </div>
            )}
            {error && <div className="text-destructive text-center">{error}</div>}

            {!isLoading && testGameId && user && (
                <>
                    <div className="flex justify-center items-center gap-2">
                       <p className="text-sm text-muted-foreground">Teile diesen Link mit deinem Testpartner:</p>
                       <Input readOnly value={inviteUrl} className="max-w-md h-9" />
                       <Button onClick={copyInviteLink} size="sm"><Link2 className="mr-2 h-4 w-4"/> Kopieren</Button>
                    </div>
                    <div className="flex-grow min-h-0">
                        <CoopGame key={testGameId} />
                    </div>
                </>
            )}
        </main>
    );
}
