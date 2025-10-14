
import { initializeApp, getApps, getApp } from "firebase/app";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator } from "firebase/firestore";
import { getAuth, onAuthStateChanged, signInAnonymously, type User, GoogleAuthProvider, signInWithPopup, signOut, connectAuthEmulator } from "firebase/auth";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";

const firebaseConfig = {
  apiKey: "AIzaSyCStdTE19Iq-EdlmiV8EB2I6sIhnvIh0-Y",
  authDomain: "studio-8208926735-5ea4c.firebaseapp.com",
  projectId: "studio-8208926735-5ea4c",
  storageBucket: "studio-8208926735-5ea4c.appspot.com",
  messagingSenderId: "345017018409",
  appId: "1:345017018409:web:07a4cccdbf28dfc1f99438"
};


const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// Firestore mit optimierten Einstellungen initialisieren
const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
  ignoreUndefinedProperties: true,
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});

const auth = getAuth(app);
const functions = getFunctions(app, 'us-central1'); // Region für die Funktionen explizit angeben

if (typeof window !== "undefined" && window.location.hostname === "localhost") {
  console.log("Connecting to Firebase Emulators (Client)...");
  try {
    // Functions-Emulator-Verbindung wird serverseitig in der Funktion selbst gehandhabt
    connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, 'localhost', 8081);
    console.log("Client successfully connected to Auth and Firestore Emulators.");
  } catch (e) {
    console.warn("Could not connect to Firebase Emulators. Are they running?", e);
  }
}

const googleProvider = new GoogleAuthProvider();


export function signInWithGoogle(): Promise<User> {
  return new Promise((resolve, reject) => {
    signInWithPopup(auth, googleProvider)
      .then((result) => {
        resolve(result.user);
      })
      .catch((error) => {
        reject(error);
      });
  });
}

export function logOut(): Promise<void> {
    return signOut(auth);
}


// Function to get the current user. It doesn't sign in anymore.
export function getCurrentUser(): Promise<User> {
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      if (user) {
        resolve(user);
      } else {
        // If there's no user, we can't proceed. The UI should handle this.
        // For robustness, you might want to reject or guide the user to log in.
        // Rejecting here makes it explicit that a user is required.
        reject(new Error("No user is logged in."));
      }
    });
  });
}

export { app, db, auth, functions, onAuthStateChanged };
