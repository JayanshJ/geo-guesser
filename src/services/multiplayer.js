// Multiplayer room + realtime game-state service. The `multiplayer_games` doc
// (id = 6-char room code) holds shared locations, per-player scores/guesses, and
// resolved panorama coords. An onSnapshot listener drives lobby + in-game UI.
import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  increment,
  deleteField,
  addDoc,
  query,
  orderBy,
  limit,
} from 'firebase/firestore';
import { authService } from './auth.js';
import { LocationGenerator } from '../game/locations.js';

class MultiplayerService {
  constructor(auth) {
    this.authService = auth;
    this.db = null;
    this.currentGame = null;
    this.gameListener = null;
    this.messagesListener = null;
    this.roomCode = null;
  }

  // 6-char room code; alphabet excludes ambiguous chars (0, O, I, 1).
  generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  // Generate `count` curated coords for the given mode (shared generator).
  // Excludes coords used in the host's recent games for cross-game variety,
  // then records the picks as used.
  generateLocationsForMode(mode, count) {
    const recent = LocationGenerator.recentForMode(mode);
    const picks = LocationGenerator.curated(mode, count, recent);
    LocationGenerator.markUsed(mode, picks);
    return picks;
  }

  async createGame(mode, timeControl = 'unlimited', maxPlayers = 8, nmpz = false) {
    if (!this.authService.user) return null;
    this.db = this.authService.db;
    this.roomCode = this.generateRoomCode();
    const locations = this.generateLocationsForMode(mode, 5);

    const gameRef = doc(this.db, 'multiplayer_games', this.roomCode);
    const gameData = {
      id: this.roomCode,
      roomCode: this.roomCode,
      host: {
        uid: this.authService.user.uid,
        displayName: this.authService.user.displayName,
      },
      mode: mode,
      timeControl: timeControl,
      nmpz: !!nmpz,
      status: 'waiting', // waiting | playing | finished | abandoned
      currentRound: 1,
      totalRounds: 5,
      maxPlayers: maxPlayers,
      locations: locations,
      players: {
        [this.authService.user.uid]: {
          uid: this.authService.user.uid,
          displayName: this.authService.user.displayName,
          isHost: true,
          score: 0,
          guesses: {},
          joinedAt: serverTimestamp(),
        },
      },
      createdAt: serverTimestamp(),
    };

    await setDoc(gameRef, gameData);
    this.currentGame = { ref: gameRef, data: gameData };
    this.listenToGame(this.roomCode);
    return this.roomCode;
  }

  async joinGameByCode(roomCode) {
    if (!this.authService.user) return { success: false, error: 'Not logged in' };
    this.db = this.authService.db;

    const code = roomCode.toUpperCase().trim();
    const gameRef = doc(this.db, 'multiplayer_games', code);
    const gameDoc = await getDoc(gameRef);

    if (!gameDoc.exists) return { success: false, error: 'Room not found. Check the code and try again.' };

    const gameData = gameDoc.data();
    if (gameData.status !== 'waiting') return { success: false, error: 'This game has already started.' };

    // Already in the game -> reconnect.
    if (gameData.players && gameData.players[this.authService.user.uid]) {
      this.roomCode = code;
      this.currentGame = { ref: gameRef, data: gameData };
      this.listenToGame(code);
      return { success: true };
    }

    const currentPlayerCount = gameData.players ? Object.keys(gameData.players).length : 0;
    if (currentPlayerCount >= gameData.maxPlayers) {
      return { success: false, error: 'This room is full.' };
    }

    await updateDoc(gameRef, {
      [`players.${this.authService.user.uid}`]: {
        uid: this.authService.user.uid,
        displayName: this.authService.user.displayName,
        isHost: false,
        score: 0,
        guesses: {},
        joinedAt: serverTimestamp(),
      },
    });

    const updatedGameData = {
      ...gameData,
      players: {
        ...gameData.players,
        [this.authService.user.uid]: {
          uid: this.authService.user.uid,
          displayName: this.authService.user.displayName,
          isHost: false,
          score: 0,
          guesses: {},
          joinedAt: new Date(),
        },
      },
    };
    this.currentGame = { ref: gameRef, data: updatedGameData };
    this.roomCode = code;
    this.listenToGame(code);
    return { success: true };
  }

  listenToGame(roomCode) {
    if (this.gameListener) this.gameListener();

    const gameRef = doc(this.db, 'multiplayer_games', roomCode);
    this.gameListener = onSnapshot(gameRef, (snap) => {
      if (snap.exists) {
        const gameData = snap.data();
        this.currentGame = { ref: gameRef, data: gameData };
        this.onGameUpdate(gameData);
      }
    });
  }

  async submitGuess(round, location, distance, points, basePoints) {
    if (!this.currentGame || !this.authService.user) return;
    const uid = this.authService.user.uid;
    const update = {
      [`players.${uid}.guesses.${round}`]: {
        location: location,
        distance: distance,
        points: points,
        timestamp: serverTimestamp(),
      },
      [`players.${uid}.score`]: increment(points),
    };
    // baseScore is the distance-only total used for ranked ELO (kept pure,
    // separate from the arcade score that includes speed/streak bonuses).
    if (typeof basePoints === 'number') {
      update[`players.${uid}.baseScore`] = increment(basePoints);
    }
    await updateDoc(this.currentGame.ref, update);
  }

  async saveResolvedLocation(roundIndex, resolvedLocation) {
    if (!this.currentGame) return;
    try {
      await updateDoc(this.currentGame.ref, {
        [`resolvedLocations.${roundIndex}`]: resolvedLocation,
      });
    } catch (e) {
      console.error('Error saving resolved location:', e);
    }
  }

  // Each rated (email) player stamps their pre-game ELO onto their own player
  // entry at game start. This lets every client deterministically compute ELO
  // updates at game end from the shared `players` map (eloStart + final score)
  // without any cross-user writes. Allowed by rules: a non-host may update
  // their own `players.{uid}` entry (control fields stay frozen).
  async setMyEloStart(elo) {
    if (!this.currentGame || !this.authService.user) return;
    try {
      await updateDoc(this.currentGame.ref, {
        [`players.${this.authService.user.uid}.eloStart`]: elo,
      });
    } catch (e) {
      console.error('Error setting eloStart:', e);
    }
  }

  // Host-initiated rematch: create a fresh game with the same mode/time/nmpz,
  // then stamp `rematchRoomCode` onto the finished game so opponents still
  // listening can one-click join. Returns the new room code (host path) or
  // null. Non-hosts join via `joinGameByCode(rematchRoomCode)`.
  async rematch() {
    if (!this.currentGame) return null;
    const oldRef = this.currentGame.ref;
    const data = this.currentGame.data;
    if (data.host.uid !== this.authService.user.uid) return null;
    const newCode = await this.createGame(data.mode, data.timeControl, data.maxPlayers, data.nmpz);
    if (newCode) {
      try {
        await updateDoc(oldRef, {
          status: 'finished',
          rematchRoomCode: newCode,
          rematchAt: serverTimestamp(),
        });
      } catch (e) {
        console.error('Error writing rematchRoomCode:', e);
      }
    }
    return newCode;
  }

  // ---- In-game chat (messages subcollection) ----
  async sendMessage(text) {
    if (!this.currentGame || !this.authService.user || !text) return;
    const trimmed = text.trim().slice(0, 280);
    if (!trimmed) return;
    try {
      await addDoc(collection(this.db, 'multiplayer_games', this.roomCode, 'messages'), {
        uid: this.authService.user.uid,
        displayName: this.authService.user.displayName,
        text: trimmed,
        timestamp: serverTimestamp(),
      });
    } catch (e) {
      console.error('Error sending message:', e);
    }
  }

  listenToMessages(cb) {
    if (!this.currentGame || !this.roomCode) return;
    this.stopListeningToMessages();
    const q = query(
      collection(this.db, 'multiplayer_games', this.roomCode, 'messages'),
      orderBy('timestamp', 'asc'),
      limit(100)
    );
    this.messagesListener = onSnapshot(q, (snap) => {
      cb(snap.docs.map((d) => d.data()));
    });
  }

  stopListeningToMessages() {
    if (this.messagesListener) {
      this.messagesListener();
      this.messagesListener = null;
    }
  }

  async startGame() {
    if (!this.currentGame) return { success: false, error: 'No active game' };
    const isHost = this.currentGame.data.host.uid === this.authService.user.uid;
    if (!isHost) return { success: false, error: 'Only the host can start the game' };

    const playerCount = this.currentGame.data.players ? Object.keys(this.currentGame.data.players).length : 0;
    if (playerCount < 2) return { success: false, error: 'Need at least 2 players to start' };

    await updateDoc(this.currentGame.ref, {
      status: 'playing',
      startedAt: serverTimestamp(),
    });
    return { success: true };
  }

  onGameUpdate(gameData) {
    if (gameData.status === 'abandoned') {
      if (window.gameController) window.gameController.showOpponentLeftModal();
      return;
    }
    if (window.multiplayerGameUpdate) window.multiplayerGameUpdate(gameData);
  }

  async notifyPlayerLeft() {
    if (!this.currentGame) return;
    try {
      await updateDoc(this.currentGame.ref, {
        status: 'abandoned',
        abandonedBy: this.authService.user.uid,
        abandonedAt: serverTimestamp(),
      });
    } catch (e) {
      console.log('Could not update game status:', e);
    }
  }

  async leaveGame() {
    if (this.gameListener) {
      this.gameListener();
      this.gameListener = null;
    }
    this.stopListeningToMessages();

    if (this.currentGame && this.authService.user) {
      try {
        const gameData = this.currentGame.data;
        const isHost = gameData.host.uid === this.authService.user.uid;

        if (gameData.status === 'waiting') {
          if (isHost) {
            await deleteDoc(this.currentGame.ref);
          } else {
            await updateDoc(this.currentGame.ref, {
              [`players.${this.authService.user.uid}`]: deleteField(),
            });
          }
        } else if (gameData.status === 'playing') {
          await updateDoc(this.currentGame.ref, {
            [`players.${this.authService.user.uid}.hasLeft`]: true,
            [`players.${this.authService.user.uid}.leftAt`]: serverTimestamp(),
          });
        }
      } catch (e) {
        console.log('Could not update game:', e);
      }
    }

    this.currentGame = null;
    this.roomCode = null;
  }
}

export const multiplayerService = new MultiplayerService(authService);
export default MultiplayerService;