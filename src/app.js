// Bootstrap. Constructs the service singletons, the GameController, and the
// UIController, wires the global multiplayer update hook, and exposes the bits
// the DOM/inline-handlers expect on `window`.
import { authService } from './services/auth.js';
import { friendsService } from './services/friends.js';
import { multiplayerService } from './services/multiplayer.js';
import { matchmakingService } from './services/matchmaking.js';
import { GameController } from './game/controller.js';
import { UIController } from './ui/controller.js';

let gameController;
let uiController;

export function initApp() {
  gameController = new GameController();
  window.gameController = gameController;

  // Auth is async (onAuthStateChanged), but we don't need to await it.
  authService.initialize();

  // Firestore handle is ready synchronously with the modular SDK.
  friendsService.initialize();

  uiController = new UIController(authService, multiplayerService, friendsService);
  uiController.matchmaking = matchmakingService;
  window.uiController = uiController;

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
    if (gameController.game.isMultiplayer) {
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