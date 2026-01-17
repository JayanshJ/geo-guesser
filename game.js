// Game Controller - Handles game logic for both solo and multiplayer
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
            resolvedLocations: [] // Stores actual panorama locations
        };
        this.advancingToNextRound = false; // Prevent double-trigger of auto-advance
        this.setupEventListeners();
    }

    setupEventListeners() {
        document.getElementById('quit-btn').addEventListener('click', () => this.quitGame());
        document.getElementById('toggle-map-btn').addEventListener('click', () => this.toggleMap());
        document.getElementById('minimize-map-btn').addEventListener('click', () => this.minimizeMap());
        document.getElementById('confirm-guess-btn').addEventListener('click', () => this.confirmGuess());
        document.getElementById('next-round-btn').addEventListener('click', () => this.nextRound());
        document.getElementById('opponent-left-ok-btn').addEventListener('click', () => this.handleOpponentLeftOk());
        
        // Handle page unload to notify opponent
        window.addEventListener('beforeunload', () => this.handlePlayerExit());
    }

    handleOpponentLeftOk() {
        document.getElementById('opponent-left-modal').classList.add('hidden');
        this.showScreen('main-menu');
    }

    handlePlayerExit() {
        if (this.game.isMultiplayer && multiplayerService.currentGame) {
            multiplayerService.notifyPlayerLeft();
        }
    }

    showOpponentLeftModal() {
        this.stopTimer();
        document.getElementById('opponent-left-modal').classList.remove('hidden');
    }

    startGame(mode, isMultiplayer = false, timeControl = 'unlimited') {
        console.log('[Game] Starting game. Mode:', mode, 'Multiplayer:', isMultiplayer, 'TimeControl:', timeControl);
        
        this.game.round = 1;
        this.game.score = 0;
        this.game.roundResults = [];
        this.game.guessLocation = null;
        this.game.mode = mode;
        this.game.isMultiplayer = isMultiplayer;
        this.game.timeControl = timeControl;
        this.game.resolvedLocations = [];
        
        // For multiplayer, use shared locations from Firestore; for solo, generate locally
        if (isMultiplayer && multiplayerService.currentGame && multiplayerService.currentGame.data.locations) {
            this.game.gameLocations = multiplayerService.currentGame.data.locations;
            // Check if we're the host
            this.game.isHost = multiplayerService.currentGame.data.host.uid === authService.user.uid;
            // Check if resolved locations already exist (opponent joining)
            if (multiplayerService.currentGame.data.resolvedLocations && 
                multiplayerService.currentGame.data.resolvedLocations.length > 0) {
                this.game.resolvedLocations = multiplayerService.currentGame.data.resolvedLocations;
            }
        } else {
            this.game.gameLocations = this.getLocationsForMode();
            this.game.isHost = true;
        }

        const modeText = mode === 'india' ? '🇮🇳 India Mode' : '🌍 World Mode';
        document.getElementById('game-mode-text').textContent = modeText;
        
        if (isMultiplayer) {
            document.getElementById('multiplayer-scores').classList.remove('hidden');
            this.updateMultiplayerScores(multiplayerService.currentGame.data);
        } else {
            document.getElementById('multiplayer-scores').classList.add('hidden');
        }

        this.showScreen('game-screen');
        this.loadRound();
    }
    
    updateMultiplayerScores(gameData) {
        if (!gameData || !gameData.players) return;
        
        const scoresContainer = document.getElementById('multiplayer-scores');
        scoresContainer.innerHTML = '';
        
        // Sort players by score (descending)
        const sortedPlayers = Object.values(gameData.players).sort((a, b) => b.score - a.score);
        
        sortedPlayers.forEach(player => {
            const isYou = player.uid === authService.user.uid;
            const scoreSpan = document.createElement('span');
            scoreSpan.className = 'mp-score';
            scoreSpan.innerHTML = `${isYou ? '<strong>You</strong>' : player.displayName}: <strong>${player.score}</strong>`;
            scoresContainer.appendChild(scoreSpan);
        });
        
        // Sync resolved locations for non-host
        if (!this.game.isHost && gameData.resolvedLocations) {
            const resolvedArr = Array.isArray(gameData.resolvedLocations) 
                ? gameData.resolvedLocations 
                : Object.values(gameData.resolvedLocations);
            this.game.resolvedLocations = resolvedArr;
        }
    }

    getLocationsForMode() {
        if (this.game.mode === 'india') {
            return this.generateIndiaLocations(this.game.totalRounds);
        } else {
            return this.generateWorldLocations(this.game.totalRounds);
        }
    }

    generateWorldLocations(count) {
        const locations = [];
        for (let i = 0; i < count; i++) {
            const lat = (Math.random() * 160) - 80;
            const lng = (Math.random() * 360) - 180;
            locations.push({ lat, lng });
        }
        return locations;
    }

    generateIndiaLocations(count) {
        const locations = [];
        for (let i = 0; i < count; i++) {
            const lat = 8 + Math.random() * 29;
            const lng = 68 + Math.random() * 29;
            locations.push({ lat, lng });
        }
        return locations;
    }

    loadRound() {
        document.getElementById('current-round').textContent = this.game.round;
        document.getElementById('current-score').textContent = this.game.score;

        this.game.guessLocation = null;
        document.getElementById('confirm-guess-btn').disabled = true;

        // In multiplayer, check if we have a resolved location for this round
        const roundIndex = this.game.round - 1;
        if (this.game.isMultiplayer && !this.game.isHost) {
            // Opponent: wait for host's resolved location if not available
            if (this.game.resolvedLocations[roundIndex] && this.game.resolvedLocations[roundIndex].panoId) {
                this.game.currentLocation = this.game.resolvedLocations[roundIndex];
                this.initializeStreetViewByPanoId(this.game.resolvedLocations[roundIndex].panoId);
            } else {
                // Wait for host to resolve location - timer will start when location is resolved
                this.waitForResolvedLocation(roundIndex);
                return; // Exit early, map setup and timer will be handled after location is resolved
            }
        } else {
            // Host or solo: find Street View and resolve
            this.game.currentLocation = this.game.gameLocations[roundIndex];
            this.findStreetViewLocation(this.game.currentLocation);
        }

        const mapCenter = this.game.mode === 'india' ? { lat: 22.5937, lng: 78.9629 } : { lat: 20, lng: 0 };
        const mapZoom = this.game.mode === 'india' ? 5 : 2;

        if (!this.game.map) {
            this.game.map = new google.maps.Map(document.getElementById('map'), {
                center: mapCenter,
                zoom: mapZoom,
                streetViewControl: false,
                mapTypeControl: false,
            });

            this.game.map.addListener('click', (e) => {
                this.placeGuessMarker(e.latLng);
            });
        } else {
            if (this.game.guessMarker) {
                this.game.guessMarker.setMap(null);
            }
            this.game.map.setCenter(mapCenter);
            this.game.map.setZoom(mapZoom);
        }

        this.minimizeMap();
        
        // Start timer after map is ready
        // For host/solo: timer starts in findStreetViewLocation callback
        // For opponent with pre-loaded location: start now
        if (this.game.isMultiplayer && !this.game.isHost && 
            this.game.resolvedLocations[roundIndex] && this.game.resolvedLocations[roundIndex].panoId) {
            this.startTimer();
        }
    }

    startTimer() {
        // Clear any existing timer
        this.stopTimer();
        
        console.log('[Timer] Starting timer. timeControl:', this.game.timeControl, 'isHost:', this.game.isHost, 'isMultiplayer:', this.game.isMultiplayer);
        
        // If unlimited time, hide timer
        if (this.game.timeControl === 'unlimited') {
            document.getElementById('timer-display').classList.add('hidden');
            return;
        }
        
        // Set time in seconds
        this.game.timeRemaining = parseInt(this.game.timeControl);
        console.log('[Timer] Time remaining set to:', this.game.timeRemaining, 'seconds');
        
        // Show timer
        const timerDisplay = document.getElementById('timer-display');
        timerDisplay.classList.remove('hidden');
        this.updateTimerDisplay();
        
        // Start countdown
        this.game.timerInterval = setInterval(() => {
            this.game.timeRemaining--;
            this.updateTimerDisplay();
            
            // Warning when < 30 seconds
            if (this.game.timeRemaining <= 30 && this.game.timeRemaining > 0) {
                timerDisplay.classList.add('warning');
            }
            
            // Time's up!
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
        const timeString = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        document.getElementById('timer-value').textContent = timeString;
    }

    handleTimeUp() {
        // Auto-submit with no guess (center of map as default)
        if (!this.game.guessLocation) {
            const mapCenter = this.game.mode === 'india' 
                ? { lat: 22.5937, lng: 78.9629 } 
                : { lat: 20, lng: 0 };
            this.game.guessLocation = new google.maps.LatLng(mapCenter.lat, mapCenter.lng);
        }
        this.confirmGuess();
    }

    waitForResolvedLocation(roundIndex) {
        // Poll for resolved location from Firestore updates
        const checkInterval = setInterval(() => {
            if (this.game.resolvedLocations[roundIndex] && this.game.resolvedLocations[roundIndex].panoId) {
                clearInterval(checkInterval);
                this.game.currentLocation = this.game.resolvedLocations[roundIndex];
                this.initializeStreetViewByPanoId(this.game.resolvedLocations[roundIndex].panoId);
                this.startTimer();
            }
        }, 500); // Check every 500ms
        
        // Timeout after 30 seconds - fallback to finding own location
        setTimeout(() => {
            clearInterval(checkInterval);
            if (!this.game.resolvedLocations[roundIndex]) {
                console.warn('Timeout waiting for host location, falling back to own search');
                this.game.currentLocation = this.game.gameLocations[roundIndex];
                this.findStreetViewLocation(this.game.currentLocation);
            }
        }, 30000);
    }

    findStreetViewLocation(startLocation) {
        const streetViewService = new google.maps.StreetViewService();
        const STREET_VIEW_MAX_DISTANCE = 50000;

        streetViewService.getPanorama({
            location: startLocation,
            radius: STREET_VIEW_MAX_DISTANCE,
            source: google.maps.StreetViewSource.OUTDOOR
        }, async (data, status) => {
            if (status === google.maps.StreetViewStatus.OK) {
                const resolvedLocation = {
                    lat: data.location.latLng.lat(),
                    lng: data.location.latLng.lng(),
                    panoId: data.location.pano
                };
                this.game.currentLocation = resolvedLocation;
                
                // If multiplayer host, save resolved location to Firestore
                if (this.game.isMultiplayer && this.game.isHost) {
                    this.game.resolvedLocations[this.game.round - 1] = resolvedLocation;
                    await multiplayerService.saveResolvedLocation(this.game.round - 1, resolvedLocation);
                }
                
                this.initializeStreetView(this.game.currentLocation);
                // Start the timer once location is loaded
                this.startTimer();
            } else {
                const newLocations = this.getLocationsForMode();
                this.game.currentLocation = newLocations[0];
                this.findStreetViewLocation(this.game.currentLocation);
            }
        });
    }

    initializeStreetViewByPanoId(panoId) {
        if (!this.game.panorama) {
            this.game.panorama = new google.maps.StreetViewPanorama(
                document.getElementById('street-view'),
                {
                    pano: panoId,
                    pov: { heading: 34, pitch: 10 },
                    zoom: 1,
                    addressControl: false,
                    showRoadLabels: false,
                    disableDefaultUI: false,
                    linksControl: true,
                    panControl: true,
                    enableCloseButton: false
                }
            );
        } else {
            this.game.panorama.setPano(panoId);
            this.game.panorama.setPov({ heading: 34, pitch: 10 });
        }
    }

    initializeStreetView(location) {
        if (!this.game.panorama) {
            this.game.panorama = new google.maps.StreetViewPanorama(
                document.getElementById('street-view'),
                {
                    position: location,
                    pov: { heading: 34, pitch: 10 },
                    zoom: 1,
                    addressControl: false,
                    showRoadLabels: false,
                    disableDefaultUI: false,
                    linksControl: true,
                    panControl: true,
                    enableCloseButton: false
                }
            );
        } else {
            this.game.panorama.setPosition(location);
            this.game.panorama.setPov({ heading: 34, pitch: 10 });
        }
    }

    toggleMap() {
        const container = document.getElementById('map-container');
        const content = document.getElementById('map-content');
        const toggleBtn = document.getElementById('toggle-map-btn');

        container.classList.remove('minimized');
        container.classList.add('expanded');
        content.classList.remove('hidden');
        toggleBtn.classList.add('hidden');
    }

    minimizeMap() {
        const container = document.getElementById('map-container');
        const content = document.getElementById('map-content');
        const toggleBtn = document.getElementById('toggle-map-btn');

        container.classList.remove('expanded');
        container.classList.add('minimized');
        content.classList.add('hidden');
        toggleBtn.classList.remove('hidden');
    }

    placeGuessMarker(latLng) {
        if (this.game.guessMarker) {
            this.game.guessMarker.setMap(null);
        }

        this.game.guessMarker = new google.maps.Marker({
            position: latLng,
            map: this.game.map,
            title: 'Your Guess',
            animation: google.maps.Animation.DROP
        });

        this.game.guessLocation = latLng;
        document.getElementById('confirm-guess-btn').disabled = false;
    }

    async confirmGuess() {
        if (!this.game.guessLocation) return;

        // Stop the timer
        this.stopTimer();

        const distance = google.maps.geometry.spherical.computeDistanceBetween(
            new google.maps.LatLng(this.game.currentLocation),
            this.game.guessLocation
        ) / 1000;

        // Different scoring for India (smaller area) vs World
        // India: ~3000km max, need tighter scoring (decay at 300km)
        // World: ~20000km max, looser scoring (decay at 2000km)
        const decayFactor = this.game.mode === 'india' ? 300 : 2000;
        const points = Math.round(5000 * Math.exp(-distance / decayFactor));

        const result = {
            round: this.game.round,
            actualLocation: this.game.currentLocation,
            guessLocation: {
                lat: this.game.guessLocation.lat(),
                lng: this.game.guessLocation.lng()
            },
            distance: distance,
            points: points
        };

        this.game.roundResults.push(result);
        this.game.score += points;

        if (this.game.isMultiplayer) {
            await multiplayerService.submitGuess(
                this.game.round,
                result.guessLocation,
                distance,
                points
            );
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

        const bounds = new google.maps.LatLngBounds();

        new google.maps.Marker({
            position: result.actualLocation,
            map: this.game.resultMap,
            title: 'Actual Location',
            icon: { url: 'http://maps.google.com/mapfiles/ms/icons/green-dot.png' }
        });
        bounds.extend(result.actualLocation);

        new google.maps.Marker({
            position: result.guessLocation,
            map: this.game.resultMap,
            title: 'Your Guess',
            icon: { url: 'http://maps.google.com/mapfiles/ms/icons/red-dot.png' }
        });
        bounds.extend(result.guessLocation);

        new google.maps.Polyline({
            path: [result.actualLocation, result.guessLocation],
            geodesic: true,
            strokeColor: '#FF0000',
            strokeOpacity: 0.8,
            strokeWeight: 3,
            map: this.game.resultMap
        });

        this.game.resultMap.fitBounds(bounds);

        // In multiplayer, hide next button and wait for both players
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
        if (this.advancingToNextRound) return; // Prevent multiple triggers
        
        const currentRound = this.game.round;
        const players = gameData.players || {};
        
        // Check if all players have submitted their guess for this round
        const allPlayersFinished = Object.values(players).every(player => {
            return player.guesses && player.guesses[currentRound];
        });
        
        if (allPlayersFinished) {
            // All players have submitted - show brief result then auto-advance
            this.advancingToNextRound = true;
            const waitingMsg = document.getElementById('mp-waiting-message');
            if (waitingMsg) {
                waitingMsg.textContent = 'All players finished! Moving on...';
            }
            
            setTimeout(() => {
                this.advancingToNextRound = false;
                this.nextRound();
            }, 2000); // Wait 2 seconds to show results, then advance
        }
    }

    async showFinalScore() {
        document.getElementById('final-score').textContent = this.game.score.toLocaleString();

        const summaryContainer = document.getElementById('round-summary');
        summaryContainer.innerHTML = '<h3>Round Breakdown</h3>';

        this.game.roundResults.forEach(result => {
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
            
            // Show multiplayer results
            document.getElementById('mp-final-result').classList.remove('hidden');
            
            // Determine your position
            const yourIndex = sortedPlayers.findIndex(p => p.uid === authService.user.uid);
            const resultText = yourIndex === 0 ? '🏆 You Win!' : 
                              yourIndex === sortedPlayers.length - 1 ? 'Better luck next time!' : 
                              `#${yourIndex + 1} Place`;
            document.getElementById('mp-result-text').textContent = resultText;
            
            // Show all player scores
            const mpStandingsDiv = document.getElementById('mp-final-standings');
            mpStandingsDiv.innerHTML = '<h3>Final Standings</h3>';
            
            sortedPlayers.forEach((player, index) => {
                const isYou = player.uid === authService.user.uid;
                const playerScore = document.createElement('div');
                playerScore.className = 'mp-player-final-score';
                playerScore.innerHTML = `
                    <span>${index + 1}. ${isYou ? '<strong>You</strong>' : player.displayName}</span>
                    <span style="color: #4CAF50; font-weight: bold;">${player.score} pts</span>
                `;
                mpStandingsDiv.appendChild(playerScore);
            });
        }

        if (!this.game.isMultiplayer && authService.user) {
            await authService.saveGameScore(this.game.score, this.game.mode);
        }

        this.showScreen('final-screen');
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
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.add('hidden');
        });
        document.getElementById(screenId).classList.remove('hidden');
    }
}

// Global initialization
let gameController;

function initApp() {
    gameController = new GameController();
    window.gameController = gameController; // Make accessible globally
    
    // Initialize auth service first (it's async but we don't need to wait)
    authService.initialize();
    
    // Initialize friends service with retry mechanism
    const initFriendsService = () => {
        if (authService.db) {
            friendsService.initialize();
        } else {
            // Retry after a short delay if db not ready
            setTimeout(initFriendsService, 100);
        }
    };
    initFriendsService();
    
    // Initialize UI controller after game controller is ready
    initUIController();
    
    // Multiplayer game update handler
    window.multiplayerGameUpdate = (gameData) => {
        // Update lobby if we're in it
        const lobbyScreen = document.getElementById('lobby-screen');
        if (!lobbyScreen.classList.contains('hidden')) {
            uiController.updateLobbyPlayers(gameData);
        }
        
        // When players join while in matchmaking, show lobby
        if (gameData.status === 'waiting') {
            const matchmakingScreen = document.getElementById('matchmaking-screen');
            if (!matchmakingScreen.classList.contains('hidden')) {
                const playerCount = gameData.players ? Object.keys(gameData.players).length : 0;
                if (playerCount > 1) {
                    uiController.showLobby();
                }
            }
        }
        
        // When game status changes to playing, ensure we're ready to start
        if (gameData.status === 'playing') {
            const lobbyScreen = document.getElementById('lobby-screen');
            const matchmakingScreen = document.getElementById('matchmaking-screen');
            if (!lobbyScreen.classList.contains('hidden') || !matchmakingScreen.classList.contains('hidden')) {
                uiController.updateLobbyPlayers(gameData);
            }
        }
        
        // Update multiplayer scores during game
        if (gameController.game.isMultiplayer) {
            gameController.updateMultiplayerScores(gameData);
            
            // Check if all players finished this round and auto-advance
            const resultScreenVisible = document.getElementById('result-screen').classList.contains('hidden') === false;
            if (resultScreenVisible) {
                gameController.checkAllPlayersFinished(gameData);
            }
        }
    };
}

// Make initApp globally available for Google Maps callback
window.initApp = initApp;
