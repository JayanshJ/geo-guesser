# GeoGuesser Clone

A fully functional GeoGuesser clone built with vanilla JavaScript and Google Maps API.

## Features

- 🌍 5 rounds of location guessing
- 🗺️ Interactive Google Maps integration
- 📍 Street View exploration
- 🎯 Distance-based scoring system
- 📊 Round-by-round statistics
- 🏆 Final score summary

## Setup Instructions

### 1. Get a Google Maps API Key

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the following APIs:
   - Maps JavaScript API
   - Street View Static API (optional but recommended)
4. Create credentials (API Key)
5. Copy your API key

### 2. Configure the Project

Open `index.html` and replace `YOUR_API_KEY_HERE` with your actual Google Maps API key:

```html
<script
  async
  defer
  src="https://maps.googleapis.com/maps/api/js?key=YOUR_ACTUAL_API_KEY&callback=initGame&libraries=geometry"
></script>
```

### 3. Run the Game

Simply open `index.html` in a web browser. For best results, use a local server:

**Using Python:**

```bash
python -m http.server 8000
```

**Using Node.js:**

```bash
npx http-server
```

Then navigate to `http://localhost:8000`

## How to Play

1. Click "Start Game" to begin
2. Explore the Street View location using mouse controls
3. Click "Show Map" to open the guess map
4. Click anywhere on the map to place your guess
5. Click "Confirm Guess" to submit
6. View your results and distance from the actual location
7. Continue for 5 rounds
8. See your final score out of 25,000 points!

## Scoring System

- Maximum 5,000 points per round
- Points decrease exponentially with distance
- Total possible score: 25,000 points

## Technologies Used

- HTML5
- CSS3
- Vanilla JavaScript
- Google Maps JavaScript API
- Google Maps Geometry Library

## Customization

### Add More Locations

Edit the `locations` array in `game.js`:

```javascript
const locations = [
  { lat: 48.8584, lng: 2.2945 }, // Eiffel Tower
  { lat: YOUR_LAT, lng: YOUR_LNG }, // Your custom location
  // Add more locations...
];
```

### Change Number of Rounds

Modify `totalRounds` in the game state:

```javascript
let game = {
  totalRounds: 5, // Change this number
  // ...
};
```

### Adjust Scoring

Modify the scoring calculation in the `confirmGuess()` function:

```javascript
const points = Math.round(5000 * Math.exp(-distance / 2000));
// Adjust the formula to your preference
```

## Notes

- Google Maps API has usage limits and costs beyond the free tier
- The game uses 20 diverse locations from around the world
- Locations are shuffled each game for variety

## License

This is a learning project. Feel free to use and modify as needed.
