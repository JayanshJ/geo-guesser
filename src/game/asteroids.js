// Asteroids — complete vanilla-canvas implementation for the arcade hub.
// Vector outlines only (white/colored glowing strokes, no fills) over the dark
// starfield, like the original vector monitor. Float positions, toroidal wrap
// on all four edges, ship inertia (velocity independent of facing), and the
// iconic line-shatter death. Reuses arcadeFX for audio; high score in
// localStorage. No deps, no image assets.
import { arcadeFX } from './arcade.js';

// ---- playfield ----
const W = 600;
const H = 480;
const TICK = 1 / 60;
const DT_CAP = 0.032;

// ---- ship ----
const SHIP_R = 12;            // collision radius (slightly generous to the player)
const SHIP_NOSE = 12;         // bullet spawn distance from center
const SHIP_VERTS = [{ x: 12, y: 0 }, { x: -10, y: 8 }, { x: -10, y: -8 }];
const ROT_SPEED = 4;          // rad/s
const THRUST_ACC = 260;       // px/s² along facing
const DAMP = 0.985;           // per-tick velocity decay
const MAX_SPEED = 420;
const INVULN = 2;             // post-respawn blink invulnerability (s)
const RESPAWN_CLEAR_R = 120;  // rocks must be outside this around center

// ---- bullets ----
const BULLET_SPEED = 520;
const BULLET_R = 2;
const BULLET_LIFE = 1.1;
const MAX_BULLETS = 4;
const FIRE_CD = 0.18;

// ---- asteroids ----
const A_R = { large: 46, medium: 26, small: 14 };
const A_PTS = { large: 20, medium: 50, small: 100 };
const A_VERT_MIN = 9;
const A_VERT_MAX = 12;
const A_JITTER = 0.35;         // ±35% radius jitter
const A_VANG = 0.6;           // ±0.6 rad/s
const A_SPEED_MIN = 40;
const A_SPEED_MAX = 80;
const SPLIT_DEFLECT = (40 * Math.PI) / 180; // ±40°
const SPLIT_SPEED = 1.3;      // children +30% speed
const A_SPAWN_DIST = 180;     // min distance from ship on spawn

// ---- saucer ----
const SAUCER_THRESH = 2000;
const SAUCER_PTS = 200;
const SAUCER_SPEED = 140;
const SAUCER_R = 14;
const SAUCER_FIRE = 1.2;
const SAUCER_BULLET_SPEED = 300;
const SAUCER_MIN = 15;
const SAUCER_MAX = 25;

// ---- meta ----
const EXTRA_LIFE_EVERY = 10000;
const WAVE_PAUSE = 2;
const HS_KEY = 'geoguesser_asteroids_highscore';

const SHIP_COLOR = '#4dd8ff';
const SHIP_FILL = 'rgba(77,216,255,0.06)';
const FLAME_COLOR = '#ff8c42';
const ROCK_COLOR = { large: '#c0c8d8', medium: '#d6dbe6', small: '#eef1f7' };
const BULLET_COLOR = '#ffffff';
const SAUCER_COLOR = '#ff2e63';
const SAUCER_BULLET_COLOR = '#ff8c42';

const DEG = Math.PI / 180;

// Toroidal wrap of a position into [0,max).
const wrap = (v, max) => ((v % max) + max) % max;
// Toroidal distance between two points (handles screen wrap).
function tdist(x1, y1, x2, y2) {
  let dx = Math.abs(x1 - x2); dx = Math.min(dx, W - dx);
  let dy = Math.abs(y1 - y2); dy = Math.min(dy, H - dy);
  return Math.hypot(dx, dy);
}
const rand = (a, b) => a + Math.random() * (b - a);

function makeAsteroid(size, x, y, vx, vy) {
  const baseR = A_R[size];
  const n = A_VERT_MIN + Math.floor(Math.random() * (A_VERT_MAX - A_VERT_MIN + 1));
  const verts = [];
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;
    const r = baseR * (1 + (Math.random() - 0.5) * 2 * A_JITTER);
    verts.push({ x: Math.cos(ang) * r, y: Math.sin(ang) * r });
  }
  return {
    size, x, y, vx, vy, r: baseR, verts,
    ang: Math.random() * Math.PI * 2,
    vang: rand(-A_VANG, A_VANG),
  };
}

function splitAsteroid(a) {
  if (a.size === 'small') return [];
  const childSize = a.size === 'large' ? 'medium' : 'small';
  const out = [];
  const baseAng = Math.atan2(a.vy, a.vx);
  let sp = Math.hypot(a.vx, a.vy) * SPLIT_SPEED;
  if (sp < A_SPEED_MIN) sp = A_SPEED_MIN;
  for (let i = 0; i < 2; i++) {
    const deflect = (Math.random() * 2 - 1) * SPLIT_DEFLECT;
    const ang = baseAng + deflect;
    out.push(makeAsteroid(childSize, a.x, a.y, Math.cos(ang) * sp, Math.sin(ang) * sp));
  }
  return out;
}

export class Asteroids {
  constructor(opts = {}) {
    this.canvas = opts.canvas;
    this.ctx = this.canvas?.getContext('2d');
    this.boardFrame = opts.boardFrame;
    this.onHighScore = opts.onHighScore || (() => {});
    this.reducedMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.running = false;
    this.state = 'idle';
    this.stars = [];
    this.reset();
  }

  reset() {
    this.score = 0;
    this.wave = 1;
    this.lives = 3;
    this.extraLifeAt = EXTRA_LIFE_EVERY;
    this.ship = { x: W / 2, y: H / 2, ang: -Math.PI / 2, vx: 0, vy: 0 };
    this.invuln = INVULN;
    this.bullets = [];
    this.sBullets = [];
    this.asteroids = [];
    this.shatter = [];
    this.particles = [];
    this.floats = [];
    this.saucer = null;
    this.saucerTimer = rand(SAUCER_MIN, SAUCER_MAX);
    this.fireCd = 0;
    this.waveTimer = 0;
    this.deathTimer = 0;
    this.thrustAccum = 0;
    this.input = { rotLeft: false, rotRight: false, thrust: false, fire: false };
    this.over = false;
    this._buildStars();
    this.spawnWave(1);
  }

  _buildStars() {
    this.stars = [];
    for (let i = 0; i < 60; i++) {
      this.stars.push({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.1 + 0.3, a: Math.random() * 0.5 + 0.2, tw: Math.random() * Math.PI * 2 });
    }
  }

  spawnWave(wave) {
    this.wave = wave;
    const count = Math.min(8, 3 + wave);
    this.asteroids = [];
    for (let i = 0; i < count; i++) {
      let x; let y; let tries = 0;
      do {
        x = Math.random() * W; y = Math.random() * H; tries++;
      } while (tdist(x, y, this.ship.x, this.ship.y) < A_SPAWN_DIST && tries < 40);
      const ang = Math.random() * Math.PI * 2;
      const sp = rand(A_SPEED_MIN, A_SPEED_MAX);
      this.asteroids.push(makeAsteroid('large', x, y, Math.cos(ang) * sp, Math.sin(ang) * sp));
    }
  }

  // ---- lifecycle ----
  start() {
    if (this.running) return;
    this.running = true;
    this.reset();
    this.state = 'playing';
    this.bindInput();
    this.lastTime = performance.now();
    this.time = 0;
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
    this.time += dt;
    this.update(dt);
    this.render();
    this.rafId = requestAnimationFrame(this.loop.bind(this));
  }
  togglePause() {
    if (this.over) return;
    if (this.state === 'playing' || this.state === 'dying' || this.state === 'respawning' || this.state === 'wavepause') {
      this._prevState = this.state;
      this.state = 'paused';
      document.getElementById('asteroids-pause-overlay')?.classList.remove('hidden');
    } else if (this.state === 'paused') {
      this.hideOverlays();
      this.state = this._prevState || 'playing';
      this.lastTime = performance.now();
    }
  }
  retry() {
    this.hideOverlays();
    this.reset();
    this.state = 'playing';
    this.lastTime = performance.now();
    this.updateHUD();
  }
  hideOverlays() {
    document.getElementById('asteroids-pause-overlay')?.classList.add('hidden');
    document.getElementById('asteroids-gameover-overlay')?.classList.add('hidden');
  }

  // ---- update ----
  update(dt) {
    for (const s of this.stars) s.tw += dt * 2;
    this._updateFloats(dt);
    this._updateParticles(dt);
    if (this.shatter.length) this._updateShatter(dt);
    if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - dt);
    if (this.fireCd > 0) this.fireCd = Math.max(0, this.fireCd - dt);

    if (this.state === 'paused' || this.state === 'over') return;

    if (this.state === 'dying') {
      this.deathTimer -= dt;
      this._stepAsteroids(dt);
      this._stepSaucer(dt);
      this._stepBullets(dt);
      if (this.deathTimer <= 0) this._afterDeath();
      return;
    }
    if (this.state === 'respawning') {
      this._stepAsteroids(dt);
      this._stepSaucer(dt);
      this._stepBullets(dt);
      this._maybeRespawn();
      return;
    }
    if (this.state === 'wavepause') {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) {
        this.spawnWave(this.wave + 1);
        this.state = 'playing';
        this.updateHUD();
      }
      return;
    }

    // playing
    this._stepShip(dt);
    this._stepAsteroids(dt);
    this._stepBullets(dt);
    this._stepSaucer(dt);
    this._collide();
    this._maybeSaucer(dt);
    if (this.asteroids.length === 0 && !this.saucer) {
      this.state = 'wavepause';
      this.waveTimer = WAVE_PAUSE;
      this.blipLevelUp();
    }
    this.updateHUD();
  }

  _stepShip(dt) {
    const s = this.ship;
    const rot = (this.input.rotRight ? 1 : 0) - (this.input.rotLeft ? 1 : 0);
    s.ang += rot * ROT_SPEED * dt;
    if (this.input.thrust) {
      s.vx += Math.cos(s.ang) * THRUST_ACC * dt;
      s.vy += Math.sin(s.ang) * THRUST_ACC * dt;
      this._thrustSound(dt);
    }
    const damp = Math.pow(DAMP, dt / TICK);
    s.vx *= damp; s.vy *= damp;
    const sp = Math.hypot(s.vx, s.vy);
    if (sp > MAX_SPEED) { s.vx = s.vx / sp * MAX_SPEED; s.vy = s.vy / sp * MAX_SPEED; }
    s.x = wrap(s.x + s.vx * dt, W);
    s.y = wrap(s.y + s.vy * dt, H);
    if (this.input.fire) this.shoot();
  }

  _thrustSound(dt) {
    this.thrustAccum += dt;
    if (this.thrustAccum > 0.08) {
      this.thrustAccum = 0;
      this.sfx({ type: 'sawtooth', freq: 70, endFreq: 60, dur: 0.08, gain: 0.08 });
    }
  }

  shoot() {
    if (this.state !== 'playing') return;
    if (this.fireCd > 0) return;
    if (this.bullets.length >= MAX_BULLETS) return;
    const s = this.ship;
    const nx = wrap(s.x + Math.cos(s.ang) * SHIP_NOSE, W);
    const ny = wrap(s.y + Math.sin(s.ang) * SHIP_NOSE, H);
    const vx = Math.cos(s.ang) * BULLET_SPEED + s.vx;
    const vy = Math.sin(s.ang) * BULLET_SPEED + s.vy;
    this.bullets.push({ x: nx, y: ny, vx, vy, life: BULLET_LIFE });
    this.fireCd = FIRE_CD;
    this.sfx({ type: 'square', freq: 880, endFreq: 220, dur: 0.1, gain: 0.12 });
  }

  _stepBullets(dt) {
    for (const b of this.bullets) { b.x = wrap(b.x + b.vx * dt, W); b.y = wrap(b.y + b.vy * dt, H); b.life -= dt; }
    this.bullets = this.bullets.filter((b) => b.life > 0);
    for (const b of this.sBullets) { b.x = wrap(b.x + b.vx * dt, W); b.y = wrap(b.y + b.vy * dt, H); b.life -= dt; }
    this.sBullets = this.sBullets.filter((b) => b.life > 0);
  }

  _stepAsteroids(dt) {
    for (const a of this.asteroids) {
      a.x = wrap(a.x + a.vx * dt, W);
      a.y = wrap(a.y + a.vy * dt, H);
      a.ang += a.vang * dt;
    }
  }

  _stepSaucer(dt) {
    const s = this.saucer;
    if (!s) return;
    s.t += dt;
    s.x += s.vx * dt;
    s.y = wrap(s.baseY + Math.sin(s.t * 1.6) * 28, H);
    s.pulse += dt * 6;
    s.fireTimer -= dt;
    if (s.fireTimer <= 0 && this.state === 'playing') {
      s.fireTimer = SAUCER_FIRE;
      const tx = this.ship.x; const ty = this.ship.y;
      const jit = this.score >= 10000 ? 5 * DEG : 12 * DEG;
      const ang = Math.atan2(ty - s.y, tx - s.x) + rand(-jit, jit);
      this.sBullets.push({ x: s.x, y: s.y, vx: Math.cos(ang) * SAUCER_BULLET_SPEED, vy: Math.sin(ang) * SAUCER_BULLET_SPEED, life: 3 });
      this.sfx({ type: 'square', freq: 320, endFreq: 240, dur: 0.12, gain: 0.1 });
    }
    if (s.x < -40 || s.x > W + 40) this.saucer = null;
  }

  _maybeSaucer(dt) {
    if (this.saucer || this.score < SAUCER_THRESH) return;
    this.saucerTimer -= dt;
    if (this.saucerTimer > 0) return;
    const fromLeft = Math.random() < 0.5;
    this.saucer = {
      x: fromLeft ? -20 : W + 20,
      baseY: rand(H * 0.2, H * 0.8),
      y: 0, vx: fromLeft ? SAUCER_SPEED : -SAUCER_SPEED, t: 0, pulse: 0, fireTimer: SAUCER_FIRE,
    };
    this.saucerTimer = rand(SAUCER_MIN, SAUCER_MAX);
    this.sfx({ type: 'sawtooth', freq: 220, endFreq: 320, dur: 0.3, gain: 0.1 });
  }

  // ---- collisions ----
  _collide() {
    // player bullets vs asteroids
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      let hit = -1;
      for (let j = 0; j < this.asteroids.length; j++) {
        if (tdist(b.x, b.y, this.asteroids[j].x, this.asteroids[j].y) < this.asteroids[j].r + BULLET_R) { hit = j; break; }
      }
      if (hit >= 0) { this._killAsteroid(hit); this.bullets.splice(i, 1); }
    }
    // player bullets vs saucer
    if (this.saucer) {
      for (let i = this.bullets.length - 1; i >= 0; i--) {
        if (tdist(this.bullets[i].x, this.bullets[i].y, this.saucer.x, this.saucer.y) < SAUCER_R + BULLET_R) {
          this._killSaucer(); this.bullets.splice(i, 1);
        }
      }
    }
    // saucer bullets vs asteroids
    for (let i = this.sBullets.length - 1; i >= 0; i--) {
      const b = this.sBullets[i];
      let hit = -1;
      for (let j = 0; j < this.asteroids.length; j++) {
        if (tdist(b.x, b.y, this.asteroids[j].x, this.asteroids[j].y) < this.asteroids[j].r + BULLET_R) { hit = j; break; }
      }
      if (hit >= 0) { this._killAsteroid(hit); this.sBullets.splice(i, 1); }
    }
    // ship vs asteroids / saucer / saucer bullets
    if (this.invuln <= 0 && this.state === 'playing') {
      for (const a of this.asteroids) {
        if (tdist(this.ship.x, this.ship.y, a.x, a.y) < a.r + SHIP_R) { this._shipDie(); return; }
      }
      if (this.saucer && tdist(this.ship.x, this.ship.y, this.saucer.x, this.saucer.y) < SAUCER_R + SHIP_R) { this._shipDie(); return; }
      for (const b of this.sBullets) {
        if (tdist(this.ship.x, this.ship.y, b.x, b.y) < SHIP_R + BULLET_R) { this._shipDie(); return; }
      }
    }
  }

  _killAsteroid(j) {
    const a = this.asteroids[j];
    this.score += A_PTS[a.size];
    this._burst(a.x, a.y, ROCK_COLOR[a.size], 7);
    this.sfx({ type: 'sawtooth', freq: 200, endFreq: 60, dur: 0.18, gain: 0.14 });
    const kids = splitAsteroid(a);
    this.asteroids.splice(j, 1, ...kids);
    this._checkExtraLife();
  }

  _killSaucer() {
    this.score += SAUCER_PTS;
    this.floats.push({ x: this.saucer.x, y: this.saucer.y, text: '200', t: 1.2, color: '#ff2e63' });
    this._burst(this.saucer.x, this.saucer.y, '#ff2e63', 16);
    this.sfx({ type: 'square', freq: 880, endFreq: 120, dur: 0.3, gain: 0.18 });
    this.saucer = null;
    this._checkExtraLife();
  }

  _shipDie() {
    this.state = 'dying';
    this.deathTimer = 1.0;
    this.sfx({ type: 'sawtooth', freq: 400, endFreq: 50, dur: 0.5, gain: 0.22 });
    this._makeShatter();
    this.bullets = [];
  }

  _makeShatter() {
    const s = this.ship;
    const edges = [[0, 1], [1, 2], [2, 0]];
    this.shatter = edges.map(([i, j]) => {
      const p1 = SHIP_VERTS[i]; const p2 = SHIP_VERTS[j];
      // rotate to ship facing, translate to ship position
      const c = Math.cos(s.ang); const sn = Math.sin(s.ang);
      const w = (p) => ({ x: s.x + p.x * c - p.y * sn, y: s.y + p.x * sn + p.y * c });
      const a = w(p1); const b = w(p2);
      const mx = (a.x + b.x) / 2; const my = (a.y + b.y) / 2;
      const outAng = Math.atan2(my - s.y, mx - s.x) + rand(-0.4, 0.4);
      const sp = rand(40, 120);
      return {
        cx: mx, cy: my,
        rx1: a.x - mx, ry1: a.y - my, rx2: b.x - mx, ry2: b.y - my,
        vx: Math.cos(outAng) * sp, vy: Math.sin(outAng) * sp,
        a: 0, vang: rand(-4, 4), t: 1,
      };
    });
  }

  _updateShatter(dt) {
    for (const seg of this.shatter) {
      seg.cx += seg.vx * dt; seg.cy += seg.vy * dt;
      seg.a += seg.vang * dt;
      seg.t -= dt;
    }
    this.shatter = this.shatter.filter((s) => s.t > 0);
  }

  _afterDeath() {
    this.lives -= 1;
    if (this.lives <= 0) { this.gameOver(); return; }
    this.state = 'respawning';
    this.ship.vx = 0; this.ship.vy = 0;
  }

  _maybeRespawn() {
    for (const a of this.asteroids) {
      if (tdist(W / 2, H / 2, a.x, a.y) < RESPAWN_CLEAR_R + a.r) return;
    }
    if (this.saucer && tdist(W / 2, H / 2, this.saucer.x, this.saucer.y) < RESPAWN_CLEAR_R + SAUCER_R) return;
    // center clear → respawn
    this.ship.x = W / 2; this.ship.y = H / 2; this.ship.ang = -Math.PI / 2; this.ship.vx = 0; this.ship.vy = 0;
    this.invuln = INVULN;
    this.state = 'playing';
  }

  _checkExtraLife() {
    if (this.score >= this.extraLifeAt) {
      this.extraLifeAt += EXTRA_LIFE_EVERY;
      this.lives += 1;
      this.floats.push({ x: this.ship.x, y: this.ship.y - 20, text: 'EXTRA SHIP', t: 1.6, color: '#3df58c' });
      this.sfx({ type: 'square', freq: 660, endFreq: 1320, dur: 0.3, gain: 0.18 });
    }
  }

  gameOver() {
    this.state = 'over';
    this.over = true;
    const prev = Number(localStorage.getItem(HS_KEY) || 0);
    if (this.score > prev) {
      localStorage.setItem(HS_KEY, String(this.score));
      this.onHighScore(this.score);
    }
    const stats = document.getElementById('asteroids-final-stats');
    if (stats) stats.textContent = `SCORE ${this.score} · WAVE ${this.wave}`;
    document.getElementById('asteroids-gameover-overlay')?.classList.remove('hidden');
    this.updateHUD();
  }

  // ---- particles / floats ----
  _burst(x, y, color, n) {
    if (this.reducedMotion) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(40, 160);
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.3, 0.6), max: 0.6, color, len: rand(4, 9) });
    }
  }
  _updateParticles(dt) {
    for (const p of this.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy *= 0.96; p.life -= dt; }
    this.particles = this.particles.filter((p) => p.life > 0);
  }
  _updateFloats(dt) {
    for (const f of this.floats) { f.y -= 26 * dt; f.t -= dt; }
    this.floats = this.floats.filter((f) => f.t > 0);
  }

  // ---- input ----
  bindInput() {
    this.keydown = (e) => this._onKey(e, true);
    this.keyup = (e) => this._onKey(e, false);
    window.addEventListener('keydown', this.keydown);
    window.addEventListener('keyup', this.keyup);
    // Touch buttons (hold-to-act): pointerdown sets a flag, pointerup/cancel clears.
    this._touchBtns = Array.from(document.querySelectorAll('#asteroids-touch [data-at]'));
    this._touchDown = (e) => {
      e.preventDefault();
      const k = e.currentTarget.dataset.at;
      if (k === 'rotleft') this.input.rotLeft = true;
      else if (k === 'rotright') this.input.rotRight = true;
      else if (k === 'thrust') this.input.thrust = true;
      else if (k === 'fire') this.input.fire = true;
    };
    this._touchUp = (e) => {
      e.preventDefault();
      const k = e.currentTarget.dataset.at;
      if (k === 'rotleft') this.input.rotLeft = false;
      else if (k === 'rotright') this.input.rotRight = false;
      else if (k === 'thrust') this.input.thrust = false;
      else if (k === 'fire') this.input.fire = false;
    };
    for (const btn of this._touchBtns) {
      btn.addEventListener('pointerdown', this._touchDown);
      btn.addEventListener('pointerup', this._touchUp);
      btn.addEventListener('pointercancel', this._touchUp);
      btn.addEventListener('pointerleave', this._touchUp);
    }
  }
  unbindInput() {
    window.removeEventListener('keydown', this.keydown);
    window.removeEventListener('keyup', this.keyup);
    for (const btn of this._touchBtns || []) {
      btn.removeEventListener('pointerdown', this._touchDown);
      btn.removeEventListener('pointerup', this._touchUp);
      btn.removeEventListener('pointercancel', this._touchUp);
      btn.removeEventListener('pointerleave', this._touchUp);
    }
  }
  _onKey(e, down) {
    if (!this.running) return;
    if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') { if (down) { e.preventDefault(); this.togglePause(); } return; }
    switch (e.key) {
      case 'ArrowLeft': case 'a': case 'A': e.preventDefault(); this.input.rotLeft = down; break;
      case 'ArrowRight': case 'd': case 'D': e.preventDefault(); this.input.rotRight = down; break;
      case 'ArrowUp': case 'w': case 'W': e.preventDefault(); this.input.thrust = down; break;
      case ' ': e.preventDefault(); this.input.fire = down; break;
      default: break;
    }
  }

  // ---- audio ----
  sfx(opts) {
    if (typeof window === 'undefined' || !arcadeFX) return;
    try { arcadeFX._tone(opts); } catch { /* audio unavailable */ }
  }
  blipLevelUp() {
    [523, 659, 784, 1047].forEach((f, i) => this.sfx({ type: 'square', freq: f, dur: 0.12, gain: 0.16, delay: i * 0.09 }));
  }

  // ---- render ----
  render() {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    this._drawStars(ctx);
    this._drawAsteroids(ctx);
    if (this.state === 'dying') this._drawShatter(ctx);
    else if (this.state !== 'respawning') this._drawShip(ctx);
    this._drawBullets(ctx);
    this._drawSaucer(ctx);
    this._drawParticles(ctx);
    this._drawFloats(ctx);
    this._drawLives(ctx);
    if (this.state === 'respawning') this._drawBanner(ctx, 'GET READY', Math.floor(this.time * 3) % 2 === 0);
    if (this.state === 'wavepause') this._drawBanner(ctx, `WAVE ${this.wave + 1}`, true);
  }

  // Draw a thing at all toroidal copies that are on screen — seamless wrap.
  _drawWrapped(ctx, cx, cy, r, drawAt) {
    for (const ox of [0, -W, W]) {
      for (const oy of [0, -H, H]) {
        const x = cx + ox; const y = cy + oy;
        if (x + r >= 0 && x - r <= W && y + r >= 0 && y - r <= H) drawAt(x, y);
      }
    }
  }

  _drawStars(ctx) {
    ctx.fillStyle = '#f4f0ff';
    for (const s of this.stars) {
      ctx.globalAlpha = s.a * (0.6 + 0.4 * Math.sin(s.tw));
      ctx.fillRect(s.x, s.y, s.r * 2, s.r * 2);
    }
    ctx.globalAlpha = 1;
  }

  _drawAsteroids(ctx) {
    for (const a of this.asteroids) {
      const color = ROCK_COLOR[a.size];
      this._drawWrapped(ctx, a.x, a.y, a.r, (x, y) => {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a.ang);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.shadowColor = color;
        ctx.shadowBlur = a.size === 'small' ? 10 : a.size === 'medium' ? 8 : 6;
        ctx.beginPath();
        for (let i = 0; i < a.verts.length; i++) {
          const v = a.verts[i];
          if (i === 0) ctx.moveTo(v.x, v.y); else ctx.lineTo(v.x, v.y);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      });
    }
  }

  _drawShip(ctx) {
    if (this.invuln > 0 && Math.floor(this.time * 12) % 2 === 0) return; // blink
    const s = this.ship;
    const draw = (x, y) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(s.ang);
      // thrust flame: flicker ~60% of thrusting frames (steady under reduced-motion).
      if (this.input.thrust && (this.reducedMotion || Math.random() < 0.6)) {
        ctx.strokeStyle = FLAME_COLOR;
        ctx.lineWidth = 2;
        ctx.shadowColor = FLAME_COLOR;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.moveTo(-10, 5);
        ctx.lineTo(-10 - rand(6, 14), 0);
        ctx.lineTo(-10, -5);
        ctx.stroke();
      }
      ctx.strokeStyle = SHIP_COLOR;
      ctx.lineWidth = 2;
      ctx.shadowColor = SHIP_COLOR;
      ctx.shadowBlur = 10;
      ctx.fillStyle = SHIP_FILL;
      ctx.beginPath();
      for (let i = 0; i < SHIP_VERTS.length; i++) {
        const v = SHIP_VERTS[i];
        if (i === 0) ctx.moveTo(v.x, v.y); else ctx.lineTo(v.x, v.y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    };
    this._drawWrapped(ctx, s.x, s.y, SHIP_R + 4, draw);
  }

  _drawShatter(ctx) {
    for (const seg of this.shatter) {
      const c = Math.cos(seg.a); const sn = Math.sin(seg.a);
      const p1x = seg.cx + seg.rx1 * c - seg.ry1 * sn;
      const p1y = seg.cy + seg.rx1 * sn + seg.ry1 * c;
      const p2x = seg.cx + seg.rx2 * c - seg.ry2 * sn;
      const p2y = seg.cy + seg.rx2 * sn + seg.ry2 * c;
      ctx.save();
      ctx.globalAlpha = Math.max(0, seg.t);
      ctx.strokeStyle = SHIP_COLOR;
      ctx.lineWidth = 2;
      ctx.shadowColor = SHIP_COLOR;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(p1x, p1y);
      ctx.lineTo(p2x, p2y);
      ctx.stroke();
      ctx.restore();
    }
  }

  _drawBullets(ctx) {
    const dash = (b, color) => {
      const len = 6;
      const sp = Math.hypot(b.vx, b.vy) || 1;
      const tx = b.vx / sp; const ty = b.vy / sp;
      this._drawWrapped(ctx, b.x, b.y, BULLET_R + 4, (x, y) => {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.shadowColor = color;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - tx * len, y - ty * len);
        ctx.stroke();
        ctx.restore();
      });
    };
    for (const b of this.bullets) dash(b, BULLET_COLOR);
    for (const b of this.sBullets) dash(b, SAUCER_BULLET_COLOR);
  }

  _drawSaucer(ctx) {
    const s = this.saucer;
    if (!s) return;
    const draw = (x, y) => {
      const pulse = 10 + Math.sin(s.pulse) * 6;
      ctx.save();
      ctx.translate(x, y);
      ctx.strokeStyle = SAUCER_COLOR;
      ctx.lineWidth = 2;
      ctx.shadowColor = SAUCER_COLOR;
      ctx.shadowBlur = pulse;
      // body ellipse
      ctx.beginPath();
      ctx.ellipse(0, 0, 16, 5, 0, 0, Math.PI * 2);
      ctx.stroke();
      // dome
      ctx.beginPath();
      ctx.arc(0, -2, 7, Math.PI, Math.PI * 2);
      ctx.stroke();
      // center line
      ctx.beginPath();
      ctx.moveTo(-16, 0); ctx.lineTo(16, 0);
      ctx.stroke();
      ctx.restore();
    };
    this._drawWrapped(ctx, s.x, s.y, SAUCER_R + 4, draw);
  }

  _drawParticles(ctx) {
    for (const p of this.particles) {
      const a = Math.max(0, p.life / p.max);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 2;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 6;
      const sp = Math.hypot(p.vx, p.vy) || 1;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - (p.vx / sp) * p.len, p.y - (p.vy / sp) * p.len);
      ctx.stroke();
      ctx.restore();
    }
  }

  _drawFloats(ctx) {
    ctx.save();
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    for (const f of this.floats) {
      ctx.globalAlpha = Math.min(1, f.t);
      ctx.fillStyle = f.color;
      ctx.shadowColor = f.color;
      ctx.shadowBlur = 8;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.restore();
  }

  _drawLives(ctx) {
    for (let i = 0; i < this.lives - 1; i++) {
      ctx.save();
      ctx.translate(18 + i * 22, H - 18);
      ctx.rotate(-Math.PI / 2);
      ctx.scale(0.7, 0.7);
      ctx.strokeStyle = SHIP_COLOR;
      ctx.lineWidth = 2;
      ctx.shadowColor = SHIP_COLOR;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.moveTo(12, 0); ctx.lineTo(-10, 8); ctx.lineTo(-10, -8);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
  }

  _drawBanner(ctx, text, visible) {
    if (!visible) return;
    ctx.save();
    ctx.font = 'bold 26px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#4dd8ff';
    ctx.shadowColor = '#4dd8ff';
    ctx.shadowBlur = 18;
    ctx.fillText(text, W / 2, H / 2);
    ctx.restore();
  }

  updateHUD() {
    if (typeof document === 'undefined') return;
    const s = document.getElementById('asteroids-score'); if (s) s.textContent = this.score.toLocaleString();
    const h = document.getElementById('asteroids-hi'); if (h) h.textContent = Number(localStorage.getItem(HS_KEY) || 0).toLocaleString();
    const w = document.getElementById('asteroids-wave'); if (w) w.textContent = this.wave;
  }
}

export function getAsteroidsHighScore() {
  return Number(localStorage.getItem(HS_KEY) || 0);
}

export const ASTEROIDS_HS_KEY = HS_KEY;

// Self-check: asteroid polygon shape, split rules, child velocity, damping,
// speed cap, bullet cap/lifetime, wave count, spawn distance, saucer threshold.
//   node --input-type=module -e "import('./src/game/asteroids.js').then(m=>m._selfCheck())"
export function _selfCheck() {
  // asteroid: 9-12 verts, ±35% jitter, vang ±0.6, never a circle (jitter applied).
  for (let i = 0; i < 30; i++) {
    const a = makeAsteroid('large', 10, 10, 1, 0);
    if (a.verts.length < A_VERT_MIN || a.verts.length > A_VERT_MAX) throw new Error('vert count');
    if (Math.abs(a.vang) > A_VANG) throw new Error('vang range');
    let allSame = true;
    const r0 = Math.hypot(a.verts[0].x, a.verts[0].y);
    for (const v of a.verts) {
      const r = Math.hypot(v.x, v.y);
      if (Math.abs(r - r0) > 0.001) allSame = false;
      if (r < A_R.large * (1 - A_JITTER) - 0.01 || r > A_R.large * (1 + A_JITTER) + 0.01) throw new Error('jitter out of range');
    }
    if (allSame) throw new Error('asteroid is a perfect circle (no jitter)');
  }

  // split: large→2 medium, medium→2 small, small→0.
  let a = makeAsteroid('large', 0, 0, 60, 0);
  let kids = splitAsteroid(a);
  if (kids.length !== 2 || kids[0].size !== 'medium') throw new Error('large split');
  a = makeAsteroid('medium', 0, 0, 60, 0);
  kids = splitAsteroid(a);
  if (kids.length !== 2 || kids[0].size !== 'small') throw new Error('medium split');
  a = makeAsteroid('small', 0, 0, 60, 0);
  if (splitAsteroid(a).length !== 0) throw new Error('small should not split');

  // child speed = parent * 1.3, deflection within ±40°.
  a = makeAsteroid('large', 0, 0, 100, 0);
  kids = splitAsteroid(a);
  for (const k of kids) {
    const sp = Math.hypot(k.vx, k.vy);
    if (sp < 100 * SPLIT_SPEED - 0.5 || sp > 100 * SPLIT_SPEED + 0.5) throw new Error('child speed');
    const ang = Math.atan2(k.vy, k.vx);
    if (Math.abs(ang) > SPLIT_DEFLECT + 0.001) throw new Error('child deflection');
  }

  // damping reduces speed; speed cap clamps to MAX_SPEED.
  const g = new Asteroids({});
  g.ship.vx = 100; g.ship.vy = 0;
  g._stepShip(1 / 60);
  if (Math.hypot(g.ship.vx, g.ship.vy) >= 100) throw new Error('no damping');
  g.ship.vx = 1000; g.ship.vy = 0;
  g._stepShip(1 / 60);
  if (Math.hypot(g.ship.vx, g.ship.vy) > MAX_SPEED + 0.5) throw new Error('no speed cap');

  // bullet cap 4 + lifetime 1.1.
  g.reset(); g.state = 'playing';
  for (let i = 0; i < 20; i++) { g.fireCd = 0; g.shoot(); }
  if (g.bullets.length !== MAX_BULLETS) throw new Error(`bullet cap ${g.bullets.length}`);
  if (g.bullets[0].life !== BULLET_LIFE) throw new Error('bullet lifetime');

  // wave count: wave1=4, grows, cap 8.
  g.reset();
  if (g.asteroids.length !== 4) throw new Error(`wave1 count ${g.asteroids.length}`);
  // all wave-1 rocks ≥180px from the centered ship.
  for (const a2 of g.asteroids) if (tdist(a2.x, a2.y, g.ship.x, g.ship.y) < A_SPAWN_DIST) throw new Error('spawn too close');
  g.spawnWave(6);
  if (g.asteroids.length !== 8) throw new Error('wave cap 8');

  // saucer only above threshold.
  g.reset(); g.score = 0; g.saucer = null; g.saucerTimer = 0;
  g._maybeSaucer(0.01);
  if (g.saucer !== null) throw new Error('saucer before threshold');
  g.score = SAUCER_THRESH; g.saucerTimer = 0;
  g._maybeSaucer(0.01);
  if (g.saucer === null) throw new Error('saucer did not spawn at threshold');

  // extra life every 10000.
  g.reset();
  g.score = 9999; g._checkExtraLife(); if (g.lives !== 3) throw new Error('premature extra life');
  g.score = 10000; g._checkExtraLife(); if (g.lives !== 4) throw new Error('no extra life');
  g.score = 20000; g._checkExtraLife(); if (g.lives !== 5) throw new Error('second extra life');

  console.log('asteroids self-check ok');
}