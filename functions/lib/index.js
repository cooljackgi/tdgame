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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.nextServer = exports.deleteTestGame = exports.archiveGame = exports.joinGame = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const zod_1 = require("zod");
const next_1 = __importDefault(require("next"));
const cors_1 = __importDefault(require("cors"));
admin.initializeApp();
const db = admin.firestore();
// Initialize CORS middleware
// We are allowing all origins for simplicity in this development environment.
// For a production app, you might want to restrict this to your specific frontend URL.
const corsHandler = (0, cors_1.default)({ origin: true });
// --- Zod Schemas for Input Validation ---
const gameIdSchema = zod_1.z.object({
    gameId: zod_1.z.string().min(1),
});
/**
 * A callable function to allow a user to join a game.
 * The user's UID is added to the game's members map.
 * This now performs a targeted update to only set player 2's info.
 */
exports.joinGame = functions.https.onCall(async (data, context) => {
    // 1. Validate authentication
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "The function must be called while authenticated.");
    }
    const uid = context.auth.uid;
    const displayName = context.auth.token.name || `Spieler 2`;
    const avatarUrl = context.auth.token.picture || null;
    // 2. Validate request body
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
            // If user is already player 1, do nothing.
            if (gameData?.player1Id === uid) {
                return;
            }
            // If a player 2 is already set
            if (gameData?.player2Id) {
                if (gameData.player2Id !== uid) { // A different player is P2
                    throw new functions.https.HttpsError("already-exists", "The game is already full.");
                }
                // The current user is already P2, do nothing further in the transaction.
                return;
            }
            const resources = gameData?.players?.player1?.resources ?? 1250;
            // If we reach here, the user is not P1, and P2 slot is free.
            transaction.update(gameRef, {
                player2Id: uid,
                'members': { ...gameData?.members, [uid]: true },
                'players.player2': {
                    id: 'player2',
                    name: displayName,
                    avatarUrl: avatarUrl,
                    resources: resources,
                    unlockedElements: ['neutral'],
                }
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
 * This sets the game's status to 'archived'.
 */
exports.archiveGame = functions.https.onCall(async (data, context) => {
    // 1. Validate authentication
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "The function must be called while authenticated.");
    }
    const uid = context.auth.uid;
    // 2. Validate request body
    const validation = gameIdSchema.safeParse(data);
    if (!validation.success) {
        throw new functions.https.HttpsError("invalid-argument", "Invalid gameId provided.");
    }
    const { gameId } = validation.data;
    const gameRef = db.collection("games").doc(gameId);
    try {
        const gameDoc = await gameRef.get();
        if (!gameDoc.exists) {
            throw new functions.https.HttpsError("not-found", "Game not found.");
        }
        const gameData = gameDoc.data();
        if (gameData?.player1Id !== uid) {
            throw new functions.https.HttpsError("permission-denied", "Only the creator of the game can archive it.");
        }
        await gameRef.update({ gameStatus: 'archived' });
        return { success: true, message: `Game ${gameId} archived successfully.` };
    }
    catch (error) {
        console.error(`Error archiving game ${gameId} for user ${uid}:`, error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError("internal", "An unexpected error occurred while archiving the game.");
    }
});
/**
 * A callable function to completely delete a test game.
 * This is only allowed for games marked with isTestGame: true.
 * This function now allows unauthenticated requests for easier test cleanup,
 * but strictly checks for the isTestGame flag.
 */
exports.deleteTestGame = functions.https.onCall(async (data, context) => {
    const validation = gameIdSchema.safeParse(data);
    if (!validation.success) {
        throw new functions.https.HttpsError("invalid-argument", "Invalid gameId provided.");
    }
    const { gameId } = validation.data;
    const gameRef = db.collection("games").doc(gameId);
    try {
        const gameDoc = await gameRef.get();
        if (!gameDoc.exists) {
            return { success: true, message: `Game ${gameId} did not exist.` };
        }
        const gameData = gameDoc.data();
        if (gameData?.isTestGame !== true) {
            throw new functions.https.HttpsError("permission-denied", "This function can only delete test games.");
        }
        await gameRef.delete();
        return { success: true, message: `Test game ${gameId} deleted successfully.` };
    }
    catch (error) {
        console.error(`Error deleting test game ${gameId}:`, error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError("internal", "An unexpected error occurred while deleting the test game.");
    }
});
const dev = process.env.NODE_ENV !== 'production';
const app = (0, next_1.default)({ dev, conf: { distDir: '.next' } });
const handle = app.getRequestHandler();
exports.nextServer = functions.https.onRequest((req, res) => {
    // Wrap the Next.js handler with the CORS middleware
    return corsHandler(req, res, () => {
        console.log('File: ' + req.originalUrl);
        return app.prepare().then(() => handle(req, res));
    });
});
//# sourceMappingURL=index.js.map