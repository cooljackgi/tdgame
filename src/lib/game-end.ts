// src/lib/game-end.ts
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { User } from 'firebase/auth';
import type {
  PlacedTower, Difficulty
} from './game-data/types';

/**
 * Handles the logic for when a game ends, such as saving the score.
 * This is now in its own file to break circular dependencies.
 */
export async function onGameEnd(
    gameId: string,
    user: User | null,
    difficulty: Difficulty,
    wave: number,
    won: boolean,
    finalTowers: Record<string, PlacedTower>
) {
    if (!user || difficulty === 'Chaos') return; 
    
    try {
        await addDoc(collection(db, "scores"), {
            playerName: user.displayName || 'Anonymer Spieler',
            playerUid: user.uid,
            difficulty: difficulty,
            wave: wave,
            won: won,
            finalTowers: finalTowers,
            date: serverTimestamp(),
            gameId: gameId, 
        });
    } catch (e) {
        console.error("Failed to save score to Firestore:", e);
    }
}
