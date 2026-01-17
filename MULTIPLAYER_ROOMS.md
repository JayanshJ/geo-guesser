# Multi-Player Room System

## Overview
Your GeoGuesser game now supports creating rooms where multiple players (up to 8) can play together!

## Features

### Room Creation
- **Host-Created Rooms**: Any player can create a room by clicking "Create World Game" or "Create India Game"
- **Room Codes**: Each room gets a unique 6-character code (e.g., "ABC123")
- **Configurable Settings**: 
  - Max players: Default 8 (can be customized)
  - Game mode: World or India
  - Time control: Blitz, Rapid, Classic, or Unlimited

### Joining Rooms
- Players can join by entering the room code
- Room shows current player count and max capacity
- Players can see all other players in the lobby
- Host can see when enough players have joined to start

### Lobby Experience
- **Live Player List**: See all players as they join
- **Visual Indicators**:
  - 👑 Crown icon for host
  - Green border for yourself
  - Gold border for host
- **Room Info Display**:
  - Room code with copy button
  - Current player count (e.g., "3/8")
  - Game mode
- **Start Control**: Only the host can start the game when at least 2 players are present

### In-Game Experience
- **Live Scoreboard**: All player scores update in real-time during the game
- **Sorted Leaderboard**: Players shown in descending order by score
- **Auto-Advance**: Game automatically advances when all players complete their guess
- **Player Status**: See who's finished and who's still guessing

### Final Results
- **Rankings**: See final standings with position numbers
- **Win Conditions**:
  - 1st place: "🏆 You Win!"
  - Last place: "Better luck next time!"
  - Middle positions: "#N Place"
- **Complete Scoreboard**: All player scores displayed with final rankings

## Technical Implementation

### Firestore Structure
```javascript
multiplayer_games/{roomCode}/
  - roomCode: string
  - host: { uid, displayName }
  - mode: 'world' | 'india'
  - timeControl: string
  - status: 'waiting' | 'playing' | 'finished'
  - maxPlayers: number (default 8)
  - currentRound: number
  - totalRounds: number
  - locations: array of {lat, lng}
  - players: {
      [uid]: {
        uid: string
        displayName: string
        isHost: boolean
        score: number
        guesses: {
          [round]: { location, distance, points, timestamp }
        }
        hasLeft: boolean (optional)
        leftAt: timestamp (optional)
      }
    }
  - resolvedLocations: array (for syncing actual panorama locations)
  - createdAt: timestamp
  - startedAt: timestamp
```

### Key Components

#### MultiplayerService (`services.js`)
- `createGame(mode, timeControl, maxPlayers)`: Creates a new room
- `joinGameByCode(roomCode)`: Join existing room
- `startGame()`: Host starts the game (requires 2+ players)
- `submitGuess(round, location, distance, points)`: Submit player guess
- `leaveGame()`: Handle player leaving

#### GameController (`game.js`)
- `updateMultiplayerScores(gameData)`: Update live scoreboard
- `checkAllPlayersFinished(gameData)`: Check if all players completed round
- `showFinalScore()`: Display final rankings

#### UIController (`ui-controller.js`)
- `showLobby()`: Display lobby with room info
- `updateLobbyPlayers(gameData)`: Refresh player list
- `copyLobbyCode()`: Copy room code to clipboard
- `startMultiplayerGame()`: Host initiates game start

## Usage

### Creating a Room
1. From main menu, click "Create World Game" or "Create India Game"
2. Select time control
3. Wait in lobby for other players to join
4. Share the room code with friends
5. Click "Start Game" when ready (need at least 2 players)

### Joining a Room
1. Get the room code from the host
2. Enter the code in the "Enter Room Code" field
3. Click "Join"
4. Wait in lobby for host to start

## Configuration

To change the default maximum players, modify the `createGame` method call:

```javascript
// In ui-controller.js, when creating a game
const roomCode = await multiplayerService.createGame(mode, timeControl, 8); // Change 8 to desired max
```

## Future Enhancements

Potential improvements:
- Private/public room toggle
- Kick player functionality for host
- Spectator mode
- Chat system
- Custom round counts
- Regional leaderboards
- Tournament brackets
- Replay system

## Compatibility

- Works with both guest users and authenticated users
- Real-time synchronization via Firebase Firestore
- Mobile-responsive design
- Handles player disconnections gracefully
