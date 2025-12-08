// src/lib/logging.ts
'use client';

import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';

// Based on the user's excellent specification.
type WebRTCEvent = 
    | 'SIGNALING_CONNECTING'
    | 'SIGNALING_OPEN'
    | 'SIGNALING_CLOSE'
    | 'SIGNALING_ERROR'
    | 'SIGNALING_RECONNECT_SCHEDULED'
    | 'SIGNALING_MESSAGE_RECEIVED'
    | 'PC_CREATED'
    | 'PC_OFFER_CREATED'
    | 'PC_OFFER_CREATED_REHELLO'
    | 'PC_ANSWER_CREATED'
    | 'PC_SET_LOCAL_DESC'
    | 'PC_SET_REMOTE_DESC'
    | 'PC_ICE_CANDIDATE'
    | 'PC_CONNECTION_STATE_CHANGE'
    | 'DC_CREATED'
    | 'DC_OPEN'
    | 'DC_CLOSE'
    | 'DC_MESSAGE_RECEIVED'
    | 'ICE_SELECTED'
    | 'NET_TICK'; // Added for periodic stats


/**
 * Logs a structured WebRTC event to a dedicated sub-collection in Firestore
 * AND outputs it to the browser console for live debugging.
 * 
 * @param gameId The ID of the game session.
 * @param role The role of the client ('host' or 'client').
 * @param event The specific WebRTC event that occurred.
 * @param details An optional object or string containing additional context.
 */
export async function logWebRTCEvent(
    gameId: string, 
    role: 'host' | 'client' | 'monitor', 
    event: WebRTCEvent, 
    details?: object | string | null
) {
    const finalDetails = details ?? null;
    
    // --- Console Logging ---
    // Log to console immediately for live debugging.
    console.log(`[WebRTC Log - ${role.toUpperCase()}]`, {
      event: event,
      details: finalDetails,
      gameId: gameId,
      timestamp: new Date().toISOString()
    });

    // --- Firestore Logging (as before) ---
    // Silently fail if there's no gameId, as remote logging is not possible.
    if (!gameId) {
        // We already console.log above, so no need for a warning here.
        return;
    };
    
    try {
        // The path to the dedicated logging sub-collection.
        // POINTING TO game_logs TO MERGE WITH OTHER GAME STATS
        const logCollectionRef = collection(db, `games/${gameId}/game_logs`);

        // Construct the log entry based on the user's specified schema.
        const logEntry = {
            gameId,
            timestamp: serverTimestamp(), // Let Firestore determine the time.
            clientTs: Date.now(), // Add client-side timestamp for latency analysis.
            type: event, // Use 'type' to match game_session logs
            role,
            details: finalDetails, // Ensure details is not undefined.
        };

        await addDoc(logCollectionRef, logEntry);

    } catch (error) {
        // Log to console if Firestore write fails, to avoid breaking the app flow.
        console.error(`[WebRTC Logging] Failed to save log to Firestore for game ${gameId}:`, error);
    }
}


type GameStats = {
    fps: number;
    enemyCount: number;
    towerCount: number;
    wave: number;
};

/**
 * Logs a snapshot of game statistics (FPS, object counts) to Firestore.
 * @param gameId The ID of the game session.
 * @param role The role of the client (should typically be 'host').
 * @param stats The statistics object to log.
 */
export async function logGameStats(gameId: string, role: 'host' | 'client' | 'monitor', stats: GameStats) {
    if (!gameId) return;

    try {
        const logCollectionRef = collection(db, `games/${gameId}/game_logs`);
        const logEntry = {
            gameId,
            timestamp: serverTimestamp(),
            clientTs: Date.now(),
            type: 'GAME_STATS_TICK', // A unique type for these logs
            role,
            details: stats,
        };
        await addDoc(logCollectionRef, logEntry);
    } catch (error) {
        console.error(`[Game Stats Logging] Failed to save stats to Firestore for game ${gameId}:`, error);
    }
}
