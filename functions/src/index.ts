import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { z } from "zod";

// Initialize Firebase Admin
if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

// --- Zod Schemas for Input Validation ---
const gameIdSchema = z.object({
  gameId: z.string().min(1),
});

// --- Type definitions copied from client to break dependency chain ---
type Element = 'fire' | 'water' | 'earth' | 'air' | 'nature' | 'light' | 'dark' | 'neutral';
export type Player = {
  id: 'player1' | 'player2';
  name: string;
  avatarUrl?: string | null;
  resources: number;
  unlockedElements: Element[];
};


/**
 * A callable function to allow a user to join a game.
 */
export const joinGame = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "The function must be called while authenticated.");
  }
  const uid = context.auth.uid;
  const displayName = context.auth.token.name || `Spieler 2`;
  const avatarUrl = context.auth.token.picture || null;
  const validation = gameIdSchema.safeParse(data);
  if (!validation.success) {
    throw new functions.https.HttpsError("invalid-argument", "The data provided is not valid.", validation.error.issues);
  }
  const { gameId } = validation.data;
  const gameRef = db.collection("games").doc(gameId);
  try {
    await db.runTransaction(async (transaction) => {
      const gameDoc = await transaction.get(gameRef);
      if (!gameDoc.exists) {
        throw new functions.https.HttpsError("not-found", "Game not found.");
      }
      const gameData = gameDoc.data();
      if (gameData?.player1Id === uid) return;
      if (gameData?.player2Id) {
         if (gameData.player2Id !== uid) {
            throw new functions.https.HttpsError("already-exists", "The game is already full.");
         }
         return; 
      }
      const resources = gameData?.players?.player1?.resources ?? 1250;
      transaction.update(gameRef, { 
        player2Id: uid, 
        'members': { ...gameData?.members, [uid]: true },
        'players.player2': {
            id: 'player2', name: displayName, avatarUrl: avatarUrl, resources: resources, unlockedElements: ['neutral'],
        }
      });
    });
    return { success: true, message: `User ${uid} joined or was already in game ${gameId}` };
  } catch (error: any) {
    console.error(`Error joining game ${gameId} for user ${uid}:`, error);
    if (error.code === 'already-exists' || error.code === 'not-found' || error.code === 'internal') {
        throw error;
    }
    throw new functions.https.HttpsError("internal", "Internal server error while trying to join the game.");
  }
});

/**
 * A callable function to allow the creator of a game to archive it.
 */
export const archiveGame = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "The function must be called while authenticated.");
    }
    const uid = context.auth.uid;
    const validation = gameIdSchema.safeParse(data);
    if (!validation.success) {
        throw new functions.https.HttpsError("invalid-argument", "Invalid gameId provided.");
    }
    const { gameId } = validation.data;
    const gameRef = db.collection("games").doc(gameId);
    try {
        const gameDoc = await gameRef.get();
        if (!gameDoc.exists) throw new functions.https.HttpsError("not-found", "Game not found.");
        const gameData = gameDoc.data();
        if (gameData?.player1Id !== uid) {
            throw new functions.https.HttpsError("permission-denied", "Only the creator of the game can archive it.");
        }
        await gameRef.update({ gameStatus: 'archived' });
        return { success: true, message: `Game ${gameId} archived successfully.` };
    } catch (error: any) {
        console.error(`Error archiving game ${gameId} for user ${uid}:`, error);
        if (error instanceof functions.https.HttpsError) throw error;
        throw new functions.https.HttpsError("internal", "An unexpected error occurred while archiving the game.");
    }
});

/**
 * A callable function to completely delete a test game.
 */
export const deleteTestGame = functions.https.onCall(async (data) => {
    const validation = gameIdSchema.safeParse(data);
    if (!validation.success) throw new functions.https.HttpsError("invalid-argument", "Invalid gameId provided.");
    const { gameId } = validation.data;
    const gameRef = db.collection("games").doc(gameId);
    try {
        const gameDoc = await gameRef.get();
        if (!gameDoc.exists) return { success: true, message: `Game ${gameId} did not exist.` };
        const gameData = gameDoc.data();
        if (gameData?.isTestGame !== true) {
            throw new functions.https.HttpsError("permission-denied", "This function can only delete test games.");
        }
        await gameRef.delete();
        return { success: true, message: `Test game ${gameId} deleted successfully.` };
    } catch (error: any) {
        console.error(`Error deleting test game ${gameId}:`, error);
        if (error instanceof functions.https.HttpsError) throw error;
        throw new functions.https.HttpsError("internal", "An unexpected error occurred while deleting the test game.");
    }
});
