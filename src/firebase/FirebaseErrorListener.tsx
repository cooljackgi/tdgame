'use client';

import { useEffect } from 'react';
import { errorEmitter } from '@/firebase/error-emitter';

// This is a client-side component that listens for globally emitted 'permission-error' events
// and throws them as uncaught exceptions. This is specifically designed to leverage
// the Next.js development overlay to display rich, actionable error messages during development.
// It will not do anything in a production build.
export function FirebaseErrorListener() {
  useEffect(() => {
    const handleError = (error: Error) => {
      // Throwing the error here will cause it to be caught by Next.js's
      // error overlay in development mode, which is exactly what we want.
      // In production, this will be caught by the nearest Error Boundary.
      throw error;
    };

    if (process.env.NODE_ENV === 'development') {
      errorEmitter.on('permission-error', handleError);
    }

    return () => {
      if (process.env.NODE_ENV === 'development') {
        errorEmitter.off('permission-error', handleError);
      }
    };
  }, []);

  // This component does not render anything itself.
  return null;
}
