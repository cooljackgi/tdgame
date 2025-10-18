
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { User } from 'firebase/auth';
import type { PlacedTower, Difficulty } from './game-data/types';

// This file is intended for reusable game logic that can be shared
// between single-player and multiplayer contexts, especially for
// actions that interact with backend services like Firestore.

/**
 * Handles the logic for when a game ends, such as saving the score.
 * 
 * @param gameId - The ID of the game that just ended.
 * @param user - The authenticated Firebase user.
 * @param difficulty - The difficulty the game was played on.
 * @param wave - The final wave number reached.
 * @param won - Whether the player won the game.
 * @param finalTowers - The state of the towers at the end of the game.
 */
export async function onGameEnd(
    gameId: string,
    user: User | null,
    difficulty: Difficulty,
    wave: number,
    won: boolean,
    finalTowers: Record<string, PlacedTower>
) {
    // For now, we only save single-player scores and if the user is logged in.
    // Coop scoring would need a different structure.
    if (!user || gameId.startsWith('sp-')) { // crude check for single-player
        if (user && difficulty !== 'Chaos') {
            try {
                await addDoc(collection(db, "scores"), {
                    playerName: user.displayName || 'Anonymer Spieler',
                    playerUid: user.uid,
                    difficulty: difficulty,
                    wave: wave,
                    won: won,
                    finalTowers: finalTowers,
                    date: serverTimestamp(),
                });
            } catch (e) {
                console.error("Failed to save score to Firestore:", e);
            }
        }
    }
    // In a real coop scenario, you might update the game document itself
    // to a 'finished' state here.
    // For now, we do nothing for coop games.
}
