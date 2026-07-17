import { describe, it, expect } from 'vitest';
import {
  LocationGenerator,
  getModeMeta,
  computeScore,
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