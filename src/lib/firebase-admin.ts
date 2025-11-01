
import * as admin from 'firebase-admin';

// This is a server-side only file. It should not be imported in client components.

// Check if the app is already initialized to prevent re-initialization
if (!admin.apps.length) {
  // This environment variable should be set in your deployment environment (Vercel, Cloud Run, etc.)
  // It should contain the stringified JSON of your service account key.
  const serviceAccountString = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (serviceAccountString) {
    try {
      const serviceAccount = JSON.parse(serviceAccountString);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      console.log("Firebase Admin SDK initialized successfully.");
    } catch (error) {
      console.error("Error parsing Firebase service account or initializing app:", error);
    }
  } else {
    // This will run in local development if the .env.local variable is not set.
    // It's also a fallback for environments where the SDK can auto-discover credentials.
    console.warn("FIREBASE_SERVICE_ACCOUNT environment variable not found. Attempting default initialization...");
    try {
        admin.initializeApp();
        console.log("Firebase Admin SDK initialized with default credentials.");
    } catch (e) {
        console.error("Default Firebase Admin SDK initialization failed. Ensure you have the correct environment setup for ADC (Application Default Credentials) or a service account file.", e);
    }
  }
}

const app = admin.app();

export { app };
