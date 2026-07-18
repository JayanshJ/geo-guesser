// Game controller - round/Street View/map/timer/scoring logic for solo and
// multiplayer. `google.maps` is the global injected by the Maps script in
// main.js; the geometry library (`computeDistanceBetween`) is loaded too.
// (`google` is declared as a readonly global in eslint.config.js.)
import { authService } from '../services/auth.js';
import { multiplayerService } from '../services/multiplayer.js';
import { CONFIG } from '../config.js';
import { LocationGenerator, getModeMeta, computeScore, computeSpeedBonus, computeStreakMultiplier, STREAK_THRESHOLD_KM } from './locations.js';
import { computeNewRating, DEFAULT_RATING } from './elo.js';
import { arcadeFX } from './arcade.js';
import { detectRoundAchievements, pinEmoji } from './achievements.js';
import { ARCADE_MAP_STYLE } from './mapStyle.js';

class GameController {
  constructor() {
    this.game = {
      round: 1,
      totalRounds: 5,
      score: 0,            // arcade total (base + speed/streak bonuses) — leaderboard/display
      baseScore: 0,        // distance-only total — used for ranked ELO (kept pure)
      streak: 0,           // consecutive sub-500m guess count (resets per game)
      roundStartTime: null, // wall-clock when the current round's timer started
      currentLocation: null,
      guessLocation: null,
      roundResults: [],
      panorama: null,
      map: null,
      resultMap: null,
      guessMarker: null,
      mode: 'world',
      isMultiplayer: false,
      timeControl: 'unlimited',
      timeRemaining: 0,
      timerInterval: null,
      isHost: false,
      resolvedLocations: [], // actual panorama locations per round
    };
    this.advancingToNextRound = false; // Prevent double-trigger of auto-advance
    this.setupEventListeners();
  }

  setupEventListeners() {
    document.getElementById('quit-btn').addEventListener('click', () => this.quitGame());
    document.getElementById('return-start-btn').addEventListener('click', () => this.returnToStart());
    document.getElementById('toggle-map-btn').addEventListener('click', () => this.toggleMap());
    document.getElementById('minimize-map-btn').addEventListener('click', () => this.minimizeMap());
    document.getElementById('confirm-guess-btn').addEventListener('click', () => this.confirmGuess());
    document.getElementById('next-round-btn').addEventListener('click', () => this.nextRound());
    document.getElementById('opponent-left-ok-btn').addEventListener('click', () => this.handleOpponentLeftOk());

    // Notify opponent on page unload.
    window.addEventListener('beforeunload', () => this.handlePlayerExit());
  }

  // Re-center to the round's starting panorama + POV (a "return to start" for
  // players who've wandered). Only meaningful once a panorama is loaded.
  returnToStart() {
    if (!this.game.panorama || !this.game.startPano) return;
    if (this.game.startPano.panoId) {
      this.game.panorama.setPano(this.game.startPano.panoId);
    } else if (this.game.startPano.position) {
      this.game.panorama.setPosition(this.game.startPano.position);
    }
    this.game.panorama.setPov(this.game.startPov);
    this.game.panorama.setZoom(1);
  }

  // Live compass: rotate the needle as the player looks around.
  updateCompass() {
    if (!this.game.panorama) return;
    const heading = this.game.panorama.getPov().heading || 0;
    const needle = document.getElementById('compass-needle');
    if (needle) needle.style.transform = `rotate(${-heading}deg)`;
  }

  handleOpponentLeftOk() {
    document.getElementById('opponent-left-modal').classList.add('hidden');
    this.showScreen('main-menu');
  }

  handlePlayerExit() {
    if (this.game.isMultiplayer && multiplayerService.currentGame) {
      multiplayerService.notifyPlayerLeft();
    }
    // Tear down listeners (chat, matchmaking) so they don't outlive the page.
    if (window.uiController && typeof window.uiController.cleanupOnExit === 'function') {
      window.uiController.cleanupOnExit();
    }
  }

  showOpponentLeftModal() {
    this.stopTimer();
    document.getElementById('opponent-left-modal').classList.remove('hidden');
  }

  startGame(mode, isMultiplayer = false, timeControl = 'unlimited', options = {}) {
    console.log('[Game] Starting game. Mode:', mode, 'Multiplayer:', isMultiplayer, 'TimeControl:', timeControl);

    this.game.round = 1;
    this.game.score = 0;
    this.game.baseScore = 0;
    this.game.streak = 0;
    this.game.roundResults = [];
    this.game.guessLocation = null;
    this.game.mode = mode;
    this.game.isMultiplayer = isMultiplayer;
    this.game.timeControl = timeControl;
    this.game.resolvedLocations = [];
    // NMPZ (hardcore) may be set locally (solo) or come from the shared game
    // doc (multiplayer — host's choice applies to everyone).
    this.game.restrictMovement = !!(options.restrictMovement
      || (isMultiplayer && multiplayerService.currentGame && multiplayerService.currentGame.data.nmpz));

    // Return-to-start + compass are only useful with a movable panorama.
    const returnBtn = document.getElementById('return-start-btn');
    const compass = document.getElementById('compass');
    if (this.game.restrictMovement) {
      returnBtn?.classList.add('hidden');
      compass?.classList.add('hidden');
    } else {
      returnBtn?.classList.remove('hidden');
      compass?.classList.remove('hidden');
    }

    // Multiplayer uses shared locations from Firestore; solo generates locally.
    if (isMultiplayer && multiplayerService.currentGame && multiplayerService.currentGame.data.locations) {
      this.game.gameLocations = multiplayerService.currentGame.data.locations;
      this.game.isHost = multiplayerService.currentGame.data.host.uid === authService.user.uid;
      if (multiplayerService.currentGame.data.resolvedLocations &&
          Object.keys(multiplayerService.currentGame.data.resolvedLocations).length > 0) {
        this.game.resolvedLocations = multiplayerService.currentGame.data.resolvedLocations;
      }
    } else {
      this.game.gameLocations = this.getLocationsForMode();
      this.game.isHost = true;
    }

    const modeMeta = getModeMeta(mode);
    const modeText = `${modeMeta.emoji} ${modeMeta.label} Mode`;
    document.getElementById('game-mode-text').textContent = modeText;

    if (isMultiplayer) {
      document.getElementById('multiplayer-scores').classList.remove('hidden');
      this.updateMultiplayerScores(multiplayerService.currentGame.data);
    } else {
      document.getElementById('multiplayer-scores').classList.add('hidden');
    }

    this.showScreen('game-screen');

    // Stamp this rated player's pre-game ELO onto their player entry so every
    // client can compute ELO updates deterministically at game end. Fire-and-
    // forget: it settles well before the final round.
    if (isMultiplayer && authService.user && !authService.user.isAnonymous) {
      authService.getMyElo().then((elo) => multiplayerService.setMyEloStart(elo));
    }

    this.loadRound();
  }

  updateMultiplayerScores(gameData) {
    if (!gameData || !gameData.players) return;

    const scoresContainer = document.getElementById('multiplayer-scores');
    scoresContainer.innerHTML = '';

    const sortedPlayers = Object.values(gameData.players).sort((a, b) => b.score - a.score);
    sortedPlayers.forEach((player) => {
      const isYou = player.uid === authService.user.uid;
      const scoreSpan = document.createElement('span');
      scoreSpan.className = 'mp-score';
      scoreSpan.innerHTML = `${isYou ? '<strong>You</strong>' : player.displayName}: <strong>${player.score}</strong>`;
      scoresContainer.appendChild(scoreSpan);
    });

    // Sync resolved locations for non-host (stored as a map keyed by roundIndex).
    if (!this.game.isHost && gameData.resolvedLocations) {
      const resolvedArr = Array.isArray(gameData.resolvedLocations)
        ? gameData.resolvedLocations
        : Object.values(gameData.resolvedLocations);
      this.game.resolvedLocations = resolvedArr;
    }
  }

  getLocationsForMode() {
    return LocationGenerator.curated(this.game.mode, this.game.totalRounds);
  }

  loadRound() {
    document.getElementById('current-round').textContent = this.game.round;
    document.getElementById('current-score').textContent = this.game.score;
    this.resetRoundHUD();

    this.game.guessLocation = null;
    document.getElementById('confirm-guess-btn').disabled = true;

    const roundIndex = this.game.round - 1;
    if (this.game.isMultiplayer && !this.game.isHost) {
      // Non-host: use the host's resolved pano if available, else wait for it.
      if (this.game.resolvedLocations[roundIndex] && this.game.resolvedLocations[roundIndex].panoId) {
        this.game.currentLocation = this.game.resolvedLocations[roundIndex];
        this.initializeStreetViewByPanoId(this.game.resolvedLocations[roundIndex].panoId);
      } else {
        this.waitForResolvedLocation(roundIndex);
        return; // map setup + timer deferred until location resolves
      }
    } else {
      this.game.currentLocation = this.game.gameLocations[roundIndex];
      this.findStreetViewLocation(this.game.currentLocation);
    }

    const mapMeta = getModeMeta(this.game.mode);
    const mapCenter = mapMeta.mapCenter;
    const mapZoom = mapMeta.mapZoom;

    if (!this.game.map) {
      this.game.map = new google.maps.Map(document.getElementById('map'), {
        center: mapCenter,
        zoom: mapZoom,
        streetViewControl: false,
        mapTypeControl: false,
        styles: ARCADE_MAP_STYLE,
      });
      this.game.map.addListener('click', (e) => this.placeGuessMarker(e.latLng));
    } else {
      if (this.game.guessMarker) this.game.guessMarker.setMap(null);
      this.game.map.setCenter(mapCenter);
      this.game.map.setZoom(mapZoom);
    }

    this.minimizeMap();

    // Non-host with a pre-resolved pano can start the timer now; host/solo
    // starts it inside the findStreetViewLocation callback.
    if (this.game.isMultiplayer && !this.game.isHost &&
        this.game.resolvedLocations[roundIndex] && this.game.resolvedLocations[roundIndex].panoId) {
      this.startTimer();
    }
  }

  startTimer() {
    this.stopTimer();
    console.log('[Timer] Starting timer. timeControl:', this.game.timeControl, 'isHost:', this.game.isHost, 'isMultiplayer:', this.game.isMultiplayer);

    // Stamp the round start so confirmGuess can compute a speed bonus. Set
    // even for unlimited (harmless — computeSpeedBonus returns 0 then).
    this.game.roundStartTime = Date.now();

    if (this.game.timeControl === 'unlimited') {
      document.getElementById('timer-display').classList.add('hidden');
      return;
    }

    this.game.timeRemaining = parseInt(this.game.timeControl);
    const timerDisplay = document.getElementById('timer-display');
    timerDisplay.classList.remove('hidden');
    this.updateTimerDisplay();

    this.game.timerInterval = setInterval(() => {
      this.game.timeRemaining--;
      this.updateTimerDisplay();
      if (this.game.timeRemaining <= 30 && this.game.timeRemaining > 0) {
        timerDisplay.classList.add('warning');
      }
      if (this.game.timeRemaining <= 0) {
        this.stopTimer();
        this.handleTimeUp();
      }
    }, 1000);
  }

  stopTimer() {
    if (this.game.timerInterval) {
      clearInterval(this.game.timerInterval);
      this.game.timerInterval = null;
    }
    const timerDisplay = document.getElementById('timer-display');
    timerDisplay.classList.remove('warning');
  }

  updateTimerDisplay() {
    const minutes = Math.floor(this.game.timeRemaining / 60);
    const seconds = this.game.timeRemaining % 60;
    document.getElementById('timer-value').textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  handleTimeUp() {
    // Auto-submit with no guess (map center as default).
    if (!this.game.guessLocation) {
      const mapCenter = getModeMeta(this.game.mode).mapCenter;
      this.game.guessLocation = new google.maps.LatLng(mapCenter.lat, mapCenter.lng);
    }
    this.game.timedOutThisRound = true;
    arcadeFX.playBuzzer();
    this.confirmGuess();
  }

  waitForResolvedLocation(roundIndex) {
    const checkInterval = setInterval(() => {
      if (this.game.resolvedLocations[roundIndex] && this.game.resolvedLocations[roundIndex].panoId) {
        clearInterval(checkInterval);
        this.game.currentLocation = this.game.resolvedLocations[roundIndex];
        this.initializeStreetViewByPanoId(this.game.resolvedLocations[roundIndex].panoId);
        this.startTimer();
      }
    }, 500);

    // Fallback after 30s: resolve our own location.
    setTimeout(() => {
      clearInterval(checkInterval);
      if (!this.game.resolvedLocations[roundIndex]) {
        console.warn('Timeout waiting for host location, falling back to own search');
        this.game.currentLocation = this.game.gameLocations[roundIndex];
        this.findStreetViewLocation(this.game.currentLocation);
      }
    }, 30000);
  }

  async findStreetViewLocation(startLocation) {
    const streetViewService = new google.maps.StreetViewService();
    const STREET_VIEW_MAX_DISTANCE = 50000;
    const apiKey = CONFIG.GOOGLE_MAPS_API_KEY;

    // Pre-validate via the Street View metadata endpoint; if the chosen spot
    // has no coverage, swap in another curated candidate (capped attempts).
    let location = startLocation;
    for (let i = 0; i < 8; i++) {
      if (await LocationGenerator.hasStreetView(location, apiKey)) break;
      location = LocationGenerator.curated(this.game.mode, 1)[0];
    }

    streetViewService.getPanorama(
      {
        location,
        radius: STREET_VIEW_MAX_DISTANCE,
        source: google.maps.StreetViewSource.OUTDOOR,
      },
      async (data, status) => {
        if (status === google.maps.StreetViewStatus.OK) {
          const resolvedLocation = {
            lat: data.location.latLng.lat(),
            lng: data.location.latLng.lng(),
            panoId: data.location.pano,
          };
          this.game.currentLocation = resolvedLocation;

          if (this.game.isMultiplayer && this.game.isHost) {
            this.game.resolvedLocations[this.game.round - 1] = resolvedLocation;
            await multiplayerService.saveResolvedLocation(this.game.round - 1, resolvedLocation);
          }

          this.initializeStreetView(this.game.currentLocation);
          this.startTimer();
        } else {
          // getPanorama still failed (rare after pre-validation): retry with a
          // fresh curated candidate.
          this.game.currentLocation = LocationGenerator.curated(this.game.mode, 1)[0];
          this.findStreetViewLocation(this.game.currentLocation);
        }
      }
    );
  }

  // Base panorama options. Under NMPZ (restrictMovement) we disable movement
  // (linksControl), panning (panControl), and zoom (zoomControl + scrollwheel),
  // and hide the default UI — the player can only look at the starting view.
  panoramaOptions(extra) {
    const startPov = { heading: 34, pitch: 10 };
    const base = {
      pov: startPov,
      zoom: 1,
      addressControl: false,
      showRoadLabels: false,
      enableCloseButton: false,
    };
    if (this.game.restrictMovement) {
      Object.assign(base, {
        disableDefaultUI: true,
        linksControl: false,
        panControl: false,
        zoomControl: false,
        scrollwheel: false,
        motionTimeInterpolation: false,
      });
    } else {
      Object.assign(base, {
        disableDefaultUI: false,
        linksControl: true,
        panControl: true,
      });
    }
    return Object.assign(base, extra);
  }

  // Record the round's starting panorama + POV (for return-to-start) and wire
  // the compass to follow the player's heading.
  bindPanoramaExtras(startRef) {
    this.game.startPov = { heading: 34, pitch: 10 };
    this.game.startPano = startRef;
    this.game.panorama.setPov(this.game.startPov);
    this.game.panorama.setZoom(1);
    this.game.panorama.addListener('pov_changed', () => this.updateCompass());
    this.updateCompass();
  }

  initializeStreetViewByPanoId(panoId) {
    if (!this.game.panorama) {
      this.game.panorama = new google.maps.StreetViewPanorama(
        document.getElementById('street-view'),
        this.panoramaOptions({ pano: panoId })
      );
    } else {
      this.game.panorama.setOptions(this.panoramaOptions({}));
      this.game.panorama.setPano(panoId);
    }
    this.bindPanoramaExtras({ panoId });
  }

  initializeStreetView(location) {
    if (!this.game.panorama) {
      this.game.panorama = new google.maps.StreetViewPanorama(
        document.getElementById('street-view'),
        this.panoramaOptions({ position: location })
      );
    } else {
      this.game.panorama.setOptions(this.panoramaOptions({}));
      this.game.panorama.setPosition(location);
    }
    this.bindPanoramaExtras({ position: location });
  }

  toggleMap() {
    document.getElementById('map-container').classList.remove('minimized');
    document.getElementById('map-container').classList.add('expanded');
    document.getElementById('map-content').classList.remove('hidden');
    document.getElementById('toggle-map-btn').classList.add('hidden');
  }

  minimizeMap() {
    document.getElementById('map-container').classList.remove('expanded');
    document.getElementById('map-container').classList.add('minimized');
    document.getElementById('map-content').classList.add('hidden');
    document.getElementById('toggle-map-btn').classList.remove('hidden');
  }

  placeGuessMarker(latLng) {
    if (this.game.guessMarker) this.game.guessMarker.setMap(null);
    const markerOpts = {
      position: latLng,
      map: this.game.map,
      title: 'Your Guess',
      animation: google.maps.Animation.DROP,
    };
    // Custom guess pin: an emoji rendered as an SVG data-URI icon. The active
    // pin is chosen on the profile screen and stored in localStorage (a purely
    // cosmetic client preference, so no backend write needed).
    const icon = this.getSelectedPinIcon();
    if (icon) markerOpts.icon = icon;
    this.game.guessMarker = new google.maps.Marker(markerOpts);
    this.game.guessLocation = latLng;
    document.getElementById('confirm-guess-btn').disabled = false;
  }

  // Build a Google Maps marker icon from the selected pin's emoji. Returns
  // null for the default pin (Google's red marker). Emoji is rendered into a
  // small SVG so it scales crisply and matches the arcade aesthetic.
  getSelectedPinIcon() {
    const pinId = localStorage.getItem('geoguesser_selected_pin') || 'default';
    if (pinId === 'default') return null;
    const emoji = pinEmoji(pinId);
    if (!emoji) return null;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44">
      <path d="M18 0C8 0 0 8 0 18c0 13 18 26 18 26s18-13 18-26C36 8 28 0 18 0z" fill="#ff3b6b" stroke="#fff" stroke-width="2"/>
      <text x="18" y="22" font-size="16" text-anchor="middle" dominant-baseline="middle">${emoji}</text>
    </svg>`;
    return {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
      scaledSize: new google.maps.Size(36, 44),
      anchor: new google.maps.Point(18, 42),
    };
  }

  async confirmGuess() {
    if (!this.game.guessLocation) return;
    this.stopTimer();

    const distance = google.maps.geometry.spherical.computeDistanceBetween(
      new google.maps.LatLng(this.game.currentLocation),
      this.game.guessLocation
    ) / 1000;

    // Decay is mode-dependent (smaller regions use a tighter decay).
    const decayFactor = getModeMeta(this.game.mode).decayFactor;
    const basePoints = computeScore(distance, decayFactor);

    // Arcade bonuses (speed + streak). These are display/leaderboard only —
    // they do NOT feed ranked ELO, which is computed from baseScore only.
    const timeUsedSec = this.game.roundStartTime
      ? (Date.now() - this.game.roundStartTime) / 1000
      : 0;
    const newStreak = distance < STREAK_THRESHOLD_KM ? this.game.streak + 1 : 0;
    const streakMult = computeStreakMultiplier(newStreak);
    const speedBonus = computeSpeedBonus(timeUsedSec, this.game.timeControl);
    const arcadeBonus = Math.min(1000, speedBonus * streakMult);
    const points = basePoints + arcadeBonus;

    this.game.streak = newStreak;
    this.game.baseScore += basePoints;
    this.game.score += points;
    this.updateStreakHUD(streakMult, speedBonus, arcadeBonus);

    const result = {
      round: this.game.round,
      actualLocation: this.game.currentLocation,
      guessLocation: {
        lat: this.game.guessLocation.lat(),
        lng: this.game.guessLocation.lng(),
      },
      distance,
      basePoints,
      speedBonus,
      streakMult,
      arcadeBonus,
      points,
    };

    this.game.roundResults.push(result);

    if (this.game.isMultiplayer) {
      await multiplayerService.submitGuess(this.game.round, result.guessLocation, distance, points, basePoints);
    }

    // Arcade juice: chiptune sound for the round + confetti on a bullseye.
    arcadeFX.playRoundSound(result, this.game.timedOutThisRound);
    if (result.distance < 1) arcadeFX.confettiBurst();
    this.game.timedOutThisRound = false;

    // Achievements: bullseye / perfect round are detectable from this round.
    // Unlock asynchronously; toast any that are newly earned.
    const roundAch = detectRoundAchievements(result);
    if (roundAch.length && authService.user && !authService.user.isAnonymous) {
      const fresh = await authService.unlockAchievements(roundAch);
      if (fresh.length && window.uiController) window.uiController.showAchievementToasts(fresh);
    }

    this.showRoundResult(result);
  }

  // Update the on-screen streak + speed-bonus HUD chips. The streak counter
  // only surfaces once it's meaningful (x2+); the speed chip shows the bonus
  // earned this round. Both reset/hidden between rounds via resetRoundHUD().
  updateStreakHUD(streakMult, speedBonus, arcadeBonus) {
    const streakDisplay = document.getElementById('streak-display');
    const streakValue = document.getElementById('streak-value');
    if (streakDisplay && streakValue) {
      if (streakMult >= 2) {
        streakValue.textContent = `x${streakMult}`;
        streakDisplay.classList.remove('hidden');
        streakDisplay.classList.remove('streak-pop');
        // re-trigger the pop animation
        void streakDisplay.offsetWidth;
        streakDisplay.classList.add('streak-pop');
      } else {
        streakDisplay.classList.add('hidden');
      }
    }
    const speedDisplay = document.getElementById('speed-bonus-display');
    const speedValue = document.getElementById('speed-bonus-value');
    if (speedDisplay && speedValue) {
      if (arcadeBonus > 0) {
        speedValue.textContent = `+${arcadeBonus}`;
        speedDisplay.classList.remove('hidden');
      } else {
        speedDisplay.classList.add('hidden');
      }
    }
  }

  // Hide the streak/speed chips at the start of each round (called from
  // loadRound). They re-appear after the next confirmGuess.
  resetRoundHUD() {
    document.getElementById('streak-display')?.classList.add('hidden');
    document.getElementById('speed-bonus-display')?.classList.add('hidden');
  }

  showRoundResult(result) {
    document.getElementById('result-round').textContent = result.round;
    document.getElementById('result-distance').textContent =
      result.distance < 1
        ? Math.round(result.distance * 1000) + ' m'
        : Math.round(result.distance) + ' km';
    this.animateCount(document.getElementById('result-points'), result.points, 850);
    this.animateCount(document.getElementById('result-total'), this.game.score, 850);

    this.game.resultMap = new google.maps.Map(document.getElementById('result-map'), {
      streetViewControl: false,
      mapTypeControl: false,
      fullscreenControl: true,
      styles: ARCADE_MAP_STYLE,
    });
    this.game.sharedMarkers = [];

    if (this.game.isMultiplayer) {
      this.renderSharedResultMap(result.round);
    } else {
      this.renderSoloResultMap(result);
    }

    if (this.game.isMultiplayer) {
      document.getElementById('next-round-btn').classList.add('hidden');
      document.getElementById('mp-round-status').classList.remove('hidden');
      document.getElementById('mp-waiting-message').textContent = 'Waiting for opponent...';
    } else {
      document.getElementById('next-round-btn').classList.remove('hidden');
      document.getElementById('next-round-btn').textContent =
        this.game.round < this.game.totalRounds ? 'Next Round' : 'View Final Score';
      document.getElementById('mp-round-status').classList.add('hidden');
    }

    this.showScreen('result-screen');
  }

  // Solo: actual (green) + your guess (red) + connecting line.
  renderSoloResultMap(result) {
    const bounds = new google.maps.LatLngBounds();
    new google.maps.Marker({
      position: result.actualLocation,
      map: this.game.resultMap,
      title: 'Actual Location',
      icon: { url: 'http://maps.google.com/mapfiles/ms/icons/green-dot.png' },
    });
    bounds.extend(result.actualLocation);
    new google.maps.Marker({
      position: result.guessLocation,
      map: this.game.resultMap,
      title: 'Your Guess',
      icon: { url: 'http://maps.google.com/mapfiles/ms/icons/red-dot.png' },
    });
    bounds.extend(result.guessLocation);
    new google.maps.Polyline({
      path: [result.actualLocation, result.guessLocation],
      geodesic: true,
      strokeColor: '#FF0000',
      strokeOpacity: 0.8,
      strokeWeight: 3,
      map: this.game.resultMap,
    });
    this.game.resultMap.fitBounds(bounds);
  }

  // Multiplayer: actual location + every player's guess for the round, each
  // labeled with the player's initial. Re-rendered live as opponents submit.
  renderSharedResultMap(round) {
    const gameData = multiplayerService.currentGame && multiplayerService.currentGame.data;
    if (!gameData || !this.game.resultMap) return;

    if (this.game.sharedMarkers) this.game.sharedMarkers.forEach((m) => m.setMap(null));
    this.game.sharedMarkers = [];

    const actual = this.game.currentLocation;
    const bounds = new google.maps.LatLngBounds();

    const actualMarker = new google.maps.Marker({
      position: actual,
      map: this.game.resultMap,
      title: 'Actual Location',
      icon: { url: 'http://maps.google.com/mapfiles/ms/icons/green-dot.png' },
    });
    this.game.sharedMarkers.push(actualMarker);
    bounds.extend(actual);

    const palette = ['#d32f2f', '#1976d2', '#7b1fa2', '#fbc02d', '#388e3c', '#0288d1', '#c2185b', '#5d4037'];
    let colorIdx = 0;
    Object.values(gameData.players || {}).forEach((p) => {
      const g = p.guesses && p.guesses[round];
      if (!g || !g.location) return;
      const isYou = p.uid === authService.user.uid;
      const marker = new google.maps.Marker({
        position: g.location,
        map: this.game.resultMap,
        title: `${isYou ? 'You' : p.displayName} — ${Math.round(g.distance)} km`,
        label: {
          text: isYou ? 'Y' : (p.displayName[0] || '?').toUpperCase(),
          color: '#fff',
          fontWeight: 'bold',
        },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 11,
          fillColor: isYou ? '#000000' : palette[colorIdx++ % palette.length],
          fillOpacity: 1,
          strokeColor: '#fff',
          strokeWeight: 2,
        },
      });
      this.game.sharedMarkers.push(marker);
      bounds.extend(g.location);
    });

    this.game.resultMap.fitBounds(bounds);
  }

  // Called from the realtime dispatcher while on the result screen, so the
  // shared map updates as each opponent submits their guess.
  updateSharedResultMap(_gameData) {
    if (!this.game.isMultiplayer) return;
    const resultScreen = document.getElementById('result-screen');
    if (!resultScreen || resultScreen.classList.contains('hidden')) return;
    if (!this.game.resultMap) return;
    this.renderSharedResultMap(this.game.round);
  }

  nextRound() {
    if (this.game.round < this.game.totalRounds) {
      this.game.round++;
      this.showScreen('game-screen');
      this.loadRound();
    } else {
      this.showFinalScore();
    }
  }

  checkAllPlayersFinished(gameData) {
    if (!this.game.isMultiplayer) return;
    if (this.advancingToNextRound) return;

    const currentRound = this.game.round;
    const players = gameData.players || {};

    const allPlayersFinished = Object.values(players).every((player) => {
      return player.guesses && player.guesses[currentRound];
    });

    if (allPlayersFinished) {
      this.advancingToNextRound = true;
      const waitingMsg = document.getElementById('mp-waiting-message');
      if (waitingMsg) waitingMsg.textContent = 'All players finished! Moving on...';

      setTimeout(() => {
        this.advancingToNextRound = false;
        this.nextRound();
      }, 2000);
    }
  }

  // Count a number up from 0 to `target` inside `el` over ~1.1s with an
  // easeOutCubic settle. Respects prefers-reduced-motion (instant). Pure UI —
  // does not touch game state or scoring.
  animateCount(el, target, duration = 1100) {
    if (!el) return;
    const reduce = window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !target) { el.textContent = target.toLocaleString(); return; }
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.round(target * eased).toLocaleString();
      if (t < 1) requestAnimationFrame(tick);
      else el.textContent = target.toLocaleString();
    };
    requestAnimationFrame(tick);
  }

  async showFinalScore() {
    this.animateCount(document.getElementById('final-score'), this.game.score);

    const summaryContainer = document.getElementById('round-summary');
    summaryContainer.innerHTML = '<h3>Round Breakdown</h3>';

    this.game.roundResults.forEach((result) => {
      const roundItem = document.createElement('div');
      roundItem.className = 'round-item';
      const bonus = result.arcadeBonus > 0
        ? ` <span style="color: var(--secondary-color); font-size: 0.85rem;">(+${result.arcadeBonus}⚡)</span>`
        : '';
      roundItem.innerHTML = `
        <span>Round ${result.round}</span>
        <span>${Math.round(result.distance)} km</span>
        <span style="color: #4CAF50; font-weight: bold;">${result.points.toLocaleString()} pts${bonus}</span>
      `;
      summaryContainer.appendChild(roundItem);
    });

    if (this.game.isMultiplayer) {
      const gameData = multiplayerService.currentGame.data;
      const players = gameData.players || {};
      const sortedPlayers = Object.values(players).sort((a, b) => b.score - a.score);

      document.getElementById('mp-final-result').classList.remove('hidden');

      const yourIndex = sortedPlayers.findIndex((p) => p.uid === authService.user.uid);
      const resultText = yourIndex === 0 ? '🏆 You Win!'
        : yourIndex === sortedPlayers.length - 1 ? 'Better luck next time!'
        : `#${yourIndex + 1} Place`;
      document.getElementById('mp-result-text').textContent = resultText;

      const mpStandingsDiv = document.getElementById('mp-final-standings');
      mpStandingsDiv.innerHTML = '<h3>Final Standings</h3>';

      // ELO update: each rated player computes their own new rating from the
      // shared eloStart values + final scores, then writes their own users doc.
      // (No cross-user writes — every client writes only its own rating.)
      let myEloDelta = 0;
      const myPlayer = players[authService.user.uid];
      const myEloStart = myPlayer && typeof myPlayer.eloStart === 'number'
        ? myPlayer.eloStart
        : DEFAULT_RATING;
      if (authService.user && !authService.user.isAnonymous) {
        const opponents = Object.values(players)
          .filter((p) => p.uid !== authService.user.uid && typeof p.eloStart === 'number')
          // ELO stays pure distance-only: compare baseScores (no arcade
          // speed/streak bonuses). Fall back to score for older in-progress
          // games that don't yet have a baseScore field.
          .map((p) => ({ rating: p.eloStart, score: typeof p.baseScore === 'number' ? p.baseScore : p.score }));
        if (opponents.length > 0) {
          const newElo = computeNewRating(myEloStart, this.game.baseScore, opponents);
          myEloDelta = newElo - myEloStart;
          await authService.updateElo(newElo);
        }
      }

      // HIGH-SCORE style ranking table (alternating row tint, gold/silver/
      // bronze ranks, pixel-font score). Rendering only — the ELO math above
      // is unchanged.
      const rows = sortedPlayers.map((player, index) => {
        const isYou = player.uid === authService.user.uid;
        const rating = typeof player.eloStart === 'number'
          ? `<span class="hs-elo">${player.eloStart}⚡</span>`
          : '';
        const delta = isYou && myEloDelta !== 0
          ? ` <span class="${myEloDelta > 0 ? 'hs-delta-up' : 'hs-delta-down'}">(${myEloDelta > 0 ? '+' : ''}${myEloDelta})</span>`
          : '';
        const name = `${player.displayName}${isYou ? '<span class="you-tag">YOU</span>' : ''}${rating}${delta}`;
        return `<tr class="${isYou ? 'is-you' : ''}">
          <td class="hs-rank">${index + 1}</td>
          <td class="hs-name">${name}</td>
          <td class="hs-score">${player.score.toLocaleString()}</td>
        </tr>`;
      }).join('');
      mpStandingsDiv.innerHTML = `
        <h3>Final Standings</h3>
        <table class="hs-table">
          <thead><tr><th>Rank</th><th>Player</th><th>Score</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`;

      // Multiplayer win-streak achievement (5 wins in a row). A non-win
      // breaks the streak. Toast if this hit the threshold.
      if (authService.user && !authService.user.isAnonymous) {
        const mp = await authService.recordMultiplayerResult(yourIndex === 0);
        if (mp.unlocked && window.uiController) window.uiController.showAchievementToasts(['winStreak5']);
      }
    }

    // Record the game + update aggregate stats. For multiplayer each client
    // records its own result (every player writes only their own games/users).
    // The rounds array (per-guess coords) powers the "Your Map" heatmap.
    if (authService.user) {
      const rounds = this.game.roundResults.map((r) => ({
        round: r.round,
        lat: r.guessLocation.lat,
        lng: r.guessLocation.lng,
        distance: r.distance,
        points: r.points,
        mode: this.game.mode,
      }));
      await authService.saveGameScore(this.game.score, this.game.mode, rounds);

      // Globe Trotter: unlocked once every mode has been played. Guests skip.
      if (!authService.user.isAnonymous) {
        const globeDone = await authService.recordModePlayed(this.game.mode);
        if (globeDone) {
          const fresh = await authService.unlockAchievements(['globeTrotter']);
          if (fresh.length && window.uiController) window.uiController.showAchievementToasts(fresh);
        }
      }
    }

    this.showScreen('final-screen');

    // Set initial rematch-button visibility for the host.
    if (this.game.isMultiplayer && window.uiController && window.uiController.onMultiplayerUpdate) {
      window.uiController.onMultiplayerUpdate(multiplayerService.currentGame.data);
    }
  }

  quitGame() {
    if (confirm('Quit current game?')) {
      this.stopTimer();
      if (this.game.isMultiplayer) {
        multiplayerService.notifyPlayerLeft();
        multiplayerService.leaveGame();
      }
      this.showScreen('main-menu');
    }
  }

  showScreen(screenId) {
    document.querySelectorAll('.screen').forEach((screen) => screen.classList.add('hidden'));
    document.getElementById(screenId).classList.remove('hidden');
  }
}

export { GameController };
export default GameController;