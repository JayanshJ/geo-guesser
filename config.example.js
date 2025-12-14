// Copy this file to config.js and add your actual API keys
// DO NOT commit config.js to GitHub!

const CONFIG = {
    // Get your Google Maps API key from: https://console.cloud.google.com/
    // Enable: Maps JavaScript API
    GOOGLE_MAPS_API_KEY: 'YOUR_GOOGLE_MAPS_API_KEY_HERE',
    
    // Get Firebase config from: https://console.firebase.google.com/
    // Project Settings > Your apps > Web app
    // Note: Authentication is handled anonymously - no Google Sign In required
    // Just enable Firestore Database in your Firebase project
    FIREBASE_CONFIG: {
        apiKey: 'YOUR_FIREBASE_API_KEY',
        authDomain: 'YOUR_PROJECT.firebaseapp.com',
        projectId: 'YOUR_PROJECT_ID',
        storageBucket: 'YOUR_PROJECT.appspot.com',
        messagingSenderId: 'YOUR_MESSAGING_SENDER_ID',
        appId: 'YOUR_APP_ID'
    }
};
