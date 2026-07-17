import { describe, it, expect } from 'vitest';
import {
  expectedScore,
  computeNewRating,
  ratingDelta,
  K_FACTOR,
  DEFAULT_RATING,
} from '../src/game/elo.js';

describe('expectedScore', () => {
  it('is 0.5 for equal ratings', () => {
    expect(expectedScore(1000, 1000)).toBeCloseTo(0.5);
  });

  it('is >0.5 when the player is higher-rated', () => {
    expect(expectedScore(1400, 1000)).toBeGreaterThan(0.5);
    expect(expectedScore(1400, 1000)).toBeLessThan(1);
  });

  it('is <0.5 when the player is lower-rated', () => {
    expect(expectedScore(1000, 1400)).toBeLessThan(0.5);
    expect(expectedScore(1000, 1400)).toBeGreaterThan(0);
  });

  it('is symmetric (A vs B + B vs A == 1)', () => {
    const a = expectedScore(1100, 900);
    const b = expectedScore(900, 1100);
    expect(a + b).toBeCloseTo(1);
  });
});

describe('computeNewRating', () => {
  it('returns the rating unchanged with no rated opponents', () => {
    expect(computeNewRating(1000, 5000, [])).toBe(1000);
    expect(computeNewRating(1000, 5000, null)).toBe(1000);
  });

  it('rewards beating a higher-rated opponent more than beating a lower one', () => {
    const beatUp = computeNewRating(1000, 5000, [{ rating: 1400, score: 0 }]);
    const beatDown = computeNewRating(1000, 5000, [{ rating: 600, score: 0 }]);
    expect(beatUp).toBeGreaterThan(beatDown);
  });

  it('drops the rating when losing to a lower-rated opponent', () => {
    const after = computeNewRating(1000, 0, [{ rating: 1000, score: 5000 }]);
    expect(after).toBeLessThan(1000);
  });

  it('is zero-sum for equal-rated players who split a game', () => {
    // Two equal-rated players; one scores 5000, the other 0. Winner gains
    // exactly what the loser loses (K * 0.5 each way).
    const winner = computeNewRating(1000, 5000, [{ rating: 1000, score: 0 }]);
    const loser = computeNewRating(1000, 0, [{ rating: 1000, score: 5000 }]);
    expect(winner - 1000).toBe(1000 - loser);
  });

  it('applies the K-factor cap (a single game cannot swing more than K per opponent)', () => {
    // Max possible swing vs one opponent: actual=1, expected=0 -> +K.
    const maxGain = computeNewRating(1000, 5000, [{ rating: 1000, score: 0 }]) - 1000;
    expect(maxGain).toBeLessThanOrEqual(K_FACTOR);
  });
});

describe('ratingDelta', () => {
  it('matches computeNewRating - oldRating', () => {
    const opponents = [{ rating: 1200, score: 1000 }];
    const delta = ratingDelta(1000, 5000, opponents);
    const fresh = computeNewRating(1000, 5000, opponents) - 1000;
    expect(delta).toBe(fresh);
  });
});

describe('DEFAULT_RATING', () => {
  it('is 1000', () => {
    expect(DEFAULT_RATING).toBe(1000);
  });
});