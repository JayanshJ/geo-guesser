// Friends + game-invite service. Reads/writes the `users` collection (friends,
// friendRequests) and the `game_invites` collection. Borrows the `db` handle
// from AuthService.
import {
  collection,
  doc,
  getDoc,
  updateDoc,
  getDocs,
  query,
  where,
  limit,
  addDoc,
  onSnapshot,
  writeBatch,
  arrayUnion,
  arrayRemove,
  serverTimestamp,
} from 'firebase/firestore';
import { authService } from './auth.js';

class FriendsService {
  constructor(auth) {
    this.authService = auth;
    this.db = auth.db;
    this.invitesUnsub = null; // stored unsubscribe for the invites listener
  }

  initialize() {
    if (!this.db && this.authService.db) this.db = this.authService.db;
  }

  async searchUsersByUsername(username) {
    if (!username || username.length < 2) return [];
    if (!this.db) {
      console.error('Database not initialized in FriendsService');
      return [];
    }
    try {
      const currentUserId = this.authService.user?.uid;
      const searchTerm = username.toLowerCase().replace('@', '');

      // Fetch non-anonymous users and filter partial matches client-side.
      const snapshot = await getDocs(
        query(collection(this.db, 'users'), where('isAnonymous', '==', false), limit(50))
      );

      const users = [];
      for (const d of snapshot.docs) {
        const userData = d.data();
        if (d.id === currentUserId) continue;
        if (!userData.username || !userData.username.includes(searchTerm)) continue;

        let status = 'none';
        if (userData.friends && userData.friends.includes(currentUserId)) {
          status = 'friends';
        } else if (userData.friendRequests && userData.friendRequests.includes(currentUserId)) {
          status = 'pending';
        }

        users.push({
          userId: d.id,
          username: userData.username,
          displayName: userData.displayName,
          status,
        });
      }

      users.sort((a, b) => {
        const aExact = a.username === searchTerm;
        const bExact = b.username === searchTerm;
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;
        return a.username.localeCompare(b.username);
      });

      return users.slice(0, 10);
    } catch (error) {
      console.error('Error searching users:', error);
      return [];
    }
  }

  async sendFriendRequest(friendUid) {
    if (!this.authService.user || this.authService.user.isAnonymous) {
      return { success: false, error: 'Must be signed in to add friends' };
    }
    if (!this.db) return { success: false, error: 'Service not ready. Please try again.' };

    try {
      const friendRef = doc(this.db, 'users', friendUid);
      const friendDoc = await getDoc(friendRef);
      if (!friendDoc.exists()) return { success: false, error: 'User not found' };

      const friendData = friendDoc.data();
      if (friendData.friends && friendData.friends.includes(this.authService.user.uid)) {
        return { success: false, error: 'Already friends' };
      }
      if (friendData.friendRequests && friendData.friendRequests.includes(this.authService.user.uid)) {
        return { success: false, error: 'Friend request already sent' };
      }

      await updateDoc(friendRef, {
        friendRequests: arrayUnion(this.authService.user.uid),
      });
      return { success: true };
    } catch (error) {
      console.error('Error sending friend request:', error);
      return { success: false, error: error.message };
    }
  }

  async acceptFriendRequest(friendUid) {
    if (!this.authService.user || this.authService.user.isAnonymous) return;
    if (!this.db) return;
    try {
      const batch = writeBatch(this.db);
      const myRef = doc(this.db, 'users', this.authService.user.uid);
      const friendRef = doc(this.db, 'users', friendUid);
      batch.update(myRef, {
        friends: arrayUnion(friendUid),
        friendRequests: arrayRemove(friendUid),
      });
      batch.update(friendRef, {
        friends: arrayUnion(this.authService.user.uid),
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
    if (!this.db) return;
    try {
      await updateDoc(doc(this.db, 'users', this.authService.user.uid), {
        friendRequests: arrayRemove(friendUid),
      });
      return { success: true };
    } catch (error) {
      console.error('Error declining friend request:', error);
      return { success: false, error: error.message };
    }
  }

  async removeFriend(friendUid) {
    if (!this.authService.user || this.authService.user.isAnonymous) return;
    if (!this.db) return;
    try {
      const batch = writeBatch(this.db);
      const myRef = doc(this.db, 'users', this.authService.user.uid);
      const friendRef = doc(this.db, 'users', friendUid);
      batch.update(myRef, { friends: arrayRemove(friendUid) });
      batch.update(friendRef, { friends: arrayRemove(this.authService.user.uid) });
      await batch.commit();
      return { success: true };
    } catch (error) {
      console.error('Error removing friend:', error);
      return { success: false, error: error.message };
    }
  }

  async getFriendsList() {
    if (!this.authService.user || this.authService.user.isAnonymous) return [];
    if (!this.db) return [];
    try {
      const userDoc = await getDoc(doc(this.db, 'users', this.authService.user.uid));
      const userData = userDoc.data();
      if (!userData.friends || userData.friends.length === 0) return [];

      const friendsData = await Promise.all(
        userData.friends.map(async (friendUid) => {
          const friendDoc = await getDoc(doc(this.db, 'users', friendUid));
          if (friendDoc.exists()) return { uid: friendUid, ...friendDoc.data() };
          return null;
        })
      );
      return friendsData.filter((f) => f !== null);
    } catch (error) {
      console.error('Error getting friends list:', error);
      return [];
    }
  }

  async getFriendRequests() {
    if (!this.authService.user || this.authService.user.isAnonymous) return [];
    if (!this.db) return [];
    try {
      const userDoc = await getDoc(doc(this.db, 'users', this.authService.user.uid));
      const userData = userDoc.data();
      if (!userData.friendRequests || userData.friendRequests.length === 0) return [];

      const requestsData = await Promise.all(
        userData.friendRequests.map(async (friendUid) => {
          const friendDoc = await getDoc(doc(this.db, 'users', friendUid));
          if (friendDoc.exists()) return { uid: friendUid, ...friendDoc.data() };
          return null;
        })
      );
      return requestsData.filter((f) => f !== null);
    } catch (error) {
      console.error('Error getting friend requests:', error);
      return [];
    }
  }

  // Create a game-invite doc. `mode` is stored so the recipient's modal can
  // show it; `roomCode` is how the recipient joins.
  async inviteFriendToGame(friendUid, roomCode, mode = 'world') {
    if (!this.authService.user || this.authService.user.isAnonymous) return;
    if (!this.db) return;
    try {
      const ref = await addDoc(collection(this.db, 'game_invites'), {
        from: this.authService.user.uid,
        fromName: this.authService.user.displayName,
        to: friendUid,
        roomCode: roomCode,
        mode: mode,
        timestamp: serverTimestamp(),
        status: 'pending',
      });
      return { success: true, id: ref.id };
    } catch (error) {
      console.error('Error sending game invite:', error);
      return { success: false, error: error.message };
    }
  }

  // Live listener for incoming pending invites. Stores its unsubscribe so it
  // can be torn down on sign-out (call stopListeningToInvites).
  listenToInvites(callback) {
    if (!this.authService.user || this.authService.user.isAnonymous) return;
    this.stopListeningToInvites();

    const q = query(
      collection(this.db, 'game_invites'),
      where('to', '==', this.authService.user.uid),
      where('status', '==', 'pending')
    );
    this.invitesUnsub = onSnapshot(q, (snapshot) => {
      const invites = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      callback(invites);
    });
    return this.invitesUnsub;
  }

  stopListeningToInvites() {
    if (this.invitesUnsub) {
      this.invitesUnsub();
      this.invitesUnsub = null;
    }
  }

  async acceptInvite(inviteId) {
    try {
      await updateDoc(doc(this.db, 'game_invites', inviteId), { status: 'accepted' });
      return { success: true };
    } catch (error) {
      console.error('Error accepting invite:', error);
      return { success: false, error: error.message };
    }
  }

  async declineInvite(inviteId) {
    try {
      await updateDoc(doc(this.db, 'game_invites', inviteId), { status: 'declined' });
      return { success: true };
    } catch (error) {
      console.error('Error declining invite:', error);
      return { success: false, error: error.message };
    }
  }
}

export const friendsService = new FriendsService(authService);
export default FriendsService;