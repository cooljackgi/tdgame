

"use client";
import { useState, useEffect, lazy, Suspense } from 'react';
import { useParams } from 'next/navigation';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Loader2 } from 'lucide-react';

// Lazy load components to split bundles
const CoopGameLoader = lazy(() => import('@/components/game/coop-game-loader'));
const VersusGameLoader = lazy(() => import('@/components/game/versus-game-loader'));

type GameMode = 'coop' | 'versus' | null;

function GamePage() {
    const { gameId } = useParams<{ gameId: string }>();
    const [gameMode, setGameMode] = useState<GameMode>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!gameId) return;

        const gameDocRef = doc(db, 'games', gameId);
        const unsubscribe = onSnapshot(gameDocRef, 
            (docSnap) => {
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    // Set gameMode only once
                    if (gameMode === null) {
                       setGameMode(data.gameMode || 'coop'); // Default to 'coop' for old games
                    }
                    setLoading(false);
                } else {
                    setError('Spiel nicht gefunden.');
                    setLoading(false);
                }
            },
            (err) => {
                console.error("Error fetching game mode:", err);
                setError('Fehler beim Laden des Spiels.');
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, [gameId, gameMode]); // Depend on gameMode to prevent re-setting it

    if (loading) {
        return <div className="w-full h-full flex flex-col items-center justify-center bg-background"><Loader2 className="h-10 w-10 animate-spin text-primary mb-4" /><p className="text-muted-foreground">Lade Spielmodus...</p></div>;
    }
    
    if (error) {
         return <div className="w-full h-full flex flex-col items-center justify-center bg-background"><p className="text-destructive">{error}</p></div>;
    }

    return (
        <Suspense fallback={<div className="w-full h-full flex flex-col items-center justify-center bg-background"><Loader2 className="h-10 w-10 animate-spin text-primary mb-4" /><p className="text-muted-foreground">Lade Spielkomponenten...</p></div>}>
            {gameMode === 'versus' ? <VersusGameLoader /> : <CoopGameLoader />}
        </Suspense>
    );
}

export default GamePage;
