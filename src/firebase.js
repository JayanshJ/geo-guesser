// Modular Firebase initialization. Imported once for its side effects; the
// `auth` and `db` singletons are imported by the services.
import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { CONFIG } from './config.js';

const app = getApps().length ? getApps()[0] : initializeApp(CONFIG.FIREBASE_CONFIG);

export const auth = getAuth(app);
export const db = getFirestore(app);