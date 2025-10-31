
import * as admin from 'firebase-admin';

// This is a server-side only file. It should not be imported in client components.
let app: admin.app.App;

if (admin.apps.length > 0) {
  app = admin.apps[0]!;
} else {
  // In a hosted Google environment (like Cloud Run, where App Hosting runs),
  // the SDK can automatically detect the project credentials.
  // We no longer need to manually parse environment variables.
  app = admin.initializeApp();
}

export { app };
