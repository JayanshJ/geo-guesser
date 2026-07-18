// Pong online networking — reuses GeoGuesser's exact room/join-code mechanism,
// connection layer (Firestore onSnapshot/updateDoc/setDoc/getDoc), and player
// identity (authService.user / .db). We do NOT reuse multiplayerService.createGame
// (it generates GeoGuesser locations for a mode); instead we write a
// `multiplayer_games` doc directly with mode 'pong' and the control fields the
// security rules freeze (so non-host paddle writes pass). The 6-char room code
// generator IS reused verbatim from multiplayerService.
//
//   ponytail: Firestore charges per doc write. We cap the host to ~20Hz and the
//   guest to ~30Hz with a one-in-flight guard per direction, so writes never
//   queue faster than Firestore can ack — under throttle the guest's 100ms
//   interpolation smooths the lower effective rate. Sustained Firestore doc-write
//   throughput is the real ceiling; if a low-latency match is needed later, swap
//   this transport for Realtime DB / WebRTC without touching the game engine
//   (the Pong class only sees onHostSnapshot/onGuestPaddle/applyRemoteState).
import {
  doc, setDoc, getDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp,
} from 'firebase/firestore';
import { authService } from './auth.js';
import { multiplayerService } from './multiplayer.js';

class PongNetService {
  constructor() {
    this.db = null;
    this.roomCode = null;
    this.ref = null;
    this.unsub = null;
    this.onUpdate = null;
    this.role = null;          // 'host' | 'guest'
    this.opponentUid = null;
    // Write throttling / in-flight guards (one per direction).
    this._hostInFlight = false;
    this._hostLastWrite = 0;
    this._guestInFlight = false;
    this._guestLastWrite = 0;
    this._hostTimer = null;
    this._guestTimer = null;
    this._pendingHost = null;
    this._pendingGuestY = null;
    this._pendingGuestT = null;
  }

  _ready() {
    if (!authService.user || !authService.db) return false;
    this.db = authService.db;
    return true;
  }

  async createRoom() {
    if (!this._ready()) return null;
    this.role = 'host';
    this.roomCode = multiplayerService.generateRoomCode(); // reused verbatim
    this.ref = doc(this.db, 'multiplayer_games', this.roomCode);
    const uid = authService.user.uid;
    const gameData = {
      id: this.roomCode,
      roomCode: this.roomCode,
      host: { uid, displayName: authService.user.displayName },
      mode: 'pong',
      timeControl: 'classic',
      nmpz: false,
      status: 'waiting',
      currentRound: 1,
      totalRounds: 1,
      maxPlayers: 2,
      locations: [],
      resolvedLocations: {},
      players: {
        [uid]: {
          uid, displayName: authService.user.displayName,
          isHost: true, score: 0, guesses: {},
          paddleY: 225, joinedAt: serverTimestamp(),
        },
      },
      createdAt: serverTimestamp(),
      pong: { bx: 400, by: 225, bvx: 0, bvy: 0, ly: 225, ry: 225, sl: 0, sr: 0, rally: 0, phase: 'countdown', win: null, cd: 3, t: Date.now(), echo: null },
    };
    await setDoc(this.ref, gameData);
    this._listen();
    return this.roomCode;
  }

  async joinRoom(code) {
    if (!this._ready()) return { success: false, error: 'Not signed in' };
    const c = code.toUpperCase().trim();
    if (c.length !== 6) return { success: false, error: 'Room code should be 6 characters' };
    this.ref = doc(this.db, 'multiplayer_games', c);
    const snap = await getDoc(this.ref);
    if (!snap.exists) return { success: false, error: 'Room not found. Check the code and try again.' };
    const data = snap.data();
    if (data.mode !== 'pong') return { success: false, error: 'That room is not a Pong game.' };
    if (data.status === 'finished' || data.status === 'abandoned') return { success: false, error: 'This game has ended.' };
    const players = data.players || {};
    const uids = Object.keys(players);
    if (uids.length >= 2 && !players[authService.user.uid]) return { success: false, error: 'This room is full.' };
    this.role = 'guest';
    this.roomCode = c;
    this.opponentUid = data.host.uid;
    // Add ourselves as the guest (non-host paddle write path the rules allow).
    if (!players[authService.user.uid]) {
      await updateDoc(this.ref, {
        [`players.${authService.user.uid}`]: {
          uid: authService.user.uid, displayName: authService.user.displayName,
          isHost: false, score: 0, guesses: {},
          paddleY: 225, paddleT: Date.now(), joinedAt: serverTimestamp(),
        },
      });
    }
    this._listen();
    return { success: true };
  }

  _listen() {
    if (this.unsub) this.unsub();
    this.unsub = onSnapshot(this.ref, (snap) => {
      if (!snap.exists) { this.onUpdate?.(null); return; }
      this.onUpdate?.(snap.data());
    });
  }

  // Host: ship a full game state. Throttled to 50ms (20Hz) + one in flight.
  writeHostState(state) {
    this._pendingHost = state;
    const now = Date.now();
    if (this._hostInFlight || now - this._hostLastWrite < 50) {
      if (!this._hostTimer) this._hostTimer = setTimeout(() => this._flushHost(), 50);
      return;
    }
    this._flushHost();
  }
  _flushHost() {
    this._hostTimer = null;
    if (!this.ref || !this._pendingHost) return;
    const state = this._pendingHost;
    this._hostInFlight = true;
    this._hostLastWrite = Date.now();
    updateDoc(this.ref, { pong: state })
      .then(() => { this._hostInFlight = false; })
      .catch((e) => { this._hostInFlight = false; console.warn('pong host write', e); });
  }

  // Guest: send our paddle Y. Throttled to ~33ms (30Hz) + one in flight.
  writeGuestPaddle(y) {
    this._pendingGuestY = y;
    this._pendingGuestT = Date.now();
    const now = Date.now();
    if (this._guestInFlight || now - this._guestLastWrite < 33) {
      if (!this._guestTimer) this._guestTimer = setTimeout(() => this._flushGuest(), 33);
      return;
    }
    this._flushGuest();
  }
  _flushGuest() {
    this._guestTimer = null;
    if (!this.ref || !authService.user || this._pendingGuestY === null) return;
    const uid = authService.user.uid;
    this._guestInFlight = true;
    this._guestLastWrite = Date.now();
    updateDoc(this.ref, {
      [`players.${uid}.paddleY`]: this._pendingGuestY,
      [`players.${uid}.paddleT`]: this._pendingGuestT,
    })
      .then(() => { this._guestInFlight = false; })
      .catch((e) => { this._guestInFlight = false; console.warn('pong guest write', e); });
  }

  // Host flips status → 'playing' once the guest has joined.
  async setPlaying() {
    if (!this.ref || this.role !== 'host') return;
    try { await updateDoc(this.ref, { status: 'playing', startedAt: serverTimestamp() }); }
    catch (e) { console.warn('pong setPlaying', e); }
  }

  // Host rematch: create a fresh room, stamp rematchRoomCode on the OLD doc so
  // the guest one-click rejoins (mirrors multiplayerService.rematch). Capture
  // oldRef BEFORE createRoom overwrites this.ref — otherwise we'd stamp the new
  // doc and the guest would never see the code.
  async rematch() {
    if (this.role !== 'host') return null;
    const oldRef = this.ref;
    const newCode = await this.createRoom();
    if (newCode && oldRef) {
      try { await updateDoc(oldRef, { status: 'finished', rematchRoomCode: newCode, rematchAt: serverTimestamp() }); }
      catch (e) { console.warn('pong rematch stamp', e); }
    }
    return newCode;
  }

  async joinRematch(code) {
    return this.joinRoom(code);
  }

  // Leave / forfeit. Waiting host deletes the doc; otherwise mark abandoned so
  // the opponent's listener shows "OPPONENT LEFT". Guards ref-clearing so a
  // concurrent createRoom/joinRoom (rematch flow) isn't clobbered: only null
  // this.ref if it's still the one we're leaving.
  async leave() {
    if (this.unsub) { this.unsub(); this.unsub = null; }
    if (this._hostTimer) { clearTimeout(this._hostTimer); this._hostTimer = null; }
    if (this._guestTimer) { clearTimeout(this._guestTimer); this._guestTimer = null; }
    const leavingRef = this.ref;
    if (leavingRef && authService.user) {
      try {
        const snap = await getDoc(leavingRef);
        const data = snap.exists ? snap.data() : null;
        if (this.role === 'host' && data && data.status === 'waiting') {
          await deleteDoc(leavingRef);
        } else if (data && data.status !== 'abandoned' && data.status !== 'finished') {
          await updateDoc(leavingRef, {
            status: 'abandoned', abandonedBy: authService.user.uid, abandonedAt: serverTimestamp(),
          });
        }
      } catch (e) { console.warn('pong leave', e); }
    }
    if (this.ref === leavingRef) {
      this.ref = null; this.roomCode = null; this.role = null;
    }
  }
}

export const pongNetService = new PongNetService();
export default PongNetService;