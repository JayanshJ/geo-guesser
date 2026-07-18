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
    // Per-channel volumes (0..1). Stored values are applied when the gain
    // nodes are created (lazily, on first _ensure()).
    this.sfxVolume = 0.8;
    this.musicVolume = 0.5;
    this.sfxGain = null;
    this.musicGain = null;
    // Looping background-music scheduler state.
    this.musicPlaying = false;
    this._musicTimer = null;
    this._nextNoteTime = 0;
    this._musicStep = 0;
  }

  // Lazily create/resume the AudioContext. Must be called from a user gesture
  // the first time (browsers block audio otherwise). No-op if muted.
  _ensure() {
    if (this.muted) return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      // Two master gain nodes: one for SFX, one for music, so the settings
      // sliders can adjust each channel independently and live.
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = this.sfxVolume;
      this.sfxGain.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      // Music is mixed a touch quieter than SFX by default.
      this.musicGain.gain.value = this.musicVolume * 0.7;
      this.musicGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  setMuted(muted) {
    this.muted = !!muted;
    if (this.muted) {
      this.stopMusic();
      if (this.ctx) this.ctx.suspend();
    } else if (this.ctx) {
      // Resume the context so SFX work. Music restart is owned by the
      // MusicPlayer (it decides synth vs file track), so we don't startMusic()
      // here — it would double-play or fight a selected file track.
      this._ensure();
    }
  }

  isMuted() {
    return this.muted;
  }

  // --- Volume (0..1). Live-adjusts the gain nodes; stored for later creation. ---
  setSfxVolume(v) {
    this.sfxVolume = Math.max(0, Math.min(1, v));
    if (this.sfxGain && this.ctx) {
      this.sfxGain.gain.setTargetAtTime(this.sfxVolume, this.ctx.currentTime, 0.02);
    }
  }

  setMusicVolume(v) {
    this.musicVolume = Math.max(0, Math.min(1, v));
    if (this.musicGain && this.ctx) {
      this.musicGain.gain.setTargetAtTime(this.musicVolume * 0.7, this.ctx.currentTime, 0.02);
    }
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
    osc.connect(g).connect(this.sfxGain || ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  // Short blip for UI button clicks.
  playClick() {
    this._tone({ type: 'square', freq: 660, endFreq: 920, dur: 0.05, gain: 0.1 });
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

  // --- Looping background arcade music -------------------------------------
  // A procedurally-scheduled chiptune: a 16-step square-wave arpeggio over a
  // triangle bassline + offbeat hi-hat blips, in A minor. Uses a lookahead
  // scheduler (setInterval) that queues notes ~200ms ahead of ctx.currentTime
  // for sample-accurate, gap-free looping. No audio files, no licensing.
  startMusic() {
    if (this.muted || this.musicPlaying) return;
    const ctx = this._ensure();
    if (!ctx) return;
    this.musicPlaying = true;
    this._nextNoteTime = ctx.currentTime + 0.1;
    this._musicStep = 0;
    this._musicTimer = setInterval(() => this._scheduleMusic(), 25);
  }

  stopMusic() {
    this.musicPlaying = false;
    if (this._musicTimer) {
      clearInterval(this._musicTimer);
      this._musicTimer = null;
    }
  }

  _scheduleMusic() {
    if (!this.musicPlaying || !this.ctx || !this.musicGain) return;
    const stepDur = 0.14;
    while (this._nextNoteTime < this.ctx.currentTime + 0.2) {
      this._playMusicStep(this._musicStep, this._nextNoteTime);
      this._nextNoteTime += stepDur;
      this._musicStep = (this._musicStep + 1) % 16;
    }
  }

  _playMusicStep(step, when) {
    // A-minor arpeggio across the bar (A4 C5 E5 A5 ...).
    const arp = [440, 523, 659, 880, 659, 523, 440, 330,
      440, 523, 659, 880, 1047, 880, 659, 523];
    this._musicNote('square', arp[step], when, 0.12, 0.09);
    // Bassline: one note per beat (every 4 steps): A2 A2 E2 G2.
    if (step % 4 === 0) {
      const bass = [110, 110, 82.41, 98];
      this._musicNote('triangle', bass[step / 4], when, 0.52, 0.16);
    }
    // Crisp hi-hat-ish blip on offbeats.
    if (step % 2 === 1) this._musicNote('square', 1800, when, 0.03, 0.03);
  }

  _musicNote(type, freq, when, dur, gain) {
    const ctx = this.ctx;
    if (!ctx || !this.musicGain) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, when);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(g).connect(this.musicGain);
    osc.start(when);
    osc.stop(when + dur + 0.02);
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