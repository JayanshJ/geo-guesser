// Authentication + user-profile service. Backed by Firebase Auth (email/password
// and anonymous guests) and the `users` Firestore collection. Owns the shared
// `db`/`auth` handles re-exported for the other services.
import { auth, db } from '../firebase.js';
import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInAnonymously,
  sendPasswordResetEmail,
  sendEmailVerification,
  signOut,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  addDoc,
  runTransaction,
  serverTimestamp,
  increment,
  arrayUnion,
} from 'firebase/firestore';
import { DEFAULT_RATING } from '../game/elo.js';
import { ALL_MODES } from '../game/achievements.js';

class AuthService {
  constructor() {
    this.user = null;
    this.db = db;
    this.auth = auth;
    this.unsubscribeAuth = null;
  }

  // Generate a random anonymous display name.
  generateAnonymousName() {
    const adjectives = ['Swift', 'Clever', 'Brave', 'Mighty', 'Silent', 'Bold', 'Quick', 'Wise', 'Lucky', 'Sharp', 'Cosmic', 'Thunder', 'Golden', 'Silver', 'Mystic', 'Shadow', 'Storm', 'Fire', 'Ice', 'Neon'];
    const nouns = ['Explorer', 'Wanderer', 'Traveler', 'Navigator', 'Scout', 'Ranger', 'Voyager', 'Pioneer', 'Adventurer', 'Pathfinder', 'Nomad', 'Seeker', 'Hunter', 'Champion', 'Legend', 'Phoenix', 'Dragon', 'Wolf', 'Eagle', 'Tiger'];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const num = Math.floor(Math.random() * 1000);
    return `${adj}${noun}${num}`;
  }

  async initialize() {
    try {
      this.unsubscribeAuth = onAuthStateChanged(this.auth, async (firebaseUser) => {
        if (!firebaseUser) {
          this.user = null;
          this.updateUI();
          return;
        }

        const userDocRef = doc(this.db, 'users', firebaseUser.uid);
        const userDoc = await getDoc(userDocRef);

        if (firebaseUser.isAnonymous) {
          // Guest via Firebase anonymous auth (real uid, required for security
          // rules). Create the profile doc on first sign-in.
          let displayName;
          if (userDoc.exists()) {
            displayName = userDoc.data().displayName;
          } else {
            displayName = localStorage.getItem('geoguesser_guest_name') || this.generateAnonymousName();
            try {
              await setDoc(userDocRef, {
                uid: firebaseUser.uid,
                displayName,
                createdAt: serverTimestamp(),
                totalGames: 0,
                totalScore: 0,
                bestScore: 0,
                isAnonymous: true,
              });
            } catch (e) {
              console.error('Error creating guest profile:', e);
            }
          }
          this.user = { uid: firebaseUser.uid, displayName, isAnonymous: true };
          this.onUserReady();
          return;
        }

        // Email user.
        if (userDoc.exists()) {
          const userData = userDoc.data();
          this.user = {
            uid: firebaseUser.uid,
            username: userData.username,
            email: firebaseUser.email,
            emailVerified: firebaseUser.emailVerified,
            displayName: userData.displayName,
            isAnonymous: false,
          };

          if (userData.emailVerified !== firebaseUser.emailVerified) {
            await updateDoc(userDocRef, { emailVerified: firebaseUser.emailVerified });
          }

          await this.updateOnlineStatus(true);
          this.onUserReady();
        }
      });
    } catch (error) {
      console.error('Firebase initialization error:', error);
    }
  }

  async signUpWithEmail(email, password, displayName, username) {
    try {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return { success: false, error: 'Please enter a valid email address' };
      }
      if (!displayName || displayName.length < 2 || displayName.length > 20) {
        return { success: false, error: 'Display name must be between 2-20 characters' };
      }
      if (!username || username.length < 3 || username.length > 20) {
        return { success: false, error: 'Username must be between 3-20 characters' };
      }
      if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        return { success: false, error: 'Username can only contain letters, numbers, and underscores' };
      }
      if (password.length < 8) {
        return { success: false, error: 'Password must be at least 8 characters' };
      }
      if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
        return { success: false, error: 'Password must contain uppercase, lowercase, and numbers' };
      }

      // Create the auth account first, then atomically reserve the username
      // (via the `usernames` collection) and create the profile in one
      // transaction. This closes the TOCTOU race two concurrent signups had
      // under the old client-only query check. If the username is taken, the
      // auth account is rolled back.
      const userCredential = await createUserWithEmailAndPassword(this.auth, email, password);
      const user = userCredential.user;
      const lowerUsername = username.toLowerCase();

      let usernameTaken = false;
      try {
        await runTransaction(this.db, async (tx) => {
          const usernameSnap = await tx.get(doc(this.db, 'usernames', lowerUsername));
          if (usernameSnap.exists) {
            usernameTaken = true;
            throw new Error('USERNAME_TAKEN');
          }
          tx.set(doc(this.db, 'usernames', lowerUsername), {
            uid: user.uid,
            username: lowerUsername,
            createdAt: serverTimestamp(),
          });
          tx.set(doc(this.db, 'users', user.uid), {
            uid: user.uid,
            username: lowerUsername,
            email: email.toLowerCase(),
            displayName: displayName,
            emailVerified: false,
            createdAt: serverTimestamp(),
            lastLogin: serverTimestamp(),
            totalGames: 0,
            totalScore: 0,
            bestScore: 0,
            elo: 1000,
            friends: [],
            friendRequests: [],
            isOnline: true,
            accountStatus: 'active',
          });
        });
      } catch (e) {
        // Roll back the auth account on any reservation failure.
        try { await user.delete(); } catch (_) { /* ignore */ }
        if (usernameTaken) return { success: false, error: 'Username is already taken' };
        console.error('Sign up transaction error:', e);
        return { success: false, error: 'Failed to create account. Please try again.' };
      }

      await sendEmailVerification(user, {
        url: window.location.origin,
        handleCodeInApp: false,
      });

      return { success: true, requiresVerification: true };
    } catch (error) {
      console.error('Sign up error:', error);
      let errorMessage = 'Failed to create account. Please try again.';
      if (error.code === 'auth/email-already-in-use') {
        errorMessage = 'An account with this email already exists';
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = 'Invalid email address';
      } else if (error.code === 'auth/weak-password') {
        errorMessage = 'Password is too weak';
      } else if (error.code === 'auth/network-request-failed') {
        errorMessage = 'Network error. Please check your connection';
      }
      return { success: false, error: errorMessage };
    }
  }

  async signInWithEmail(email, password) {
    try {
      const userCredential = await signInWithEmailAndPassword(this.auth, email, password);
      const user = userCredential.user;

      await updateDoc(doc(this.db, 'users', user.uid), {
        lastLogin: serverTimestamp(),
        isOnline: true,
      });

      if (!user.emailVerified) {
        return {
          success: true,
          emailNotVerified: true,
          message: 'Please verify your email. Check your inbox for the verification link.',
        };
      }
      return { success: true };
    } catch (error) {
      console.error('Sign in error:', error);
      let errorMessage = 'Failed to sign in. Please try again.';
      if (error.code === 'auth/user-not-found') {
        errorMessage = 'No account found with this email';
      } else if (error.code === 'auth/wrong-password') {
        errorMessage = 'Incorrect password';
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = 'Invalid email address';
      } else if (error.code === 'auth/user-disabled') {
        errorMessage = 'This account has been disabled';
      } else if (error.code === 'auth/too-many-requests') {
        errorMessage = 'Too many failed attempts. Please try again later';
      } else if (error.code === 'auth/network-request-failed') {
        errorMessage = 'Network error. Please check your connection';
      }
      return { success: false, error: errorMessage };
    }
  }

  async sendPasswordResetEmail(email) {
    try {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return { success: false, error: 'Please enter a valid email address' };
      }
      await sendPasswordResetEmail(this.auth, email, {
        url: window.location.origin,
        handleCodeInApp: false,
      });
      return { success: true, message: 'Password reset email sent! Check your inbox.' };
    } catch (error) {
      console.error('Password reset error:', error);
      let errorMessage = 'Failed to send reset email. Please try again.';
      if (error.code === 'auth/user-not-found') {
        return { success: true, message: 'If an account exists with this email, you will receive a password reset link.' };
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = 'Invalid email address';
      } else if (error.code === 'auth/too-many-requests') {
        errorMessage = 'Too many requests. Please try again later';
      }
      return { success: false, error: errorMessage };
    }
  }

  async resendVerificationEmail() {
    try {
      const user = this.auth.currentUser;
      if (!user) return { success: false, error: 'No user signed in' };
      if (user.emailVerified) return { success: false, error: 'Email is already verified' };
      await sendEmailVerification(user, {
        url: window.location.origin,
        handleCodeInApp: false,
      });
      return { success: true, message: 'Verification email sent! Check your inbox.' };
    } catch (error) {
      console.error('Resend verification error:', error);
      let errorMessage = 'Failed to send verification email. Please try again.';
      if (error.code === 'auth/too-many-requests') {
        errorMessage = 'Too many requests. Please wait before trying again';
      }
      return { success: false, error: errorMessage };
    }
  }

  async signOut() {
    try {
      if (this.user && !this.user.isAnonymous) {
        await this.updateOnlineStatus(false);
        await signOut(this.auth);
      }
      this.user = null;
      localStorage.removeItem('geoguesser_user');
      this.updateUI();
    } catch (error) {
      console.error('Sign out error:', error);
    }
  }

  async updateOnlineStatus(isOnline) {
    if (this.user && !this.user.isAnonymous) {
      try {
        await updateDoc(doc(this.db, 'users', this.user.uid), {
          isOnline: isOnline,
          lastSeen: serverTimestamp(),
        });
      } catch (error) {
        console.error('Error updating online status:', error);
      }
    }
  }

  async createUser(displayName) {
    // Guests use Firebase anonymous auth so they get a real uid; this is
    // required for Firestore security rules (which gate writes on
    // request.auth.uid). The profile doc is created in onAuthStateChanged once
    // the anonymous user is known. (Enable Anonymous auth in the Firebase
    // console for this to work.)
    const name = displayName || this.generateAnonymousName();
    localStorage.setItem('geoguesser_guest_name', name);
    try {
      await signInAnonymously(this.auth);
    } catch (error) {
      console.error('Anonymous sign-in error:', error);
    }
    // onAuthStateChanged finishes setup and calls onUserReady.
    return this.user;
  }

  async changeName(newName) {
    if (!this.user) return;
    this.user.displayName = newName;
    localStorage.setItem('geoguesser_user', JSON.stringify(this.user));
    try {
      await updateDoc(doc(this.db, 'users', this.user.uid), { displayName: newName });
    } catch (error) {
      console.error('Error updating name:', error);
    }
    this.updateUI();
  }

  onUserReady() {
    this.updateUI();
  }

  updateUI() {
    const authSection = document.getElementById('auth-section');
    const mainMenu = document.getElementById('main-menu');
    const changeNameBtn = document.getElementById('change-name-btn');
    const signOutBtn = document.getElementById('signout-btn');
    const friendsBtn = document.getElementById('friends-btn');
    const userEmailEl = document.getElementById('user-email');

    if (this.user) {
      authSection.classList.add('hidden');
      mainMenu.classList.remove('hidden');

      if (this.user.username) {
        document.getElementById('user-name').textContent = `${this.user.displayName} (@${this.user.username})`;
      } else {
        document.getElementById('user-name').textContent = this.user.displayName;
      }

      if (this.user.isAnonymous) {
        changeNameBtn?.classList.remove('hidden');
        signOutBtn?.classList.add('hidden');
        friendsBtn?.classList.add('hidden');
        userEmailEl?.classList.add('hidden');
      } else {
        changeNameBtn?.classList.add('hidden');
        signOutBtn?.classList.remove('hidden');
        friendsBtn?.classList.remove('hidden');
        if (this.user.email) {
          userEmailEl.textContent = this.user.email;
          userEmailEl?.classList.remove('hidden');
        } else {
          userEmailEl?.classList.add('hidden');
        }
      }
    } else {
      authSection.classList.remove('hidden');
      mainMenu.classList.add('hidden');
    }
  }

  // Record a finished game. Writes a `games` history doc (now enriched with a
  // `rounds` array so the stats dashboard can plot every guess on "Your Map",
  // and an `eloAfter` snapshot for the ELO-history chart) and updates the
  // user's aggregate stats. The rounds array is optional so older callers
  // still work; each entry is {lat,lng,distance,points,mode}.
  async saveGameScore(score, mode, rounds) {
    if (!this.user) return;
    try {
      const userRef = doc(this.db, 'users', this.user.uid);
      // Read the user doc first so we can stamp the post-game ELO onto the
      // game doc (updateElo, if any, runs before this in showFinalScore).
      const userDoc = await getDoc(userRef);
      const userData = userDoc.exists() ? userDoc.data() : {};

      const gameDoc = {
        uid: this.user.uid,
        displayName: this.user.displayName,
        score: score,
        mode: mode,
        timestamp: serverTimestamp(),
      };
      if (Array.isArray(rounds) && rounds.length) gameDoc.rounds = rounds;
      if (typeof userData.elo === 'number') gameDoc.eloAfter = userData.elo;
      await addDoc(collection(this.db, 'games'), gameDoc);

      if (userDoc.exists()) {
        await updateDoc(userRef, {
          totalGames: increment(1),
          totalScore: increment(score),
          bestScore: Math.max(userData.bestScore || 0, score),
          lastPlayed: serverTimestamp(),
        });
      }
    } catch (error) {
      console.error('Error saving score:', error);
    }
  }

  // Unlock one or more achievements on the user's doc. Returns only the ids
  // that were NEWLY unlocked (so the UI can toast them). No-op for guests.
  // Rules: a user may update their own doc freely (isOwner, no field guard),
  // so writing `achievements.{id}` needs no rules change.
  async unlockAchievements(ids) {
    if (!this.user || this.user.isAnonymous || !Array.isArray(ids) || ids.length === 0) return [];
    try {
      const ref = doc(this.db, 'users', this.user.uid);
      const snap = await getDoc(ref);
      const current = (snap.exists() && snap.data().achievements) || {};
      const fresh = ids.filter((id) => !current[id]);
      if (fresh.length === 0) return [];
      const update = {};
      fresh.forEach((id) => { update[`achievements.${id}`] = true; });
      await updateDoc(ref, update);
      return fresh;
    } catch (error) {
      console.error('Error unlocking achievements:', error);
      return [];
    }
  }

  // Record that the user played a mode. Returns true if this completed the
  // Globe Trotter achievement (played every mode). No-op for guests.
  async recordModePlayed(mode) {
    if (!this.user || this.user.isAnonymous) return false;
    try {
      const ref = doc(this.db, 'users', this.user.uid);
      await updateDoc(ref, { modesPlayed: arrayUnion(mode) });
      const snap = await getDoc(ref);
      const modes = (snap.exists() && snap.data().modesPlayed) || [];
      return ALL_MODES.every((m) => modes.includes(m));
    } catch (error) {
      console.error('Error recording mode played:', error);
      return false;
    }
  }

  // Update the multiplayer win streak. `won` true => increment, false => reset
  // to 0 (any non-win breaks the streak). Unlocks winStreak5 at 5+. Returns
  // { winStreak, unlocked }. No-op for guests (ranked/MP features are gated).
  async recordMultiplayerResult(won) {
    if (!this.user || this.user.isAnonymous) return { winStreak: 0, unlocked: false };
    try {
      const ref = doc(this.db, 'users', this.user.uid);
      const snap = await getDoc(ref);
      const cur = (snap.exists() && snap.data().winStreak) || 0;
      const next = won ? cur + 1 : 0;
      await updateDoc(ref, { winStreak: next });
      const unlocked = next >= 5;
      if (unlocked) await this.unlockAchievements(['winStreak5']);
      return { winStreak: next, unlocked };
    } catch (error) {
      console.error('Error recording multiplayer result:', error);
      return { winStreak: 0, unlocked: false };
    }
  }

  // Fetch the user's own profile doc (achievements, stats, modesPlayed,
  // winStreak, elo) for the Profile/Stats screen.
  async getMyProfile() {
    if (!this.user) return null;
    try {
      const snap = await getDoc(doc(this.db, 'users', this.user.uid));
      return snap.exists() ? snap.data() : null;
    } catch (error) {
      console.error('Error getting profile:', error);
      return null;
    }
  }

  // Fetch the current user's game history (newest first) — the per-round
  // `rounds` array on each doc powers the "Your Map" heatmap. Scoped to the
  // signed-in user (the global getRecentGames is leaderboard-oriented).
  async getMyGames(limitCount = 50) {
    if (!this.user) return [];
    try {
      const q = query(
        collection(this.db, 'games'),
        where('uid', '==', this.user.uid),
        orderBy('timestamp', 'desc'),
        limit(limitCount),
      );
      const snapshot = await getDocs(q);
      return snapshot.docs.map((d) => d.data());
    } catch (error) {
      console.error('Error getting my games:', error);
      return [];
    }
  }

  async getLeaderboard(mode = 'all', limitCount = 10) {
    try {
      const q = query(
        collection(this.db, 'users'),
        where('totalGames', '>', 0),
        orderBy('bestScore', 'desc'),
        limit(limitCount)
      );
      const snapshot = await getDocs(q);
      return snapshot.docs.map((d) => d.data());
    } catch (error) {
      console.error('Error getting leaderboard:', error);
      return [];
    }
  }

  // Leaderboard ordered by ELO rating. The `elo >= 0` inequality both filters
  // out unrated (guest) profiles — which have no `elo` field and so never
  // satisfy the inequality — and satisfies Firestore's orderBy-must-match-
  // inequality-field requirement.
  async getLeaderboardByElo(limitCount = 20) {
    try {
      const q = query(
        collection(this.db, 'users'),
        where('elo', '>=', 0),
        orderBy('elo', 'desc'),
        limit(limitCount)
      );
      const snapshot = await getDocs(q);
      return snapshot.docs.map((d) => d.data());
    } catch (error) {
      console.error('Error getting elo leaderboard:', error);
      return [];
    }
  }

  // Read the current user's ELO (default 1000 for unrated/guest accounts).
  async getMyElo() {
    if (!this.user) return DEFAULT_RATING;
    try {
      const snap = await getDoc(doc(this.db, 'users', this.user.uid));
      if (snap.exists()) return snap.data().elo || DEFAULT_RATING;
    } catch (error) {
      console.error('Error getting elo:', error);
    }
    return DEFAULT_RATING;
  }

  // Write the current user's new ELO after a ranked game. Only email users are
  // rated; guests are skipped. Security rules let a user update their own doc
  // freely (the isOwner branch has no field restriction).
  async updateElo(newElo) {
    if (!this.user || this.user.isAnonymous) return;
    try {
      await updateDoc(doc(this.db, 'users', this.user.uid), {
        elo: newElo,
        lastPlayed: serverTimestamp(),
      });
      this.user.elo = newElo;
    } catch (error) {
      console.error('Error updating elo:', error);
    }
  }

  async getRecentGames(limitCount = 10) {
    try {
      const q = query(collection(this.db, 'games'), orderBy('timestamp', 'desc'), limit(limitCount));
      const snapshot = await getDocs(q);
      return snapshot.docs.map((d) => d.data());
    } catch (error) {
      console.error('Error getting recent games:', error);
      return [];
    }
  }
}

export const authService = new AuthService();
export default AuthService;