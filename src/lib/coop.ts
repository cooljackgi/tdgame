
import {
  getFunctions,
  httpsCallable,
  Functions,
} from "firebase/functions";
import {
  doc,
  onSnapshot,
  query,
  orderBy,
  where,
  Timestamp,
  Firestore,
  Unsubscribe,
  startAfter,
} from "firebase/firestore";


/**
 * Joins a game by calling the 'joinGame' callable Cloud Function.
 * This requires the user to be authenticated, and the Functions instance to be passed.
 * The client user is hardcoded for the test environment.
 *
 * @param functions The Firebase Functions instance.
 * @param gameId The ID of the game to join.
 * @returns A promise that resolves when the user has successfully joined the game.
 */
export async function joinGame(functions: Functions, gameId: string, testClientUid?: string): Promise<any> {
  const joinGameCallable = httpsCallable(functions, 'joinGame');
  try {
    // In a real app, you wouldn't hardcode this.
    // This is a stand-in for the second player's authentication.
    const options = testClientUid ? {
        auth: {
            token: {
                uid: testClientUid,
                name: 'Client-Spieler',
                picture: `https://i.pravatar.cc/150?u=${testClientUid}`
            }
        }
    } as any : undefined;

    const result = await joinGameCallable({ gameId }, options);

    console.log(`Successfully joined game ${gameId}`);
    return result.data;
  } catch (error) {
    console.error("Error calling 'joinGame' function:", error);
    throw error;
  }
}
