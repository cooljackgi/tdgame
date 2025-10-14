"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteTestGame = exports.archiveGame = exports.joinGame = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const zod_1 = require("zod");
// Initialize Firebase Admin
if (admin.apps.length === 0) {
    admin.initializeApp();
}
const db = admin.firestore();
// --- Zod Schemas for Input Validation ---
const gameIdSchema = zod_1.z.object({
    gameId: zod_1.z.string().min(1),
});
/**
 * A callable function to allow a user to join a game.
 */
exports.joinGame = functions.https.onCall(async (data, context) => {
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
            if (gameData?.player1Id === uid)
                return;
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
                },
                gameStatus: 'playing', // Set game to playing now that P2 has joined
                isIntermission: true,
                waveStartCountdown: 15, // Start the actual intermission countdown
            });
        });
        return { success: true, message: `User ${uid} joined or was already in game ${gameId}` };
    }
    catch (error) {
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
exports.archiveGame = functions.https.onCall(async (data, context) => {
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
        if (!gameDoc.exists)
            throw new functions.https.HttpsError("not-found", "Game not found.");
        const gameData = gameDoc.data();
        if (gameData?.player1Id !== uid) {
            throw new functions.https.HttpsError("permission-denied", "Only the creator of the game can archive it.");
        }
        await gameRef.update({ gameStatus: 'archived' });
        return { success: true, message: `Game ${gameId} archived successfully.` };
    }
    catch (error) {
        console.error(`Error archiving game ${gameId} for user ${uid}:`, error);
        if (error instanceof functions.https.HttpsError)
            throw error;
        throw new functions.https.HttpsError("internal", "An unexpected error occurred while archiving the game.");
    }
});
/**
 * A callable function to completely delete a test game.
 */
exports.deleteTestGame = functions.https.onCall(async (data) => {
    const validation = gameIdSchema.safeParse(data);
    if (!validation.success)
        throw new functions.https.HttpsError("invalid-argument", "Invalid gameId provided.");
    const { gameId } = validation.data;
    const gameRef = db.collection("games").doc(gameId);
    try {
        const gameDoc = await gameRef.get();
        if (!gameDoc.exists)
            return { success: true, message: `Game ${gameId} did not exist.` };
        const gameData = gameDoc.data();
        if (gameData?.isTestGame !== true) {
            throw new functions.https.HttpsError("permission-denied", "This function can only delete test games.");
        }
        await gameRef.delete();
        return { success: true, message: `Test game ${gameId} deleted successfully.` };
    }
    catch (error) {
        console.error(`Error deleting test game ${gameId}:`, error);
        if (error instanceof functions.https.HttpsError)
            throw error;
        throw new functions.https.HttpsError("internal", "An unexpected error occurred while deleting the test game.");
    }
});
//# sourceMappingURL=index.js.map