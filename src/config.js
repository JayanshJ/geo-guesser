// Configuration built from Vite env vars (VITE_*).
// Locally: create .env.local (see .env.example). In CI: the deploy workflow
// writes .env.production from GitHub secrets. Vite only exposes VITE_*-prefixed
// vars to client code, so secrets are never bundled unless explicitly imported.

const FIREBASE_CONFIG = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const CONFIG = {
  GOOGLE_MAPS_API_KEY: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
  FIREBASE_CONFIG,
};