// Achievement definitions + pure detection helpers. The unlocked-state is
// persisted on the user's Firestore doc (`achievements` map) by AuthService;
// this module only holds metadata and the pure "does this round/result unlock
// anything?" logic so it can be reasoned about (and later tested) in isolation.

export const ALL_MODES = ['world', 'india', 'europe', 'us', 'asia', 'landmarks'];

export const ACHIEVEMENTS = {
  bullseye: { id: 'bullseye', label: 'Bullseye', emoji: '🎯', desc: 'Guess within 1 km of the target.' },
  perfectRound: { id: 'perfectRound', label: 'Perfect Round', emoji: '💯', desc: 'Score a perfect 5,000 on a round.' },
  winStreak5: { id: 'winStreak5', label: 'Hot Streak', emoji: '🔥', desc: 'Win 5 multiplayer games in a row.' },
  globeTrotter: { id: 'globeTrotter', label: 'Globe Trotter', emoji: '🌍', desc: 'Play every game mode.' },
};

// Achievements unlocked by a single round's result (bullseye / perfect round).
// `result` is the round-result object built in GameController.confirmGuess.
export function detectRoundAchievements(result) {
  const out = [];
  if (!result) return out;
  if (result.distance < 1) out.push('bullseye');
  if (result.basePoints === 5000) out.push('perfectRound');
  return out;
}

// True once the player has played every mode at least once.
export function isGlobeTrotter(modesPlayed) {
  const played = Array.isArray(modesPlayed) ? modesPlayed : [];
  return ALL_MODES.every((m) => played.includes(m));
}

// Pins unlocked by achievements: each pin requires a specific achievement.
// `unlockedPins` is the array persisted on the user doc; returns the pin ids
// that should be newly available given the achievement set.
export const PINS = {
  default: { id: 'default', label: 'Classic', emoji: '📍', requires: null },
  dart: { id: 'dart', label: 'Dart', emoji: '🎯', requires: 'bullseye' },
  flag: { id: 'flag', label: 'Flag', emoji: '🚩', requires: 'globeTrotter' },
  heart: { id: 'heart', label: 'Pixel Heart', emoji: '❤️', requires: 'perfectRound' },
};

// Pins the player has available: the default always, plus any whose required
// achievement is unlocked.
export function availablePins(achievementIds) {
  const have = new Set(achievementIds || []);
  return Object.values(PINS).filter((p) => p.requires === null || have.has(p.requires));
}

// Emoji for a pin id (used to render the map marker icon + the selector UI).
export function pinEmoji(pinId) {
  return (PINS[pinId] && PINS[pinId].emoji) || PINS.default.emoji;
}

// Back-compat: the unlocked (non-default) pin ids for a given achievement set.
export function pinsForAchievements(achievementIds) {
  const have = new Set(achievementIds || []);
  return Object.values(PINS).filter((p) => p.requires && have.has(p.requires)).map((p) => p.id);
}