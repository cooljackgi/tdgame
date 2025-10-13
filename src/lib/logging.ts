
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
 * Logs a structured WebRTC event to a dedicated sub-collection in Firestore.
 * This is designed for debugging P2P connection issues.
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
    // Silently fail if there's no gameId, as logging is not possible.
    if (!gameId) {
        console.warn("[WebRTC Logging] Aborted: Missing gameId.");
        return;
    };
    
    try {
        // The path to the dedicated logging sub-collection.
        const logCollectionRef = collection(db, `games/${gameId}/webrtc_logs`);

        // Construct the log entry based on the user's specified schema.
        const logEntry = {
            timestamp: serverTimestamp(), // Let Firestore determine the time.
            clientTs: Date.now(), // Add client-side timestamp for latency analysis.
            role,
            event,
            details: details ?? null, // Ensure details is not undefined.
        };

        await addDoc(logCollectionRef, logEntry);

    } catch (error) {
        // Log to console if Firestore write fails, to avoid breaking the app flow.
        console.error(`[WebRTC Logging] Failed to log event for game ${gameId}:`, error);
    }
}
