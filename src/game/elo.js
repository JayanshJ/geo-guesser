// Pure ELO rating math. Kept free of Firebase/browser globals so it can be
// unit-tested directly. Multi-player games use a pairwise update: the player's
// expected and actual scores are summed across all rated opponents, then the
// rating moves by K * (actual - expected). This is the standard extension of
// Elo to N-player fields (used by e.g. online chess tournaments).

export const K_FACTOR = 32;
export const DEFAULT_RATING = 1000;

// Expected score (0..1) of `ratingA` against `ratingB`.
export function expectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

// New rating for a player after a multi-player game.
//   myRating  - the player's pre-game rating
//   myScore   - the player's final game score
//   opponents - [{ rating, score }, ...] (exclude unrated players upstream)
// Returns the rounded new rating. With no rated opponents the rating is
// unchanged (no competitive signal from the game).
export function computeNewRating(myRating, myScore, opponents) {
  if (!opponents || opponents.length === 0) return myRating;
  let expected = 0;
  let actual = 0;
  for (const opp of opponents) {
    expected += expectedScore(myRating, opp.rating);
    actual += myScore > opp.score ? 1 : myScore === opp.score ? 0.5 : 0;
  }
  return Math.round(myRating + K_FACTOR * (actual - expected));
}

// Rating delta (new - old), for display.
export function ratingDelta(myRating, myScore, opponents) {
  return computeNewRating(myRating, myScore, opponents) - myRating;
}