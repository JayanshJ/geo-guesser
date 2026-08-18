# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What this is

A GeoGuesser clone — single-player and real-time multiplayer — built as a **Vite + vanilla ES-modules** frontend: Firebase (Firestore + Auth, modular v10 SDK) for backend, Google Maps JS API for Street View + maps. Deployed to GitHub Pages via a build step.

## Commands

```bash
npm install        # install deps (vite, firebase, vitest, eslint, prettier)
npm run dev        # Vite dev server with HMR (http://localhost:5173)
npm run build      # production build to dist/
npm run preview    # serve the built dist/ locally
npm test           # run Vitest unit tests once
npm run test:watch # Vitest watch mode
npm run lint       # ESLint (flat config in eslint.config.js)
npm run format     # Prettier write
```

**Config / secrets:** all client-exposed config is Vite env vars (must be `VITE_`-prefixed). Copy `.env.example` → `.env.local` for dev and fill in `VITE_GOOGLE_MAPS_API_KEY` + `VITE_FIREBASE_*`. In CI, `.github/workflows/deploy.yml` writes `.env.production` from GitHub secrets, runs `npm ci && npm run build`, and deploys `dist/` to GitHub Pages. `.github/workflows/ci.yml` runs lint + test + build on push/PR. `.env*` files and `dist/` are gitignored — never commit real keys. (A legacy gitignored `config.js` may exist locally but is no longer loaded.)

Required Google APIs: Maps JavaScript API (with `geometry` library), Street View Static API. Required Firebase: Auth (enable **both** Email/Password **and Anonymous** — guests sign in via `signInAnonymously` to get a real uid the security rules can gate on) and Firestore.

**Firestore security rules:** `firestore.rules` (deployed via `firebase deploy --only firestore:rules` using `firebase.json`). Rules require auth for all writes, enforce username uniqueness via an immutable `usernames` collection, scope `game_invites` to sender/recipient, and confine non-host multiplayer writes to the `players` map (+ self-abandon). The client cooperates: `signUpWithEmail` reserves the username in a transaction (closes the TOCTOU race); guests use anonymous auth so `request.auth.uid` is set.

## Architecture

ES modules, bundled by Vite. Entry: `index.html` → `<script type="module" src="/src/main.js">`. `vite.config.js` sets `base: './'` so built asset URLs stay relative (works under a GitHub Pages project subpath).

### Module graph

- `src/main.js` — entry. Imports `initApp` from `app.js`, exposes it on `window.initApp` (the Google Maps `callback=`), then injects the Maps script.
- `src/config.js` — builds `CONFIG` from `import.meta.env.VITE_*`.
- `src/firebase.js` — side-effect import: `initializeApp`, then exports `auth` and `db` singletons (modular SDK).
- `src/app.js` — `initApp()`: constructs `GameController`, calls `authService.initialize()`, `friendsService.initialize()`, constructs `UIController`, and wires `window.multiplayerGameUpdate` (the single realtime dispatcher). Sets `window.gameController` / `window.uiController` (used by inline `onclick` handlers and UIController).
- `src/services/{auth,friends,multiplayer,matchmaking}.js` — each exports its class **and** a singleton instance (`authService`, `friendsService`, `multiplayerService`, `matchmakingService`). Services import the `db`/`auth` handles from `firebase.js`; the singleton instances are imported by the game/UI controllers (no more global-script DI).
- `src/game/{controller,locations,elo}.js` — `GameController` (game loop, Street View, map, timer, scoring, Street View QoL), `locations.js` (mode metadata + curated coordinate lists + `LocationGenerator` + `computeScore`), `elo.js` (pure ELO rating math).
- `src/ui/controller.js` — `UIController` (all DOM event wiring + screen navigation).

**Bootstrap flow:** Maps script loads → `initApp()` → `GameController` → `authService.initialize()` (async `onAuthStateChanged`) → `friendsService.initialize()` (db is ready synchronously with the modular SDK) → `UIController`. `onAuthStateChanged` drives which screen shows: signed-in → main menu; guests restored from `localStorage['geoguesser_user']` only if `isAnonymous`; otherwise the auth screen.

### The three services

- **`AuthService`** (`src/services/auth.js`) — Firebase Auth wrapper. Anonymous guests (persisted in localStorage, not Firebase) and email/password accounts (Firestore `users` collection, keyed by `uid`). Owns `this.db`/`this.auth`. `onUserReady()` / `updateUI()` are the seams to the UI.
- **`FriendsService`** (`src/services/friends.js`) — username search, friend requests, friend lists, live `game_invites` via `onSnapshot`. Friends features are gated to email-authenticated users. `listenToInvites` stores its unsubscribe on `this.invitesUnsub`; call `stopListeningToInvites()` on sign-out.
- **`MultiplayerService`** (`src/services/multiplayer.js`) — room create/join, location generation, realtime game state, in-game chat (`messages` subcollection), and host-initiated rematch. 6-char room code (alphabet excludes `0/O/I/1`) is the Firestore doc id.
- **`MatchmakingService`** (`src/services/matchmaking.js`) — skill-based ranked queue. Pairs a player with a nearby-rated opponent via the `matchmaking` collection. To avoid double-claims, only the player with the lexicographically-greater uid initiates a pair, and a transaction atomically flips both docs `searching`→`matched` only if both are still searching. Email users only (rating requires an account).

### Firestore collections

- `users` — profile per auth user: `username` (lowercased, unique), `displayName`, `email`, `emailVerified`, online status, `friends`, `friendRequests`, stats (`totalGames`, `totalScore`, `bestScore`), `elo` (default 1000; email users only).
- `multiplayer_games` — doc id = room code. Fields: `host`, `mode` (`world`/`india`/`europe`/`us`/`asia`/`landmarks`), `timeControl`, `nmpz` (hardcore flag, host's choice applies to all), `status` (`waiting` → `playing` → `abandoned`/`finished`), `currentRound`, `totalRounds`, `maxPlayers`, `locations` (shared array so all players guess the same spots), `resolvedLocations` (map keyed by 0-based roundIndex → `{lat,lng,panoId}`, written by host), `rematchRoomCode` (host writes this on rematch so opponents can one-click join), `players` map (`{uid,displayName,isHost,score,guesses,eloStart,joinedAt}`). `onSnapshot` drives live lobby + in-game scores. `players.{uid}.eloStart` is each rated player's pre-game ELO, stamped at game start so every client can compute ELO updates deterministically without cross-user writes.
- `multiplayer_games/{code}/messages` — in-game chat (`uid`, `displayName`, `text`, `timestamp`), listened to live via `listenToMessages`.
- `matchmaking` — ranked queue, doc id = uid. `{uid,displayName,elo,mode,timeControl,status,roomCode,createdAt}`. The claim transaction writes the opponent's doc `searching`→`matched` (rules scope this tightly).
- `games` — game history (for leaderboard); now written for both solo and multiplayer (each player records their own).
- `game_invites` — friend game invites (`from`, `fromName`, `to`, `roomCode`, `mode`, `status`), listened to live.

### Game loop (`src/game/controller.js`)

- 5 rounds, max 5000 points/round (25000 total). Scoring in `confirmGuess()` uses `computeScore(distance, decayFactor)` from `locations.js` (`Math.round(5000 * Math.exp(-distance / decayFactor))`) where `decayFactor` is **mode-dependent** (India=300, Europe=400, US=500, Asia=600, World/Landmarks=2000). Distance via `google.maps.geometry.spherical.computeDistanceBetween`.
- **Locations are curated** (`LocationGenerator.curated` in `src/game/locations.js`): each mode has a hand-picked list of ~20 real, Street View-covered coordinates, so rounds no longer land in ocean/empty areas. The same generator backs both solo and multiplayer (one source of truth). `LocationGenerator.hasStreetView` pre-validates a coord against the Street View Static metadata endpoint before the heavier `getPanorama` call; `findStreetViewLocation` swaps in another curated candidate (8 attempts) if a spot has lost coverage. Street View resolves to the nearest panorama (50km radius, `OUTDOOR` source); the resolved coord + `panoId` is stored in `game.resolvedLocations` and, for multiplayer, written to Firestore so everyone scores against the same actual spot. On failure, the host regenerates and retries.
- **Street View QoL:** `returnToStart()` re-centers to the round's starting panorama + POV (button hidden under NMPZ). A live compass (`pov_changed` → `updateCompass`) rotates a needle with heading. NMPZ (hardcore) mode — set via the time-control modal checkbox, stored as `nmpz` on the game doc so it applies to all players — disables movement/pan/zoom via panorama options.
- **ELO:** each rated (email) player stamps `players.{uid}.eloStart` at game start (`setMyEloStart`). At `showFinalScore`, every client computes its own new rating from the shared `eloStart` + final scores (`computeNewRating` in `elo.js`, pairwise across rated opponents) and writes only its own `users/{uid}.elo` — no cross-user writes. Guests are unrated and excluded.
- **Solo vs multiplayer:** solo generates locations locally (implicit host). Multiplayer reads shared `locations` from `multiplayerService.currentGame.data`; `isHost` = `host.uid === authService.user.uid`. Non-host waits for the host's resolved `panoId` (polls `waitForResolvedLocation`, 30s fallback to self-resolve).
- **Multiplayer sync** flows through `window.multiplayerGameUpdate(gameData)` (defined in `app.js`), called by `MultiplayerService.onGameUpdate` (the `onSnapshot` callback). It updates the lobby, transitions matchmaking→lobby on a second join, updates live scores, re-renders the shared result map as opponents submit (`updateSharedResultMap`), drives chat/rematch via `uiController.onMultiplayerUpdate`, and auto-advances rounds when all players finish (`checkAllPlayersFinished`). `this.advancingToNextRound` guards against double-trigger; the 2s delay is the only result-viewing window.
- Time controls (Blitz 60s / Rapid 180s / Classic 300s / Unlimited) chosen via the time-control modal; timer is per-round (restarted each `loadRound`).

### UI layer (`src/ui/controller.js`)

`UIController` wires every DOM event (by `getElementById` — IDs are the HTML↔JS contract) and navigates via `showScreen(id)` (toggles `.hidden` on `.screen` divs). Constructed with the three service singletons. Inline `onclick="uiController.x()"` handlers in friends lists rely on `window.uiController`. Modals (`.modal`) are toggled independently of `showScreen` by adding/removing `.hidden` directly.

### Styling

`index.html` links `styles-production.css`, `friends-styles.css`, `auth-styles.css` (relative); Vite bundles them into one CSS asset. `styles.css` exists but is **not** loaded — `styles-production.css` is the active stylesheet. Screens use a `.hidden` class pattern; modals stack separately.

## Conventions to preserve

- **ES modules + Vite.** New code is an ES module imported from the graph; no global `<script>` tags, no globals-as-DI for new code (the remaining `window.*` hooks exist only for the Maps callback and legacy inline `onclick` handlers).
- **Service singletons** are imported, not passed around manually. To add a service, export a class + singleton from `src/services/` and import where needed.
- **IDs are the HTML↔JS contract.** Adding UI = adding the element with an id in `index.html` and the listener in `src/ui/controller.js`.
- **One location generator.** `LocationGenerator` in `src/game/locations.js` is the single source of truth for both solo and multiplayer — no per-service coordinate generators.
- **Pure game math is extracted and tested.** Scoring (`computeScore`), ELO (`computeNewRating`/`expectedScore`), and location generation live in `src/game/{locations,elo}.js` as pure functions so they can be unit-tested without Firebase/Maps. Keep new game math pure and add tests under `tests/`.
- Secrets live in `.env.local` (dev) or GitHub secrets (CI). Never hardcode keys; never commit `.env*` or `dist/`.

## Testing

`tests/` holds Vitest unit tests for the pure game logic: `elo.test.js` (ELO expected score, multi-player rating updates, zero-sum property) and `locations.test.js` (`computeScore` monotonicity/decay, `getModeMeta` fallback, `LocationGenerator.curated` count + refill + random fallback). Run with `npm test`. Tests are part of CI (`.github/workflows/ci.yml`). The Firebase/Maps-dependent code (services, controllers) is not unit-tested — it's verified via `npm run build` (import/export + syntax) and manual runtime testing with real keys.

## Reference docs in repo

`AUTH_FEATURES.md`, `MULTIPLAYER_ROOMS.md`, `QUICK_START.md`, `CHANGES_SUMMARY.md`, `IMPLEMENTATION_COMPLETE.md` describe feature-level behavior in more detail — consult them when touching auth, multiplayer rooms, or friends. (Some predate the Vite migration and may reference the old global-script architecture.)