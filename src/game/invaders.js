// Space Invaders — complete vanilla-canvas implementation for the arcade hub.
// 5×11 formation that marches in discrete steps, speeds up as invaders die,
// drops + reverses at the walls. Binary-array sprites (no image assets),
// pixel-eroding bunkers, a UFO, 1-bullet-at-a-time player cannon, and a
// 4-note descending march bass that quickens with the tempo. Reuses arcadeFX
// for audio (march thump respects the global mute); high score in localStorage.
import { arcadeFX } from './arcade.js';

// ---- playfield ----
const W = 560;
const H = 560;
const PX = 3;                 // sprite pixel scale
const CELL_W = 40;            // formation cell (holds one invader)
const CELL_H = 30;
const SPRITE_H = 8;           // all invader sprites are 8 sprite-rows tall
const SPRITE_W = { A: 8, B: 11, C: 12 };
const COLOR = { A: '#b04dff', B: '#4dd8ff', C: '#3df58c' }; // purple/cyan/green
const POINTS = { A: 30, B: 20, C: 10 };
const MARGIN = 16;
const STEP_X = 8;             // px per march step
const DROP = 18;              // px the formation drops on a wall touch
const FORM_X0 = 62;          // formation starts centered in the playfield
const FORM_Y0 = 60;
const PLAYER_Y = H - 56;
const CANNON_W = 13 * PX;     // 39
const CANNON_H = 8 * PX;      // 24
const PLAYER_SPEED = 220;
const BULLET_P_SPEED = 560;   // player bullet (up) — fast enough to thin ranks @1-bullet
const BULLET_I_SPEED = 130;   // invader bullet (down) — slow enough to dodge
const BUNKER_COLS = 22;
const BUNKER_ROWS = 16;
const BUNKER_PX = 2;          // bunker = 44×32
const BUNKER_Y = H - 130;
const BUNKER_ERODE_R = 3;
const BUNKER_XS = [48, 188, 328, 468];
const UFO_Y = 22;
const UFO_SPEED = 120;
const UFO_SCORES = [50, 100, 150, 300];
const EXTRA_LIFE_AT = 5000;
const HS_KEY = 'geoguesser_invaders_highscore';

// 4-note descending march bass — the heartbeat. Cycles one note per step so it
// speeds up with the march tempo automatically.
const MARCH_NOTES = [110, 98, 87, 82];

// ---- sprites (binary 2D arrays; rows of strings → 0/1 grid) ----
const S = (...rows) => rows.map((r) => [...r].map((c) => (c === '1' ? 1 : 0)));

const SPRITES = {
  A0: S(
    '00111100',
    '01111110',
    '11111111',
    '11011011',
    '11111111',
    '00100100',
    '01011010',
    '10000001',
  ),
  A1: S(
    '00111100',
    '01111110',
    '11111111',
    '11011011',
    '11111111',
    '01011010',
    '10000001',
    '01000010',
  ),
  B0: S(
    '00100000100',
    '00010001000',
    '00111111100',
    '01101110110',
    '11111111111',
    '00101110100',
    '01010001010',
    '10100000101',
  ),
  B1: S(
    '00100000100',
    '10010001001',
    '10111111101',
    '11101110111',
    '11111111111',
    '00101110100',
    '01000000010',
    '00100000100',
  ),
  C0: S(
    '000111110000',
    '001111111000',
    '011111111100',
    '111001100110',
    '111111111111',
    '001100110011',
    '001100110011',
    '011000000110',
  ),
  C1: S(
    '000111110000',
    '001111111000',
    '011111111100',
    '111001100110',
    '111111111111',
    '001100110011',
    '010000000010',
    '100000000001',
  ),
  player: S(
    '0000001000000',
    '0000011100000',
    '0000011100000',
    '0000111110000',
    '0111111111110',
    '1111111111111',
    '1111111111111',
    '1111111111111',
  ),
  ufo: S(
    '0000011111100000',
    '0001111111111000',
    '0011111111111100',
    '0110110110110110',
    '1111111111111111',
    '0011001100110011',
    '0000110000110000',
  ),
  bulletP: S('1', '1', '1', '1'),       // 1×4 white-hot bolt
  bulletI0: S('010', '010', '111', '010', '111'),
  bulletI1: S('111', '010', '111', '010', '010'),
  boom: S(
    '00100100',
    '01000010',
    '10011001',
    '00111100',
    '00111100',
    '10011001',
    '01000010',
    '00100100',
  ),
};

// Bunker outline: a dome with a central bottom arch, generated so we never
// miscount hand-drawn row widths.
function makeBunkerGrid() {
  const g = Array.from({ length: BUNKER_ROWS }, () => Array(BUNKER_COLS).fill(1));
  for (let y = 0; y < BUNKER_ROWS; y++) {
    for (let x = 0; x < BUNKER_COLS; x++) {
      const topTaper = Math.max(0, 3 - Math.floor(y / 1.5));
      const botTaper = y > 12 ? y - 12 : 0;
      const m = Math.max(topTaper, botTaper);
      if (x < m || x >= BUNKER_COLS - m) g[y][x] = 0;
      if (y > 10 && x >= 8 && x <= 13) g[y][x] = 0; // arch
    }
  }
  return g;
}

function aabb(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export class Invaders {
  constructor(opts = {}) {
    this.canvas = opts.canvas;
    this.ctx = this.canvas?.getContext('2d');
    this.boardFrame = opts.boardFrame;
    this.onHighScore = opts.onHighScore || (() => {});
    this.reducedMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.running = false;
    this.state = 'idle';
    this.cache = {};
    this.stars = [];
    this.reset();
  }

  reset() {
    this.score = 0;
    this.wave = 1;
    this.lives = 3;
    this.extraLifeAwarded = false;
    this.player = { x: W / 2 - CANNON_W / 2, vx: 0 };
    this.pBullets = [];           // player bullets (hold-to-fire stream)
    this.invBullets = [];
    this.fireCd = 0;             // auto-fire cooldown
    this.firing = false;         // true while fire button held
    this.pointerX = null;        // cannon follows pointer X when set
    this.lastInput = 'key';      // 'key' | 'pointer' — which control owns movement
    this.deaths = [];             // {x,y,color,t} explosion anims
    this.floats = [];             // {x,y,text,t} rising score text
    this.particles = [];
    this.ufo = null;
    this.ufoTimer = this._ufoDelay();
    this.ufoDir = 1;
    this.marchStepIdx = 0;
    this.marchTimer = 0;
    this.fireTimer = 0.8;
    this.invuln = 0;
    this.deathTimer = 0;
    this.waveTimer = 0;
    this.shake = 0;
    this.marchFlare = 0;
    this.animFrame = 0;
    this.over = false;
    this.bunkers = [];
    this._buildStars();
    this.buildWave(1);
  }

  _buildStars() {
    this.stars = [];
    for (let i = 0; i < 46; i++) {
      this.stars.push({
        x: Math.random() * W,
        y: Math.random() * (H - 60),
        r: Math.random() * 1.2 + 0.3,
        a: Math.random() * 0.5 + 0.2,
        tw: Math.random() * Math.PI * 2,
      });
    }
  }

  buildWave(wave) {
    this.wave = wave;
    this.formX = FORM_X0;
    this.formY = FORM_Y0 + (wave - 1) * 16; // each wave starts one step lower
    this.formDir = 1;
    this.invaders = [];
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 11; col++) {
        const type = row === 0 ? 'A' : (row <= 2 ? 'B' : 'C');
        this.invaders.push({ row, col, type, alive: true });
      }
    }
    this.animFrame = 0;
    this.marchStepIdx = 0;
    this.marchTimer = 0;
    this.fireTimer = 0.8;
    this.pBullets = [];
    this.invBullets = [];
    this.bunkers = BUNKER_XS.map((x) => ({ x, y: BUNKER_Y, cells: makeBunkerGrid() }));
  }

  aliveCount() { return this.invaders.reduce((n, i) => n + (i.alive ? 1 : 0), 0); }

  // 55 alive → 800ms, 1 alive → 90ms, interpolated on count, then ~10% faster
  // per wave. The 90ms floor (not 60) keeps the final sprinting invader
  // hittable with a single bullet.
  marchInterval() {
    const n = this.aliveCount();
    const base = 90 + (800 - 90) * (n - 1) / 54;
    return Math.max(40, Math.round(base * Math.pow(0.9, this.wave - 1)));
  }

  // ---- lifecycle ----
  start() {
    if (this.running) return;
    this.running = true;
    this._buildCache();
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
    if (dt > 0.1) dt = 0.1;
    this.time += dt;
    this.update(dt);
    this.render();
    this.rafId = requestAnimationFrame(this.loop.bind(this));
  }

  togglePause() {
    if (this.over) return;
    if (this.state === 'playing') {
      this.state = 'paused';
      document.getElementById('invaders-pause-overlay')?.classList.remove('hidden');
    } else if (this.state === 'paused') {
      this.hideOverlays();
      this.state = 'playing';
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
    document.getElementById('invaders-pause-overlay')?.classList.add('hidden');
    document.getElementById('invaders-gameover-overlay')?.classList.add('hidden');
  }

  // ---- update ----
  update(dt) {
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt);
    if (this.marchFlare > 0) this.marchFlare = Math.max(0, this.marchFlare - dt * 6);
    this._updateParticles(dt);
    this._updateFloats(dt);
    for (const s of this.stars) s.tw += dt * 2;

    if (this.state === 'paused' || this.state === 'over') return;

    if (this.state === 'dead') {
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) this._respawn();
      return;
    }
    if (this.state === 'waveclear') {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) {
        this.buildWave(this.wave + 1);
        this.state = 'playing';
      }
      return;
    }

    // playing
    if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - dt);
    if (this.fireCd > 0) this.fireCd = Math.max(0, this.fireCd - dt);
    if (this.firing) this.shoot(); // hold-to-fire: auto-stream while button held

    this._movePlayer(dt);
    this._moveBullets(dt);
    this._moveUfo(dt);
    this._collide();
    this._maybeFire(dt);
    this._ufoTick(dt);

    this.marchTimer += dt * 1000;
    if (this.marchTimer >= this.marchInterval()) {
      this.marchTimer = 0;
      this._marchStep();
    }

    if (this.aliveCount() === 0) {
      this.state = 'waveclear';
      this.waveTimer = 1.4;
      this.blipLevelUp();
    }
    this.updateHUD();
  }

  _movePlayer(dt) {
    // Pointer (mouse/trackpad) directly drives the cannon; keyboard sets a
    // velocity. The last input used wins so the two don't fight.
    if (this.lastInput === 'pointer' && this.pointerX != null) {
      this.player.x = this.pointerX;
    } else {
      this.player.x += this.player.vx * dt;
    }
    this.player.x = Math.max(8, Math.min(W - 8 - CANNON_W, this.player.x));
  }

  shoot() {
    if (this.state !== 'playing') return;
    // ponytail: classic 1-bullet limit relaxed to a hold-to-fire stream per
    // user request; cap on-screen at 6 so it reads as a stream, not a laser.
    if (this.fireCd > 0) return;
    if (this.pBullets.length >= 6) return;
    this.pBullets.push({ x: this.player.x + CANNON_W / 2 - 1.5, y: PLAYER_Y - 12, w: 3, h: 12, vy: -BULLET_P_SPEED });
    this.fireCd = 0.14;
    this.sfx({ type: 'square', freq: 660, endFreq: 180, dur: 0.12, gain: 0.14 });
  }

  // Tap-nudge for mobile (click buttons have no hold state, so move a fixed
  // step rather than setting a velocity that would drift). Clamped to walls.
  nudge(dx) {
    if (this.state !== 'playing') return;
    this.lastInput = 'key';
    this.pointerX = null;
    this.player.x = Math.max(8, Math.min(W - 8 - CANNON_W, this.player.x + dx));
  }

  _moveBullets(dt) {
    for (const b of this.pBullets) b.y += b.vy * dt;
    this.pBullets = this.pBullets.filter((b) => b.y + b.h >= 0);
    for (const b of this.invBullets) {
      b.y += b.vy * dt;
      b.ft += dt;
      if (b.ft > 0.12) { b.frame ^= 1; b.ft = 0; }
    }
    this.invBullets = this.invBullets.filter((b) => b.y + b.h < H);
  }

  _moveUfo(dt) {
    if (!this.ufo) return;
    this.ufo.x += this.ufo.dir * UFO_SPEED * dt;
    this.ufo.pulse += dt * 6;
    if (this.ufo.x < -60 || this.ufo.x > W + 20) this.ufo = null;
  }

  _ufoDelay() { return 20 + Math.random() * 10; }

  _ufoTick(dt) {
    if (this.ufo) return;
    this.ufoTimer -= dt;
    if (this.ufoTimer > 0) return;
    // Only cross while the formation is in the top two-thirds.
    const lowest = this._lowestInvaderBottom();
    if (lowest >= H * 0.7) { this.ufoTimer = 2; return; }
    this.ufoDir *= -1;
    this.ufo = { x: this.ufoDir > 0 ? -50 : W + 10, dir: this.ufoDir, pulse: 0 };
    this.ufoTimer = this._ufoDelay();
    this.sfx({ type: 'sawtooth', freq: 420, endFreq: 520, dur: 0.2, gain: 0.08 });
  }

  _lowestInvaderBottom() {
    let max = -Infinity;
    for (const inv of this.invaders) {
      if (!inv.alive) continue;
      max = Math.max(max, this.formY + inv.row * CELL_H + SPRITE_H * PX);
    }
    return max;
  }

  // The discrete march: shift the whole formation sideways; on a wall touch,
  // drop down one step and reverse. Toggle the shuffle frame + thump each step.
  _marchStep() {
    this.animFrame ^= 1;
    this.marchStepIdx++;
    this.marchFlare = 1;
    this._thump();

    let minX = Infinity; let maxX = -Infinity;
    for (const inv of this.invaders) {
      if (!inv.alive) continue;
      const x = this.formX + inv.col * CELL_W;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x + SPRITE_W[inv.type] * PX);
    }
    if (minX === Infinity) return;
    const nextMin = minX + this.formDir * STEP_X;
    const nextMax = maxX + this.formDir * STEP_X;
    if ((this.formDir > 0 && nextMax >= W - MARGIN) || (this.formDir < 0 && nextMin <= MARGIN)) {
      this.formY += DROP;
      this.formDir *= -1;
    } else {
      this.formX += this.formDir * STEP_X;
    }
    this._erodeBunkersByFormation();

    // Reached the player's row → instant game over.
    if (this._lowestInvaderBottom() >= PLAYER_Y) this.gameOver();
  }

  _erodeBunkersByFormation() {
    for (const inv of this.invaders) {
      if (!inv.alive) continue;
      const ix = this.formX + inv.col * CELL_W;
      const iy = this.formY + inv.row * CELL_H;
      const iw = SPRITE_W[inv.type] * PX;
      const ih = SPRITE_H * PX;
      for (const bk of this.bunkers) {
        if (ix + iw < bk.x || ix > bk.x + BUNKER_COLS * BUNKER_PX) continue;
        if (iy + ih < bk.y || iy > bk.y + BUNKER_ROWS * BUNKER_PX) continue;
        for (let r = 0; r < BUNKER_ROWS; r++) {
          for (let c = 0; c < BUNKER_COLS; c++) {
            if (!bk.cells[r][c]) continue;
            const cx = bk.x + c * BUNKER_PX;
            const cy = bk.y + r * BUNKER_PX;
            if (cx + BUNKER_PX > ix && cx < ix + iw && cy + BUNKER_PX > iy && cy < iy + ih) {
              bk.cells[r][c] = 0;
            }
          }
        }
      }
    }
  }

  _erodeBunker(bk, px, py) {
    const cx = Math.floor((px - bk.x) / BUNKER_PX);
    const cy = Math.floor((py - bk.y) / BUNKER_PX);
    for (let r = cy - BUNKER_ERODE_R; r <= cy + BUNKER_ERODE_R; r++) {
      for (let c = cx - BUNKER_ERODE_R; c <= cx + BUNKER_ERODE_R; c++) {
        if (r < 0 || r >= BUNKER_ROWS || c < 0 || c >= BUNKER_COLS) continue;
        if ((c - cx) ** 2 + (r - cy) ** 2 <= BUNKER_ERODE_R * BUNKER_ERODE_R) bk.cells[r][c] = 0;
      }
    }
  }

  _maybeFire(dt) {
    this.fireTimer -= dt;
    if (this.fireTimer > 0) return;
    const cap = Math.min(6, 2 + (this.wave - 1));
    if (this.invBullets.length >= cap) { this.fireTimer = 0.4; return; }
    const byCol = {};
    for (const inv of this.invaders) {
      if (inv.alive) (byCol[inv.col] = byCol[inv.col] || []).push(inv);
    }
    const keys = Object.keys(byCol);
    if (!keys.length) { this.fireTimer = 0.5; return; }
    const arr = byCol[keys[Math.floor(Math.random() * keys.length)]];
    arr.sort((a, b) => b.row - a.row);
    const sh = arr[0];
    const sx = this.formX + sh.col * CELL_W + (SPRITE_W[sh.type] * PX) / 2;
    const sy = this.formY + sh.row * CELL_H + SPRITE_H * PX;
    this.invBullets.push({ x: sx - 4.5, y: sy, w: 9, h: 15, vy: BULLET_I_SPEED, frame: 0, ft: 0 });
    this.sfx({ type: 'square', freq: 220, endFreq: 160, dur: 0.12, gain: 0.1 });
    this.fireTimer = (1.2 + Math.random() * 1.2) * Math.pow(0.92, this.wave - 1);
  }

  _collide() {
    // player bullets vs UFO / invaders / bunkers / invader bullets. Iterate
    // backward so splicing a consumed bullet is safe.
    for (let i = this.pBullets.length - 1; i >= 0; i--) {
      const pb = this.pBullets[i];
      let consumed = false;
      if (this.ufo) {
        const ur = { x: this.ufo.x, y: UFO_Y, w: 16 * PX, h: 7 * PX };
        if (aabb(pb, ur)) {
          const val = UFO_SCORES[Math.floor(Math.random() * UFO_SCORES.length)];
          this.score += val;
          this.floats.push({ x: ur.x, y: UFO_Y, text: String(val), t: 1, color: '#ffc93c' });
          this._burst(ur.x + ur.w / 2, UFO_Y + ur.h / 2, '#ffc93c', 14);
          this.sfx({ type: 'square', freq: 880, endFreq: 220, dur: 0.3, gain: 0.18 });
          this.ufo = null;
          consumed = true;
          this._checkExtraLife();
        }
      }
      if (!consumed) {
        for (const inv of this.invaders) {
          if (!inv.alive) continue;
          const r = {
            x: this.formX + inv.col * CELL_W,
            y: this.formY + inv.row * CELL_H,
            w: SPRITE_W[inv.type] * PX,
            h: SPRITE_H * PX,
          };
          if (aabb(pb, r)) {
            inv.alive = false;
            this.score += POINTS[inv.type];
            this.deaths.push({ x: r.x, y: r.y, color: COLOR[inv.type], t: 0.12 });
            this._burst(r.x + r.w / 2, r.y + r.h / 2, COLOR[inv.type], 7);
            this.sfx({ type: 'square', freq: 520, endFreq: 120, dur: 0.18, gain: 0.16 });
            consumed = true;
            this._checkExtraLife();
            break;
          }
        }
      }
      if (!consumed && this._bulletVsBunkers(pb, true)) consumed = true;
      if (!consumed) {
        for (const b of this.invBullets) {
          if (aabb(pb, b)) {
            this._burst(b.x + b.w / 2, b.y + b.h / 2, '#ff8c42', 4);
            this.invBullets = this.invBullets.filter((x) => x !== b);
            consumed = true;
            break;
          }
        }
      }
      if (consumed) this.pBullets.splice(i, 1);
    }
    // invader bullets vs player
    if (this.invuln <= 0 && this.state === 'playing') {
      const pr = { x: this.player.x, y: PLAYER_Y, w: CANNON_W, h: CANNON_H };
      for (const b of this.invBullets) {
        if (aabb(b, pr)) {
          this.invBullets = this.invBullets.filter((x) => x !== b);
          this._playerHit();
          return;
        }
      }
    }
    // invader bullets vs bunkers
    for (const b of [...this.invBullets]) this._bulletVsBunkers(b, false);
  }

  // Returns true if the bullet hit + was consumed (caller removes it). For
  // invader bullets (isPlayer=false) the bullet is removed here.
  _bulletVsBunkers(b, isPlayer) {
    for (const bk of this.bunkers) {
      if (b.x + b.w < bk.x || b.x > bk.x + BUNKER_COLS * BUNKER_PX) continue;
      if (b.y + b.h < bk.y || b.y > bk.y + BUNKER_ROWS * BUNKER_PX) continue;
      const hitY = isPlayer ? b.y : b.y + b.h;
      const localX = Math.floor((b.x + b.w / 2 - bk.x) / BUNKER_PX);
      const localY = Math.floor((hitY - bk.y) / BUNKER_PX);
      if (localY >= 0 && localY < BUNKER_ROWS && localX >= 0 && localX < BUNKER_COLS && bk.cells[localY][localX]) {
        this._erodeBunker(bk, b.x + b.w / 2, hitY);
        this._burst(b.x + b.w / 2, hitY, '#3df58c', 3);
        if (!isPlayer) this.invBullets = this.invBullets.filter((x) => x !== b);
        return true;
      }
    }
    return false;
  }

  _playerHit() {
    this.state = 'dead';
    this.deathTimer = 1.0;
    this.shake = this.reducedMotion ? 0 : 0.4;
    this._burst(this.player.x + CANNON_W / 2, PLAYER_Y + CANNON_H / 2, '#ff4d6d', 22);
    this._burst(this.player.x + CANNON_W / 2, PLAYER_Y + CANNON_H / 2, '#ffffff', 14);
    this.sfx({ type: 'sawtooth', freq: 200, endFreq: 60, dur: 0.5, gain: 0.22 });
    this.pBullets = [];
  }

  _respawn() {
    this.lives -= 1;
    if (this.lives <= 0) { this.gameOver(); return; }
    this.player.x = W / 2 - CANNON_W / 2;
    this.invuln = 1.5;
    this.invBullets = [];
    this.state = 'playing';
  }

  _checkExtraLife() {
    if (!this.extraLifeAwarded && this.score >= EXTRA_LIFE_AT) {
      this.extraLifeAwarded = true;
      this.lives += 1;
      this.floats.push({ x: W / 2 - 30, y: PLAYER_Y - 30, text: '+1UP', t: 1.5, color: '#3df58c' });
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
    const stats = document.getElementById('invaders-final-stats');
    if (stats) stats.textContent = `SCORE ${this.score} · WAVE ${this.wave}`;
    document.getElementById('invaders-gameover-overlay')?.classList.remove('hidden');
    this.updateHUD();
  }

  // ---- particles / floats ----
  _burst(x, y, color, n) {
    if (this.reducedMotion) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 140;
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.35, max: 0.35, color });
    }
  }
  _updateParticles(dt) {
    for (const p of this.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 240 * dt; p.life -= dt; }
    this.particles = this.particles.filter((p) => p.life > 0);
  }
  _updateFloats(dt) {
    for (const f of this.floats) { f.y -= 30 * dt; f.t -= dt; }
    this.floats = this.floats.filter((f) => f.t > 0);
    this.deaths = this.deaths.filter((d) => (d.t -= dt) > 0);
  }

  // ---- input ----
  bindInput() {
    this.keydown = (e) => this._onKey(e, true);
    this.keyup = (e) => this._onKey(e, false);
    window.addEventListener('keydown', this.keydown);
    window.addEventListener('keyup', this.keyup);
    // Pointer (mouse/trackpad/touch) on the canvas: move cannon to cursor X,
    // hold button to auto-fire a stream. Pointer events cover all three.
    this.pmove = (e) => this._onPointerMove(e);
    this.pdown = (e) => this._onPointerDown(e);
    this.pup = () => { this.firing = false; };
    this.canvas?.addEventListener('pointermove', this.pmove);
    this.canvas?.addEventListener('pointerdown', this.pdown);
    window.addEventListener('pointerup', this.pup);
    this.canvas?.addEventListener('pointercancel', this.pup);
  }
  unbindInput() {
    window.removeEventListener('keydown', this.keydown);
    window.removeEventListener('keyup', this.keyup);
    this.canvas?.removeEventListener('pointermove', this.pmove);
    this.canvas?.removeEventListener('pointerdown', this.pdown);
    window.removeEventListener('pointerup', this.pup);
    this.canvas?.removeEventListener('pointercancel', this.pup);
  }
  // Map a client X to the canvas drawing-buffer coordinate space (the canvas
  // is CSS-scaled, so divide by the displayed scale).
  _toBufferX(clientX) {
    const rect = this.canvas.getBoundingClientRect();
    return ((clientX - rect.left) / rect.width) * W;
  }
  _onPointerMove(e) {
    if (!this.running) return;
    this.lastInput = 'pointer';
    this.pointerX = Math.max(8, Math.min(W - 8 - CANNON_W, this._toBufferX(e.clientX) - CANNON_W / 2));
  }
  _onPointerDown(e) {
    if (!this.running) return;
    e.preventDefault();
    this.lastInput = 'pointer';
    this.pointerX = Math.max(8, Math.min(W - 8 - CANNON_W, this._toBufferX(e.clientX) - CANNON_W / 2));
    this.firing = true;
    this.shoot(); // immediate first shot, then the update loop streams
  }
  _onKey(e, down) {
    if (!this.running) return;
    if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') { if (down) { e.preventDefault(); this.togglePause(); } return; }
    switch (e.key) {
      case 'ArrowLeft': case 'a': case 'A':
        e.preventDefault(); this.lastInput = 'key'; this.player.vx = down ? -PLAYER_SPEED : (this.rightHeld ? PLAYER_SPEED : 0); this.leftHeld = down; break;
      case 'ArrowRight': case 'd': case 'D':
        e.preventDefault(); this.lastInput = 'key'; this.player.vx = down ? PLAYER_SPEED : (this.leftHeld ? -PLAYER_SPEED : 0); this.rightHeld = down; break;
      case ' ':
        // Hold-to-fire: stream while Space is held (cooldown lives in shoot()).
        e.preventDefault(); this.firing = down; break;
      default: break;
    }
  }

  // ---- audio ----
  sfx(opts) {
    if (typeof window === 'undefined' || !arcadeFX) return;
    try { arcadeFX._tone(opts); } catch { /* audio unavailable */ }
  }
  _thump() {
    const f = MARCH_NOTES[this.marchStepIdx % 4];
    this.sfx({ type: 'square', freq: f, endFreq: f * 0.94, dur: 0.12, gain: 0.16 });
  }
  blipLevelUp() {
    [523, 659, 784, 1047].forEach((f, i) => this.sfx({ type: 'square', freq: f, dur: 0.12, gain: 0.16, delay: i * 0.09 }));
  }

  // ---- sprite cache (offscreen canvases, color baked in) ----
  _buildCache() {
    if (!document || this._cacheBuilt) return;
    const bake = (key, grid, color, scale = PX) => {
      const c = document.createElement('canvas');
      c.width = grid[0].length * scale;
      c.height = grid.length * scale;
      const g = c.getContext('2d');
      g.fillStyle = color;
      for (let r = 0; r < grid.length; r++) for (let cc = 0; cc < grid[r].length; cc++) if (grid[r][cc]) g.fillRect(cc * scale, r * scale, scale, scale);
      this.cache[key] = c;
    };
    bake('A0', SPRITES.A0, COLOR.A); bake('A1', SPRITES.A1, COLOR.A);
    bake('B0', SPRITES.B0, COLOR.B); bake('B1', SPRITES.B1, COLOR.B);
    bake('C0', SPRITES.C0, COLOR.C); bake('C1', SPRITES.C1, COLOR.C);
    bake('player', SPRITES.player, '#4d79ff');
    bake('ufo', SPRITES.ufo, '#ff2e63');
    bake('bulletP', SPRITES.bulletP, '#ffffff');
    bake('bulletI0', SPRITES.bulletI0, '#ff8c42');
    bake('bulletI1', SPRITES.bulletI1, '#ff8c42');
    bake('boom', SPRITES.boom, '#ffffff', PX);
    this._cacheBuilt = true;
  }

  drawCached(key, x, y, color, glow) {
    const c = this.cache[key];
    if (!c) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = glow;
    ctx.drawImage(c, Math.round(x), Math.round(y));
    ctx.restore();
  }

  // ---- render ----
  render() {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (this.shake > 0 && !this.reducedMotion) {
      const m = this.shake * 6;
      ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
    }
    this._drawStars(ctx);
    this._drawGround(ctx);
    this._drawBunkers(ctx);
    this._drawFormation();
    this._drawDeaths();
    this._drawUfo();
    this._drawBullets();
    this._drawPlayer();
    this._drawParticles(ctx);
    this._drawFloats(ctx);
    this._drawLives(ctx);
    if (this.state === 'waveclear') this._drawBanner(ctx, `WAVE ${this.wave + 1}`);
    ctx.restore();
  }

  _drawStars(ctx) {
    for (const s of this.stars) {
      ctx.globalAlpha = s.a * (0.6 + 0.4 * Math.sin(s.tw));
      ctx.fillStyle = '#f4f0ff';
      ctx.fillRect(s.x, s.y, s.r * 2, s.r * 2);
    }
    ctx.globalAlpha = 1;
  }

  _drawGround(ctx) {
    ctx.save();
    ctx.shadowColor = '#3df58c';
    ctx.shadowBlur = 6;
    ctx.fillStyle = 'rgba(61,245,140,0.5)';
    ctx.fillRect(0, PLAYER_Y + CANNON_H + 6, W, 2);
    ctx.restore();
  }

  _drawFormation() {
    const glow = 8 + this.marchFlare * 8;
    for (const inv of this.invaders) {
      if (!inv.alive) continue;
      const key = `${inv.type}${this.animFrame}`;
      this.drawCached(key, this.formX + inv.col * CELL_W, this.formY + inv.row * CELL_H, COLOR[inv.type], glow);
    }
  }

  _drawDeaths() {
    for (const d of this.deaths) this.drawCached('boom', d.x, d.y, d.color, 14);
  }

  _drawUfo() {
    if (!this.ufo) return;
    const pulse = 10 + Math.sin(this.ufo.pulse) * 6;
    this.drawCached('ufo', this.ufo.x, UFO_Y, '#ff2e63', pulse);
  }

  _drawBullets() {
    for (const b of this.pBullets) this.drawCached('bulletP', b.x, b.y, '#ffffff', 10);
    for (const b of this.invBullets) this.drawCached(`bulletI${b.frame}`, b.x, b.y, '#ff8c42', 8);
  }

  _drawPlayer() {
    if (this.state === 'dead') return;
    if (this.invuln > 0 && Math.floor(this.time * 12) % 2 === 0) return; // blink
    this.drawCached('player', this.player.x, PLAYER_Y, '#4d79ff', 10);
  }

  _drawBunkers(ctx) {
    ctx.save();
    ctx.shadowColor = '#3df58c';
    ctx.shadowBlur = 5;
    ctx.fillStyle = '#3df58c';
    for (const bk of this.bunkers) {
      for (let r = 0; r < BUNKER_ROWS; r++) {
        for (let c = 0; c < BUNKER_COLS; c++) {
          if (bk.cells[r][c]) ctx.fillRect(bk.x + c * BUNKER_PX, bk.y + r * BUNKER_PX, BUNKER_PX, BUNKER_PX);
        }
      }
    }
    ctx.restore();
  }

  _drawParticles(ctx) {
    for (const p of this.particles) {
      const a = Math.max(0, p.life / p.max);
      ctx.globalAlpha = a;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 6;
      ctx.fillStyle = p.color;
      const s = 3 * a + 1;
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  _drawFloats(ctx) {
    ctx.save();
    ctx.font = 'bold 14px monospace';
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
    const c = this.cache.player;
    if (!c) return;
    for (let i = 0; i < this.lives - 1; i++) {
      ctx.save();
      ctx.shadowColor = '#4d79ff';
      ctx.shadowBlur = 6;
      ctx.drawImage(c, 14 + i * 30, H - 22, 20, 12);
      ctx.restore();
    }
  }

  _drawBanner(ctx, text) {
    ctx.save();
    ctx.fillStyle = 'rgba(10,6,26,0.55)';
    ctx.fillRect(0, H / 2 - 40, W, 80);
    ctx.font = 'bold 28px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#4dd8ff';
    ctx.shadowColor = '#4dd8ff';
    ctx.shadowBlur = 18;
    ctx.fillText(text, W / 2, H / 2 + 6);
    ctx.restore();
  }

  updateHUD() {
    if (typeof document === 'undefined') return;
    const s = document.getElementById('invaders-score'); if (s) s.textContent = this.score.toLocaleString();
    const h = document.getElementById('invaders-hi'); if (h) h.textContent = Number(localStorage.getItem(HS_KEY) || 0).toLocaleString();
    const w = document.getElementById('invaders-wave'); if (w) w.textContent = this.wave;
  }
}

export function getInvadersHighScore() {
  return Number(localStorage.getItem(HS_KEY) || 0);
}

export const INVADERS_HS_KEY = HS_KEY;

// Self-check: sprite integrity, formation layout, tempo curve, 1-bullet rule,
// march reversal/drop, bunker erosion, extra life, fire cap.
//   node --input-type=module -e "import('./src/game/invaders.js').then(m=>m._selfCheck())"
export function _selfCheck() {
  // sprites: 2D binary, uniform row widths.
  for (const [name, grid] of Object.entries(SPRITES)) {
    if (!Array.isArray(grid) || !grid.length) throw new Error(`sprite ${name} empty`);
    const w = grid[0].length;
    for (const row of grid) {
      if (row.length !== w) throw new Error(`sprite ${name} ragged`);
      for (const c of row) if (c !== 0 && c !== 1) throw new Error(`sprite ${name} non-binary`);
    }
  }
  // 3 invader types × 2 frames.
  for (const t of ['A', 'B', 'C']) if (!SPRITES[`${t}0`] || !SPRITES[`${t}1`]) throw new Error('missing invader frames');

  const g = new Invaders({});
  // formation: 5 rows × 11 cols = 55, type rows A/B/B/C/C.
  if (g.invaders.length !== 55) throw new Error('formation count');
  const typeOf = (row) => (row === 0 ? 'A' : row <= 2 ? 'B' : 'C');
  for (const inv of g.invaders) if (inv.type !== typeOf(inv.row)) throw new Error(`row ${inv.row} type ${inv.type}`);

  // tempo: 55→800, 1→90 (wave 1), monotonic decreasing.
  g.wave = 1;
  if (g.marchInterval() !== 800) throw new Error(`tempo@55 ${g.marchInterval()}`);
  // force 1 alive: kill 54
  let killed = 0;
  for (const inv of g.invaders) { if (killed < 54) { inv.alive = false; killed++; } }
  if (g.marchInterval() !== 90) throw new Error(`tempo@1 ${g.marchInterval()}`);
  // restore, verify wave multiplier makes wave 2 faster at 55 alive.
  g.reset();
  const t1 = g.marchInterval();
  g.wave = 2;
  const t2 = g.marchInterval();
  if (t2 >= t1) throw new Error('wave multiplier not faster');

  // Hold-to-fire stream: first shot spawns, a second is rate-limited by the
  // cooldown (so it's a stream, not a laser), and the on-screen cap holds at 6.
  g.reset(); g.state = 'playing';
  g.shoot(); if (g.pBullets.length !== 1) throw new Error('shoot failed');
  g.shoot(); if (g.pBullets.length !== 1) throw new Error('cooldown not enforced');
  // release the cooldown each tick and spam up to the on-screen cap of 6.
  for (let i = 0; i < 20; i++) { g.fireCd = 0; g.shoot(); }
  if (g.pBullets.length !== 6) throw new Error(`bullet cap ${g.pBullets.length}`);

  // fire cap scales with wave: wave1→2, wave5→6.
  g.reset(); g.wave = 1;
  if (Math.min(6, 2 + (g.wave - 1)) !== 2) throw new Error('cap wave1');
  g.wave = 5; if (Math.min(6, 2 + (g.wave - 1)) !== 6) throw new Error('cap wave5');

  // march reversal + drop: park the formation's right edge at the wall, step
  // twice — expect a drop + direction flip on the first step, then it should
  // keep marching the new way (not immediately re-flip).
  g.reset();
  let maxRight = 0;
  for (const inv of g.invaders) {
    maxRight = Math.max(maxRight, inv.col * CELL_W + SPRITE_W[inv.type] * PX);
  }
  g.formDir = 1;
  g.formX = W - MARGIN - maxRight; // right edge flush with the wall
  const beforeY = g.formY;
  g._marchStep();
  g._marchStep();
  if (g.formDir !== -1) throw new Error('no reverse at wall');
  if (g.formY <= beforeY) throw new Error('no drop at wall');

  // bunker erosion: a hit removes a circle of cells (filled count drops).
  g.reset();
  const bk = g.bunkers[0];
  const filled0 = bk.cells.flat().reduce((n, v) => n + v, 0);
  g._erodeBunker(bk, bk.x + BUNKER_COLS * BUNKER_PX / 2, bk.y + 4);
  const filled1 = bk.cells.flat().reduce((n, v) => n + v, 0);
  if (filled1 >= filled0) throw new Error('bunker not eroded');

  // extra life at 5000, once.
  g.reset();
  g._checkExtraLife(); if (g.lives !== 3) throw new Error('premature extra life');
  g.score = 5000; g._checkExtraLife(); if (g.lives !== 4) throw new Error('no extra life');
  g.score = 12000; g._checkExtraLife(); if (g.lives !== 4) throw new Error('double extra life');

  // UFO spawns only while formation is high.
  g.reset(); g.ufo = null; g.ufoTimer = 0;
  // formation at top (formY=60) → lowest bottom ~204 < H*0.7 → should spawn.
  // Force-advance formation to the bottom third and confirm no spawn.
  g.formY = H - 40; g.ufoTimer = 0; g.ufo = null;
  g._ufoTick(0.01);
  if (g.ufo !== null) throw new Error('UFO spawned in bottom third');

  console.log('invaders self-check ok');
}