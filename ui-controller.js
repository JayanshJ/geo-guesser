// UI Controller - Handles all UI interactions and navigation
class UIController {
    constructor(authService, multiplayerService, friendsService) {
        this.auth = authService;
        this.multiplayer = multiplayerService;
        this.friends = friendsService;
        this.pendingGameMode = null;
        this.pendingIsMultiplayer = false;
        this.multiplayerGameStarted = false;
        this.setupEventListeners();
        this.setupFriendsListeners();
    }

    setupEventListeners() {
        // Auth - Sign In/Sign Up
        document.getElementById('show-signin-btn')?.addEventListener('click', () => this.showSignIn());
        document.getElementById('show-signup-btn')?.addEventListener('click', () => this.showSignUp());
        document.getElementById('signin-submit-btn')?.addEventListener('click', () => this.handleSignIn());
        document.getElementById('signup-submit-btn')?.addEventListener('click', () => this.handleSignUp());
        document.getElementById('signin-cancel-btn')?.addEventListener('click', () => this.cancelAuth());
        document.getElementById('signup-cancel-btn')?.addEventListener('click', () => this.cancelAuth());
        document.getElementById('signout-btn')?.addEventListener('click', () => this.handleSignOut());
        document.getElementById('forgot-password-link')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.showForgotPassword();
        });
        document.getElementById('forgot-submit-btn')?.addEventListener('click', () => this.handleForgotPassword());
        document.getElementById('forgot-cancel-btn')?.addEventListener('click', () => this.showSignIn());
        
        // Password strength indicator
        document.getElementById('signup-password')?.addEventListener('input', (e) => this.updatePasswordStrength(e.target.value));
        
        // Password confirmation real-time validation
        document.getElementById('signup-password-confirm')?.addEventListener('input', () => this.validatePasswordMatch());
        
        // Enter key handlers for forms
        document.getElementById('signin-password')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleSignIn();
        });
        document.getElementById('signup-password-confirm')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleSignUp();
        });
        document.getElementById('forgot-email')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleForgotPassword();
        });
        
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
        
        // Friends
        document.getElementById('close-friends-btn')?.addEventListener('click', () => this.showScreen('main-menu'));

        // Matchmaking
        document.getElementById('cancel-matchmaking-btn').addEventListener('click', () => this.cancelMatchmaking());
        document.getElementById('leave-lobby-btn').addEventListener('click', () => this.leaveLobby());
        document.getElementById('copy-lobby-code-btn').addEventListener('click', () => this.copyLobbyCode());
        document.getElementById('start-game-btn').addEventListener('click', () => this.startMultiplayerGame());

        // Game controls
        document.getElementById('play-again-btn').addEventListener('click', () => this.backToMenu());
        document.getElementById('opponent-left-ok-btn')?.addEventListener('click', () => this.backToMenu());
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
    
    copyLobbyCode() {
        const code = document.getElementById('lobby-room-code').textContent;
        navigator.clipboard.writeText(code).then(() => {
            const btn = document.getElementById('copy-lobby-code-btn');
            const originalText = btn.textContent;
            btn.textContent = '✓ Copied!';
            setTimeout(() => {
                btn.textContent = originalText;
            }, 2000);
        }).catch(err => {
            console.error('Could not copy code:', err);
        });
    }
    
    async startMultiplayerGame() {
        const result = await this.multiplayer.startGame();
        if (!result.success) {
            alert(result.error);
        }
        // Game will auto-start when status changes to 'playing'
    }

    showLobby() {
        this.showScreen('lobby-screen');
        const gameData = this.multiplayer.currentGame.data;
        
        console.log('[Lobby] Game data:', gameData);
        console.log('[Lobby] TimeControl from gameData:', gameData.timeControl);
        
        // Show room code
        document.getElementById('lobby-room-code').textContent = gameData.roomCode;
        
        // Show game mode
        const modeEmoji = gameData.mode === 'india' ? '🇮🇳' : '🌍';
        const modeText = gameData.mode === 'india' ? 'India' : 'World';
        document.getElementById('lobby-game-mode').textContent = `Mode: ${modeEmoji} ${modeText}`;
        
        // Update players
        this.updateLobbyPlayers(gameData);
    }
    
    updateLobbyPlayers(gameData) {
        const playersGrid = document.getElementById('lobby-players-grid');
        const players = gameData.players || {};
        const playerCount = Object.keys(players).length;
        const maxPlayers = gameData.maxPlayers || 8;
        
        // Update player count
        document.getElementById('lobby-player-count').textContent = `Players: ${playerCount}/${maxPlayers}`;
        
        // Clear grid
        playersGrid.innerHTML = '';
        
        // Add each player
        Object.values(players).forEach(player => {
            const isYou = player.uid === this.auth.user.uid;
            const isHost = player.isHost;
            
            const playerCard = document.createElement('div');
            playerCard.className = 'lobby-player-card';
            if (isHost) playerCard.classList.add('is-host');
            if (isYou) playerCard.classList.add('is-you');
            
            playerCard.innerHTML = `
                <div class="player-avatar-text">${isHost ? '👑' : '🎮'}</div>
                <div class="player-name">${player.displayName}</div>
                <div class="player-label">${isYou ? 'You' : (isHost ? 'Host' : 'Player')}</div>
            `;
            
            playersGrid.appendChild(playerCard);
        });
        
        // Show/hide start button for host
        const startBtn = document.getElementById('start-game-btn');
        const isHost = gameData.host.uid === this.auth.user.uid;
        
        if (isHost && gameData.status === 'waiting') {
            startBtn.classList.remove('hidden');
            startBtn.disabled = playerCount < 2;
            startBtn.textContent = playerCount < 2 ? 'Waiting for players...' : 'Start Game';
        } else {
            startBtn.classList.add('hidden');
        }
        
        // Auto-start game when status changes to playing
        if (gameData.status === 'playing' && !this.multiplayerGameStarted) {
            this.multiplayerGameStarted = true;
            
            setTimeout(() => {
                const timeControl = gameData.timeControl || 'unlimited';
                console.log('[Lobby] Starting game with timeControl:', timeControl);
                window.gameController.startGame(gameData.mode, true, timeControl);
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
        // Hide any open modals
        document.getElementById('opponent-left-modal')?.classList.add('hidden');
        document.getElementById('time-control-modal')?.classList.add('hidden');
        this.showScreen('main-menu');
    }

    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.add('hidden');
        });
        document.getElementById(screenId).classList.remove('hidden');
    }

    // Auth Methods
    showSignIn() {
        document.getElementById('signup-form').classList.add('hidden');
        document.getElementById('forgot-password-form').classList.add('hidden');
        document.getElementById('signin-form').classList.remove('hidden');
        document.getElementById('email-auth-options').classList.add('hidden');
        document.getElementById('signup-error').style.display = 'none';
        document.getElementById('signin-error').classList.add('hidden');
        document.getElementById('signin-success').classList.add('hidden');
    }

    showSignUp() {
        document.getElementById('signin-form').classList.add('hidden');
        document.getElementById('forgot-password-form').classList.add('hidden');
        document.getElementById('signup-form').classList.remove('hidden');
        document.getElementById('email-auth-options').classList.add('hidden');
        document.getElementById('signin-error').style.display = 'none';
        document.getElementById('signup-error').classList.add('hidden');
        document.getElementById('signup-success').classList.add('hidden');
    }

    showForgotPassword() {
        document.getElementById('signin-form').classList.add('hidden');
        document.getElementById('signup-form').classList.add('hidden');
        document.getElementById('forgot-password-form').classList.remove('hidden');
        document.getElementById('email-auth-options').classList.add('hidden');
        document.getElementById('forgot-error').classList.add('hidden');
        document.getElementById('forgot-success').classList.add('hidden');
    }

    cancelAuth() {
        document.getElementById('signin-form').classList.add('hidden');
        document.getElementById('signup-form').classList.add('hidden');
        document.getElementById('forgot-password-form').classList.add('hidden');
        document.getElementById('email-auth-options').classList.remove('hidden');
        document.getElementById('signin-error').style.display = 'none';
        document.getElementById('signup-error').style.display = 'none';
    }

    async handleSignIn() {
        const email = document.getElementById('signin-email').value.trim();
        const password = document.getElementById('signin-password').value;
        const errorEl = document.getElementById('signin-error');
        const successEl = document.getElementById('signin-success');
        const submitBtn = document.getElementById('signin-submit-btn');

        // Hide previous messages
        errorEl.classList.add('hidden');
        successEl.classList.add('hidden');

        if (!email || !password) {
            this.showError('signin-error', 'Please enter both email and password');
            return;
        }
        
        // Show loading state
        this.setButtonLoading(submitBtn, true);

        const result = await this.auth.signInWithEmail(email, password);
        
        this.setButtonLoading(submitBtn, false);

        if (result.success) {
            if (result.emailNotVerified) {
                this.showEmailVerificationBanner();
            }
            // UI will update automatically via onAuthStateChanged
        } else {
            this.showError('signin-error', result.error);
        }
    }

    async handleForgotPassword() {
        const email = document.getElementById('forgot-email').value.trim();
        const submitBtn = document.getElementById('forgot-submit-btn');
        
        if (!email) {
            this.showError('forgot-error', 'Please enter your email address');
            return;
        }
        
        this.setButtonLoading(submitBtn, true);
        
        const result = await this.auth.sendPasswordResetEmail(email);
        
        this.setButtonLoading(submitBtn, false);
        
        if (result.success) {
            this.showSuccess('forgot-success', result.message);
            // Clear the input
            document.getElementById('forgot-email').value = '';
            // Switch back to sign in after 3 seconds
            setTimeout(() => this.showSignIn(), 3000);
        } else {
            this.showError('forgot-error', result.error);
        }
    }

    async handleSignUp() {
        const username = document.getElementById('signup-username').value.trim();
        const email = document.getElementById('signup-email').value.trim();
        const password = document.getElementById('signup-password').value;
        const passwordConfirm = document.getElementById('signup-password-confirm').value;
        const displayName = document.getElementById('signup-name').value.trim();
        const termsAccepted = document.getElementById('terms-checkbox').checked;
        const submitBtn = document.getElementById('signup-submit-btn');

        // Hide previous messages
        document.getElementById('signup-error').classList.add('hidden');
        document.getElementById('signup-success').classList.add('hidden');

        if (!username || !email || !password || !passwordConfirm || !displayName) {
            this.showError('signup-error', 'Please fill in all fields');
            return;
        }

        if (username.length < 3 || username.length > 20) {
            this.showError('signup-error', 'Username must be between 3-20 characters');
            return;
        }
        
        if (displayName.length < 2 || displayName.length > 20) {
            this.showError('signup-error', 'Display name must be between 2-20 characters');
            return;
        }
        
        if (password !== passwordConfirm) {
            this.showError('signup-error', 'Passwords do not match');
            return;
        }

        if (password.length < 8) {
            this.showError('signup-error', 'Password must be at least 8 characters');
            return;
        }
        
        if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
            this.showError('signup-error', 'Password must contain uppercase, lowercase, and numbers');
            return;
        }
        
        if (!termsAccepted) {
            this.showError('signup-error', 'Please accept the Terms of Service');
            return;
        }
        
        // Show loading state
        this.setButtonLoading(submitBtn, true);

        const result = await this.auth.signUpWithEmail(email, password, displayName, username);
        
        this.setButtonLoading(submitBtn, false);

        if (result.success) {
            if (result.requiresVerification) {
                this.showSuccess('signup-success', 'Account created! Please check your email to verify your account.');
                // Clear form
                document.getElementById('signup-username').value = '';
                document.getElementById('signup-name').value = '';
                document.getElementById('signup-email').value = '';
                document.getElementById('signup-password').value = '';
                document.getElementById('signup-password-confirm').value = '';
                document.getElementById('terms-checkbox').checked = false;
                document.getElementById('password-strength').textContent = '';
                // Switch to sign in after 4 seconds
                setTimeout(() => this.showSignIn(), 4000);
            }
        } else {
            this.showError('signup-error', result.error);
        }
    }

    async handleSignOut() {
        await this.auth.signOut();
    }

    // Friends Methods
    setupFriendsListeners() {
        document.getElementById('friends-btn')?.addEventListener('click', () => this.showFriendsScreen());
        document.getElementById('search-friend-btn')?.addEventListener('click', () => this.searchFriend());
        document.getElementById('friend-search-input')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.searchFriend();
        });

        // Invite accept/decline
        document.getElementById('accept-invite-btn')?.addEventListener('click', () => this.acceptInvite());
        document.getElementById('decline-invite-btn')?.addEventListener('click', () => this.declineInvite());

        // Listen to invites
        if (this.friends) {
            this.friends.listenToInvites((invite) => {
                this.showInviteModal(invite);
            });
        }
    }

    async showFriendsScreen() {
        this.showScreen('friends-screen');
        await this.refreshFriendsLists();
    }

    async refreshFriendsLists() {
        // Get friend requests
        const requests = await this.friends.getFriendRequests();
        const requestsList = document.getElementById('friend-requests-list');
        
        if (requests.length === 0) {
            requestsList.innerHTML = '<div class="empty-list">No pending requests</div>';
        } else {
            requestsList.innerHTML = requests.map(req => `
                <div class="friend-item">
                    <div class="friend-info">
                        <div class="friend-avatar">${req.displayName[0].toUpperCase()}</div>
                        <div class="friend-details">
                            <div class="friend-name">${req.displayName}</div>
                            <div class="friend-status">${req.email}</div>
                        </div>
                    </div>
                    <div class="friend-actions">
                        <button class="btn btn-success" onclick="uiController.acceptRequest('${req.userId}')">Accept</button>
                        <button class="btn btn-danger" onclick="uiController.declineRequest('${req.userId}')">Decline</button>
                    </div>
                </div>
            `).join('');
        }

        // Get friends list
        const friends = await this.friends.getFriendsList();
        const friendsList = document.getElementById('friends-list');
        
        if (friends.length === 0) {
            friendsList.innerHTML = '<div class="empty-list">No friends yet. Search by email to add friends!</div>';
        } else {
            friendsList.innerHTML = friends.map(friend => {
                const statusClass = friend.isOnline ? 'online' : 'offline';
                const statusText = friend.isOnline ? 'Online' : 'Offline';
                return `
                    <div class="friend-item">
                        <div class="friend-info">
                            <div class="friend-avatar">${friend.displayName[0].toUpperCase()}</div>
                            <div class="friend-details">
                                <div class="friend-name">${friend.displayName}</div>
                                <div class="friend-status ${statusClass}">
                                    <span class="status-dot ${statusClass}"></span>${statusText}
                                </div>
                            </div>
                        </div>
                        <div class="friend-actions">
                            ${friend.isOnline ? 
                                `<button class="btn btn-primary" onclick="uiController.inviteFriend('${friend.userId}')">Invite to Game</button>` : 
                                ''}
                            <button class="btn btn-danger" onclick="uiController.removeFriend('${friend.userId}')">Remove</button>
                        </div>
                    </div>
                `;
            }).join('');
        }
    }

    async searchFriend() {
        const searchInput = document.getElementById('friend-search-input');
        const username = searchInput.value.trim();
        const resultsDiv = document.getElementById('search-results');

        if (!username) {
            resultsDiv.innerHTML = '<div class="info-message">💡 Enter a username to search (at least 2 characters)</div>';
            return;
        }

        if (username.length < 2) {
            resultsDiv.innerHTML = '<div class="info-message">⚠️ Username must be at least 2 characters</div>';
            return;
        }

        resultsDiv.innerHTML = '<div class="info-message">🔍 Searching...</div>';

        try {
            const users = await this.friends.searchUsersByUsername(username);
            
            if (users.length === 0) {
                resultsDiv.innerHTML = '<div class="empty-list">❌ No users found matching "' + username + '"</div>';
            } else {
                resultsDiv.innerHTML = users.map(user => `
                    <div class="friend-item">
                        <div class="friend-info">
                            <div class="friend-avatar">${user.displayName[0].toUpperCase()}</div>
                            <div class="friend-details">
                                <div class="friend-name">${user.displayName}</div>
                                <div class="friend-status">@${user.username}</div>
                            </div>
                        </div>
                        <div class="friend-actions">
                            ${user.status === 'none' ? 
                                `<button class="btn btn-primary" onclick="uiController.sendFriendRequest('${user.userId}')">➕ Add Friend</button>` : 
                                user.status === 'pending' ?
                                '<span class="info-message" style="padding: 8px;">⏳ Request Pending</span>' :
                                '<span class="info-message" style="padding: 8px;">✅ Already Friends</span>'}
                        </div>
                    </div>
                `).join('');
            }
        } catch (error) {
            console.error('Search error:', error);
            resultsDiv.innerHTML = `<div class="error-message">❌ Error: ${error.message}</div>`;
        }
    }

    async sendFriendRequest(userId) {
        try {
            const result = await this.friends.sendFriendRequest(userId);
            if (result.success) {
                document.getElementById('search-results').innerHTML = 
                    '<div class="success-message">✅ Friend request sent!</div>';
                setTimeout(() => this.searchFriend(), 2000);
            } else {
                document.getElementById('search-results').innerHTML = 
                    `<div class="error-message">❌ ${result.error}</div>`;
            }
        } catch (error) {
            alert(error.message);
        }
    }

    async acceptRequest(userId) {
        try {
            const result = await this.friends.acceptFriendRequest(userId);
            if (result.success) {
                await this.refreshFriendsLists();
            } else {
                alert(result.error || 'Failed to accept request');
            }
        } catch (error) {
            alert(error.message);
        }
    }

    async declineRequest(userId) {
        try {
            const result = await this.friends.declineFriendRequest(userId);
            if (result.success) {
                await this.refreshFriendsLists();
            } else {
                alert(result.error || 'Failed to decline request');
            }
        } catch (error) {
            alert(error.message);
        }
    }

    async removeFriend(userId) {
        if (confirm('Are you sure you want to remove this friend?')) {
            try {
                const result = await this.friends.removeFriend(userId);
                if (result.success) {
                    await this.refreshFriendsLists();
                } else {
                    alert(result.error || 'Failed to remove friend');
                }
            } catch (error) {
                alert(error.message);
            }
        }
    }

    async inviteFriend(friendId) {
        // Show time control selection for invite
        this.pendingInviteFriendId = friendId;
        this.showTimeSelection('world', true); // Default to world mode
    }

    async sendGameInvite(friendId, mode, timeControl) {
        try {
            const gameId = await this.friends.inviteFriendToGame(friendId, mode, timeControl);
            // Create the multiplayer game
            await this.multiplayer.createGame(mode, timeControl);
            // Show waiting screen
            this.showScreen('main-menu');
            alert('Game invite sent! Waiting for friend to join...');
        } catch (error) {
            alert('Failed to send invite: ' + error.message);
        }
    }

    showInviteModal(invite) {
        this.currentInvite = invite;
        document.getElementById('invite-message').textContent = 
            `${invite.inviterName} invited you to play ${invite.mode.toUpperCase()} mode!`;
        document.getElementById('game-invite-modal').classList.remove('hidden');
    }

    async acceptInvite() {
        if (this.currentInvite) {
            try {
                await this.friends.acceptInvite(this.currentInvite.inviteId);
                document.getElementById('game-invite-modal').classList.add('hidden');
                // Join the game
                await this.multiplayer.joinGame(this.currentInvite.gameId);
            } catch (error) {
                alert('Failed to accept invite: ' + error.message);
            }
        }
    }

    declineInvite() {
        document.getElementById('game-invite-modal').classList.add('hidden');
        this.currentInvite = null;
    }
    
    // Helper methods for authentication UI
    updatePasswordStrength(password) {
        const strengthDiv = document.getElementById('password-strength');
        
        if (!password) {
            strengthDiv.textContent = '';
            strengthDiv.className = 'password-strength';
            return;
        }
        
        let strength = 0;
        let message = '';
        let className = '';
        
        // Length check
        if (password.length >= 8) strength++;
        if (password.length >= 12) strength++;
        
        // Character variety checks
        if (/[a-z]/.test(password)) strength++;
        if (/[A-Z]/.test(password)) strength++;
        if (/\d/.test(password)) strength++;
        if (/[^a-zA-Z0-9]/.test(password)) strength++;
        
        if (strength < 3) {
            message = '❌ Weak password';
            className = 'password-strength weak';
        } else if (strength < 5) {
            message = '⚠️ Medium password';
            className = 'password-strength medium';
        } else {
            message = '✅ Strong password';
            className = 'password-strength strong';
        }
        
        strengthDiv.textContent = message;
        strengthDiv.className = className;
    }

    validatePasswordMatch() {
        const password = document.getElementById('signup-password').value;
        const confirm = document.getElementById('signup-password-confirm').value;
        const confirmInput = document.getElementById('signup-password-confirm');
        
        if (!confirm) {
            confirmInput.style.borderColor = '';
            return;
        }
        
        if (password === confirm) {
            confirmInput.style.borderColor = '#4CAF50';
        } else {
            confirmInput.style.borderColor = '#f44336';
        }
    }

    setButtonLoading(button, isLoading) {
        const btnText = button.querySelector('.btn-text');
        const btnSpinner = button.querySelector('.btn-spinner');
        
        if (isLoading) {
            btnText.classList.add('hidden');
            btnSpinner.classList.remove('hidden');
            button.disabled = true;
        } else {
            btnText.classList.remove('hidden');
            btnSpinner.classList.add('hidden');
            button.disabled = false;
        }
    }

    showError(elementId, message) {
        const errorDiv = document.getElementById(elementId);
        errorDiv.textContent = message;
        errorDiv.classList.remove('hidden');
    }

    showSuccess(elementId, message) {
        const successDiv = document.getElementById(elementId);
        successDiv.textContent = message;
        successDiv.classList.remove('hidden');
    }

    showEmailVerificationBanner() {
        const banner = document.createElement('div');
        banner.className = 'verification-banner';
        banner.innerHTML = `
            <p>⚠️ Please verify your email to access all features.</p>
            <button id="resend-verification-btn" class="btn btn-small">Resend Email</button>
        `;
        
        const mainMenu = document.getElementById('main-menu');
        const existingBanner = mainMenu.querySelector('.verification-banner');
        if (existingBanner) {
            existingBanner.remove();
        }
        
        mainMenu.insertBefore(banner, mainMenu.firstChild);
        
        document.getElementById('resend-verification-btn').addEventListener('click', async () => {
            const result = await this.auth.resendVerificationEmail();
            if (result.success) {
                alert(result.message);
            } else {
                alert(result.error);
            }
        });
    }
}

// Initialize UI Controller - called from initApp in game.js
let uiController;

function initUIController() {
    uiController = new UIController(authService, multiplayerService, friendsService);
    window.uiController = uiController;
}
