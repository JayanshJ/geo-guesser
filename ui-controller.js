// UI Controller - Handles all UI interactions and navigation
class UIController {
    constructor(authService, multiplayerService) {
        this.auth = authService;
        this.multiplayer = multiplayerService;
        this.pendingGameMode = null;
        this.pendingIsMultiplayer = false;
        this.multiplayerGameStarted = false;
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Name entry
        document.getElementById('start-playing-btn').addEventListener('click', () => this.handleStartPlaying());
        document.getElementById('player-name-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleStartPlaying();
        });
        document.getElementById('change-name-btn').addEventListener('click', () => this.handleChangeName());

        // Solo mode buttons
        document.getElementById('solo-world-btn').addEventListener('click', () => this.showTimeSelection('world', false));
        document.getElementById('solo-india-btn').addEventListener('click', () => this.showTimeSelection('india', false));

        // Multiplayer - Create game buttons
        document.getElementById('create-world-btn').addEventListener('click', () => this.showTimeSelection('world', true));
        document.getElementById('create-india-btn').addEventListener('click', () => this.showTimeSelection('india', true));
        
        // Time control selection
        document.querySelectorAll('.time-option-btn').forEach(btn => {
            btn.addEventListener('click', () => this.selectTimeControl(btn.dataset.time));
        });
        document.getElementById('cancel-time-select-btn').addEventListener('click', () => this.hideTimeSelection());
        
        // Multiplayer - Join with room code
        document.getElementById('join-room-btn').addEventListener('click', () => this.joinRoomByCode());
        document.getElementById('room-code-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinRoomByCode();
        });
        
        // Copy room code button
        document.getElementById('copy-code-btn').addEventListener('click', () => this.copyRoomCode());

        // Leaderboard
        document.getElementById('leaderboard-btn').addEventListener('click', () => this.showLeaderboard());
        document.getElementById('close-leaderboard-btn').addEventListener('click', () => this.closeLeaderboard());

        // Matchmaking
        document.getElementById('cancel-matchmaking-btn').addEventListener('click', () => this.cancelMatchmaking());
        document.getElementById('leave-lobby-btn').addEventListener('click', () => this.leaveLobby());

        // Game controls
        document.getElementById('play-again-btn').addEventListener('click', () => this.backToMenu());
    }

    async handleStartPlaying() {
        const nameInput = document.getElementById('player-name-input');
        const name = nameInput.value.trim();
        
        if (!name) {
            // Generate random name if empty
            await this.auth.createUser();
        } else {
            await this.auth.createUser(name);
        }
    }

    handleChangeName() {
        const newName = prompt('Enter new name:', this.auth.user?.displayName || '');
        if (newName && newName.trim()) {
            this.auth.changeName(newName.trim());
        }
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
    }

    selectTimeControl(timeControl) {
        const mode = this.pendingGameMode;
        const isMultiplayer = this.pendingIsMultiplayer;
        
        this.hideTimeSelection();
        
        if (isMultiplayer) {
            this.createMultiplayerGame(mode, timeControl);
        } else {
            this.startSoloGame(mode, timeControl);
        }
    }

    startSoloGame(mode, timeControl = 'unlimited') {
        window.gameController.startGame(mode, false, timeControl);
    }

    async createMultiplayerGame(mode, timeControl = 'unlimited') {
        // First, ensure we're on the matchmaking screen
        this.showScreen('matchmaking-screen');
        
        // Reset game started flag
        this.multiplayerGameStarted = false;
        
        // Store time control for when game starts
        this.multiplayerTimeControl = timeControl;
        
        try {
            const roomCode = await this.multiplayer.createGame(mode, timeControl);
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
            // Reset game started flag
            this.multiplayerGameStarted = false;
            
            const result = await this.multiplayer.joinGameByCode(code);
            if (result.success) {
                this.showLobby();
            } else {
                alert(result.error);
            }
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
            setTimeout(() => {
                btn.textContent = '📋 Copy Code';
            }, 2000);
        }).catch(() => {
            alert('Room code: ' + code);
        });
    }

    cancelMatchmaking() {
        this.multiplayer.leaveGame();
        this.multiplayerGameStarted = false;
        this.showScreen('main-menu');
    }

    async leaveLobby() {
        await this.multiplayer.leaveGame();
        this.multiplayerGameStarted = false;
        this.showScreen('main-menu');
    }

    showLobby() {
        this.showScreen('lobby-screen');
        const gameData = this.multiplayer.currentGame.data;
        
        console.log('[Lobby] Game data:', gameData);
        console.log('[Lobby] TimeControl from gameData:', gameData.timeControl);
        
        // Show host info
        document.getElementById('lobby-host-name').textContent = gameData.host.displayName;

        // Show opponent if joined
        if (gameData.opponent) {
            document.getElementById('lobby-waiting').classList.add('hidden');
            document.getElementById('lobby-opponent').classList.remove('hidden');
            document.getElementById('lobby-opponent-name').textContent = gameData.opponent.displayName;
            
            // Only start game once
            if (!this.multiplayerGameStarted) {
                this.multiplayerGameStarted = true;
                
                // Start game after short delay with time control from game data
                document.getElementById('lobby-start-container').classList.remove('hidden');
                setTimeout(() => {
                    const timeControl = gameData.timeControl || 'unlimited';
                    console.log('[Lobby] Starting game with timeControl:', timeControl);
                    window.gameController.startGame(gameData.mode, true, timeControl);
                }, 2000);
            }
        }
    }

    async showLeaderboard() {
        this.showScreen('leaderboard-screen');
        const leaderboard = await this.auth.getLeaderboard('all', 20);
        const content = document.getElementById('leaderboard-content');
        
        if (leaderboard.length === 0) {
            content.innerHTML = '<div class="leaderboard-empty">No scores yet. Be the first to play!</div>';
            return;
        }
        
        content.innerHTML = leaderboard.map((user, index) => `
            <div class="leaderboard-item">
                <span class="rank">#${index + 1}</span>
                <span class="leaderboard-avatar">${this.getAvatarEmoji(index)}</span>
                <span class="leaderboard-name">${user.displayName}</span>
                <span class="leaderboard-score">${user.bestScore.toLocaleString()}</span>
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

    backToMenu() {
        this.showScreen('main-menu');
    }

    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.add('hidden');
        });
        document.getElementById(screenId).classList.remove('hidden');
    }
}

// Initialize UI Controller - called from initApp in game.js
let uiController;

function initUIController() {
    uiController = new UIController(authService, multiplayerService);
    window.uiController = uiController;
}
