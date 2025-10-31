
import * as admin from 'firebase-admin';

const firebaseConfig = {
  apiKey: "AIzaSyCStdTE19Iq-EdlmiV8EB2I6sIhnvIh0-Y",
  authDomain: "studio-8208926735-5ea4c.firebaseapp.com",
  projectId: "studio-8208926735-5ea4c",
  storageBucket: "studio-8208926735-5ea4c.appspot.com",
  messagingSenderId: "345017018409",
  appId: "1:345017018409:web:07a4cccdbf28dfc1f99438"
};

// This is a server-side only file. It should not be imported in client components.
let app: admin.app.App;

if (admin.apps.length > 0) {
  app = admin.apps[0]!;
} else {
  // Extract credentials from environment variables if they exist
  // This is the standard way to initialize in secure environments like Cloud Run
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : undefined;

  app = admin.initializeApp({
    credential: serviceAccount ? admin.credential.cert(serviceAccount) : undefined,
    databaseURL: `https://${firebaseConfig.projectId}.firebaseio.com`,
  });
}

export { app };
