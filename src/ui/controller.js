// UI controller - all DOM event wiring, screen navigation, and rendering of
// auth/friends/lobby/leaderboard. Uses element ids as the HTML<->JS contract.
// `window.gameController` (set in app.js) is used to start games; inline
// `onclick="uiController.x()"` handlers rely on `window.uiController`.
import { authService } from '../services/auth.js';
import { multiplayerService } from '../services/multiplayer.js';
import { friendsService } from '../services/friends.js';
import { getModeMeta } from '../game/locations.js';
import { arcadeFX } from '../game/arcade.js';
import { ACHIEVEMENTS, ALL_MODES, availablePins, pinEmoji } from '../game/achievements.js';
import { ARCADE_MAP_STYLE } from '../game/mapStyle.js';

class UIController {
  constructor(auth, multiplayer, friends) {
    this.auth = auth;
    this.multiplayer = multiplayer;
    this.friends = friends;
    this.pendingGameMode = null;
    this.pendingIsMultiplayer = false;
    this.pendingInviteFriendId = null; // set when inviting a friend (vs. creating a normal room)
    this.multiplayerGameStarted = false;
    this.currentInvite = null;
    this.setupEventListeners();
    this.setupFriendsListeners();
  }

  setupEventListeners() {
    // Auth - Sign In/Sign Up
    document.getElementById('show-signin-btn')?.addEventListener('click', () => this.showSignIn());
    document.getElementById('show-signup-btn')?.addEventListener('click', () => this.showSignUp());
    document.getElementById('signin-submit-btn')?.addEventListener('click', () => this.handleSignIn());
    document.getElementById('signup-submit-btn')?.addEventListener('click', () => this.handleSignUp());
    document.getElementById('signin-cancel-btn')?.addEventListener('click', () => this.cancelAuth());
    document.getElementById('signup-cancel-btn')?.addEventListener('click', () => this.cancelAuth());
    document.getElementById('signout-btn')?.addEventListener('click', () => this.handleSignOut());
    document.getElementById('forgot-password-link')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.showForgotPassword();
    });
    document.getElementById('forgot-submit-btn')?.addEventListener('click', () => this.handleForgotPassword());
    document.getElementById('forgot-cancel-btn')?.addEventListener('click', () => this.showSignIn());

    document.getElementById('signup-password')?.addEventListener('input', (e) => this.updatePasswordStrength(e.target.value));
    document.getElementById('signup-password-confirm')?.addEventListener('input', () => this.validatePasswordMatch());

    document.getElementById('signin-password')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.handleSignIn();
    });
    document.getElementById('signup-password-confirm')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.handleSignUp();
    });
    document.getElementById('forgot-email')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.handleForgotPassword();
    });

    // Name entry
    document.getElementById('start-playing-btn').addEventListener('click', () => this.handleStartPlaying());
    document.getElementById('player-name-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.handleStartPlaying();
    });
    document.getElementById('change-name-btn').addEventListener('click', () => this.handleChangeName());

    // Solo mode buttons
    document.getElementById('solo-world-btn').addEventListener('click', () => this.showTimeSelection('world', false));
    document.getElementById('solo-india-btn').addEventListener('click', () => this.showTimeSelection('india', false));
    document.getElementById('solo-europe-btn')?.addEventListener('click', () => this.showTimeSelection('europe', false));
    document.getElementById('solo-us-btn')?.addEventListener('click', () => this.showTimeSelection('us', false));
    document.getElementById('solo-asia-btn')?.addEventListener('click', () => this.showTimeSelection('asia', false));
    document.getElementById('solo-landmarks-btn')?.addEventListener('click', () => this.showTimeSelection('landmarks', false));

    // Multiplayer - Create game buttons
    document.getElementById('create-world-btn').addEventListener('click', () => this.showTimeSelection('world', true));
    document.getElementById('create-india-btn').addEventListener('click', () => this.showTimeSelection('india', true));
    document.getElementById('create-europe-btn')?.addEventListener('click', () => this.showTimeSelection('europe', true));
    document.getElementById('create-us-btn')?.addEventListener('click', () => this.showTimeSelection('us', true));
    document.getElementById('create-asia-btn')?.addEventListener('click', () => this.showTimeSelection('asia', true));
    document.getElementById('create-landmarks-btn')?.addEventListener('click', () => this.showTimeSelection('landmarks', true));

    // Ranked matchmaking buttons (email users only — rating requires an account)
    document.getElementById('ranked-world-btn')?.addEventListener('click', () => this.showRankedTimeSelection('world'));
    document.getElementById('ranked-india-btn')?.addEventListener('click', () => this.showRankedTimeSelection('india'));
    document.getElementById('ranked-europe-btn')?.addEventListener('click', () => this.showRankedTimeSelection('europe'));
    document.getElementById('ranked-us-btn')?.addEventListener('click', () => this.showRankedTimeSelection('us'));
    document.getElementById('ranked-asia-btn')?.addEventListener('click', () => this.showRankedTimeSelection('asia'));
    document.getElementById('ranked-landmarks-btn')?.addEventListener('click', () => this.showRankedTimeSelection('landmarks'));

    // Time control selection
    document.querySelectorAll('.time-option-btn').forEach((btn) => {
      btn.addEventListener('click', () => this.selectTimeControl(btn.dataset.time));
    });
    document.getElementById('cancel-time-select-btn').addEventListener('click', () => this.hideTimeSelection());

    // Multiplayer - Join with room code
    document.getElementById('join-room-btn').addEventListener('click', () => this.joinRoomByCode());
    document.getElementById('room-code-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.joinRoomByCode();
    });

    document.getElementById('copy-code-btn').addEventListener('click', () => this.copyRoomCode());

    // Leaderboard
    document.getElementById('leaderboard-btn').addEventListener('click', () => this.showLeaderboard());
    document.getElementById('close-leaderboard-btn').addEventListener('click', () => this.closeLeaderboard());

    // Profile / Stats dashboard
    document.getElementById('profile-btn')?.addEventListener('click', () => this.showProfile());
    document.getElementById('close-profile-btn')?.addEventListener('click', () => this.showScreen('main-menu'));

    // Sound toggle (arcade FX mute). Persisted in localStorage.
    this.initSoundToggle();

    // Friends
    document.getElementById('close-friends-btn')?.addEventListener('click', () => this.showScreen('main-menu'));

    // Matchmaking / lobby
    document.getElementById('cancel-matchmaking-btn').addEventListener('click', () => this.cancelMatchmaking());
    document.getElementById('leave-lobby-btn').addEventListener('click', () => this.leaveLobby());
    document.getElementById('copy-lobby-code-btn').addEventListener('click', () => this.copyLobbyCode());
    document.getElementById('start-game-btn').addEventListener('click', () => this.startMultiplayerGame());

    // Game controls
    document.getElementById('play-again-btn').addEventListener('click', () => this.backToMenu());
    document.getElementById('opponent-left-ok-btn')?.addEventListener('click', () => this.backToMenu());

    // In-game chat
    document.getElementById('chat-toggle-btn')?.addEventListener('click', () => this.toggleChat());
    document.getElementById('chat-send-btn')?.addEventListener('click', () => this.sendChat());
    document.getElementById('chat-input')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendChat();
    });

    // Rematch (host creates a new game; others join via rematchRoomCode)
    document.getElementById('rematch-btn')?.addEventListener('click', () => this.hostRematch());
    document.getElementById('join-rematch-btn')?.addEventListener('click', () => this.joinRematch());
    document.getElementById('share-result-btn')?.addEventListener('click', () => this.shareResult());
  }

  async handleStartPlaying() {
    const nameInput = document.getElementById('player-name-input');
    const name = nameInput.value.trim();
    if (!name) await this.auth.createUser();
    else await this.auth.createUser(name);
  }

  handleChangeName() {
    const newName = prompt('Enter new name:', this.auth.user?.displayName || '');
    if (newName && newName.trim()) this.auth.changeName(newName.trim());
  }

  showTimeSelection(mode, isMultiplayer) {
    this.pendingGameMode = mode;
    this.pendingIsMultiplayer = isMultiplayer;
    document.getElementById('time-control-modal').classList.remove('hidden');
  }

  hideTimeSelection() {
    document.getElementById('time-control-modal').classList.add('hidden');
    this.pendingGameMode = null;
    this.pendingIsMultiplayer = false;
    this.pendingInviteFriendId = null;
    this.pendingRanked = false;
  }

  selectTimeControl(timeControl) {
    const mode = this.pendingGameMode;
    const isMultiplayer = this.pendingIsMultiplayer;
    const inviteFriendId = this.pendingInviteFriendId;
    const ranked = this.pendingRanked;
    const nmpz = document.getElementById('nmpz-checkbox')?.checked || false;
    document.getElementById('nmpz-checkbox').checked = false;
    this.hideTimeSelection();

    if (ranked) {
      this.startMatchmaking(mode, timeControl, nmpz);
    } else if (inviteFriendId) {
      this.sendGameInvite(inviteFriendId, mode, timeControl, nmpz);
    } else if (isMultiplayer) {
      this.createMultiplayerGame(mode, timeControl, nmpz);
    } else {
      this.startSoloGame(mode, timeControl, nmpz);
    }
  }

  showRankedTimeSelection(mode) {
    if (!this.auth.user || this.auth.user.isAnonymous) {
      alert('Ranked matchmaking requires an email account. Sign in or create one to earn a rating!');
      return;
    }
    this.pendingGameMode = mode;
    this.pendingRanked = true;
    this.pendingIsMultiplayer = false;
    this.pendingInviteFriendId = null;
    document.getElementById('time-control-modal').classList.remove('hidden');
  }

  async startMatchmaking(mode, timeControl = 'unlimited', nmpz = false) {
    this.showScreen('matchmaking-screen');
    document.getElementById('display-room-code').textContent = '------';
    document.getElementById('matchmaking-status').textContent = '⚡ Searching for an opponent...';
    const ok = await this.matchmaking.findMatch(mode, timeControl, nmpz);
    if (!ok) {
      alert('Ranked matchmaking requires an email account.');
      this.showScreen('main-menu');
    }
  }

  // Called by MatchmakingService once a match is secured. The game doc already
  // exists (host created it / responder joined it), so just render the lobby.
  onMatchFound(roomCode, isHost) {
    if (!isHost && !this.multiplayer.currentGame) return; // join failed; stay put
    this.showLobby();
  }

  startSoloGame(mode, timeControl = 'unlimited', nmpz = false) {
    window.gameController.startGame(mode, false, timeControl, { restrictMovement: nmpz });
  }

  async createMultiplayerGame(mode, timeControl = 'unlimited', nmpz = false) {
    this.showScreen('matchmaking-screen');
    this.multiplayerGameStarted = false;
    this.multiplayerTimeControl = timeControl;

    try {
      const roomCode = await this.multiplayer.createGame(mode, timeControl, 8, nmpz);
      if (roomCode) {
        document.getElementById('display-room-code').textContent = roomCode;
        document.getElementById('matchmaking-status').textContent = 'Waiting for opponent to join...';
      } else {
        throw new Error('Failed to get room code');
      }
    } catch (error) {
      console.error('Create game error:', error);
      alert('Failed to create game. Please try again.');
      this.showScreen('main-menu');
    }
  }

  async joinRoomByCode() {
    const codeInput = document.getElementById('room-code-input');
    const code = codeInput.value.trim();
    if (!code) {
      alert('Please enter a room code');
      return;
    }
    if (code.length !== 6) {
      alert('Room code should be 6 characters');
      return;
    }
    try {
      this.multiplayerGameStarted = false;
      const result = await this.multiplayer.joinGameByCode(code);
      if (result.success) this.showLobby();
      else alert(result.error);
    } catch (error) {
      console.error('Join game error:', error);
      alert('Failed to join game. Please try again.');
    }
    codeInput.value = '';
  }

  copyRoomCode() {
    const code = document.getElementById('display-room-code').textContent;
    navigator.clipboard.writeText(code).then(() => {
      const btn = document.getElementById('copy-code-btn');
      btn.textContent = '✓ Copied!';
      setTimeout(() => { btn.textContent = '📋 Copy Code'; }, 2000);
    }).catch(() => {
      alert('Room code: ' + code);
    });
  }

  cancelMatchmaking() {
    // Ranked search uses its own queue + polling loop; tear that down first.
    if (this.matchmaking && this.matchmaking.searching) {
      this.matchmaking.cancel();
    } else {
      this.multiplayer.leaveGame();
    }
    this.multiplayerGameStarted = false;
    this.showScreen('main-menu');
  }

  async leaveLobby() {
    this.stopChat();
    await this.multiplayer.leaveGame();
    this.multiplayerGameStarted = false;
    this.showScreen('main-menu');
  }

  copyLobbyCode() {
    const code = document.getElementById('lobby-room-code').textContent;
    navigator.clipboard.writeText(code).then(() => {
      const btn = document.getElementById('copy-lobby-code-btn');
      const originalText = btn.textContent;
      btn.textContent = '✓ Copied!';
      setTimeout(() => { btn.textContent = originalText; }, 2000);
    }).catch((err) => console.error('Could not copy code:', err));
  }

  async startMultiplayerGame() {
    const result = await this.multiplayer.startGame();
    if (!result.success) alert(result.error);
    // Game auto-starts when status flips to 'playing'.
  }

  showLobby() {
    this.showScreen('lobby-screen');
    const gameData = this.multiplayer.currentGame.data;
    document.getElementById('lobby-room-code').textContent = gameData.roomCode;
    const modeMeta = getModeMeta(gameData.mode);
    document.getElementById('lobby-game-mode').textContent = `Mode: ${modeMeta.emoji} ${modeMeta.label}`;
    this.updateLobbyPlayers(gameData);
  }

  updateLobbyPlayers(gameData) {
    const playersGrid = document.getElementById('lobby-players-grid');
    const players = gameData.players || {};
    const playerCount = Object.keys(players).length;
    const maxPlayers = gameData.maxPlayers || 8;

    document.getElementById('lobby-player-count').textContent = `Players: ${playerCount}/${maxPlayers}`;
    playersGrid.innerHTML = '';

    Object.values(players).forEach((player) => {
      const isYou = player.uid === this.auth.user.uid;
      const isHost = player.isHost;
      const playerCard = document.createElement('div');
      playerCard.className = 'lobby-player-card';
      if (isHost) playerCard.classList.add('is-host');
      if (isYou) playerCard.classList.add('is-you');
      playerCard.innerHTML = `
        <div class="player-avatar-text">${isHost ? '👑' : '🎮'}</div>
        <div class="player-name">${player.displayName}</div>
        <div class="player-label">${isYou ? 'You' : (isHost ? 'Host' : 'Player')}</div>
      `;
      playersGrid.appendChild(playerCard);
    });

    const startBtn = document.getElementById('start-game-btn');
    const isHost = gameData.host.uid === this.auth.user.uid;
    if (isHost && gameData.status === 'waiting') {
      startBtn.classList.remove('hidden');
      startBtn.disabled = playerCount < 2;
      startBtn.textContent = playerCount < 2 ? 'Waiting for players...' : 'Start Game';
    } else {
      startBtn.classList.add('hidden');
    }

    // Auto-start when status flips to 'playing'.
    if (gameData.status === 'playing' && !this.multiplayerGameStarted) {
      this.multiplayerGameStarted = true;
      this.startChat();
      setTimeout(() => {
        const timeControl = gameData.timeControl || 'unlimited';
        window.gameController.startGame(gameData.mode, true, timeControl);
      }, 2000);
    }
  }

  // ---- In-game chat ----
  startChat() {
    document.getElementById('chat-toggle-btn')?.classList.remove('hidden');
    this.multiplayer.listenToMessages((msgs) => this.renderChat(msgs));
  }

  stopChat() {
    this.multiplayer.stopListeningToMessages();
    document.getElementById('chat-toggle-btn')?.classList.add('hidden');
    document.getElementById('chat-panel')?.classList.add('hidden');
  }

  toggleChat() {
    document.getElementById('chat-panel')?.classList.toggle('hidden');
  }

  async sendChat() {
    const input = document.getElementById('chat-input');
    const text = input.value;
    if (!text.trim()) return;
    await this.multiplayer.sendMessage(text);
    input.value = '';
  }

  renderChat(msgs) {
    const box = document.getElementById('chat-messages');
    if (!box) return;
    const wasNearBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 40;
    box.innerHTML = msgs.map((m) => {
      const isYou = m.uid === this.auth.user.uid;
      return `<div class="chat-msg ${isYou ? 'chat-self' : ''}"><span class="chat-name">${isYou ? 'You' : m.displayName}:</span> ${this.escapeChat(m.text)}</div>`;
    }).join('');
    if (wasNearBottom) box.scrollTop = box.scrollHeight;
  }

  escapeChat(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
  }

  // ---- Rematch ----
  async hostRematch() {
    const code = await this.multiplayer.rematch();
    if (code) this.showLobby();
  }

  async joinRematch() {
    const data = this.multiplayer.currentGame && this.multiplayer.currentGame.data;
    if (!data || !data.rematchRoomCode) return;
    const result = await this.multiplayer.joinGameByCode(data.rematchRoomCode);
    if (result.success) this.showLobby();
    else alert(result.error);
  }

  // Realtime hook (called from app.js for multiplayer updates). Toggles the
  // rematch buttons on the final screen as the host creates a new game.
  onMultiplayerUpdate(gameData) {
    const finalScreen = document.getElementById('final-screen');
    if (!finalScreen || finalScreen.classList.contains('hidden')) return;
    const isHost = gameData.host && gameData.host.uid === this.auth.user.uid;
    const rematchBtn = document.getElementById('rematch-btn');
    const joinBtn = document.getElementById('join-rematch-btn');
    if (!rematchBtn || !joinBtn) return;
    if (gameData.rematchRoomCode) {
      rematchBtn.classList.add('hidden');
      joinBtn.classList.toggle('hidden', isHost); // host already moved on
    } else if (isHost) {
      rematchBtn.classList.remove('hidden');
      joinBtn.classList.add('hidden');
    } else {
      rematchBtn.classList.add('hidden');
      joinBtn.classList.add('hidden');
    }
  }

  // Render the result to a canvas and offer it via Web Share (with file) or a
  // plain download fallback. Lets players post a scorecard image.
  async shareResult() {
    const gc = window.gameController;
    if (!gc) return;
    const canvas = document.getElementById('share-canvas');
    const ctx = canvas.getContext('2d');
    const meta = getModeMeta(gc.game.mode);

    ctx.fillStyle = '#1a2236';
    ctx.fillRect(0, 0, 600, 380);
    ctx.fillStyle = '#2a7de1';
    ctx.fillRect(0, 0, 600, 8);

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 36px sans-serif';
    ctx.fillText('🌍 GeoGuesser', 30, 60);
    ctx.font = '18px sans-serif';
    ctx.fillStyle = '#9fb4d6';
    ctx.fillText(`${meta.emoji} ${meta.label} Mode`, 30, 90);

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 48px sans-serif';
    ctx.fillText(`${gc.game.score.toLocaleString()} pts`, 30, 160);
    ctx.font = '16px sans-serif';
    ctx.fillStyle = '#9aa3b5';
    ctx.fillText('out of 25,000', 30, 185);

    let y = 230;
    ctx.font = '15px sans-serif';
    if (gc.game.isMultiplayer && this.multiplayer.currentGame) {
      const players = Object.values(this.multiplayer.currentGame.data.players || {})
        .sort((a, b) => b.score - a.score);
      ctx.fillStyle = '#fff';
      ctx.fillText('Standings:', 30, y);
      y += 24;
      players.slice(0, 5).forEach((p, i) => {
        const isYou = p.uid === this.auth.user.uid;
        ctx.fillStyle = isYou ? '#6d6' : '#ccd';
        ctx.fillText(`${i + 1}. ${isYou ? 'You' : p.displayName} — ${p.score}`, 30, y);
        y += 22;
      });
    } else {
      ctx.fillStyle = '#fff';
      ctx.fillText('Round Breakdown:', 30, y);
      y += 24;
      gc.game.roundResults.forEach((r) => {
        ctx.fillStyle = '#ccd';
        ctx.fillText(`R${r.round}: ${Math.round(r.distance)} km — ${r.points.toLocaleString()} pts`, 30, y);
        y += 22;
      });
    }

    ctx.fillStyle = '#6b7280';
    ctx.font = '12px sans-serif';
    ctx.fillText('Made with GeoGuesser', 30, 365);

    const dataUrl = canvas.toDataURL('image/png');
    try {
      if (navigator.share && navigator.canShare) {
        const blob = await (await fetch(dataUrl)).blob();
        const file = new File([blob], 'geoguesser-result.png', { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: 'GeoGuesser Result' });
          return;
        }
      }
    } catch (e) {
      // fall through to download
    }
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = 'geoguesser-result.png';
    a.click();
  }

  // Best-effort synchronous teardown of listeners on page unload / sign-out.
  cleanupOnExit() {
    try { this.stopChat(); } catch (e) { /* ignore */ }
    if (this.matchmaking && this.matchmaking.searching) this.matchmaking.stopSearch(false);
  }

  async showLeaderboard() {
    this.showScreen('leaderboard-screen');
    this.leaderboardView = this.leaderboardView || 'score';
    await this.renderLeaderboard();
  }

  async toggleLeaderboardView() {
    this.leaderboardView = this.leaderboardView === 'score' ? 'elo' : 'score';
    await this.renderLeaderboard();
  }

  async renderLeaderboard() {
    const content = document.getElementById('leaderboard-content');
    const isElo = this.leaderboardView === 'elo';
    const toggleLabel = isElo ? '🏆 Switch to Top Scores' : '⚡ Switch to Top Ratings';
    const heading = isElo ? '⚡ Top Ratings' : '🏆 Top Scores';

    content.innerHTML = `<div class="leaderboard-toggle"><button id="leaderboard-toggle-btn" class="btn btn-small">${toggleLabel}</button></div><h3>${heading}</h3><div id="leaderboard-list"></div>`;
    document.getElementById('leaderboard-toggle-btn').addEventListener('click', () => this.toggleLeaderboardView());

    const list = document.getElementById('leaderboard-list');
    list.innerHTML = '<div class="leaderboard-empty">Loading...</div>';

    const leaderboard = isElo
      ? await this.auth.getLeaderboardByElo(20)
      : await this.auth.getLeaderboard('all', 20);

    if (leaderboard.length === 0) {
      list.innerHTML = isElo
        ? '<div class="leaderboard-empty">No rated games yet. Play multiplayer to earn a rating!</div>'
        : '<div class="leaderboard-empty">No scores yet. Be the first to play!</div>';
      return;
    }
    list.innerHTML = leaderboard.map((user, index) => `
      <div class="leaderboard-item">
        <span class="rank">#${index + 1}</span>
        <span class="leaderboard-avatar">${this.getAvatarEmoji(index)}</span>
        <span class="leaderboard-name">${user.displayName}</span>
        <span class="leaderboard-score">${isElo
          ? `${(user.elo || 1000)}⚡`
          : user.bestScore.toLocaleString()}</span>
      </div>
    `).join('');
  }

  getAvatarEmoji(rank) {
    const emojis = ['🥇', '🥈', '🥉', '🎮', '🌍', '🎯', '⭐', '🏆', '🚀', '💫'];
    return emojis[rank] || '🎮';
  }

  closeLeaderboard() {
    this.showScreen('main-menu');
  }

  // ===== Profile / Stats dashboard =====

  async showProfile() {
    this.showScreen('profile-screen');
    const content = document.getElementById('profile-content');
    if (content) content.innerHTML = '<div class="profile-empty">Loading your stats…</div>';
    await this.renderProfile();
  }

  async renderProfile() {
    const content = document.getElementById('profile-content');
    if (!content) return;

    // Guests don't persist profile/achievements — show a friendly gate.
    if (!this.auth.user || this.auth.user.isAnonymous) {
      content.innerHTML = `
        <div class="profile-guest">
          <p>🔒 Sign up with an email account to earn achievements, build a rating, and track your stats on a personal profile.</p>
        </div>`;
      return;
    }

    const [profile, games] = await Promise.all([
      this.auth.getMyProfile(),
      this.auth.getMyGames(50),
    ]);

    if (!profile) {
      content.innerHTML = '<div class="profile-empty">No profile data yet — play a game!</div>';
      return;
    }

    const achievements = profile.achievements || {};
    const totalGames = profile.totalGames || 0;
    const bestScore = profile.bestScore || 0;
    const elo = profile.elo || 1000;
    const winStreak = profile.winStreak || 0;

    // Flatten per-round guesses across game history for the map + accuracy.
    const allRounds = [];
    (games || []).forEach((g) => {
      (g.rounds || []).forEach((r) => allRounds.push({ ...r, mode: r.mode || g.mode }));
    });

    // Accuracy by mode: average distance + count.
    const byMode = {};
    ALL_MODES.forEach((m) => { byMode[m] = { count: 0, distSum: 0 }; });
    allRounds.forEach((r) => {
      if (byMode[r.mode] && typeof r.distance === 'number') {
        byMode[r.mode].count++;
        byMode[r.mode].distSum += r.distance;
      }
    });

    // Best rounds (top 5 by points).
    const bestRounds = [...allRounds]
      .filter((r) => typeof r.points === 'number')
      .sort((a, b) => b.points - a.points)
      .slice(0, 5);

    // ELO history: games with an eloAfter snapshot, oldest-first.
    const eloHistory = (games || [])
      .filter((g) => typeof g.eloAfter === 'number' && g.timestamp)
      .sort((a, b) => a.timestamp.seconds - b.timestamp.seconds)
      .map((g) => g.eloAfter);

    content.innerHTML = `
      <div class="profile-header">
        <div class="profile-avatar">${(profile.displayName || 'G').charAt(0).toUpperCase()}</div>
        <div class="profile-header-info">
          <div class="profile-name">${profile.displayName || 'Player'}</div>
          <div class="profile-stats-row">
            <span class="profile-stat"><strong>${elo}</strong>⚡ ELO</span>
            <span class="profile-stat"><strong>${totalGames}</strong> games</span>
            <span class="profile-stat"><strong>${bestScore.toLocaleString()}</strong> best</span>
            <span class="profile-stat"><strong>${winStreak}</strong>🔥 win streak</span>
          </div>
        </div>
      </div>

      <h3 class="profile-section-title">🏆 Achievements</h3>
      <div class="achievement-grid">
        ${Object.values(ACHIEVEMENTS).map((a) => {
          const unlocked = !!achievements[a.id];
          return `
            <div class="achievement-card ${unlocked ? 'unlocked' : 'locked'}" title="${a.desc}">
              <span class="achievement-emoji ${unlocked ? '' : 'dim'}">${a.emoji}</span>
              <span class="achievement-label">${a.label}</span>
              <span class="achievement-desc">${a.desc}</span>
            </div>
          `;
        }).join('')}
      </div>

      <h3 class="profile-section-title">🏳️ Guess Pin</h3>
      <div class="pin-selector" id="pin-selector">
        ${availablePins(Object.keys(achievements)).map((p) => {
          const selected = (localStorage.getItem('geoguesser_selected_pin') || 'default') === p.id;
          return `
            <button class="pin-option ${selected ? 'selected' : ''}" data-pin="${p.id}" title="${p.label}">
              <span class="pin-option-emoji">${p.emoji}</span>
              <span class="pin-option-label">${p.label}</span>
            </button>
          `;
        }).join('')}
      </div>
      <div class="profile-hint">Unlock more pins by earning achievements. Locked pins aren't shown.</div>

      <h3 class="profile-section-title">🗺️ Your Map</h3>
      <div id="profile-map" class="profile-map"></div>
      ${allRounds.length === 0 ? '<div class="profile-empty">Play some rounds to see your guesses plotted here.</div>' : ''}

      <h3 class="profile-section-title">📊 Accuracy by Mode</h3>
      <div class="profile-accuracy">
        ${ALL_MODES.map((m) => {
          const meta = getModeMeta(m);
          const s = byMode[m];
          if (!s || s.count === 0) {
            return `<div class="accuracy-row"><span class="accuracy-mode">${meta.emoji} ${meta.label}</span><span class="accuracy-val muted">not played</span></div>`;
          }
          const avg = s.distSum / s.count;
          return `<div class="accuracy-row">
            <span class="accuracy-mode">${meta.emoji} ${meta.label}</span>
            <span class="accuracy-bar"><span class="accuracy-bar-fill" style="width:${Math.max(4, Math.min(100, 100 - Math.min(avg, 2000) / 20))}%"></span></span>
            <span class="accuracy-val">${avg < 1 ? Math.round(avg * 1000) + ' m' : Math.round(avg) + ' km'} · ${s.count}r</span>
          </div>`;
        }).join('')}
      </div>

      <h3 class="profile-section-title">⭐ Best Rounds</h3>
      <div class="profile-best">
        ${bestRounds.length === 0
          ? '<div class="profile-empty">No rounds recorded yet.</div>'
          : bestRounds.map((r) => {
              const meta = getModeMeta(r.mode);
              return `<div class="best-round">
                <span class="best-pts">${r.points.toLocaleString()} pts</span>
                <span class="best-meta">${meta.emoji} ${meta.label} · ${r.distance < 1 ? Math.round(r.distance * 1000) + ' m' : Math.round(r.distance) + ' km'}</span>
              </div>`;
            }).join('')}
      </div>

      <h3 class="profile-section-title">📈 ELO History</h3>
      <canvas id="elo-chart" class="profile-chart" width="600" height="160"></canvas>
      ${eloHistory.length === 0 ? '<div class="profile-empty">Play ranked multiplayer games to build an ELO history.</div>' : ''}
    `;

    this.renderProfileMap(allRounds);
    this.renderEloChart(eloHistory);

    // Pin selector: clicking a pin stores the choice (localStorage) and
    // re-styles the selected option. A coin blip confirms the change.
    document.querySelectorAll('#pin-selector .pin-option').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pinId = btn.getAttribute('data-pin');
        localStorage.setItem('geoguesser_selected_pin', pinId);
        document.querySelectorAll('#pin-selector .pin-option').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        arcadeFX.playCoin();
      });
    });
  }

  // "Your Map": plot every guess as a colored pin (pink = great, blue = ok,
  // gray = far) on an arcade-themed map. Capped to the 250 most recent guesses
  // so a long history doesn't overload the Maps API.
  renderProfileMap(rounds) {
    const el = document.getElementById('profile-map');
    if (!el || typeof google === 'undefined' || !google.maps) return;
    const recent = rounds.slice(-250);
    if (recent.length === 0) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    const map = new google.maps.Map(el, {
      center: { lat: 20, lng: 0 },
      zoom: 2,
      streetViewControl: false,
      mapTypeControl: false,
      fullscreenControl: true,
      styles: ARCADE_MAP_STYLE,
    });
    const bounds = new google.maps.LatLngBounds();
    recent.forEach((r) => {
      if (typeof r.lat !== 'number' || typeof r.lng !== 'number') return;
      const pos = { lat: r.lat, lng: r.lng };
      const color = r.distance < 1 ? '#ff3b6b'
        : r.distance < 50 ? '#ffd23f'
        : r.distance < 500 ? '#2d7dff'
        : '#6b5fa0';
      new google.maps.Circle({
        map,
        center: pos,
        radius: Math.max(4000, Math.min(30000, r.distance * 200)),
        fillColor: color,
        fillOpacity: 0.7,
        strokeColor: '#fff',
        strokeWeight: 1,
        clickable: false,
      });
      bounds.extend(pos);
    });
    if (!bounds.isEmpty()) map.fitBounds(bounds, 20);
  }

  // ELO history line chart drawn on a 2D canvas (no charting dependency).
  renderEloChart(history) {
    const canvas = document.getElementById('elo-chart');
    if (!canvas || history.length === 0) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const min = Math.min(...history, 800);
    const max = Math.max(...history, 1200);
    const span = Math.max(50, max - min);
    const pad = 14;
    const x = (i) => history.length === 1 ? W / 2 : pad + (i / (history.length - 1)) * (W - 2 * pad);
    const y = (v) => H - pad - ((v - min) / span) * (H - 2 * pad);

    // grid baseline
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, y(1000));
    ctx.lineTo(W - pad, y(1000));
    ctx.stroke();

    // line
    ctx.strokeStyle = '#ffd23f';
    ctx.lineWidth = 3;
    ctx.beginPath();
    history.forEach((v, i) => { i === 0 ? ctx.moveTo(x(i), y(v)) : ctx.lineTo(x(i), y(v)); });
    ctx.stroke();

    // points
    ctx.fillStyle = '#ff3b6b';
    history.forEach((v, i) => {
      ctx.beginPath();
      ctx.arc(x(i), y(v), 3.5, 0, Math.PI * 2);
      ctx.fill();
    });

    // start/end labels
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '11px sans-serif';
    ctx.fillText(String(history[0]), pad, H - 4);
    ctx.fillText(String(history[history.length - 1]), W - pad - 30, H - 4);
  }

  // Sound toggle: reflects + persists the arcade-FX mute state. The button
  // label swaps between 🔊 / 🔇.
  initSoundToggle() {
    const btn = document.getElementById('sound-toggle-btn');
    if (!btn) return;
    const stored = localStorage.getItem('geoguesser_muted') === '1';
    arcadeFX.setMuted(stored);
    btn.textContent = stored ? '🔇' : '🔊';
    btn.addEventListener('click', () => this.toggleSound());
  }

  toggleSound() {
    const btn = document.getElementById('sound-toggle-btn');
    const muted = !arcadeFX.isMuted();
    arcadeFX.setMuted(muted);
    localStorage.setItem('geoguesser_muted', muted ? '1' : '0');
    if (btn) btn.textContent = muted ? '🔇' : '🔊';
    // Play a coin so the user hears the new (un-muted) state immediately.
    if (!muted) arcadeFX.playCoin();
  }

  // Pop a toast for each newly-unlocked achievement id. Stacks vertically,
  // auto-dismisses after 4s. Safe to call mid-game (overlay is global).
  showAchievementToasts(ids) {
    const container = document.getElementById('achievement-toast-container');
    if (!container || !Array.isArray(ids)) return;
    ids.forEach((id, i) => {
      const meta = ACHIEVEMENTS[id];
      if (!meta) return;
      const toast = document.createElement('div');
      toast.className = 'achievement-toast';
      toast.innerHTML = `
        <span class="achievement-toast-emoji">${meta.emoji}</span>
        <span class="achievement-toast-text">
          <span class="achievement-toast-title">Achievement Unlocked!</span>
          <span class="achievement-toast-name">${meta.label}</span>
          <span class="achievement-toast-desc">${meta.desc}</span>
        </span>
      `;
      container.appendChild(toast);
      setTimeout(() => {
        toast.classList.add('leaving');
        setTimeout(() => toast.remove(), 400);
      }, 4000 + i * 600);
    });
  }

  backToMenu() {
    // Tear down any active multiplayer game (fixes listener leak on play-again).
    if (window.gameController && window.gameController.game.isMultiplayer) {
      this.stopChat();
      this.multiplayer.leaveGame();
    }
    document.getElementById('rematch-btn')?.classList.add('hidden');
    document.getElementById('join-rematch-btn')?.classList.add('hidden');
    document.getElementById('opponent-left-modal')?.classList.add('hidden');
    document.getElementById('time-control-modal')?.classList.add('hidden');
    this.showScreen('main-menu');
  }

  showScreen(screenId) {
    document.querySelectorAll('.screen').forEach((screen) => screen.classList.add('hidden'));
    document.getElementById(screenId).classList.remove('hidden');
  }

  // ---- Auth UI ----
  showSignIn() {
    document.getElementById('signup-form').classList.add('hidden');
    document.getElementById('forgot-password-form').classList.add('hidden');
    document.getElementById('signin-form').classList.remove('hidden');
    document.getElementById('email-auth-options').classList.add('hidden');
    document.getElementById('signup-error').style.display = 'none';
    document.getElementById('signin-error').classList.add('hidden');
    document.getElementById('signin-success').classList.add('hidden');
  }

  showSignUp() {
    document.getElementById('signin-form').classList.add('hidden');
    document.getElementById('forgot-password-form').classList.add('hidden');
    document.getElementById('signup-form').classList.remove('hidden');
    document.getElementById('email-auth-options').classList.add('hidden');
    document.getElementById('signin-error').style.display = 'none';
    document.getElementById('signup-error').classList.add('hidden');
    document.getElementById('signup-success').classList.add('hidden');
  }

  showForgotPassword() {
    document.getElementById('signin-form').classList.add('hidden');
    document.getElementById('signup-form').classList.add('hidden');
    document.getElementById('forgot-password-form').classList.remove('hidden');
    document.getElementById('email-auth-options').classList.add('hidden');
    document.getElementById('forgot-error').classList.add('hidden');
    document.getElementById('forgot-success').classList.add('hidden');
  }

  cancelAuth() {
    document.getElementById('signin-form').classList.add('hidden');
    document.getElementById('signup-form').classList.add('hidden');
    document.getElementById('forgot-password-form').classList.add('hidden');
    document.getElementById('email-auth-options').classList.remove('hidden');
    document.getElementById('signin-error').style.display = 'none';
    document.getElementById('signup-error').style.display = 'none';
  }

  async handleSignIn() {
    const email = document.getElementById('signin-email').value.trim();
    const password = document.getElementById('signin-password').value;
    const errorEl = document.getElementById('signin-error');
    const successEl = document.getElementById('signin-success');
    const submitBtn = document.getElementById('signin-submit-btn');

    errorEl.classList.add('hidden');
    successEl.classList.add('hidden');

    if (!email || !password) {
      this.showError('signin-error', 'Please enter both email and password');
      return;
    }

    this.setButtonLoading(submitBtn, true);
    const result = await this.auth.signInWithEmail(email, password);
    this.setButtonLoading(submitBtn, false);

    if (result.success) {
      if (result.emailNotVerified) this.showEmailVerificationBanner();
      // UI updates via onAuthStateChanged; (re)attach the invites listener now.
      this.attachInviteListenerWhenReady();
    } else {
      this.showError('signin-error', result.error);
    }
  }

  async handleForgotPassword() {
    const email = document.getElementById('forgot-email').value.trim();
    const submitBtn = document.getElementById('forgot-submit-btn');
    if (!email) {
      this.showError('forgot-error', 'Please enter your email address');
      return;
    }
    this.setButtonLoading(submitBtn, true);
    const result = await this.auth.sendPasswordResetEmail(email);
    this.setButtonLoading(submitBtn, false);
    if (result.success) {
      this.showSuccess('forgot-success', result.message);
      document.getElementById('forgot-email').value = '';
      setTimeout(() => this.showSignIn(), 3000);
    } else {
      this.showError('forgot-error', result.error);
    }
  }

  async handleSignUp() {
    const username = document.getElementById('signup-username').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    const passwordConfirm = document.getElementById('signup-password-confirm').value;
    const displayName = document.getElementById('signup-name').value.trim();
    const termsAccepted = document.getElementById('terms-checkbox').checked;
    const submitBtn = document.getElementById('signup-submit-btn');

    document.getElementById('signup-error').classList.add('hidden');
    document.getElementById('signup-success').classList.add('hidden');

    if (!username || !email || !password || !passwordConfirm || !displayName) {
      this.showError('signup-error', 'Please fill in all fields');
      return;
    }
    if (username.length < 3 || username.length > 20) {
      this.showError('signup-error', 'Username must be between 3-20 characters');
      return;
    }
    if (displayName.length < 2 || displayName.length > 20) {
      this.showError('signup-error', 'Display name must be between 2-20 characters');
      return;
    }
    if (password !== passwordConfirm) {
      this.showError('signup-error', 'Passwords do not match');
      return;
    }
    if (password.length < 8) {
      this.showError('signup-error', 'Password must be at least 8 characters');
      return;
    }
    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
      this.showError('signup-error', 'Password must contain uppercase, lowercase, and numbers');
      return;
    }
    if (!termsAccepted) {
      this.showError('signup-error', 'Please accept the Terms of Service');
      return;
    }

    this.setButtonLoading(submitBtn, true);
    const result = await this.auth.signUpWithEmail(email, password, displayName, username);
    this.setButtonLoading(submitBtn, false);

    if (result.success) {
      if (result.requiresVerification) {
        this.showSuccess('signup-success', 'Account created! Please check your email to verify your account.');
        document.getElementById('signup-username').value = '';
        document.getElementById('signup-name').value = '';
        document.getElementById('signup-email').value = '';
        document.getElementById('signup-password').value = '';
        document.getElementById('signup-password-confirm').value = '';
        document.getElementById('terms-checkbox').checked = false;
        document.getElementById('password-strength').textContent = '';
        setTimeout(() => this.showSignIn(), 4000);
      }
    } else {
      this.showError('signup-error', result.error);
    }
  }

  async handleSignOut() {
    this.cleanupOnExit();
    if (this.multiplayer.currentGame) await this.multiplayer.leaveGame();
    this.friends.stopListeningToInvites();
    await this.auth.signOut();
  }

  // ---- Friends ----
  setupFriendsListeners() {
    document.getElementById('friends-btn')?.addEventListener('click', () => this.showFriendsScreen());
    document.getElementById('search-friend-btn')?.addEventListener('click', () => this.searchFriend());
    document.getElementById('friend-search-input')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.searchFriend();
    });
    document.getElementById('accept-invite-btn')?.addEventListener('click', () => this.acceptInvite());
    document.getElementById('decline-invite-btn')?.addEventListener('click', () => this.declineInvite());

    // Attach the invites listener once a (non-anonymous) user is available.
    // onAuthStateChanged is async, so the user may not be known at construction.
    this.attachInviteListenerWhenReady();
  }

  attachInviteListenerWhenReady() {
    const user = this.auth.user;
    if (user && !user.isAnonymous) {
      this.friends.listenToInvites((invites) => this.showInviteModal(invites));
    } else if (user && user.isAnonymous) {
      // Guests can't receive invites for this session; stop polling.
    } else {
      setTimeout(() => this.attachInviteListenerWhenReady(), 500);
    }
  }

  async showFriendsScreen() {
    this.showScreen('friends-screen');
    await this.refreshFriendsLists();
  }

  async refreshFriendsLists() {
    const requests = await this.friends.getFriendRequests();
    const requestsList = document.getElementById('friend-requests-list');
    if (requests.length === 0) {
      requestsList.innerHTML = '<div class="empty-list">No pending requests</div>';
    } else {
      requestsList.innerHTML = requests.map((req) => `
        <div class="friend-item">
          <div class="friend-info">
            <div class="friend-avatar">${req.displayName[0].toUpperCase()}</div>
            <div class="friend-details">
              <div class="friend-name">${req.displayName}</div>
              <div class="friend-status">@${req.username || ''}</div>
            </div>
          </div>
          <div class="friend-actions">
            <button class="btn btn-success" onclick="uiController.acceptRequest('${req.userId}')">Accept</button>
            <button class="btn btn-danger" onclick="uiController.declineRequest('${req.userId}')">Decline</button>
          </div>
        </div>
      `).join('');
    }

    const friends = await this.friends.getFriendsList();
    const friendsList = document.getElementById('friends-list');
    if (friends.length === 0) {
      friendsList.innerHTML = '<div class="empty-list">No friends yet. Search by username to add friends!</div>';
    } else {
      friendsList.innerHTML = friends.map((friend) => {
        const statusClass = friend.isOnline ? 'online' : 'offline';
        const statusText = friend.isOnline ? 'Online' : 'Offline';
        return `
          <div class="friend-item">
            <div class="friend-info">
              <div class="friend-avatar">${friend.displayName[0].toUpperCase()}</div>
              <div class="friend-details">
                <div class="friend-name">${friend.displayName}</div>
                <div class="friend-status ${statusClass}">
                  <span class="status-dot ${statusClass}"></span>${statusText}
                </div>
              </div>
            </div>
            <div class="friend-actions">
              ${friend.isOnline
                ? `<button class="btn btn-primary" onclick="uiController.inviteFriend('${friend.uid}')">Invite to Game</button>`
                : ''}
              <button class="btn btn-danger" onclick="uiController.removeFriend('${friend.uid}')">Remove</button>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  async searchFriend() {
    const searchInput = document.getElementById('friend-search-input');
    const username = searchInput.value.trim();
    const resultsDiv = document.getElementById('search-results');
    if (!username) {
      resultsDiv.innerHTML = '<div class="info-message">💡 Enter a username to search (at least 2 characters)</div>';
      return;
    }
    if (username.length < 2) {
      resultsDiv.innerHTML = '<div class="info-message">⚠️ Username must be at least 2 characters</div>';
      return;
    }
    resultsDiv.innerHTML = '<div class="info-message">🔍 Searching...</div>';
    try {
      const users = await this.friends.searchUsersByUsername(username);
      if (users.length === 0) {
        resultsDiv.innerHTML = '<div class="empty-list">❌ No users found matching "' + username + '"</div>';
      } else {
        resultsDiv.innerHTML = users.map((user) => `
          <div class="friend-item">
            <div class="friend-info">
              <div class="friend-avatar">${user.displayName[0].toUpperCase()}</div>
              <div class="friend-details">
                <div class="friend-name">${user.displayName}</div>
                <div class="friend-status">@${user.username}</div>
              </div>
            </div>
            <div class="friend-actions">
              ${user.status === 'none'
                ? `<button class="btn btn-primary" onclick="uiController.sendFriendRequest('${user.userId}')">➕ Add Friend</button>`
                : user.status === 'pending'
                ? '<span class="info-message" style="padding: 8px;">⏳ Request Pending</span>'
                : '<span class="info-message" style="padding: 8px;">✅ Already Friends</span>'}
            </div>
          </div>
        `).join('');
      }
    } catch (error) {
      console.error('Search error:', error);
      resultsDiv.innerHTML = `<div class="error-message">❌ Error: ${error.message}</div>`;
    }
  }

  async sendFriendRequest(userId) {
    try {
      const result = await this.friends.sendFriendRequest(userId);
      if (result.success) {
        document.getElementById('search-results').innerHTML =
          '<div class="success-message">✅ Friend request sent!</div>';
        setTimeout(() => this.searchFriend(), 2000);
      } else {
        document.getElementById('search-results').innerHTML =
          `<div class="error-message">❌ ${result.error}</div>`;
      }
    } catch (error) {
      alert(error.message);
    }
  }

  async acceptRequest(userId) {
    try {
      const result = await this.friends.acceptFriendRequest(userId);
      if (result.success) await this.refreshFriendsLists();
      else alert(result.error || 'Failed to accept request');
    } catch (error) {
      alert(error.message);
    }
  }

  async declineRequest(userId) {
    try {
      const result = await this.friends.declineFriendRequest(userId);
      if (result.success) await this.refreshFriendsLists();
      else alert(result.error || 'Failed to decline request');
    } catch (error) {
      alert(error.message);
    }
  }

  async removeFriend(userId) {
    if (confirm('Are you sure you want to remove this friend?')) {
      try {
        const result = await this.friends.removeFriend(userId);
        if (result.success) await this.refreshFriendsLists();
        else alert(result.error || 'Failed to remove friend');
      } catch (error) {
        alert(error.message);
      }
    }
  }

  // Begin the friend-invite flow: pick a time control, then create a room + invite.
  inviteFriend(friendId) {
    this.pendingInviteFriendId = friendId;
    this.showTimeSelection('world', true);
  }

  async sendGameInvite(friendId, mode, timeControl, nmpz = false) {
    try {
      // Create the room first so we have a code to invite with.
      const roomCode = await this.multiplayer.createGame(mode, timeControl, 8, nmpz);
      if (!roomCode) throw new Error('Failed to create game');
      await this.friends.inviteFriendToGame(friendId, roomCode, mode);
      // Stay on the matchmaking screen (already shown by createMultiplayerGame)
      // and surface the room code.
      document.getElementById('display-room-code').textContent = roomCode;
      document.getElementById('matchmaking-status').textContent = 'Waiting for friend to join...';
    } catch (error) {
      console.error('Send game invite error:', error);
      alert('Failed to send invite: ' + error.message);
      this.showScreen('main-menu');
    }
  }

  // `invites` is the array of pending invites from the listener; show the first.
  showInviteModal(invites) {
    const invite = Array.isArray(invites) ? invites[0] : invites;
    if (!invite) return;
    this.currentInvite = invite;
    const modeLabel = invite.mode ? invite.mode.toUpperCase() : 'WORLD';
    document.getElementById('invite-message').textContent =
      `${invite.fromName} invited you to play ${modeLabel} mode!`;
    document.getElementById('game-invite-modal').classList.remove('hidden');
  }

  async acceptInvite() {
    if (!this.currentInvite) return;
    const invite = this.currentInvite;
    try {
      await this.friends.acceptInvite(invite.id);
      document.getElementById('game-invite-modal').classList.add('hidden');
      const result = await this.multiplayer.joinGameByCode(invite.roomCode);
      if (result.success) this.showLobby();
      else alert(result.error);
    } catch (error) {
      alert('Failed to accept invite: ' + error.message);
    }
    this.currentInvite = null;
  }

  declineInvite() {
    if (this.currentInvite) {
      this.friends.declineInvite(this.currentInvite.id).catch(() => {});
    }
    document.getElementById('game-invite-modal').classList.add('hidden');
    this.currentInvite = null;
  }

  // ---- Auth UI helpers ----
  updatePasswordStrength(password) {
    const strengthDiv = document.getElementById('password-strength');
    if (!password) {
      strengthDiv.textContent = '';
      strengthDiv.className = 'password-strength';
      return;
    }
    let strength = 0;
    if (password.length >= 8) strength++;
    if (password.length >= 12) strength++;
    if (/[a-z]/.test(password)) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/\d/.test(password)) strength++;
    if (/[^a-zA-Z0-9]/.test(password)) strength++;

    let message, className;
    if (strength < 3) {
      message = '❌ Weak password';
      className = 'password-strength weak';
    } else if (strength < 5) {
      message = '⚠️ Medium password';
      className = 'password-strength medium';
    } else {
      message = '✅ Strong password';
      className = 'password-strength strong';
    }
    strengthDiv.textContent = message;
    strengthDiv.className = className;
  }

  validatePasswordMatch() {
    const password = document.getElementById('signup-password').value;
    const confirm = document.getElementById('signup-password-confirm').value;
    const confirmInput = document.getElementById('signup-password-confirm');
    if (!confirm) {
      confirmInput.style.borderColor = '';
      return;
    }
    confirmInput.style.borderColor = password === confirm ? '#4CAF50' : '#f44336';
  }

  setButtonLoading(button, isLoading) {
    const btnText = button.querySelector('.btn-text');
    const btnSpinner = button.querySelector('.btn-spinner');
    if (isLoading) {
      btnText.classList.add('hidden');
      btnSpinner.classList.remove('hidden');
      button.disabled = true;
    } else {
      btnText.classList.remove('hidden');
      btnSpinner.classList.add('hidden');
      button.disabled = false;
    }
  }

  showError(elementId, message) {
    const errorDiv = document.getElementById(elementId);
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
  }

  showSuccess(elementId, message) {
    const successDiv = document.getElementById(elementId);
    successDiv.textContent = message;
    successDiv.classList.remove('hidden');
  }

  showEmailVerificationBanner() {
    const banner = document.createElement('div');
    banner.className = 'verification-banner';
    banner.innerHTML = `
      <p>⚠️ Please verify your email to access all features.</p>
      <button id="resend-verification-btn" class="btn btn-small">Resend Email</button>
    `;
    const mainMenu = document.getElementById('main-menu');
    const existingBanner = mainMenu.querySelector('.verification-banner');
    if (existingBanner) existingBanner.remove();
    mainMenu.insertBefore(banner, mainMenu.firstChild);
    document.getElementById('resend-verification-btn').addEventListener('click', async () => {
      const result = await this.auth.resendVerificationEmail();
      alert(result.success ? result.message : result.error);
    });
  }
}

export { UIController };
export default UIController;