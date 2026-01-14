// Authentication and Firebase Service
class AuthService {
    constructor() {
        this.user = null;
        this.db = null;
        this.auth = null;
        this.unsubscribeAuth = null;
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

    async initialize() {
        try {
            // Initialize Firebase
            if (!firebase.apps.length) {
                firebase.initializeApp(CONFIG.FIREBASE_CONFIG);
            }
            this.db = firebase.firestore();
            this.auth = firebase.auth();
            
            // Listen for auth state changes
            this.unsubscribeAuth = this.auth.onAuthStateChanged(async (firebaseUser) => {
                if (firebaseUser) {
                    // User is signed in with email
                    const userDoc = await this.db.collection('users').doc(firebaseUser.uid).get();
                    if (userDoc.exists) {
                        const userData = userDoc.data();
                        this.user = {
                            uid: firebaseUser.uid,
                            username: userData.username,
                            email: firebaseUser.email,
                            emailVerified: firebaseUser.emailVerified,
                            displayName: userData.displayName,
                            isAnonymous: false
                        };
                        
                        // Update emailVerified status in Firestore if it changed
                        if (userData.emailVerified !== firebaseUser.emailVerified) {
                            await this.db.collection('users').doc(firebaseUser.uid).update({
                                emailVerified: firebaseUser.emailVerified
                            });
                        }
                        
                        await this.updateOnlineStatus(true);
                        this.onUserReady();
                    }
                } else {
                    // No Firebase user - check for anonymous user only if explicitly logged in as guest
                    const savedUser = localStorage.getItem('geoguesser_user');
                    if (savedUser) {
                        const userData = JSON.parse(savedUser);
                        // Only restore if it was explicitly created (has isAnonymous flag)
                        if (userData.isAnonymous) {
                            this.user = userData;
                            this.onUserReady();
                        }
                    } else {
                        // No user at all - show auth section
                        this.updateUI();
                    }
                }
            });
        } catch (error) {
            console.error('Firebase initialization error:', error);
        }
    }

    async signUpWithEmail(email, password, displayName, username) {
        try {
            // Validate email format
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                return { success: false, error: 'Please enter a valid email address' };
            }
            
            // Validate display name
            if (!displayName || displayName.length < 2 || displayName.length > 20) {
                return { success: false, error: 'Display name must be between 2-20 characters' };
            }
            
            // Validate username format
            if (!username || username.length < 3 || username.length > 20) {
                return { success: false, error: 'Username must be between 3-20 characters' };
            }
            
            // Check if username only contains allowed characters
            if (!/^[a-zA-Z0-9_]+$/.test(username)) {
                return { success: false, error: 'Username can only contain letters, numbers, and underscores' };
            }
            
            // Validate password strength
            if (password.length < 8) {
                return { success: false, error: 'Password must be at least 8 characters' };
            }
            
            if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
                return { success: false, error: 'Password must contain uppercase, lowercase, and numbers' };
            }
            
            // Check if username is already taken
            const usernameCheck = await this.db.collection('users')
                .where('username', '==', username.toLowerCase())
                .get();
            
            if (!usernameCheck.empty) {
                return { success: false, error: 'Username is already taken' };
            }
            
            // Create user account
            const userCredential = await this.auth.createUserWithEmailAndPassword(email, password);
            const user = userCredential.user;
            
            // Send email verification
            await user.sendEmailVerification({
                url: window.location.origin,
                handleCodeInApp: false
            });
            
            // Create user document in Firestore
            await this.db.collection('users').doc(user.uid).set({
                uid: user.uid,
                username: username.toLowerCase(),
                email: email.toLowerCase(),
                displayName: displayName,
                emailVerified: false,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                lastLogin: firebase.firestore.FieldValue.serverTimestamp(),
                totalGames: 0,
                totalScore: 0,
                bestScore: 0,
                friends: [],
                friendRequests: [],
                isOnline: true,
                accountStatus: 'active'
            });
            
            return { success: true, requiresVerification: true };
        } catch (error) {
            console.error('Sign up error:', error);
            
            // Provide user-friendly error messages
            let errorMessage = 'Failed to create account. Please try again.';
            
            if (error.code === 'auth/email-already-in-use') {
                errorMessage = 'An account with this email already exists';
            } else if (error.code === 'auth/invalid-email') {
                errorMessage = 'Invalid email address';
            } else if (error.code === 'auth/weak-password') {
                errorMessage = 'Password is too weak';
            } else if (error.code === 'auth/network-request-failed') {
                errorMessage = 'Network error. Please check your connection';
            }
            
            return { success: false, error: errorMessage };
        }
    }

    async signInWithEmail(email, password) {
        try {
            const userCredential = await this.auth.signInWithEmailAndPassword(email, password);
            const user = userCredential.user;
            
            // Update last login
            await this.db.collection('users').doc(user.uid).update({
                lastLogin: firebase.firestore.FieldValue.serverTimestamp(),
                isOnline: true
            });
            
            // Check if email is verified
            if (!user.emailVerified) {
                return { 
                    success: true, 
                    emailNotVerified: true,
                    message: 'Please verify your email. Check your inbox for the verification link.'
                };
            }
            
            return { success: true };
        } catch (error) {
            console.error('Sign in error:', error);
            
            // Provide user-friendly error messages
            let errorMessage = 'Failed to sign in. Please try again.';
            
            if (error.code === 'auth/user-not-found') {
                errorMessage = 'No account found with this email';
            } else if (error.code === 'auth/wrong-password') {
                errorMessage = 'Incorrect password';
            } else if (error.code === 'auth/invalid-email') {
                errorMessage = 'Invalid email address';
            } else if (error.code === 'auth/user-disabled') {
                errorMessage = 'This account has been disabled';
            } else if (error.code === 'auth/too-many-requests') {
                errorMessage = 'Too many failed attempts. Please try again later';
            } else if (error.code === 'auth/network-request-failed') {
                errorMessage = 'Network error. Please check your connection';
            }
            
            return { success: false, error: errorMessage };
        }
    }

    async sendPasswordResetEmail(email) {
        try {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                return { success: false, error: 'Please enter a valid email address' };
            }
            
            await this.auth.sendPasswordResetEmail(email, {
                url: window.location.origin,
                handleCodeInApp: false
            });
            
            return { success: true, message: 'Password reset email sent! Check your inbox.' };
        } catch (error) {
            console.error('Password reset error:', error);
            
            let errorMessage = 'Failed to send reset email. Please try again.';
            
            if (error.code === 'auth/user-not-found') {
                // Don't reveal if email exists for security
                return { success: true, message: 'If an account exists with this email, you will receive a password reset link.' };
            } else if (error.code === 'auth/invalid-email') {
                errorMessage = 'Invalid email address';
            } else if (error.code === 'auth/too-many-requests') {
                errorMessage = 'Too many requests. Please try again later';
            }
            
            return { success: false, error: errorMessage };
        }
    }

    async resendVerificationEmail() {
        try {
            const user = this.auth.currentUser;
            if (!user) {
                return { success: false, error: 'No user signed in' };
            }
            
            if (user.emailVerified) {
                return { success: false, error: 'Email is already verified' };
            }
            
            await user.sendEmailVerification({
                url: window.location.origin,
                handleCodeInApp: false
            });
            
            return { success: true, message: 'Verification email sent! Check your inbox.' };
        } catch (error) {
            console.error('Resend verification error:', error);
            
            let errorMessage = 'Failed to send verification email. Please try again.';
            
            if (error.code === 'auth/too-many-requests') {
                errorMessage = 'Too many requests. Please wait before trying again';
            }
            
            return { success: false, error: errorMessage };
        }
    }

    async signOut() {
        try {
            if (this.user && !this.user.isAnonymous) {
                await this.updateOnlineStatus(false);
                await this.auth.signOut();
            }
            this.user = null;
            localStorage.removeItem('geoguesser_user');
            this.updateUI();
        } catch (error) {
            console.error('Sign out error:', error);
        }
    }

    async updateOnlineStatus(isOnline) {
        if (this.user && !this.user.isAnonymous) {
            try {
                await this.db.collection('users').doc(this.user.uid).update({
                    isOnline: isOnline,
                    lastSeen: firebase.firestore.FieldValue.serverTimestamp()
                });
            } catch (error) {
                console.error('Error updating online status:', error);
            }
        }
    }

    async createUser(displayName) {
        const userId = 'anon_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
        this.user = {
            uid: userId,
            displayName: displayName || this.generateAnonymousName(),
            createdAt: new Date().toISOString(),
            isAnonymous: true
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
                bestScore: 0,
                isAnonymous: true
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
        const changeNameBtn = document.getElementById('change-name-btn');
        const signOutBtn = document.getElementById('signout-btn');
        const friendsBtn = document.getElementById('friends-btn');
        const userEmailEl = document.getElementById('user-email');
        
        if (this.user) {
            authSection.classList.add('hidden');
            mainMenu.classList.remove('hidden');
            
            // Show display name and username for authenticated users
            if (this.user.username) {
                document.getElementById('user-name').textContent = `${this.user.displayName} (@${this.user.username})`;
            } else {
                document.getElementById('user-name').textContent = this.user.displayName;
            }
            
            // Show/hide buttons based on auth type
            if (this.user.isAnonymous) {
                // Guest user - show change name, hide sign out and friends
                changeNameBtn?.classList.remove('hidden');
                signOutBtn?.classList.add('hidden');
                friendsBtn?.classList.add('hidden');
                userEmailEl?.classList.add('hidden');
            } else {
                // Email user - hide change name, show sign out and friends
                changeNameBtn?.classList.add('hidden');
                signOutBtn?.classList.remove('hidden');
                friendsBtn?.classList.remove('hidden');
                
                // Show email if available
                if (this.user.email) {
                    userEmailEl.textContent = this.user.email;
                    userEmailEl?.classList.remove('hidden');
                } else {
                    userEmailEl?.classList.add('hidden');
                }
            }
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

// Friends Service
class FriendsService {
    constructor(authService) {
        this.authService = authService;
        this.db = authService.db || null;
        this.friendsListener = null;
    }

    initialize() {
        // Ensure we have db reference
        if (!this.db && this.authService.db) {
            this.db = this.authService.db;
        }
    }

    async searchUsersByUsername(username) {
        if (!username || username.length < 2) {
            return [];
        }
        if (!this.db) {
            console.error('Database not initialized in FriendsService');
            return [];
        }

        try {
            const currentUserId = this.authService.user?.uid;
            const searchTerm = username.toLowerCase().replace('@', '');
            
            // Get all non-anonymous users (we'll filter client-side for partial matches)
            const snapshot = await this.db.collection('users')
                .where('isAnonymous', '==', false)
                .limit(50)
                .get();
            
            const users = [];
            for (const doc of snapshot.docs) {
                const userData = doc.data();
                
                // Skip current user
                if (doc.id === currentUserId) continue;
                
                // Skip if username doesn't match (partial match)
                if (!userData.username || !userData.username.includes(searchTerm)) continue;
                
                // Check friend status
                let status = 'none';
                if (userData.friends && userData.friends.includes(currentUserId)) {
                    status = 'friends';
                } else if (userData.friendRequests && userData.friendRequests.includes(currentUserId)) {
                    status = 'pending';
                }
                
                users.push({
                    userId: doc.id,
                    username: userData.username,
                    displayName: userData.displayName,
                    status: status
                });
            }
            
            // Sort by exact matches first, then alphabetically
            users.sort((a, b) => {
                const aExact = a.username === searchTerm;
                const bExact = b.username === searchTerm;
                if (aExact && !bExact) return -1;
                if (!aExact && bExact) return 1;
                return a.username.localeCompare(b.username);
            });
            
            return users.slice(0, 10); // Return top 10 results
        } catch (error) {
            console.error('Error searching users:', error);
            return [];
        }
    }

    async sendFriendRequest(friendUid) {
        if (!this.authService.user || this.authService.user.isAnonymous) {
            return { success: false, error: 'Must be signed in to add friends' };
        }
        if (!this.db) {
            console.error('Database not initialized in FriendsService');
            return { success: false, error: 'Service not ready. Please try again.' };
        }

        try {
            const friendRef = this.db.collection('users').doc(friendUid);
            const friendDoc = await friendRef.get();
            
            if (!friendDoc.exists) {
                return { success: false, error: 'User not found' };
            }

            const friendData = friendDoc.data();
            
            // Check if already friends
            if (friendData.friends && friendData.friends.includes(this.authService.user.uid)) {
                return { success: false, error: 'Already friends' };
            }

            // Check if request already sent
            if (friendData.friendRequests && friendData.friendRequests.includes(this.authService.user.uid)) {
                return { success: false, error: 'Friend request already sent' };
            }

            // Add friend request
            await friendRef.update({
                friendRequests: firebase.firestore.FieldValue.arrayUnion(this.authService.user.uid)
            });

            return { success: true };
        } catch (error) {
            console.error('Error sending friend request:', error);
            return { success: false, error: error.message };
        }
    }

    async acceptFriendRequest(friendUid) {
        if (!this.authService.user || this.authService.user.isAnonymous) return;
        if (!this.db) {
            console.error('Database not initialized in FriendsService');
            return;
        }

        try {
            const batch = this.db.batch();
            
            // Add to both users' friend lists
            const myRef = this.db.collection('users').doc(this.authService.user.uid);
            const friendRef = this.db.collection('users').doc(friendUid);
            
            batch.update(myRef, {
                friends: firebase.firestore.FieldValue.arrayUnion(friendUid),
                friendRequests: firebase.firestore.FieldValue.arrayRemove(friendUid)
            });
            
            batch.update(friendRef, {
                friends: firebase.firestore.FieldValue.arrayUnion(this.authService.user.uid)
            });
            
            await batch.commit();
            return { success: true };
        } catch (error) {
            console.error('Error accepting friend request:', error);
            return { success: false, error: error.message };
        }
    }

    async declineFriendRequest(friendUid) {
        if (!this.authService.user || this.authService.user.isAnonymous) return;
        if (!this.db) {
            console.error('Database not initialized in FriendsService');
            return;
        }

        try {
            await this.db.collection('users').doc(this.authService.user.uid).update({
                friendRequests: firebase.firestore.FieldValue.arrayRemove(friendUid)
            });
            return { success: true };
        } catch (error) {
            console.error('Error declining friend request:', error);
            return { success: false, error: error.message };
        }
    }

    async removeFriend(friendUid) {
        if (!this.authService.user || this.authService.user.isAnonymous) return;
        if (!this.db) {
            console.error('Database not initialized in FriendsService');
            return;
        }

        try {
            const batch = this.db.batch();
            
            const myRef = this.db.collection('users').doc(this.authService.user.uid);
            const friendRef = this.db.collection('users').doc(friendUid);
            
            batch.update(myRef, {
                friends: firebase.firestore.FieldValue.arrayRemove(friendUid)
            });
            
            batch.update(friendRef, {
                friends: firebase.firestore.FieldValue.arrayRemove(this.authService.user.uid)
            });
            
            await batch.commit();
            return { success: true };
        } catch (error) {
            console.error('Error removing friend:', error);
            return { success: false, error: error.message };
        }
    }

    async getFriendsList() {
        if (!this.authService.user || this.authService.user.isAnonymous) return [];
        if (!this.db) {
            console.error('Database not initialized in FriendsService');
            return [];
        }

        try {
            const userDoc = await this.db.collection('users').doc(this.authService.user.uid).get();
            const userData = userDoc.data();
            
            if (!userData.friends || userData.friends.length === 0) {
                return [];
            }

            const friendsData = await Promise.all(
                userData.friends.map(async (friendUid) => {
                    const friendDoc = await this.db.collection('users').doc(friendUid).get();
                    if (friendDoc.exists) {
                        return { uid: friendUid, ...friendDoc.data() };
                    }
                    return null;
                })
            );

            return friendsData.filter(f => f !== null);
        } catch (error) {
            console.error('Error getting friends list:', error);
            return [];
        }
    }

    async getFriendRequests() {
        if (!this.authService.user || this.authService.user.isAnonymous) return [];
        if (!this.db) {
            console.error('Database not initialized in FriendsService');
            return [];
        }

        try {
            const userDoc = await this.db.collection('users').doc(this.authService.user.uid).get();
            const userData = userDoc.data();
            
            if (!userData.friendRequests || userData.friendRequests.length === 0) {
                return [];
            }

            const requestsData = await Promise.all(
                userData.friendRequests.map(async (friendUid) => {
                    const friendDoc = await this.db.collection('users').doc(friendUid).get();
                    if (friendDoc.exists) {
                        return { uid: friendUid, ...friendDoc.data() };
                    }
                    return null;
                })
            );

            return requestsData.filter(f => f !== null);
        } catch (error) {
            console.error('Error getting friend requests:', error);
            return [];
        }
    }

    async inviteFriendToGame(friendUid, roomCode) {
        if (!this.authService.user || this.authService.user.isAnonymous) return;
        if (!this.db) {
            console.error('Database not initialized in FriendsService');
            return;
        }

        try {
            await this.db.collection('game_invites').add({
                from: this.authService.user.uid,
                fromName: this.authService.user.displayName,
                to: friendUid,
                roomCode: roomCode,
                timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                status: 'pending'
            });
            return { success: true };
        } catch (error) {
            console.error('Error sending game invite:', error);
            return { success: false, error: error.message };
        }
    }

    listenToInvites(callback) {
        if (!this.authService.user || this.authService.user.isAnonymous) return;

        return this.db.collection('game_invites')
            .where('to', '==', this.authService.user.uid)
            .where('status', '==', 'pending')
            .onSnapshot((snapshot) => {
                const invites = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                callback(invites);
            });
    }

    async acceptInvite(inviteId) {
        try {
            await this.db.collection('game_invites').doc(inviteId).update({
                status: 'accepted'
            });
            return { success: true };
        } catch (error) {
            console.error('Error accepting invite:', error);
            return { success: false, error: error.message };
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

    // Generate locations for multiplayer game (stored in Firestore)
    generateLocationsForMode(mode, count) {
        const locations = [];
        for (let i = 0; i < count; i++) {
            let lat, lng;
            if (mode === 'india') {
                lat = 8 + Math.random() * 29;
                lng = 68 + Math.random() * 29;
            } else {
                lat = (Math.random() * 160) - 80;
                lng = (Math.random() * 360) - 180;
            }
            locations.push({ lat, lng });
        }
        return locations;
    }

    async createGame(mode, timeControl = 'unlimited') {
        if (!this.authService.user) return null;
        
        // Use authService's db
        this.db = this.authService.db;
        
        // Generate a unique room code
        this.roomCode = this.generateRoomCode();
        
        // Generate locations for the game (so both players get the same ones)
        const locations = this.generateLocationsForMode(mode, 5);
        
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
            timeControl: timeControl,
            status: 'waiting', // waiting, playing, finished
            currentRound: 1,
            totalRounds: 5,
            locations: locations,
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
        
        // Set currentGame immediately with updated data so showLobby() can access it
        const updatedGameData = {
            ...gameData,
            opponent: {
                uid: this.authService.user.uid,
                displayName: this.authService.user.displayName
            },
            status: 'playing'
        };
        this.currentGame = { ref: gameRef, data: updatedGameData };
        
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

    async saveResolvedLocation(roundIndex, resolvedLocation) {
        if (!this.currentGame) return;
        
        try {
            await this.currentGame.ref.update({
                [`resolvedLocations.${roundIndex}`]: resolvedLocation
            });
        } catch (e) {
            console.error('Error saving resolved location:', e);
        }
    }

    onGameUpdate(gameData) {
        // Check if opponent left
        if (gameData.status === 'abandoned') {
            if (window.gameController) {
                window.gameController.showOpponentLeftModal();
            }
            return;
        }
        
        // This will be called by the game controller
        if (window.multiplayerGameUpdate) {
            window.multiplayerGameUpdate(gameData);
        }
    }

    async notifyPlayerLeft() {
        if (!this.currentGame) return;
        
        try {
            await this.currentGame.ref.update({
                status: 'abandoned',
                abandonedBy: this.authService.user.uid,
                abandonedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (e) {
            console.log('Could not update game status:', e);
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
const friendsService = new FriendsService(authService);
const multiplayerService = new MultiplayerService(authService);

// Make globally accessible
window.authService = authService;
window.friendsService = friendsService;
window.multiplayerService = multiplayerService;
