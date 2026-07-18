// Bootstrap. Constructs the service singletons, the GameController, and the
// UIController, wires the global multiplayer update hook, and exposes the bits
// the DOM/inline-handlers expect on `window`.
//
// IMPORTANT: the UI/auth side (`initUI`) runs immediately on module load, NOT
// gated on the Google Maps `callback`. Previously everything lived in the Maps
// callback (`initApp`), so a missing/invalid Maps API key (which makes Google
// fire `gm_authFailure` instead of the callback) left the UIController
// unconstructed and the Sign In / Play as Guest buttons with no listeners.
// Splitting the two means login + guest work as soon as Firebase keys are in
// `.env.local`, independent of whether/when Maps loads.
import { CONFIG } from './config.js';
import { authService } from './services/auth.js';
import { friendsService } from './services/friends.js';
import { multiplayerService } from './services/multiplayer.js';
import { matchmakingService } from './services/matchmaking.js';
import { GameController } from './game/controller.js';
import { UIController } from './ui/controller.js';
import { applyArcadeName } from './arcade.js';

let gameController;
let uiController;

// Surface a visible banner when the app can't reach its backends. Without this,
// missing `.env.local` manifests as a dead auth screen with only console errors.
function showConfigBanner(message, kind = 'error') {
  if (document.getElementById('config-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'config-banner';
  banner.setAttribute('data-kind', kind);
  banner.className = 'config-banner';
  banner.innerHTML = `<span>${message}</span>`;
  document.body.appendChild(banner);
}

function firebaseConfigured() {
  const c = CONFIG.FIREBASE_CONFIG || {};
  return Boolean(c.apiKey && c.projectId && c.appId);
}

// Runs immediately on load: construct controllers, init auth + friends, wire
// the realtime dispatcher. None of this needs Google Maps.
export function initUI() {
  gameController = new GameController();
  window.gameController = gameController;

  // Fill the hub hero title from the single ARCADE_NAME constant.
  applyArcadeName();

  // Auth is async (onAuthStateChanged), but we don't need to await it.
  authService.initialize();

  // Firestore handle is ready synchronously with the modular SDK.
  friendsService.initialize();

  uiController = new UIController(authService, multiplayerService, friendsService);
  uiController.matchmaking = matchmakingService;
  window.uiController = uiController;

  if (!firebaseConfigured()) {
    showConfigBanner(
      'Configuration missing — copy <code>.env.example</code> → <code>.env.local</code>, add your Firebase + Google Maps keys, then restart <code>npm run dev</code>.',
    );
  }

  // Single realtime-update dispatcher for multiplayer games. Invoked by
  // MultiplayerService.onGameUpdate whenever the game doc changes.
  window.multiplayerGameUpdate = (gameData) => {
    const lobbyScreen = document.getElementById('lobby-screen');
    if (lobbyScreen && !lobbyScreen.classList.contains('hidden')) {
      uiController.updateLobbyPlayers(gameData);
    }

    // When a second player joins while the host sits on the matchmaking screen,
    // transition into the lobby.
    if (gameData.status === 'waiting') {
      const matchmakingScreen = document.getElementById('matchmaking-screen');
      if (matchmakingScreen && !matchmakingScreen.classList.contains('hidden')) {
        const playerCount = gameData.players ? Object.keys(gameData.players).length : 0;
        if (playerCount > 1) {
          uiController.showLobby();
        }
      }
    }

    // Once the host flips status to 'playing', ensure lobby/matchmaking viewers
    // start the game (updateLobbyPlayers triggers the delayed startGame).
    if (gameData.status === 'playing') {
      const lobbyScreen = document.getElementById('lobby-screen');
      const matchmakingScreen = document.getElementById('matchmaking-screen');
      if ((lobbyScreen && !lobbyScreen.classList.contains('hidden')) ||
          (matchmakingScreen && !matchmakingScreen.classList.contains('hidden'))) {
        uiController.updateLobbyPlayers(gameData);
      }
    }

    // In-game live score updates + auto-advance when all players finish a round.
    if (gameController && gameController.game && gameController.game.isMultiplayer) {
      gameController.updateMultiplayerScores(gameData);

      const resultScreen = document.getElementById('result-screen');
      if (resultScreen && !resultScreen.classList.contains('hidden')) {
        gameController.updateSharedResultMap(gameData);
        gameController.checkAllPlayersFinished(gameData);
      }

      // Live chat + a host-initiated rematch both write to the game doc; let
      // the UI controller react when the relevant screens are open.
      if (typeof uiController.onMultiplayerUpdate === 'function') {
        uiController.onMultiplayerUpdate(gameData);
      }
    }
  };
}

// Called by the Google Maps `callback=` once the script has loaded. Marks Maps
// ready and flushes any game start that was queued while Maps was still loading.
// (Loading the game itself still requires Maps; UIController.ensureMapsReady
// gates the start paths on this flag.)
export function onMapsReady() {
  window.googleMapsReady = true;
  if (typeof window._flushPendingGameStart === 'function') {
    window._flushPendingGameStart();
  }
}

// Google fires this global instead of `callback` when the Maps API key is
// missing/invalid/restricted. Surface it so a bad key is never silent.
export function onMapsAuthFailure() {
  window.googleMapsReady = false;
  if (document.getElementById('maps-error-banner')) return;
  showConfigBanner(
    'Google Maps failed to load — check <code>VITE_GOOGLE_MAPS_API_KEY</code> in <code>.env.local</code> and that the key allows this domain.',
  );
}