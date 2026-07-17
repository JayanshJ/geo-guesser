// Skill-based ranked matchmaking. An alternative to room codes: a player
// queues up and is paired with a nearby-rated opponent.
//
// Firestore `matchmaking/{uid}` docs hold each searcher's rating + mode. To
// avoid both players trying to claim each other at once, only the player whose
// uid is lexicographically GREATER initiates a match for a given pair (the
// "uid < myUid" filter below). The initiator creates the game, then a
// transaction atomically flips both docs searching -> matched (only if both
// are still searching), so a pair is claimed by exactly one side. Each client
// listens to its own doc; on `matched` it joins the shared game.
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  serverTimestamp,
  runTransaction,
} from 'firebase/firestore';
import { authService } from './auth.js';
import { multiplayerService } from './multiplayer.js';

class MatchmakingService {
  constructor(auth, multiplayer) {
    this.authService = auth;
    this.multiplayer = multiplayer;
    this.db = null;
    this.mode = null;
    this.timeControl = 'unlimited';
    this.myElo = 1000;
    this.searchInterval = null;
    this.myListener = null;
    this.searching = false;
  }

  // Enter the queue for `mode`. Returns false if the user can't be rated.
  async findMatch(mode, timeControl = 'unlimited', nmpz = false) {
    if (!this.authService.user || this.authService.user.isAnonymous) return false;
    this.db = this.authService.db;
    this.mode = mode;
    this.timeControl = timeControl;
    this.nmpz = nmpz;
    this.myElo = await this.authService.getMyElo();
    this.searching = true;

    const uid = this.authService.user.uid;
    const myRef = doc(this.db, 'matchmaking', uid);
    await setDoc(myRef, {
      uid,
      displayName: this.authService.user.displayName,
      elo: this.myElo,
      mode,
      timeControl,
      status: 'searching',
      createdAt: serverTimestamp(),
    });

    // When someone matches us, join their game.
    this.myListener = onSnapshot(myRef, (snap) => {
      const data = snap.data();
      if (data && data.status === 'matched' && data.roomCode) {
        this.stopSearch();
        this.joinMatchedGame(data.roomCode);
      }
    });

    // Poll for an opponent every 3s (immediate first attempt).
    this.tryMatch();
    this.searchInterval = setInterval(() => this.tryMatch(), 3000);
    return true;
  }

  async tryMatch() {
    if (!this.searching) return;
    const me = this.authService.user.uid;

    // Only initiate toward opponents with a smaller uid (breaks symmetry so a
    // pair is claimed by exactly one side).
    const q = query(
      collection(this.db, 'matchmaking'),
      where('status', '==', 'searching'),
      where('mode', '==', this.mode)
    );
    const snap = await getDocs(q);
    const opponents = snap.docs
      .map((d) => d.data())
      .filter((d) => d.uid < me && typeof d.elo === 'number');
    if (opponents.length === 0) return;

    // Closest rating first.
    opponents.sort((a, b) => Math.abs(a.elo - this.myElo) - Math.abs(b.elo - this.myElo));
    const target = opponents[0];

    // Create the game as host, then atomically claim the pair.
    const roomCode = await this.multiplayer.createGame(this.mode, this.timeControl, 8, this.nmpz);
    if (!roomCode) return;
    try {
      await runTransaction(this.db, async (tx) => {
        const mySnap = await tx.get(doc(this.db, 'matchmaking', me));
        const tSnap = await tx.get(doc(this.db, 'matchmaking', target.uid));
        if (!mySnap.exists() || mySnap.data().status !== 'searching') throw new Error('SELF_GONE');
        if (!tSnap.exists() || tSnap.data().status !== 'searching') throw new Error('TAKEN');
        tx.update(doc(this.db, 'matchmaking', me), {
          status: 'matched',
          roomCode,
          matchedAt: serverTimestamp(),
        });
        tx.update(doc(this.db, 'matchmaking', target.uid), {
          status: 'matched',
          roomCode,
          matchedAt: serverTimestamp(),
        });
      });
      // Claimed: I'm the host. Hand off to the UI to show the lobby.
      this.stopSearch();
      if (window.uiController) window.uiController.onMatchFound(roomCode, true);
    } catch {
      // Someone else claimed the opponent (or we were matched ourselves): drop
      // the game we just created and keep searching.
      await this.multiplayer.leaveGame();
    }
  }

  // Responder path: join the game the initiator created, then show the lobby.
  async joinMatchedGame(roomCode) {
    const result = await this.multiplayer.joinGameByCode(roomCode);
    if (window.uiController) window.uiController.onMatchFound(roomCode, result.success);
  }

  // Stop polling + listening and remove our queue doc. Called on match, cancel,
  // or sign-out. `removeDoc` defaults to true (clean up the queue entry).
  stopSearch(removeDoc = true) {
    this.searching = false;
    if (this.searchInterval) {
      clearInterval(this.searchInterval);
      this.searchInterval = null;
    }
    if (this.myListener) {
      this.myListener();
      this.myListener = null;
    }
    if (removeDoc && this.authService.user) {
      deleteDoc(doc(this.db, 'matchmaking', this.authService.user.uid)).catch(() => {});
    }
  }

  // User-cancelled search: tear down the queue entry and any half-created game.
  async cancel() {
    this.stopSearch();
    if (this.multiplayer.currentGame) {
      await this.multiplayer.leaveGame();
    }
  }
}

export const matchmakingService = new MatchmakingService(authService, multiplayerService);
export default MatchmakingService;