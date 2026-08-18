import { describe, it, expect, vi, afterEach } from 'vitest';
import { Pong } from '../src/game/pong.js';

// The guest is render-only: it interpolates the ball from a buffer of host
// snapshots. The host ships ball velocity (bvx/bvy) precisely so the guest can
// extrapolate during a delivery gap — without that, the ball freezes whenever
// a Firestore gap exceeds the 100ms interpolation window, producing the
// move→freeze→jump stutter the joining player sees.

afterEach(() => vi.unstubAllGlobals());

describe('Pong guest — extrapolation during snapshot gaps', () => {
  it('keeps the ball moving when no newer snapshot is available (gap > interp window)', () => {
    const guest = new Pong({ mode: 'online', netRole: 'guest' });
    let t = 1000;
    vi.stubGlobal('performance', { now: () => t });

    // Host state at t=1000: ball at x=200, moving right at 300 px/s.
    guest.applyRemoteState({
      bx: 200, by: 225, bvx: 300, bvy: 0, ly: 225,
      sl: 0, sr: 0, rally: 0, phase: 'playing', cd: 3,
    });
    expect(guest.snapBuf.length).toBe(1);

    // Simulate a 250ms delivery gap (no new snapshot). The 100ms interpolation
    // window has run dry, so s1 is null — the guest must extrapolate along the
    // shipped velocity instead of freezing at x=200.
    t = 1250;
    guest._updateGuest(0.016);

    expect(guest.ball.x).toBeGreaterThan(200);
    expect(guest.ball.y).toBeCloseTo(225, 1);
  });

  it('interpolates smoothly between two bracketing snapshots', () => {
    const guest = new Pong({ mode: 'online', netRole: 'guest' });
    let t = 1000;
    vi.stubGlobal('performance', { now: () => t });

    // Two snapshots 50ms apart, ball moving right.
    guest.applyRemoteState({ bx: 200, by: 225, bvx: 300, bvy: 0, ly: 225, sl: 0, sr: 0, rally: 0, phase: 'playing', cd: 3 });
    t = 1050;
    guest.applyRemoteState({ bx: 215, by: 225, bvx: 300, bvy: 0, ly: 225, sl: 0, sr: 0, rally: 0, phase: 'playing', cd: 3 });

    // now = 1100 → render target = 1000. s0 = recvAt 1000, s1 = recvAt 1050.
    // f = (1000 - 1000) / 50 = 0 → ball at s0 position (200). Advance 25ms:
    // target = 1025 → f = 25/50 = 0.5 → ball halfway = 207.5.
    t = 1125;
    guest._updateGuest(0.016);
    expect(guest.ball.x).toBeCloseTo(207.5, 0);
  });

  it('caps extrapolation so a long dropout cannot fling the ball off-screen', () => {
    const guest = new Pong({ mode: 'online', netRole: 'guest' });
    let t = 1000;
    vi.stubGlobal('performance', { now: () => t });
    guest.applyRemoteState({ bx: 200, by: 225, bvx: 700, bvy: 0, ly: 225, sl: 0, sr: 0, rally: 0, phase: 'playing', cd: 3 });

    // 5-second gap. fwd is capped at 80ms, so the ball advances at most
    // 700 * 0.08 = 56px → x = 256, not 200 + 700*5 = 3700.
    t = 6000;
    guest._updateGuest(0.016);
    expect(guest.ball.x).toBeLessThan(300);
    expect(guest.ball.x).toBeGreaterThan(200);
  });
});