// Game controller - round/Street View/map/timer/scoring logic for solo and
// multiplayer. `google.maps` is the global injected by the Maps script in
// main.js; the geometry library (`computeDistanceBetween`) is loaded too.
// (`google` is declared as a readonly global in eslint.config.js.)
import { authService } from '../services/auth.js';
import { multiplayerService } from '../services/multiplayer.js';
import { CONFIG } from '../config.js';
import { LocationGenerator, getModeMeta, computeScore } from './locations.js';
import { computeNewRating, DEFAULT_RATING } from './elo.js';

class GameController {
  constructor() {
    this.game = {
      round: 1,
      totalRounds: 5,
      score: 0,
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
    this.game.guessMarker = new google.maps.Marker({
      position: latLng,
      map: this.game.map,
      title: 'Your Guess',
      animation: google.maps.Animation.DROP,
    });
    this.game.guessLocation = latLng;
    document.getElementById('confirm-guess-btn').disabled = false;
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
    const points = computeScore(distance, decayFactor);

    const result = {
      round: this.game.round,
      actualLocation: this.game.currentLocation,
      guessLocation: {
        lat: this.game.guessLocation.lat(),
        lng: this.game.guessLocation.lng(),
      },
      distance,
      points,
    };

    this.game.roundResults.push(result);
    this.game.score += points;

    if (this.game.isMultiplayer) {
      await multiplayerService.submitGuess(this.game.round, result.guessLocation, distance, points);
    }

    this.showRoundResult(result);
  }

  showRoundResult(result) {
    document.getElementById('result-round').textContent = result.round;
    document.getElementById('result-distance').textContent =
      result.distance < 1
        ? Math.round(result.distance * 1000) + ' m'
        : Math.round(result.distance) + ' km';
    document.getElementById('result-points').textContent = result.points.toLocaleString();
    document.getElementById('result-total').textContent = this.game.score.toLocaleString();

    this.game.resultMap = new google.maps.Map(document.getElementById('result-map'), {
      streetViewControl: false,
      mapTypeControl: false,
      fullscreenControl: true,
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

  async showFinalScore() {
    document.getElementById('final-score').textContent = this.game.score.toLocaleString();

    const summaryContainer = document.getElementById('round-summary');
    summaryContainer.innerHTML = '<h3>Round Breakdown</h3>';

    this.game.roundResults.forEach((result) => {
      const roundItem = document.createElement('div');
      roundItem.className = 'round-item';
      roundItem.innerHTML = `
        <span>Round ${result.round}</span>
        <span>${Math.round(result.distance)} km</span>
        <span style="color: #4CAF50; font-weight: bold;">${result.points.toLocaleString()} pts</span>
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
          .map((p) => ({ rating: p.eloStart, score: p.score }));
        if (opponents.length > 0) {
          const newElo = computeNewRating(myEloStart, this.game.score, opponents);
          myEloDelta = newElo - myEloStart;
          await authService.updateElo(newElo);
        }
      }

      sortedPlayers.forEach((player, index) => {
        const isYou = player.uid === authService.user.uid;
        const playerScore = document.createElement('div');
        playerScore.className = 'mp-player-final-score';
        const ratingLabel = typeof player.eloStart === 'number'
          ? ` · ${player.eloStart}⚡`
          : '';
        const youDelta = isYou && myEloDelta !== 0
          ? ` <span style="color:${myEloDelta > 0 ? '#4CAF50' : '#f44336'}">(${myEloDelta > 0 ? '+' : ''}${myEloDelta})</span>`
          : '';
        playerScore.innerHTML = `
          <span>${index + 1}. ${isYou ? '<strong>You</strong>' : player.displayName}${ratingLabel}${youDelta}</span>
          <span style="color: #4CAF50; font-weight: bold;">${player.score} pts</span>
        `;
        mpStandingsDiv.appendChild(playerScore);
      });
    }

    // Record the game + update aggregate stats. For multiplayer each client
    // records its own result (every player writes only their own games/users).
    if (authService.user) {
      await authService.saveGameScore(this.game.score, this.game.mode);
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