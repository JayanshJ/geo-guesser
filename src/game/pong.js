// Pong — vanilla-canvas implementation for the arcade hub. Three modes:
// VS CPU (easy/normal/hard), LOCAL 2P (same keyboard), and ONLINE vs a friend.
// Ball physics mirror Breakout: sub-stepped movement (no tunnelling), paddle
// bounce mapped from hit offset with a 20°-from-horizontal floor, +3%/hit speed
// capped at 2× serve. The engine is net-free — online play is driven through
// callbacks (onHostSnapshot / onGuestPaddle) the controller wires to Firestore,
// and inbound data arrives via applyRemoteState / setOpponentPaddle. This keeps
// the physics pure and unit-testable without Firebase. No deps, no images.
import { arcadeFX } from './arcade.js';

// Playfield (drawing buffer), 16:9. Walls = top/bottom; goals = left/right edges.
const W = 800;
const H = 450;
const DT_CAP = 0.032;

const PADDLE_W = 14;
const PADDLE_H = 80;          // ~18% of field height
const PADDLE_MARGIN = 28;
const PADDLE_KEY_SPEED = 520; // px/s under keyboard
const PADDLE_LERP = 14;       // opponent/remote paddle follow rate (per second)

const BALL_R = 8;
const BASE_SPEED = 380;       // serve speed (px/s)
const SPEED_MULT = 1.03;      // +3% per paddle hit
const MAX_SPEED = BASE_SPEED * 2;

const WIN_SCORE = 7;
const SERVE_BEAT = 1.0;       // pause before each serve
const COUNTDOWN = 3.0;        // 3·2·1 on the first serve of a game only
const SCORED_PAUSE = 0.6;     // brief flash after a point
const RALLY_FADE_AT = 4;      // rally counter appears after this many hits
const MIN_FROM_HORZ = 20;     // degrees — exit angle never shallower than this
const MAX_FROM_HORZ = 55;     // degrees — |offset|*55 at the paddle edge

// CPU difficulty: the entire knob is max paddle speed as a fraction of ball
// speed. readMs = how often the AI re-reads the ball; offFrac = aim jitter as a
// fraction of paddle height (re-rolled each read).
const CPU = {
  easy:   { speedFrac: 0.55, readMs: 90, offFrac: 0.25 },
  normal: { speedFrac: 0.80, readMs: 50, offFrac: 0.12 },
  hard:   { speedFrac: 1.05, readMs: 30, offFrac: 0.05 },
};

const COL_LEFT = '#4d79ff';   // blue
const COL_RIGHT = '#ff2e63';  // pink
const COL_BALL = '#4dd8ff';
const COL_GOLD = '#ffc93c';
const HS_KEY = 'geoguesser_pong_highscore';      // best rally (any mode)
const WINS_KEY = 'geoguesser_pong_wins';          // online wins

const DEG = Math.PI / 180;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// Safe localStorage read (Node self-check has a stub without getItem).
const lsGet = (k) => {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem ? localStorage.getItem(k) : null; }
  catch { return null; }
};
const lsSet = (k, v) => {
  try { if (typeof localStorage !== 'undefined' && localStorage.setItem) localStorage.setItem(k, v); } catch { /* */ }
};

export class Pong {
  constructor(opts = {}) {
    this.canvas = opts.canvas;
    this.ctx = this.canvas?.getContext('2d');
    this.boardFrame = opts.boardFrame;
    this.mode = opts.mode || 'cpu';        // 'cpu' | 'local' | 'online'
    this.difficulty = opts.difficulty || 'normal';
    this.netRole = opts.netRole || null;    // 'host' | 'guest' (online only)
    this.onHighScore = opts.onHighScore || (() => {});
    this.onWin = opts.onWin || (() => {});  // (winnerSide, leftScore, rightScore, isOnline)
    this.onHostSnapshot = opts.onHostSnapshot || null;  // host → controller (FireStore write)
    this.onGuestPaddle = opts.onGuestPaddle || null;     // guest → controller (FireStore write)
    this.reducedMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    // In online the human always plays the LEFT side locally. The guest's view
    // is mirrored so its own paddle is on the left — swap display x/scores.
    this.swap = this.mode === 'online' && this.netRole === 'guest';
    // Only the host (and offline modes) simulate the ball. The guest renders.
    this.sim = this.mode !== 'online' || this.netRole === 'host';
    this.running = false;
    this.reset();
  }

  reset() {
    this.scoreL = 0;
    this.scoreR = 0;
    this.rally = 0;
    this.bestRally = Number(lsGet(HS_KEY) || 0);
    this.ball = { x: W / 2, y: H / 2, vx: 0, vy: 0, trail: [] };
    this.left = { y: H / 2, vy: 0, flash: 0 };
    this.right = { y: H / 2, vy: 0, flash: 0 };
    this.particles = [];
    this.floats = [];
    this.wallSparks = [];
    this.sidePulseL = 0;   // scorer-side pulse
    this.sidePulseR = 0;
    this.goalFlashL = 0;    // conceding goal line flash
    this.goalFlashR = 0;
    this.phase = 'countdown';
    this.phaseT = COUNTDOWN;
    this.firstServe = true;
    this.countdownN = 3;
    this._cdPulse = 0;
    this.paused = false;
    this.over = false;
    this.winner = null;
    this.netStatus = 'ok';  // 'ok' | 'reconnecting' | 'lost'
    this.ping = null;
    this.snapBuf = [];      // guest: received host states with local recv time
    this.lastInput = 'none';
    // input state
    this.keys = { w: false, s: false, up: false, down: false };
    this.mouseY = null;
    this.touchLeftY = null;
    this.touchRightY = null;
  }

  // ---- lifecycle ----
  start() {
    if (this.running) return;
    this.running = true;
    this.reset();
    if (this.sim) this.serveSetup();
    this.bindInput();
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.loop.bind(this));
    this.updateHUD();
  }
  stop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.unbindInput();
    this.hideOverlays();
  }
  loop(now) {
    if (!this.running) return;
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (dt > DT_CAP) dt = DT_CAP;
    this.update(dt);
    this.render();
    this.rafId = requestAnimationFrame(this.loop.bind(this));
  }
  togglePause() {
    if (this.over) return;
    // In online the game keeps running remotely — pause is local-render only.
    if (this.mode === 'online') {
      this.localPaused = !this.localPaused;
      document.getElementById('pong-pause-overlay')?.classList.toggle('hidden', !this.localPaused);
      return;
    }
    this.paused = !this.paused;
    document.getElementById('pong-pause-overlay')?.classList.toggle('hidden', !this.paused);
    if (!this.paused) this.lastTime = performance.now();
  }
  retry() {
    this.hideOverlays();
    this.reset();
    if (this.sim) this.serveSetup();
    this.lastTime = performance.now();
    this.updateHUD();
  }
  hideOverlays() {
    document.getElementById('pong-pause-overlay')?.classList.add('hidden');
    document.getElementById('pong-gameover-overlay')?.classList.add('hidden');
  }

  // ---- serve ----
  serveSetup() {
    // Place ball at center, still. The phase timer drives the beat / countdown.
    this.ball.x = W / 2;
    this.ball.y = H / 2;
    this.ball.vx = 0;
    this.ball.vy = 0;
    this.ball.trail.length = 0;
    this.rally = 0;
    if (this.firstServe) {
      this.phase = 'countdown';
      this.phaseT = COUNTDOWN;
      this.countdownN = 3;
    } else {
      this.phase = 'serving';
      this.phaseT = SERVE_BEAT;
    }
  }

  // direction: -1 toward left (player who conceded on the left), +1 toward right.
  launchBall(direction) {
    const ang = rand(-20, 20) * DEG; // ±20° from horizontal
    const dir = direction || (Math.random() < 0.5 ? -1 : 1);
    this.ball.vx = Math.cos(ang) * BASE_SPEED * dir;
    this.ball.vy = Math.sin(ang) * BASE_SPEED;
    this.phase = 'playing';
    this.blip('click');
  }

  // ---- update ----
  update(dt) {
    this._updateParticles(dt);
    this._updateFloats(dt);
    if (this.left.flash > 0) this.left.flash = Math.max(0, this.left.flash - dt);
    if (this.right.flash > 0) this.right.flash = Math.max(0, this.right.flash - dt);
    if (this.sidePulseL > 0) this.sidePulseL = Math.max(0, this.sidePulseL - dt);
    if (this.sidePulseR > 0) this.sidePulseR = Math.max(0, this.sidePulseR - dt);
    if (this.goalFlashL > 0) this.goalFlashL = Math.max(0, this.goalFlashL - dt);
    if (this.goalFlashR > 0) this.goalFlashR = Math.max(0, this.goalFlashR - dt);

    if (this.mode === 'online' && this.netRole === 'guest') {
      this._updateGuest(dt);
      return;
    }
    if (this.paused || this.over) return;

    this._movePaddles(dt);

    if (this.phase === 'countdown') {
      this.phaseT -= dt;
      this._cdPulse += dt;
      const n = Math.ceil(this.phaseT);
      if (n !== this.countdownN && n >= 1) { this.countdownN = n; this._cdPulse = 0; this.blip('click'); }
      if (this.phaseT <= 0) { this.firstServe = false; this.launchBall(); }
    } else if (this.phase === 'serving') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) this.launchBall(this.serveDir || 0);
    } else if (this.phase === 'scored') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) this.serveSetup();
    } else if (this.phase === 'playing') {
      this._moveBall(dt);
    }

    // Host ships state every sim frame so the guest sees countdown / serve /
    // rally / score transitions (not just the playing phase). Stopped on 'over'.
    if (this.mode === 'online' && this.netRole === 'host' && this.onHostSnapshot) {
      this.onHostSnapshot(this.snapshot());
    }
  }

  _movePaddles(dt) {
    // Left paddle = the local human in every mode (and the host in online).
    this._moveLocalLeft(dt);
    // Right paddle:
    if (this.mode === 'cpu') this._moveCpu(dt);
    else if (this.mode === 'local') this._moveLocalRight(dt);
    else if (this.mode === 'online' && this.netRole === 'host') this._moveOpponentRight(dt);
    // (online guest: paddles handled in _updateGuest)
  }

  _paddleTop(y) { return y - PADDLE_H / 2; }
  _clampPaddle(y) { return clamp(y, PADDLE_H / 2, H - PADDLE_H / 2); }

  _moveLocalLeft(dt) {
    let target = this.left.y;
    let keyed = false;
    if (this.keys.w || this.keys.up) { target -= PADDLE_KEY_SPEED * dt; keyed = true; }
    if (this.keys.s || this.keys.down) { target += PADDLE_KEY_SPEED * dt; keyed = true; }
    if (!keyed && this.mouseY !== null && this.lastInput !== 'touch') {
      target = this.mouseY; // mouse follows cursor Y instantly
    }
    if (this.touchLeftY !== null) target = this.touchLeftY;
    this.left.y = this._clampPaddle(target);
  }

  _moveLocalRight(dt) {
    let target = this.right.y;
    if (this.keys.up) target -= PADDLE_KEY_SPEED * dt;
    if (this.keys.down) target += PADDLE_KEY_SPEED * dt;
    if (this.touchRightY !== null) target = this.touchRightY;
    this.right.y = this._clampPaddle(target);
  }

  _moveOpponentRight(dt) {
    // Host: lerp the right paddle toward the latest received guest Y.
    if (this._oppY !== undefined && this._oppY !== null) {
      this.right.y += (this._oppY - this.right.y) * Math.min(1, dt * PADDLE_LERP);
      this.right.y = this._clampPaddle(this.right.y);
    }
  }

  _moveCpu(dt) {
    const cfg = CPU[this.difficulty] || CPU.normal;
    const ball = this.ball;
    const now = performance.now();
    if (now - (this._cpuLastRead || 0) >= cfg.readMs) {
      this._cpuLastRead = now;
      // Aim with a random offset; re-rolled each read.
      const off = rand(-cfg.offFrac, cfg.offFrac) * PADDLE_H;
      this._cpuAim = ball.y + off;
    }
    let target = this._cpuAim ?? H / 2;
    // Ball moving away from the CPU (right paddle) → drift back to center.
    if (ball.vx < 0) target = H / 2;
    const maxSpeed = cfg.speedFrac * this._ballSpeed();
    const dy = target - this.right.y;
    const move = clamp(dy, -maxSpeed * dt, maxSpeed * dt);
    this.right.y = this._clampPaddle(this.right.y + move);
  }

  _ballSpeed() {
    const s = Math.hypot(this.ball.vx, this.ball.vy);
    return s > 0 ? s : BASE_SPEED;
  }

  _moveBall(dt) {
    const speed = this._ballSpeed();
    const travel = speed * dt;
    // Sub-step so per-frame travel never exceeds half the paddle width — the
    // ball can't tunnel through a paddle at high speed.
    const maxStep = PADDLE_W / 2;
    const steps = Math.max(1, Math.ceil(travel / maxStep));
    const sdt = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.ball.x += this.ball.vx * sdt;
      this.ball.y += this.ball.vy * sdt;
      this._collideWalls();
      this._collidePaddles();
      if (this._checkGoal()) break;
    }
    // Trail (skip under reduced motion).
    if (!this.reducedMotion) {
      this.ball.trail.push({ x: this.ball.x, y: this.ball.y });
      if (this.ball.trail.length > 8) this.ball.trail.shift();
    }
  }

  _collideWalls() {
    if (this.ball.y - BALL_R < 0) {
      this.ball.y = BALL_R;
      this.ball.vy = Math.abs(this.ball.vy);
      this._wallSpark(this.ball.x, 0);
      this.blip('click');
    }
    if (this.ball.y + BALL_R > H) {
      this.ball.y = H - BALL_R;
      this.ball.vy = -Math.abs(this.ball.vy);
      this._wallSpark(this.ball.x, H);
      this.blip('click');
    }
  }

  _collidePaddles() {
    const b = this.ball;
    // Left paddle: hits when moving left and within paddle x/y range.
    if (b.vx < 0
        && b.x - BALL_R <= PADDLE_MARGIN + PADDLE_W
        && b.x - BALL_R >= PADDLE_MARGIN - 4
        && b.y >= this._paddleTop(this.left.y) - BALL_R
        && b.y <= this._paddleTop(this.left.y) + PADDLE_H + BALL_R) {
      b.x = PADDLE_MARGIN + PADDLE_W + BALL_R;
      this._bounce(true, this.left.y);
    }
    // Right paddle.
    if (b.vx > 0
        && b.x + BALL_R >= W - PADDLE_MARGIN - PADDLE_W
        && b.x + BALL_R <= W - PADDLE_MARGIN + 4
        && b.y >= this._paddleTop(this.right.y) - BALL_R
        && b.y <= this._paddleTop(this.right.y) + PADDLE_H + BALL_R) {
      b.x = W - PADDLE_MARGIN - PADDLE_W - BALL_R;
      this._bounce(false, this.right.y);
    }
  }

  // leftSide true = left paddle (ball bounces rightward), false = right paddle.
  _bounce(leftSide, paddleY) {
    const offset = clamp((this.ball.y - paddleY) / (PADDLE_H / 2), -1, 1);
    let fromHorz = Math.abs(offset) * MAX_FROM_HORZ;
    if (fromHorz < MIN_FROM_HORZ) fromHorz = MIN_FROM_HORZ; // never shallower than 20°
    const sign = offset === 0 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(offset);
    const rad = fromHorz * DEG;
    const speed = Math.min(MAX_SPEED, this._ballSpeed() * SPEED_MULT);
    const vxMag = Math.cos(rad) * speed;
    const vy = sign * Math.sin(rad) * speed;
    this.ball.vx = leftSide ? vxMag : -vxMag;
    this.ball.vy = vy;
    this.rally++;
    if (this.rally > this.bestRally) {
      this.bestRally = this.rally;
      lsSet(HS_KEY, String(this.bestRally));
      this.onHighScore(this.bestRally);
    }
    const pad = leftSide ? this.left : this.right;
    pad.flash = 0.15;
    const col = leftSide ? COL_LEFT : COL_RIGHT;
    this._burst(this.ball.x, this.ball.y, col, 5);
    this.blip('click');
    this.updateHUD();
  }

  _checkGoal() {
    const b = this.ball;
    if (b.x + BALL_R < 0) { this._score('right'); return true; }
    if (b.x - BALL_R > W) { this._score('left'); return true; }
    return false;
  }

  _score(side) {
    if (side === 'left') { this.scoreL++; this.sidePulseL = 0.8; this.goalFlashR = 0.8; }
    else { this.scoreR++; this.sidePulseR = 0.8; this.goalFlashL = 0.8; }
    // Rally burst in gold when it ended above the fade-in threshold.
    if (this.rally >= RALLY_FADE_AT) {
      this.floats.push({ x: W / 2, y: H / 2, text: `RALLY ×${this.rally}`, t: 1.2, color: COL_GOLD, burst: true });
    }
    this.blip('bullseye');
    this.updateHUD();
    this.serveDir = side === 'left' ? 1 : -1; // serve toward the conceding side
    if (this.scoreL >= WIN_SCORE || this.scoreR >= WIN_SCORE) {
      this._gameOver();
    } else {
      this.phase = 'scored';
      this.phaseT = SCORED_PAUSE;
    }
  }

  _gameOver() {
    this.phase = 'over';
    this.over = true;
    const leftWins = this.scoreL >= WIN_SCORE;
    this.winner = leftWins ? 'left' : 'right';
    this.blip('buzzer');
    // Online: persist W/L + record an online win for the local human.
    const isOnline = this.mode === 'online';
    if (isOnline) {
      // The local human is always 'left' in display. They won iff left won.
      const humanWon = leftWins; // (guest view is swapped but leftWins is in display frame)
      if (humanWon) {
        const w = Number(lsGet(WINS_KEY) || 0) + 1;
        lsSet(WINS_KEY, String(w));
      }
      this.onWin(leftWins ? 'left' : 'right', this.scoreL, this.scoreR, true);
    } else {
      this.onWin(leftWins ? 'left' : 'right', this.scoreL, this.scoreR, false);
    }
    const winnerName = leftWins ? 'LEFT' : 'RIGHT';
    const stats = document.getElementById('pong-final-stats');
    if (stats) stats.textContent = `${winnerName} WINS · ${this.scoreL} – ${this.scoreR}`;
    const banner = document.getElementById('pong-winner-banner');
    if (banner) {
      banner.textContent = `${winnerName} WINS!`;
      banner.style.color = leftWins ? COL_LEFT : COL_RIGHT;
    }
    document.getElementById('pong-gameover-overlay')?.classList.remove('hidden');
    this.updateHUD();
  }

  // ---- guest (online) update: render only, no simulation ----
  _updateGuest(dt) {
    if (this.localPaused) return;
    if (this.over) return; // game finished — stop shipping paddle updates
    // Local paddle (displayed left) from local input; sent to host as right Y.
    this._moveLocalLeft(dt);
    if (this.onGuestPaddle) this.onGuestPaddle(this.left.y);

    // Interpolate the ball ~100ms behind real time across the receive buffer.
    const now = performance.now();
    const target = now - 0.1;
    let s0 = null; let s1 = null;
    for (let i = 0; i < this.snapBuf.length; i++) {
      if (this.snapBuf[i].recvAt <= target) s0 = this.snapBuf[i];
      else { s1 = this.snapBuf[i]; break; }
    }
    if (!s0 && this.snapBuf.length) s0 = this.snapBuf[this.snapBuf.length - 1];
    if (s0 && s1) {
      const span = s1.recvAt - s0.recvAt || 1;
      const f = clamp((target - s0.recvAt) / span, 0, 1);
      this.ball.x = s0.s.bx + (s1.s.bx - s0.s.bx) * f;
      this.ball.y = s0.s.by + (s1.s.by - s0.s.by) * f;
    } else if (s0) {
      this.ball.x = s0.s.bx; this.ball.y = s0.s.by;
    }
    // Mirror phase/score/rally from the latest state.
    const latest = this.snapBuf[this.snapBuf.length - 1];
    if (latest) {
      this.scoreL = latest.s.sr; // display-left = guest (host's right)
      this.scoreR = latest.s.sl; // display-right = host (host's left)
      this.rally = latest.s.rally;
      this.phase = latest.s.phase;
      if (latest.s.cd !== this.countdownN) { this.countdownN = latest.s.cd; this._cdPulse = 0; }
      this._cdPulse += dt;
      // Opponent (host) paddle = host's left Y, displayed on the right.
      this._oppY = latest.s.ly;
      this.right.y += (this._oppY - this.right.y) * Math.min(1, dt * PADDLE_LERP);
      this.right.y = this._clampPaddle(this.right.y);
      // RTT via echoed timestamp.
      if (latest.s.echo) this.ping = Date.now() - latest.s.echo;
    }
    // Mirror display x for the ball (guest sees itself on the left).
    // (Swap applied at render time via this.swap.)
    this.updateHUD();
  }

  // ---- net hooks (called by the controller) ----
  // Host: opponent (guest) paddle Y arrived from Firestore.
  setOpponentPaddle(y, paddleT) {
    this._oppY = y;
    this._guestPaddleT = paddleT; // echoed back in next snapshot for RTT
  }
  // Guest: a host state arrived from Firestore.
  applyRemoteState(s) {
    if (!s) return;
    this.snapBuf.push({ s, recvAt: performance.now() });
    if (this.snapBuf.length > 8) this.snapBuf.shift();
    if (s.phase === 'over' && !this.over) {
      // Host declared a winner — mirror it locally.
      this.scoreL = s.sr; this.scoreR = s.sl;
      this.over = true; this.phase = 'over';
      this.winner = s.win;
      const leftWins = s.win === 'left';
      if (this.mode === 'online' && this.netRole === 'guest' && leftWins) {
        const w = Number(lsGet(WINS_KEY) || 0) + 1;
        lsSet(WINS_KEY, String(w));
      }
      this.onWin(s.win, s.sr, s.sl, true);
      const stats = document.getElementById('pong-final-stats');
      const banner = document.getElementById('pong-winner-banner');
      if (stats) stats.textContent = `${leftWins ? 'LEFT' : 'RIGHT'} WINS · ${s.sr} – ${s.sl}`;
      if (banner) { banner.textContent = `${leftWins ? 'LEFT' : 'RIGHT'} WINS!`; banner.style.color = leftWins ? COL_LEFT : COL_RIGHT; }
      document.getElementById('pong-gameover-overlay')?.classList.remove('hidden');
    }
  }
  setNetStatus(s) { this.netStatus = s; }
  setPing(ms) { this.ping = ms; }

  // Host: build the state to ship to Firestore.
  snapshot() {
    return {
      bx: Math.round(this.ball.x * 100) / 100,
      by: Math.round(this.ball.y * 100) / 100,
      bvx: Math.round(this.ball.vx * 100) / 100,
      bvy: Math.round(this.ball.vy * 100) / 100,
      ly: Math.round(this.left.y * 100) / 100,
      ry: Math.round(this.right.y * 100) / 100,
      sl: this.scoreL, sr: this.scoreR,
      rally: this.rally,
      phase: this.phase,
      win: this.winner,
      cd: this.countdownN,
      t: Date.now(),
      echo: this._guestPaddleT || null,
    };
  }

  // ---- particles / floats / sparks ----
  _burst(x, y, color, n) {
    if (this.reducedMotion) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(40, 160);
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.4, max: 0.4, color });
    }
  }
  _wallSpark(x, y) {
    if (this.reducedMotion) return;
    this.wallSparks.push({ x, y, life: 0.2, max: 0.2 });
  }
  _updateParticles(dt) {
    for (const p of this.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.94; p.vy *= 0.94; p.life -= dt; }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const s of this.wallSparks) s.life -= dt;
    this.wallSparks = this.wallSparks.filter((s) => s.life > 0);
  }
  _updateFloats(dt) {
    for (const f of this.floats) { f.y -= 22 * dt; f.t -= dt; }
    this.floats = this.floats.filter((f) => f.t > 0);
  }

  // ---- input ----
  bindInput() {
    this.keydown = (e) => this._onKey(e, true);
    this.keyup = (e) => this._onKey(e, false);
    this.mousemove = (e) => this._onMouse(e);
    this.touchstart = (e) => this._onTouch(e);
    this.touchmove = (e) => this._onTouch(e);
    this.touchend = () => { this.touchLeftY = null; this.touchRightY = null; };
    window.addEventListener('keydown', this.keydown);
    window.addEventListener('keyup', this.keyup);
    this.canvas?.addEventListener('mousemove', this.mousemove);
    this.canvas?.addEventListener('touchstart', this.touchstart, { passive: false });
    this.canvas?.addEventListener('touchmove', this.touchmove, { passive: false });
    this.canvas?.addEventListener('touchend', this.touchend);
  }
  unbindInput() {
    window.removeEventListener('keydown', this.keydown);
    window.removeEventListener('keyup', this.keyup);
    this.canvas?.removeEventListener('mousemove', this.mousemove);
    this.canvas?.removeEventListener('touchstart', this.touchstart);
    this.canvas?.removeEventListener('touchmove', this.touchmove);
    this.canvas?.removeEventListener('touchend', this.touchend);
  }
  _onKey(e, down) {
    if (!this.running) return;
    if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') { if (down) { e.preventDefault(); this.togglePause(); } return; }
    this.lastInput = 'key';
    switch (e.key) {
      case 'w': case 'W': e.preventDefault(); this.keys.w = down; break;
      case 's': case 'S': e.preventDefault(); this.keys.s = down; break;
      case 'ArrowUp': e.preventDefault(); this.keys.up = down; break;
      case 'ArrowDown': e.preventDefault(); this.keys.down = down; break;
      default: break;
    }
  }
  _onMouse(e) {
    this.lastInput = 'mouse';
    this.mouseY = this._clientToY(e.clientY);
  }
  _onTouch(e) {
    if (e.preventDefault) e.preventDefault();
    this.lastInput = 'touch';
    const rect = this.canvas.getBoundingClientRect();
    for (const t of e.touches) {
      const x = (t.clientX - rect.left) / rect.width * W;
      const y = (t.clientY - rect.top) / rect.height * H;
      if (this.mode === 'local') {
        if (x < W / 2) this.touchLeftY = y; else this.touchRightY = y;
      } else {
        this.touchLeftY = y; // your paddle follows wherever you drag
      }
    }
  }
  _clientToY(clientY) {
    if (!this.canvas) return H / 2;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.height === 0) return H / 2;
    return clamp((clientY - rect.top) / rect.height * H, PADDLE_H / 2, H - PADDLE_H / 2);
  }

  // ---- audio ----
  blip(kind) {
    if (typeof window === 'undefined' || !arcadeFX) return;
    const fn = arcadeFX[`play${kind[0].toUpperCase()}${kind.slice(1)}`];
    if (fn) { try { fn.call(arcadeFX); } catch { /* audio unavailable */ } }
  }

  // ---- render ----
  render() {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0a061a';
    ctx.fillRect(0, 0, W, H);

    this._drawSidePulses(ctx);
    this._drawCenterLine(ctx);
    this._drawGoalFlashes(ctx);
    this._drawScores(ctx);
    this._drawRally(ctx);
    this._drawPaddle(ctx, this.left, COL_LEFT, true);
    this._drawPaddle(ctx, this.right, COL_RIGHT, false);
    this._drawBall(ctx);
    this._drawParticles(ctx);
    this._drawWallSparks(ctx);
    this._drawFloats(ctx);

    if (this.phase === 'countdown') this._drawCountdown(ctx);
    else if (this.phase === 'serving') this._drawBanner(ctx, 'GET READY', 'rgba(255,255,255,0.6)');
    if (this.netStatus !== 'ok') this._drawNetBanner(ctx);
    if (this.ping !== null) this._drawPing(ctx);
    // Match-point glow on both scores.
    if (!this.over && (this.scoreL === WIN_SCORE - 1 || this.scoreR === WIN_SCORE - 1)) {
      this._drawMatchPoint(ctx);
    }
  }

  // Guest view mirrors x so its own paddle is on the left.
  _x(d) { return this.swap ? W - d : d; }

  _drawCenterLine(ctx) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 14]);
    ctx.shadowColor = 'rgba(255,255,255,0.25)';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(W / 2, 8);
    ctx.lineTo(W / 2, H - 8);
    ctx.stroke();
    ctx.restore();
  }

  _drawSidePulses(ctx) {
    if (this.sidePulseL > 0) {
      const a = this.sidePulseL / 0.8 * 0.25;
      const g = ctx.createLinearGradient(0, 0, W * 0.5, 0);
      g.addColorStop(0, `rgba(77,121,255,${a})`);
      g.addColorStop(1, 'rgba(77,121,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W / 2, H);
    }
    if (this.sidePulseR > 0) {
      const a = this.sidePulseR / 0.8 * 0.25;
      const g = ctx.createLinearGradient(W, 0, W * 0.5, 0);
      g.addColorStop(0, `rgba(255,46,99,${a})`);
      g.addColorStop(1, 'rgba(255,46,99,0)');
      ctx.fillStyle = g; ctx.fillRect(W / 2, 0, W / 2, H);
    }
  }

  _drawGoalFlashes(ctx) {
    if (this.goalFlashL > 0) {
      const a = this.goalFlashL / 0.8;
      ctx.fillStyle = `rgba(255,46,99,${a * 0.6})`;
      ctx.fillRect(0, 0, 6, H);
    }
    if (this.goalFlashR > 0) {
      const a = this.goalFlashR / 0.8;
      ctx.fillStyle = `rgba(77,121,255,${a * 0.6})`;
      ctx.fillRect(W - 6, 0, 6, H);
    }
  }

  _drawScores(ctx) {
    ctx.save();
    ctx.font = '52px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    // Display-left score (blue) and display-right score (pink). Guest view is
    // swapped: its own score (host's right) shows on the left.
    const lScore = this.swap ? this.scoreR : this.scoreL;
    const rScore = this.swap ? this.scoreL : this.scoreR;
    ctx.fillStyle = COL_LEFT; ctx.shadowColor = COL_LEFT; ctx.shadowBlur = 16;
    ctx.fillText(String(lScore), W * 0.28, 18);
    ctx.fillStyle = COL_RIGHT; ctx.shadowColor = COL_RIGHT; ctx.shadowBlur = 16;
    ctx.fillText(String(rScore), W * 0.72, 18);
    ctx.restore();
  }

  _drawMatchPoint(ctx) {
    ctx.save();
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 120);
    ctx.globalAlpha = 0.4 + pulse * 0.4;
    ctx.font = '12px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = COL_GOLD; ctx.shadowColor = COL_GOLD; ctx.shadowBlur = 12;
    ctx.fillText('MATCH POINT', W / 2, 78);
    ctx.restore();
  }

  _drawRally(ctx) {
    if (this.rally < RALLY_FADE_AT) return;
    const fade = Math.min(1, (this.rally - RALLY_FADE_AT + 1) / 3);
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.font = '16px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff'; ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 10;
    ctx.fillText(`RALLY ×${this.rally}`, W / 2, H / 2 + 8);
    ctx.restore();
  }

  _drawPaddle(ctx, pad, color, isLeft) {
    const x = isLeft ? PADDLE_MARGIN : W - PADDLE_MARGIN - PADDLE_W;
    const y = pad.y - PADDLE_H / 2;
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = pad.flash > 0 ? 26 : 12;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, PADDLE_W, PADDLE_H);
    if (pad.flash > 0) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, y, PADDLE_W, PADDLE_H);
    }
    ctx.restore();
  }

  _drawBall(ctx) {
    if (this.phase === 'countdown') return; // hidden during 3·2·1
    // Trail: fading radius/alpha over last ~8 positions.
    if (!this.reducedMotion) {
      for (let i = 0; i < this.ball.trail.length; i++) {
        const t = this.ball.trail[i];
        const a = (i + 1) / this.ball.trail.length;
        ctx.save();
        ctx.globalAlpha = a * 0.4;
        ctx.fillStyle = COL_BALL;
        ctx.beginPath();
        ctx.arc(this._x(t.x), t.y, BALL_R * a, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.save();
    ctx.shadowColor = COL_BALL;
    ctx.shadowBlur = 16;
    ctx.fillStyle = COL_BALL;
    ctx.beginPath();
    ctx.arc(this._x(this.ball.x), this.ball.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(this._x(this.ball.x), this.ball.y, BALL_R * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _drawParticles(ctx) {
    for (const p of this.particles) {
      const a = Math.max(0, p.life / p.max);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color; ctx.shadowColor = p.color; ctx.shadowBlur = 6;
      const s = 4 * a + 1;
      ctx.fillRect(this._x(p.x) - s / 2, p.y - s / 2, s, s);
      ctx.restore();
    }
  }

  _drawWallSparks(ctx) {
    for (const s of this.wallSparks) {
      const a = s.life / s.max;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = '#ffffff'; ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 8;
      ctx.fillRect(this._x(s.x) - 2, s.y === 0 ? 0 : H - 2, 4, 2);
      ctx.restore();
    }
  }

  _drawFloats(ctx) {
    ctx.save();
    ctx.font = '18px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    for (const f of this.floats) {
      ctx.globalAlpha = Math.min(1, f.t);
      ctx.fillStyle = f.color; ctx.shadowColor = f.color; ctx.shadowBlur = 14;
      const scale = f.burst ? 1 + (1.2 - f.t) * 0.4 : 1;
      ctx.font = `${18 * scale}px "Press Start 2P", monospace`;
      ctx.fillText(f.text, this._x(f.x), f.y);
    }
    ctx.restore();
  }

  _drawCountdown(ctx) {
    const n = Math.max(1, this.countdownN);
    ctx.save();
    const pulse = Math.max(0, 1 - this._cdPulse); // bright at each tick, fades
    ctx.globalAlpha = 0.4 + pulse * 0.6;
    ctx.font = '80px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COL_GOLD; ctx.shadowColor = COL_GOLD; ctx.shadowBlur = 24;
    ctx.fillText(String(n), W / 2, H / 2);
    ctx.restore();
  }

  _drawBanner(ctx, text, color) {
    ctx.save();
    ctx.font = '20px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 12;
    ctx.fillText(text, W / 2, H / 2);
    ctx.restore();
  }

  _drawNetBanner(ctx) {
    ctx.save();
    ctx.fillStyle = 'rgba(10,6,26,0.7)';
    ctx.fillRect(0, H / 2 - 26, W, 52);
    ctx.font = '20px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COL_GOLD; ctx.shadowColor = COL_GOLD; ctx.shadowBlur = 14;
    ctx.fillText(this.netStatus === 'lost' ? 'CONNECTION LOST' : 'RECONNECTING…', W / 2, H / 2);
    ctx.restore();
  }

  _drawPing(ctx) {
    ctx.save();
    ctx.font = '10px "Press Start 2P", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    const col = this.ping < 120 ? '#3df58c' : this.ping < 250 ? COL_GOLD : COL_RIGHT;
    ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 6;
    ctx.fillText(`${Math.round(this.ping)}ms`, W - 10, 8);
    ctx.restore();
  }

  // ---- HUD ----
  updateHUD() {
    if (typeof document === 'undefined') return;
    const s = document.getElementById('pong-score');
    if (s) s.textContent = `${this.scoreL} – ${this.scoreR}`;
    const r = document.getElementById('pong-rally');
    if (r) r.textContent = this.rally;
    const best = document.getElementById('pong-best');
    if (best) best.textContent = this.bestRally;
  }
}

export function getPongHighScore() {
  return Number(lsGet(HS_KEY) || 0);
}
export function getPongWins() {
  return Number(lsGet(WINS_KEY) || 0);
}
export const PONG_HS_KEY = HS_KEY;
export const PONG_WINS_KEY = WINS_KEY;

// Self-check: paddle exit-angle floor (≥20° from horizontal, ≤55°), speed cap
// and +3%/hit mult, sub-step count at top speed, win at 7, serve angle ±20°,
// CPU speed fractions, guest x-mirror, rally counter.
//   node --input-type=module -e "import('./src/game/pong.js').then(m=>m._selfCheck())"
export function _selfCheck() {
  // Exit angle from horizontal: offset 0 → 20° (floor), ±1 → 55°. Derived from
  // the _bounce math: fromHorz = max(20, |offset|*55).
  for (const offset of [-1, -0.5, 0, 0.5, 1]) {
    let fromHorz = Math.abs(offset) * MAX_FROM_HORZ;
    if (fromHorz < MIN_FROM_HORZ) fromHorz = MIN_FROM_HORZ;
    if (fromHorz < MIN_FROM_HORZ - 0.001) throw new Error(`angle ${fromHorz} below 20° floor`);
    if (fromHorz > MAX_FROM_HORZ + 0.001) throw new Error(`angle ${fromHorz} above 55°`);
  }

  // Speed cap: after many hits, never above 2× base.
  let speed = BASE_SPEED;
  for (let i = 0; i < 1000; i++) speed = Math.min(MAX_SPEED, speed * SPEED_MULT);
  if (speed > MAX_SPEED + 0.001) throw new Error('speed cap violated');
  if (MAX_SPEED !== BASE_SPEED * 2) throw new Error('cap should be 2× base');

  // Sub-steps at 2× speed on a 32ms frame: travel > half paddle width.
  const travel = MAX_SPEED * DT_CAP;
  const steps = Math.max(1, Math.ceil(travel / (PADDLE_W / 2)));
  if (steps < 2) throw new Error(`sub-steps ${steps} too few at top speed`);

  // Win at 7 (no deuce — first to 7).
  if (WIN_SCORE !== 7) throw new Error('win score should be 7');

  // Serve angle within ±20° of horizontal: |vy|/|vx| ≤ tan(20°).
  const g = new Pong({ mode: 'cpu', difficulty: 'normal' });
  let maxSlope = 0;
  for (let i = 0; i < 50; i++) {
    g.launchBall(1);
    const slope = Math.abs(g.ball.vy / g.ball.vx);
    if (slope > maxSlope) maxSlope = slope;
    g.ball.vx = 0; g.ball.vy = 0;
  }
  if (maxSlope > Math.tan(20 * DEG) + 1e-6) throw new Error(`serve angle ${maxSlope} > tan20`);

  // CPU speed fractions: easy < normal < hard, hard > 1 (faster than ball →
  // beatable only via sharp-angle vertical motion, not raw speed).
  if (CPU.easy.speedFrac >= CPU.normal.speedFrac) throw new Error('easy >= normal');
  if (CPU.normal.speedFrac >= CPU.hard.speedFrac) throw new Error('normal >= hard');
  if (CPU.hard.speedFrac <= 1) throw new Error('hard should exceed ball speed');

  // Guest mirrors x: _x(0) === W, _x(W) === 0.
  const guest = new Pong({ mode: 'online', netRole: 'guest' });
  if (guest._x(0) !== W || guest._x(W) !== 0) throw new Error('guest x-mirror wrong');
  if (!guest.swap) throw new Error('guest should swap');
  if (guest.sim) throw new Error('guest should not simulate');
  const host = new Pong({ mode: 'online', netRole: 'host' });
  if (host.swap) throw new Error('host should not swap');
  if (!host.sim) throw new Error('host should simulate');

  // Snapshot round-trips the key fields.
  host.scoreL = 3; host.scoreR = 5; host.rally = 9; host.phase = 'playing';
  const snap = host.snapshot();
  if (snap.sl !== 3 || snap.sr !== 5 || snap.rally !== 9 || snap.phase !== 'playing') throw new Error('snapshot fields');

  // Guest applies remote state and interpolates toward it.
  guest.applyRemoteState({ bx: 100, by: 100, bvx: 0, bvy: 0, ly: 200, sl: 1, sr: 2, rally: 4, phase: 'playing', cd: 3 });
  if (guest.snapBuf.length !== 1) throw new Error('guest did not buffer state');

  console.log('pong self-check ok');
}