import { describe, it, expect } from 'vitest';
import {
  LocationGenerator,
  getModeMeta,
  computeScore,
  computeSpeedBonus,
  computeStreakMultiplier,
  MAX_SPEED_BONUS,
  MAX_STREAK_MULTIPLIER,
  STREAK_THRESHOLD_KM,
  MODES,
} from '../src/game/locations.js';

describe('computeScore', () => {
  it('scores 5000 on a perfect (0 km) guess', () => {
    expect(computeScore(0, 2000)).toBe(5000);
  });

  it('never returns negative for huge distances', () => {
    expect(computeScore(1_000_000, 2000)).toBeGreaterThanOrEqual(0);
  });

  it('is monotonic: closer guesses score higher', () => {
    const decay = 2000;
    const close = computeScore(100, decay);
    const mid = computeScore(1000, decay);
    const far = computeScore(5000, decay);
    expect(close).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(far);
  });

  it('respects the decay factor (tighter decay => lower score for the same miss)', () => {
    // A 500 km miss is almost free in world mode but costly in india mode.
    expect(computeScore(500, MODES.world.decayFactor)).toBeGreaterThan(
      computeScore(500, MODES.india.decayFactor),
    );
  });
});

describe('getModeMeta', () => {
  it('returns metadata for a known mode', () => {
    const meta = getModeMeta('india');
    expect(meta.label).toBe('India');
    expect(meta.decayFactor).toBe(300);
    expect(meta.mapCenter).toBeDefined();
  });

  it('falls back to world for an unknown mode', () => {
    expect(getModeMeta('nonsense').label).toBe('World');
  });
});

describe('LocationGenerator.curated', () => {
  it('returns the requested number of coords', () => {
    const coords = LocationGenerator.curated('world', 5);
    expect(coords).toHaveLength(5);
  });

  it('returns valid {lat,lng} objects', () => {
    const coords = LocationGenerator.curated('europe', 3);
    coords.forEach((c) => {
      expect(typeof c.lat).toBe('number');
      expect(typeof c.lng).toBe('number');
      expect(c.lat).toBeGreaterThanOrEqual(-90);
      expect(c.lat).toBeLessThanOrEqual(90);
    });
  });

  it('handles count larger than the curated list (refills the pool)', () => {
    const coords = LocationGenerator.curated('india', 50);
    expect(coords).toHaveLength(50);
  });

  it('falls back to random coords for an unknown mode', () => {
    const coords = LocationGenerator.curated('does-not-exist', 4);
    expect(coords).toHaveLength(4);
    coords.forEach((c) => {
      expect(c.lat).toBeGreaterThanOrEqual(-80);
      expect(c.lat).toBeLessThanOrEqual(80);
    });
  });
});

describe('computeSpeedBonus', () => {
  it('awards the full bonus on an instant (0s) guess', () => {
    expect(computeSpeedBonus(0, 60)).toBe(MAX_SPEED_BONUS);
  });

  it('awards nothing when time runs out', () => {
    expect(computeSpeedBonus(60, 60)).toBe(0);
    expect(computeSpeedBonus(999, 60)).toBe(0); // clamped
  });

  it('is monotonic: faster guesses get a bigger (or equal) bonus', () => {
    const fast = computeSpeedBonus(5, 60);
    const mid = computeSpeedBonus(30, 60);
    const slow = computeSpeedBonus(55, 60);
    expect(fast).toBeGreaterThanOrEqual(mid);
    expect(mid).toBeGreaterThanOrEqual(slow);
  });

  it('never exceeds MAX_SPEED_BONUS and never goes negative', () => {
    for (let t = 0; t <= 60; t += 1) {
      const b = computeSpeedBonus(t, 60);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(MAX_SPEED_BONUS);
    }
  });

  it('snaps to the nearest 10 (arcade feel)', () => {
    // 30s used of 60s => fraction 0.5 => raw 250 => already a multiple of 10.
    expect(computeSpeedBonus(30, 60) % 10).toBe(0);
    // 1s used of 60s => fraction ~0.9833 => raw ~491.66 => snaps to 490.
    expect(computeSpeedBonus(1, 60)).toBe(490);
  });

  it('returns 0 under unlimited time (no speed pressure)', () => {
    expect(computeSpeedBonus(0, 'unlimited')).toBe(0);
    expect(computeSpeedBonus(5, 'unlimited')).toBe(0);
  });

  it('returns 0 for missing/invalid inputs without throwing', () => {
    expect(computeSpeedBonus(5, 0)).toBe(0);
    expect(computeSpeedBonus(5, null)).toBe(0);
    expect(computeSpeedBonus(null, 60)).toBe(0);
    expect(computeSpeedBonus(undefined, undefined)).toBe(0);
  });
});

describe('computeStreakMultiplier', () => {
  it('is x1 with no streak or a single good guess', () => {
    expect(computeStreakMultiplier(0)).toBe(1);
    expect(computeStreakMultiplier(1)).toBe(1);
  });

  it('grows by +1 per consecutive good guess', () => {
    expect(computeStreakMultiplier(2)).toBe(2);
    expect(computeStreakMultiplier(3)).toBe(3);
    expect(computeStreakMultiplier(4)).toBe(4);
  });

  it('caps at MAX_STREAK_MULTIPLIER', () => {
    expect(computeStreakMultiplier(MAX_STREAK_MULTIPLIER)).toBe(MAX_STREAK_MULTIPLIER);
    expect(computeStreakMultiplier(100)).toBe(MAX_STREAK_MULTIPLIER);
  });

  it('never drops below x1 and floors fractional input', () => {
    expect(computeStreakMultiplier(-5)).toBe(1);
    expect(computeStreakMultiplier(2.9)).toBe(2);
  });

  it('treats nullish input as 0 (x1)', () => {
    expect(computeStreakMultiplier(null)).toBe(1);
    expect(computeStreakMultiplier(undefined)).toBe(1);
  });
});

describe('STREAK_THRESHOLD_KM', () => {
  it('is 0.5 km (the sub-500m streak criterion)', () => {
    expect(STREAK_THRESHOLD_KM).toBe(0.5);
  });
});