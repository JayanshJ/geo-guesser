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
            timerInterval: null
        };
        this.setupEventListeners();
    }

    setupEventListeners() {
        document.getElementById('quit-btn').addEventListener('click', () => this.quitGame());
        document.getElementById('toggle-map-btn').addEventListener('click', () => this.toggleMap());
        document.getElementById('minimize-map-btn').addEventListener('click', () => this.minimizeMap());
        document.getElementById('confirm-guess-btn').addEventListener('click', () => this.confirmGuess());
        document.getElementById('next-round-btn').addEventListener('click', () => this.nextRound());
    }

    startGame(mode, isMultiplayer = false, timeControl = 'unlimited') {
        this.game.round = 1;
        this.game.score = 0;
        this.game.roundResults = [];
        this.game.guessLocation = null;
        this.game.mode = mode;
        this.game.isMultiplayer = isMultiplayer;
        this.game.timeControl = timeControl;
        this.game.gameLocations = this.getLocationsForMode();

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

        this.game.currentLocation = this.game.gameLocations[this.game.round - 1];
        this.findStreetViewLocation(this.game.currentLocation);

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
        this.startTimer();
    }

    startTimer() {
        // Clear any existing timer
        this.stopTimer();
        
        // If unlimited time, hide timer
        if (this.game.timeControl === 'unlimited') {
            document.getElementById('timer-display').classList.add('hidden');
            return;
        }
        
        // Set time in seconds
        this.game.timeRemaining = parseInt(this.game.timeControl);
        
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

    findStreetViewLocation(startLocation) {
        const streetViewService = new google.maps.StreetViewService();
        const STREET_VIEW_MAX_DISTANCE = 50000;

        streetViewService.getPanorama({
            location: startLocation,
            radius: STREET_VIEW_MAX_DISTANCE,
            source: google.maps.StreetViewSource.OUTDOOR
        }, (data, status) => {
            if (status === google.maps.StreetViewStatus.OK) {
                this.game.currentLocation = {
                    lat: data.location.latLng.lat(),
                    lng: data.location.latLng.lng()
                };
                this.initializeStreetView(this.game.currentLocation);
            } else {
                const newLocations = this.getLocationsForMode();
                this.game.currentLocation = newLocations[0];
                this.findStreetViewLocation(this.game.currentLocation);
            }
        });
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

        document.getElementById('next-round-btn').textContent =
            this.game.round < this.game.totalRounds ? 'Next Round' : 'View Final Score';

        if (this.game.isMultiplayer) {
            document.getElementById('mp-round-status').classList.remove('hidden');
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
        // When opponent joins, transition from matchmaking to lobby
        if (gameData.status === 'waiting' && gameData.opponent) {
            // Opponent just joined, show lobby
            const matchmakingScreen = document.getElementById('matchmaking-screen');
            if (!matchmakingScreen.classList.contains('hidden')) {
                uiController.showLobby();
            }
        }
        
        // When game status changes to playing, ensure we're in the lobby and ready to start
        if (gameData.status === 'playing' && gameData.opponent) {
            const lobbyScreen = document.getElementById('lobby-screen');
            if (!lobbyScreen.classList.contains('hidden')) {
                // Already in lobby, this will trigger game start
                uiController.showLobby();
            }
        }
        
        // Update multiplayer scores during game
        if (gameController.game.isMultiplayer) {
            const isHost = gameData.host.uid === authService.user.uid;
            const yourScore = isHost ? gameData.hostScore : gameData.opponentScore;
            const oppScore = isHost ? gameData.opponentScore : gameData.hostScore;
            
            document.getElementById('your-mp-score').textContent = yourScore;
            document.getElementById('opponent-mp-score').textContent = oppScore;
        }
    };
}

// Make initApp globally available for Google Maps callback
window.initApp = initApp;
