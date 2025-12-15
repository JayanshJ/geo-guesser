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
            isHost: false,
            resolvedLocations: [] // Stores actual panorama locations
        };
        this.timer = null;
        this.timeRemaining = 0;
        this.roundTimeLimit = 20; // 20 seconds per round
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

    startGame(mode, isMultiplayer = false) {
        this.game.round = 1;
        this.game.score = 0;
        this.game.roundResults = [];
        this.game.guessLocation = null;
        this.game.mode = mode;
        this.game.isMultiplayer = isMultiplayer;
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
            document.getElementById('your-mp-score').textContent = '0';
            document.getElementById('opponent-mp-score').textContent = '0';
        } else {
            document.getElementById('multiplayer-scores').classList.add('hidden');
        }

        this.showScreen('game-screen');
        this.loadRound();
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
                this.startTimer();
            } else {
                // Wait for host to resolve location
                this.waitForResolvedLocation(roundIndex);
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

    // Timer methods
    startTimer() {
        this.stopTimer(); // Clear any existing timer
        this.timeRemaining = this.roundTimeLimit;
        this.updateTimerDisplay();
        
        this.timer = setInterval(() => {
            this.timeRemaining--;
            this.updateTimerDisplay();
            
            if (this.timeRemaining <= 0) {
                this.stopTimer();
                this.handleTimeUp();
            }
        }, 1000);
    }

    stopTimer() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    updateTimerDisplay() {
        const minutes = Math.floor(this.timeRemaining / 60);
        const seconds = this.timeRemaining % 60;
        const display = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        
        const timerEl = document.getElementById('round-timer');
        timerEl.textContent = display;
        
        // Update color based on time remaining
        timerEl.classList.remove('warning', 'danger');
        if (this.timeRemaining <= 10) {
            timerEl.classList.add('danger');
        } else if (this.timeRemaining <= 30) {
            timerEl.classList.add('warning');
        }
    }

    handleTimeUp() {
        // Auto-submit with current guess or no guess
        if (this.game.guessLocation) {
            this.confirmGuess();
        } else {
            // No guess made - score 0 for this round
            const result = {
                round: this.game.round,
                actualLocation: this.game.currentLocation,
                guessLocation: null,
                distance: Infinity,
                points: 0
            };
            this.game.roundResults.push(result);
            
            if (this.game.isMultiplayer) {
                multiplayerService.submitGuess(
                    this.game.round,
                    null,
                    Infinity,
                    0
                );
            }
            
            this.showTimeUpResult(result);
        }
    }

    showTimeUpResult(result) {
        document.getElementById('result-round').textContent = result.round;
        document.getElementById('result-distance').textContent = 'No guess made';
        document.getElementById('result-points').textContent = '0';
        document.getElementById('result-total').textContent = this.game.score.toLocaleString();

        // Show only actual location on map
        this.game.resultMap = new google.maps.Map(document.getElementById('result-map'), {
            center: result.actualLocation,
            zoom: 5,
            streetViewControl: false,
            mapTypeControl: false,
            fullscreenControl: true,
        });

        new google.maps.Marker({
            position: result.actualLocation,
            map: this.game.resultMap,
            title: 'Actual Location',
            icon: { url: 'http://maps.google.com/mapfiles/ms/icons/green-dot.png' }
        });

        document.getElementById('next-round-btn').textContent =
            this.game.round < this.game.totalRounds ? 'Next Round' : 'View Final Score';

        if (this.game.isMultiplayer) {
            document.getElementById('mp-round-status').classList.remove('hidden');
        }

        this.showScreen('result-screen');
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

    checkBothPlayersFinished(gameData) {
        if (!this.game.isMultiplayer) return;
        if (this.advancingToNextRound) return; // Prevent multiple triggers
        
        const currentRound = this.game.round;
        const hostGuess = gameData.hostGuesses && gameData.hostGuesses[currentRound];
        const opponentGuess = gameData.opponentGuesses && gameData.opponentGuesses[currentRound];
        
        if (hostGuess && opponentGuess) {
            // Both players have submitted - show brief result then auto-advance
            this.advancingToNextRound = true;
            document.getElementById('mp-waiting-message').textContent = 'Both finished! Moving on...';
            
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
            const opponentScore = gameData.host.uid === authService.user.uid
                ? gameData.opponentScore
                : gameData.hostScore;

            document.getElementById('mp-final-result').classList.remove('hidden');
            document.getElementById('mp-your-final').textContent = this.game.score;
            document.getElementById('mp-opponent-final').textContent = opponentScore;
            document.getElementById('mp-result-text').textContent =
                this.game.score > opponentScore ? '🏆 You Win!' :
                this.game.score < opponentScore ? '😞 You Lost' : '🤝 Draw!';
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
    
    // Initialize UI controller after game controller is ready
    initUIController();
    
    // Initialize auth service
    authService.initialize();
    
    // Multiplayer game update handler
    window.multiplayerGameUpdate = (gameData) => {
        if (gameData.status === 'playing' && gameData.opponent) {
            const lobbyVisible = document.getElementById('lobby-screen').classList.contains('hidden') === false;
            const matchmakingVisible = document.getElementById('matchmaking-screen').classList.contains('hidden') === false;

            // If we're in lobby or still on matchmaking (host waiting), transition to lobby
            if (lobbyVisible || matchmakingVisible) {
                uiController.showLobby();
            }
        }
        
        // Update multiplayer scores
        if (gameController.game.isMultiplayer) {
            const isHost = gameData.host.uid === authService.user.uid;
            const yourScore = isHost ? gameData.hostScore : gameData.opponentScore;
            const oppScore = isHost ? gameData.opponentScore : gameData.hostScore;
            
            document.getElementById('your-mp-score').textContent = yourScore;
            document.getElementById('opponent-mp-score').textContent = oppScore;
            
            // Sync resolved locations for opponent
            if (!isHost && gameData.resolvedLocations) {
                // Convert object to array if needed
                const resolvedArr = Array.isArray(gameData.resolvedLocations) 
                    ? gameData.resolvedLocations 
                    : Object.values(gameData.resolvedLocations);
                gameController.game.resolvedLocations = resolvedArr;
            }
            
            // Check if both players finished this round and auto-advance
            const resultScreenVisible = document.getElementById('result-screen').classList.contains('hidden') === false;
            if (resultScreenVisible) {
                gameController.checkBothPlayersFinished(gameData);
            }
        }
    };
}

// Make initApp globally available for Google Maps callback
window.initApp = initApp;
