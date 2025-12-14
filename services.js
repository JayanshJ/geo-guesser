// Anonymous User and Firebase Service
class AuthService {
    constructor() {
        this.user = null;
        this.db = null;
    }

    // Generate random anonymous names
    generateAnonymousName() {
        const adjectives = ['Swift', 'Clever', 'Brave', 'Mighty', 'Silent', 'Bold', 'Quick', 'Wise', 'Lucky', 'Sharp', 'Cosmic', 'Thunder', 'Golden', 'Silver', 'Mystic', 'Shadow', 'Storm', 'Fire', 'Ice', 'Neon'];
        const nouns = ['Explorer', 'Wanderer', 'Traveler', 'Navigator', 'Scout', 'Ranger', 'Voyager', 'Pioneer', 'Adventurer', 'Pathfinder', 'Nomad', 'Seeker', 'Hunter', 'Champion', 'Legend', 'Phoenix', 'Dragon', 'Wolf', 'Eagle', 'Tiger'];
        const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
        const noun = nouns[Math.floor(Math.random() * nouns.length)];
        const num = Math.floor(Math.random() * 1000);
        return `${adj}${noun}${num}`;
    }

    // Generate unique user ID
    generateUserId() {
        return 'user_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    }

    async initialize() {
        try {
            // Initialize Firebase
            firebase.initializeApp(CONFIG.FIREBASE_CONFIG);
            this.db = firebase.firestore();
            
            // Check for existing user in localStorage
            const savedUser = localStorage.getItem('geoguesser_user');
            if (savedUser) {
                this.user = JSON.parse(savedUser);
                this.onUserReady();
            }
        } catch (error) {
            console.error('Firebase initialization error:', error);
        }
    }

    async createUser(displayName) {
        const userId = this.generateUserId();
        this.user = {
            uid: userId,
            displayName: displayName || this.generateAnonymousName(),
            createdAt: new Date().toISOString()
        };
        
        // Save to localStorage
        localStorage.setItem('geoguesser_user', JSON.stringify(this.user));
        
        // Create user document in Firestore
        try {
            const userRef = this.db.collection('users').doc(userId);
            await userRef.set({
                uid: userId,
                displayName: this.user.displayName,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                totalGames: 0,
                totalScore: 0,
                bestScore: 0
            });
        } catch (error) {
            console.error('Error creating user document:', error);
        }
        
        this.onUserReady();
        return this.user;
    }

    async changeName(newName) {
        if (!this.user) return;
        
        this.user.displayName = newName;
        localStorage.setItem('geoguesser_user', JSON.stringify(this.user));
        
        // Update Firestore
        try {
            await this.db.collection('users').doc(this.user.uid).update({
                displayName: newName
            });
        } catch (error) {
            console.error('Error updating name:', error);
        }
        
        this.updateUI();
    }

    onUserReady() {
        this.updateUI();
    }

    updateUI() {
        const authSection = document.getElementById('auth-section');
        const mainMenu = document.getElementById('main-menu');
        
        if (this.user) {
            authSection.classList.add('hidden');
            mainMenu.classList.remove('hidden');
            
            document.getElementById('user-name').textContent = this.user.displayName;
        } else {
            authSection.classList.remove('hidden');
            mainMenu.classList.add('hidden');
        }
    }

    async saveGameScore(score, mode) {
        if (!this.user) return;
        
        try {
            const userRef = this.db.collection('users').doc(this.user.uid);
            const gameRef = this.db.collection('games').doc();
            
            // Save game record
            await gameRef.set({
                uid: this.user.uid,
                displayName: this.user.displayName,
                score: score,
                mode: mode,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            // Update user stats
            const userDoc = await userRef.get();
            if (userDoc.exists) {
                const userData = userDoc.data();
                await userRef.update({
                    totalGames: firebase.firestore.FieldValue.increment(1),
                    totalScore: firebase.firestore.FieldValue.increment(score),
                    bestScore: Math.max(userData.bestScore || 0, score),
                    lastPlayed: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
        } catch (error) {
            console.error('Error saving score:', error);
        }
    }

    async getLeaderboard(mode = 'all', limit = 10) {
        try {
            const query = this.db.collection('users')
                .where('totalGames', '>', 0)
                .orderBy('bestScore', 'desc')
                .limit(limit);
            
            const snapshot = await query.get();
            return snapshot.docs.map(doc => doc.data());
        } catch (error) {
            console.error('Error getting leaderboard:', error);
            return [];
        }
    }

    async getRecentGames(limit = 10) {
        try {
            const snapshot = await this.db.collection('games')
                .orderBy('timestamp', 'desc')
                .limit(limit)
                .get();
            
            return snapshot.docs.map(doc => doc.data());
        } catch (error) {
            console.error('Error getting recent games:', error);
            return [];
        }
    }
}

// Multiplayer Service
class MultiplayerService {
    constructor(authService) {
        this.authService = authService;
        this.db = null;
        this.currentGame = null;
        this.gameListener = null;
        this.roomCode = null;
    }

    // Generate a simple 6-character room code
    generateRoomCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excluded confusing chars like 0, O, I, 1
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }

    async createGame(mode) {
        if (!this.authService.user) return null;
        
        // Use authService's db
        this.db = this.authService.db;
        
        // Generate a unique room code
        this.roomCode = this.generateRoomCode();
        
        const gameRef = this.db.collection('multiplayer_games').doc(this.roomCode);
        const gameData = {
            id: this.roomCode,
            roomCode: this.roomCode,
            host: {
                uid: this.authService.user.uid,
                displayName: this.authService.user.displayName
            },
            opponent: null,
            mode: mode,
            status: 'waiting', // waiting, playing, finished
            currentRound: 1,
            totalRounds: 5,
            locations: [],
            hostGuesses: {},
            opponentGuesses: {},
            hostScore: 0,
            opponentScore: 0,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        
        await gameRef.set(gameData);
        this.currentGame = { ref: gameRef, data: gameData };
        this.listenToGame(this.roomCode);
        
        return this.roomCode;
    }

    async joinGameByCode(roomCode) {
        if (!this.authService.user) return { success: false, error: 'Not logged in' };
        
        // Use authService's db
        this.db = this.authService.db;
        
        const code = roomCode.toUpperCase().trim();
        const gameRef = this.db.collection('multiplayer_games').doc(code);
        const gameDoc = await gameRef.get();
        
        if (!gameDoc.exists) {
            return { success: false, error: 'Room not found. Check the code and try again.' };
        }
        
        const gameData = gameDoc.data();
        
        if (gameData.status !== 'waiting') {
            return { success: false, error: 'This game has already started.' };
        }
        
        if (gameData.host.uid === this.authService.user.uid) {
            return { success: false, error: 'You cannot join your own game!' };
        }
        
        await gameRef.update({
            opponent: {
                uid: this.authService.user.uid,
                displayName: this.authService.user.displayName
            },
            status: 'playing'
        });
        
        this.roomCode = code;
        this.listenToGame(code);
        return { success: true };
    }

    listenToGame(roomCode) {
        if (this.gameListener) {
            this.gameListener();
        }
        
        const gameRef = this.db.collection('multiplayer_games').doc(roomCode);
        this.gameListener = gameRef.onSnapshot((doc) => {
            if (doc.exists) {
                const gameData = doc.data();
                this.currentGame = { ref: gameRef, data: gameData };
                this.onGameUpdate(gameData);
            }
        });
    }

    async submitGuess(round, location, distance, points) {
        if (!this.currentGame || !this.authService.user) return;
        
        const isHost = this.currentGame.data.host.uid === this.authService.user.uid;
        const guessField = isHost ? 'hostGuesses' : 'opponentGuesses';
        const scoreField = isHost ? 'hostScore' : 'opponentScore';
        
        await this.currentGame.ref.update({
            [`${guessField}.${round}`]: {
                location: location,
                distance: distance,
                points: points,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            },
            [scoreField]: firebase.firestore.FieldValue.increment(points)
        });
    }

    onGameUpdate(gameData) {
        // This will be called by the game controller
        if (window.multiplayerGameUpdate) {
            window.multiplayerGameUpdate(gameData);
        }
    }

    async leaveGame() {
        if (this.gameListener) {
            this.gameListener();
            this.gameListener = null;
        }
        
        // If we're the host and game is still waiting, delete it
        if (this.currentGame && this.currentGame.data.status === 'waiting') {
            try {
                await this.currentGame.ref.delete();
            } catch (e) {
                console.log('Could not delete game:', e);
            }
        }
        
        this.currentGame = null;
        this.roomCode = null;
    }
}

// Initialize services
const authService = new AuthService();
const multiplayerService = new MultiplayerService(authService);
