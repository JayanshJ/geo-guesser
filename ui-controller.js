// UI Controller - Handles all UI interactions and navigation
class UIController {
    constructor(authService, multiplayerService) {
        this.auth = authService;
        this.multiplayer = multiplayerService;
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
        document.getElementById('solo-world-btn').addEventListener('click', () => this.startSoloGame('world'));
        document.getElementById('solo-india-btn').addEventListener('click', () => this.startSoloGame('india'));

        // Multiplayer - Create game buttons
        document.getElementById('create-world-btn').addEventListener('click', () => this.createMultiplayerGame('world'));
        document.getElementById('create-india-btn').addEventListener('click', () => this.createMultiplayerGame('india'));
        
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

    startSoloGame(mode) {
        window.gameController.startGame(mode, false);
    }

    async createMultiplayerGame(mode) {
        this.showScreen('matchmaking-screen');
        try {
            const roomCode = await this.multiplayer.createGame(mode);
            if (roomCode) {
                document.getElementById('display-room-code').textContent = roomCode;
                document.getElementById('matchmaking-status').textContent = 'Waiting for opponent to join...';
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
        this.showScreen('main-menu');
    }

    async leaveLobby() {
        await this.multiplayer.leaveGame();
        this.showScreen('main-menu');
    }

    showLobby() {
        this.showScreen('lobby-screen');
        const gameData = this.multiplayer.currentGame.data;
        
        // Show host info
        document.getElementById('lobby-host-name').textContent = gameData.host.displayName;

        // Show opponent if joined
        if (gameData.opponent) {
            document.getElementById('lobby-waiting').classList.add('hidden');
            document.getElementById('lobby-opponent').classList.remove('hidden');
            document.getElementById('lobby-opponent-name').textContent = gameData.opponent.displayName;
            
            // Start game after short delay
            document.getElementById('lobby-start-container').classList.remove('hidden');
            setTimeout(() => {
                window.gameController.startGame(gameData.mode, true);
            }, 2000);
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

// Initialize UI Controller when page loads
let uiController;
window.addEventListener('DOMContentLoaded', () => {
    uiController = new UIController(authService, multiplayerService);
});
