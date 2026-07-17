// Arcade juice: synthesized chiptune sound effects (Web Audio API, no asset
// files) + a canvas confetti burst for bullseyes. Everything is generated at
// runtime so there are no binary assets to ship and no new dependencies.
//
// Sounds are short square/sawtooth/triangle blips in the retro-arcade palette
// (hot-pink / electric-blue / sunny-yellow vibes via frequency choices). The
// AudioContext is created lazily and resumed on the first user gesture (the
// guess click) to satisfy browser autoplay policies.

class ArcadeFX {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  // Lazily create/resume the AudioContext. Must be called from a user gesture
  // the first time (browsers block audio otherwise). No-op if muted.
  _ensure() {
    if (this.muted) return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  setMuted(muted) {
    this.muted = !!muted;
    if (this.muted && this.ctx) this.ctx.suspend();
  }

  isMuted() {
    return this.muted;
  }

  // Core tone: a simple envelope-shaped oscillator. `type` is the waveform,
  // `freq` the start frequency, `endFreq` optional glide target, `dur` seconds.
  _tone({ type = 'square', freq, endFreq, dur = 0.12, gain = 0.18, delay = 0 }) {
    const ctx = this._ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  // Coin/bleep on a normal guess.
  playCoin() {
    this._tone({ type: 'square', freq: 880, endFreq: 1320, dur: 0.1, gain: 0.16 });
  }

  // Buzzer on time-out (descending low buzz).
  playBuzzer() {
    this._tone({ type: 'sawtooth', freq: 220, endFreq: 90, dur: 0.45, gain: 0.2 });
    this._tone({ type: 'square', freq: 160, endFreq: 70, dur: 0.45, gain: 0.12, delay: 0.05 });
  }

  // Level-up jingle on a great (but not perfect) round: ascending arpeggio.
  playLevelUp() {
    const notes = [523, 659, 784, 1047]; // C5 E5 G5 C6
    notes.forEach((f, i) => this._tone({ type: 'square', freq: f, dur: 0.12, gain: 0.16, delay: i * 0.09 }));
  }

  // Sparkly bullseye jingle on a <1km round: higher, faster, with a triangle
  // shimmer on top. Played alongside the confetti burst.
  playBullseye() {
    const notes = [784, 1047, 1319, 1568, 2093]; // G5 C6 E6 G6 C7
    notes.forEach((f, i) => this._tone({ type: 'square', freq: f, dur: 0.13, gain: 0.15, delay: i * 0.07 }));
    notes.forEach((f, i) => this._tone({ type: 'triangle', freq: f * 2, dur: 0.1, gain: 0.06, delay: i * 0.07 + 0.03 }));
  }

  // Pick + play the right sound for a round result. `timedOut` suppresses the
  // positive sounds (the buzzer is expected to have already played).
  playRoundSound(result, timedOut = false) {
    if (this.muted) return;
    if (timedOut) return; // buzzer handled by handleTimeUp
    if (!result) return;
    if (result.distance < 1) {
      this.playBullseye();
    } else if (result.basePoints >= 4000) {
      this.playLevelUp();
    } else {
      this.playCoin();
    }
  }

  // Confetti burst over the current screen. Creates a throwaway full-viewport
  // canvas overlay (pointer-events: none) and runs a short rAF particle loop.
  confettiBurst() {
    const colors = ['#ff3b6b', '#2d7dff', '#ffd23f', '#ff7a9c', '#ffffff'];
    const canvas = document.createElement('canvas');
    canvas.className = 'confetti-overlay';
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    Object.assign(canvas.style, {
      position: 'fixed',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: '9999',
    });
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const particles = [];
    const count = 140;
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: -20 - Math.random() * canvas.height * 0.3,
        w: 6 + Math.random() * 8,
        h: 8 + Math.random() * 10,
        color: colors[Math.floor(Math.random() * colors.length)],
        vy: 2 + Math.random() * 4,
        vx: -2 + Math.random() * 4,
        rot: Math.random() * Math.PI,
        vr: -0.2 + Math.random() * 0.4,
        life: 1,
      });
    }

    const start = performance.now();
    const DURATION = 2200;
    const draw = (now) => {
      const elapsed = now - start;
      const t = elapsed / DURATION;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.08; // gravity
        p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(0, 1 - t);
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      if (elapsed < DURATION) {
        requestAnimationFrame(draw);
      } else {
        canvas.remove();
      }
    };
    requestAnimationFrame(draw);
  }
}

export const arcadeFX = new ArcadeFX();
export default ArcadeFX;