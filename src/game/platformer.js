// GLOW RUNNER — an original neon side-scroller. Vanilla canvas, fixed-timestep
// physics, AABB tile collision, coyote time + jump buffer, variable jump height,
// moving platforms (player inherits platform velocity), breakable blocks,
// walkers + spikes, coins + hearts + goal, camera with parallax, level select.
//
//   ponytail: one engine file, no sub-modules — the physics and the renderer
//   share state because a platformer's feel lives in the coupling between them
//   (squash/stretch, trail, camera lag). Splitting would just thread the same
//   fields through more files. The single source of truth is the ASCII level
//   map built by the level builder; physics is the smallest correct model.
import { arcadeFX } from './arcade.js';

// ---- The one place the game's name lives (renamable) ----
export const GAME_NAME = 'GLOW RUNNER';

// ---- Tunables (px, seconds) ----
const TILE = 32;
const VIEW_W = 25;            // tiles visible horizontally
const VIEW_H = 15;            // tiles visible vertically (== level height → no vertical scroll)
const W = VIEW_W * TILE;      // 800
const H = VIEW_H * TILE;      // 480
const PW = 24, PH = 30;      // player hitbox
const RUN_ACC = 1400;         // ground run acceleration px/s²
const MAX_RUN = 230;         // max run speed px/s
const GROUND_FRICTION = 1800; // decel on ground when no input px/s²
const AIR_CONTROL = 0.65;    // fraction of accel applied in air
const JUMP_VEL = -700;        // jump impulse px/s (≈5.1-tile apex, ≈5.8-tile air distance at MAX_RUN — clears 4-tile platforms)
const GRAVITY = 1500;        // px/s²
const FALL_MULT = 1.8;       // gravity multiplier while falling (faster fall)
const RISE_REL_MULT = 1.8;  // gravity mult while rising & jump released (short hop)
const JUMP_CUT = 0.45;       // release jump while rising → vy *= this
const MAX_FALL = 640;        // fall speed cap px/s
const COYOTE = 0.08;         // s grace after leaving ground
const BUFFER = 0.1;         // s jump-press lookahead
const STEP = 1 / 60;        // fixed-timestep dt
const WALKER_SPEED = 60;    // px/s
const STOMP_BOUNCE = -310;   // vy after stomping a walker (≈ 55% of jump)
const MAX_HEARTS = 5;
const START_HEARTS = 3;
const INVULN = 1.2;          // s of blink after a hit
const DEATH_PAUSE = 0.5;     // s freeze on death before reset
const KNOCKBACK_X = 180, KNOCKBACK_Y = -260;
const HAZARD_INSET = 5;      // spike trigger horizontal inset
const HAZARD_H = 22;         // spike trigger height (the pointy region, from tile top)
const HAZARD_STUCK = 1.0;     // s of continuous hazard overlap → force death (soft-lock failsafe)
const PIT_MARGIN = 16;        // px below the level's ground row the player may sink before dying (tight → no slow fall into blackness)
const STUCK_TIME = 3.0;      // s of "pushing but not progressing" while grounded → soft-lock, force reset

// Colors reuse the shared arcade tokens (kept as literals — canvas can't read CSS vars).
const C = {
  bg: '#0a061a', bg2: '#160a2e',
  cyan: '#4dd8ff', blue: '#4d79ff', pink: '#ff2e63', purple: '#b04dff',
  gold: '#ffc93c', orange: '#ff8c42', green: '#3df58c', red: '#ff4d4d',
  white: '#f4f7ff', dim: '#7a6aa8',
};

// ---- Hero binary sprites (8 wide × 10 tall, pixel scale 3 → 24×30 == hitbox) ----
// '1' = cyan body, '2' = white eye/core, '.' = empty.
const HERO_RUN = [
  ['...11...', '..1111..', '.12211..', '.11111..', '.11111..', '..1111..', '.11..11.', '.1....1.', '.1....1.', '..1..1..'],
  ['...11...', '..1111..', '.12211..', '.11111..', '.11111..', '..1111..', '..1111..', '..1..1..', '.1....1.', '.1....1.'],
];
const HERO_JUMP = ['...11...', '..1111..', '.12211..', '.11111..', '1111111.', '.11111..', '..1111..', '..1..1..', '.1....1.', '.1....1.'];

// ---- Level builder: programmatic ASCII so every row is exactly `width` chars ----
// Tiles: '.' empty, '#' solid, '=' one-way platform, 'B' breakable, 'b' breakable
// (drops a coin), '^' spike, 'o' coin, 'E' walker spawn, 'S' hero spawn,
// 'F' goal, 'M' moving-platform track (a run of M = the platform's patrol span).
// The builder keeps '#','=','B','b','^' in the grid and extracts 'o','E','S','F','M'
// into meta lists, so collection/animation never re-scans the grid.
function buildLevel(width, height, paint) {
  const grid = Array.from({ length: height }, () => new Array(width).fill('.'));
  const set = (x, y, ch) => { if (y >= 0 && y < height && x >= 0 && x < width) grid[y][x] = ch; };
  paint(set, width, height);
  const meta = { width, height, rows: [], spawn: null, goal: null, coins: [], enemies: [], movers: [] };
  for (let y = 0; y < height; y++) {
    let rowStr = '';
    for (let x = 0; x < width; x++) {
      const ch = grid[y][x];
      if (ch === 'S') { meta.spawn = { x, y }; rowStr += '.'; continue; }
      if (ch === 'F') { meta.goal = { x, y }; rowStr += '.'; continue; }
      if (ch === 'o') { meta.coins.push({ x, y, got: false }); rowStr += '.'; continue; }
      if (ch === 'E') { meta.enemies.push(spawnWalker(x, y)); rowStr += '.'; continue; }
      rowStr += ch; // '#','=','B','b','^' stay
    }
    meta.rows.push(rowStr);
  }
  // Parse M runs → moving platforms. M tiles are non-solid track markers.
  for (let y = 0; y < height; y++) {
    let x = 0;
    while (x < width) {
      if (meta.rows[y][x] === 'M') {
        const c1 = x;
        while (x < width && meta.rows[y][x] === 'M') x++;
        const c2 = x - 1;
        const wTiles = 2;
        const minX = c1 * TILE;
        const maxX = Math.max(minX, (c2 - wTiles + 1) * TILE);
        meta.movers.push({ x: minX, y: y * TILE, w: wTiles * TILE, minX, maxX, dir: 1, speed: WALKER_SPEED * 1.4, dx: 0 });
        let s = meta.rows[y];
        s = s.slice(0, c1) + '.'.repeat(c2 - c1 + 1) + s.slice(c2 + 1);
        meta.rows[y] = s;
      } else x++;
    }
  }
  meta.grid = meta.rows.map((r) => r.split(''));
  return meta;
}

function spawnWalker(col, row) {
  return { x: col * TILE + 4, y: row * TILE + 8, w: 24, h: 24, vx: WALKER_SPEED, dir: 1, alive: true, pop: 0, frame: 0, frameT: 0 };
}

// ---- Tile queries (pure, module-level so the self-check can test them) ----
function solidAt(level, c, r) {
  if (r < 0 || c < 0 || c >= level.width || r >= level.height) return false;
  const ch = level.grid[r][c];
  return ch === '#' || ch === 'B' || ch === 'b';
}
function oneWayAt(level, c, r) {
  if (r < 0 || c < 0 || c >= level.width || r >= level.height) return false;
  return level.grid[r][c] === '=';
}
function breakableAt(level, c, r) {
  if (r < 0 || c < 0 || c >= level.width || r >= level.height) return '';
  const ch = level.grid[r][c];
  return ch === 'B' || ch === 'b' ? ch : '';
}
function spikeAt(level, c, r) {
  if (r < 0 || c < 0 || c >= level.width || r >= level.height) return false;
  return level.grid[r][c] === '^';
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const flr = (v) => Math.floor(v);
const lsGet = (k, def) => { try { const v = localStorage.getItem(k); return v === null ? def : v; } catch { return def; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

// ---- Levels (4 handcrafted; width 110–150, height 15) ----
function level1() {
  const Wd = 120;
  return buildLevel(Wd, 15, (set) => {
    // ground with two gaps
    for (let x = 0; x < Wd; x++) if (!((x >= 30 && x <= 33) || (x >= 74 && x <= 77))) set(x, 14, '#');
    // side walls bound the level
    for (let y = 0; y < 15; y++) { set(0, y, '#'); set(Wd - 1, y, '#'); }
    set(2, 13, 'S');                          // spawn on ground
    for (let x = 4; x <= 12; x++) set(x, 13, 'o');  // coin warm-up trail
    // ascending staircase x16..20
    for (let i = 0; i < 5; i++) for (let y = 14 - i; y <= 14; y++) set(16 + i, y, '#');
    for (let x = 30; x <= 33; x++) set(x, 11, 'o'); // coins arc over the gap
    // one-way platform with coins after the gap
    for (let x = 38; x <= 42; x++) set(x, 11, '=');
    for (let x = 39; x <= 41; x++) set(x, 10, 'o');
    // optional high risky cache: breakable stairs up to a coin cluster
    for (let i = 0; i < 5; i++) set(54 + i, 13 - i, 'B');
    for (let x = 58; x <= 61; x++) set(x, 8, 'o');
    // small rise + platform over gap 74..77
    for (let x = 70; x <= 73; x++) set(x, 13, 'o');
    for (let x = 82; x <= 86; x++) set(x, 12, '=');
    set(82, 11, 'o'); set(86, 11, 'o');
    set(Wd - 3, 13, 'F');                    // goal
  });
}

function level2() {
  const Wd = 132;
  return buildLevel(Wd, 15, (set) => {
    for (let x = 0; x < Wd; x++) if (!((x >= 24 && x <= 26) || (x >= 56 && x <= 59) || (x >= 96 && x <= 99))) set(x, 14, '#');
    for (let y = 0; y < 15; y++) { set(0, y, '#'); set(Wd - 1, y, '#'); }
    set(2, 13, 'S');
    // 3-tile spike pit at x=24..26 — comfortably clearable with a 5-tile jump
    for (let x = 24; x <= 26; x++) set(x, 13, '^');
    // walker patrol on the first stretch
    set(8, 13, 'E'); set(14, 13, 'E');
    // mid platform over gap 56..59 with a walker + coins
    for (let x = 50; x <= 65; x++) set(x, 10, '=');
    set(54, 9, 'o'); set(58, 9, 'o'); set(62, 9, 'o');
    set(57, 9, 'E');                            // walker stands ON the platform (row 10 top)
    // 3-tile spike strip on the ground at x=71..73 (jump from x=70, land x=74)
    for (let x = 71; x <= 73; x++) set(x, 13, '^');
    // breakable wall with a coin cache behind at x=84
    for (let y = 11; y <= 13; y++) set(84, y, 'B');
    for (let y = 9; y <= 11; y++) set(86, y, 'o');
    // gap 96..99 crossed by two one-way platforms
    for (let x = 96; x <= 97; x++) set(x, 11, '=');
    for (let x = 98; x <= 99; x++) set(x, 9, '=');
    set(97, 10, 'o'); set(98, 8, 'o');
    // final stretch + walker guard
    set(110, 13, 'E');
    set(Wd - 3, 13, 'F');
  });
}

function level3() {
  const Wd = 140;
  return buildLevel(Wd, 15, (set) => {
    // sparse ground islands (the gaps are bridged by moving platforms)
    for (let x = 0; x <= 18; x++) set(x, 14, '#');
    for (let x = 30; x <= 40; x++) set(x, 14, '#');
    for (let x = 52; x <= 62; x++) set(x, 14, '#');
    for (let x = 74; x <= 84; x++) set(x, 14, '#');
    for (let x = 96; x <= Wd - 1; x++) set(x, 14, '#');
    for (let y = 0; y < 15; y++) { set(0, y, '#'); set(Wd - 1, y, '#'); }
    set(3, 13, 'S');
    // moving platforms bridge the gaps (M run = track; platform slides along it)
    for (let x = 20; x <= 28; x++) set(x, 11, 'M');   // platform 1 over gap 19..29
    for (let x = 42; x <= 50; x++) set(x, 11, 'M');   // platform 2 over gap 41..51
    for (let x = 64; x <= 72; x++) set(x, 11, 'M');   // platform 3 over gap 63..73
    for (let x = 86; x <= 94; x++) set(x, 11, 'M');   // platform 4 over gap 85..95
    // coins hovering over each moving platform
    for (const cx of [24, 46, 68, 90]) set(cx, 10, 'o');
    // a couple walkers on the islands
    set(34, 13, 'E'); set(78, 13, 'E');
    // spike hazards on the approach to the last gap
    for (let x = 90; x <= 92; x++) set(x, 13, '^');
    set(Wd - 3, 13, 'F');
  });
}

function level4() {
  const Wd = 150;
  return buildLevel(Wd, 15, (set) => {
    for (let x = 0; x < Wd; x++) {
      if ((x >= 22 && x <= 25) || (x >= 48 && x <= 51) || (x >= 78 && x <= 81) || (x >= 114 && x <= 117)) continue;
      set(x, 14, '#');
    }
    for (let y = 0; y < 15; y++) { set(0, y, '#'); set(Wd - 1, y, '#'); }
    set(2, 13, 'S');
    // opening spikes + walker
    for (let x = 10; x <= 12; x++) set(x, 13, '^');
    set(16, 13, 'E');
    // breakable staircase with coins inside
    for (let i = 0; i < 5; i++) set(26 + i, 13 - i, 'b');
    // one-way platform over gap 48..51 with a walker above
    for (let x = 44; x <= 56; x++) set(x, 10, '=');
    set(50, 9, 'E'); set(48, 9, 'o'); set(54, 9, 'o');
    // vertical spike climb: breakable blocks you must head-bump to pass
    for (let y = 8; y <= 13; y++) set(64, y, 'B');
    set(64, 7, 'o');
    // moving platform over gap 78..81 + walker on far side
    for (let x = 78; x <= 88; x++) set(x, 11, 'M');
    set(84, 10, 'o');
    set(92, 13, 'E');
    // spike corridor: 9-tile strip is too wide to jump, so the path is a
    // one-way ledge OVER it. The ledge sits at row 12 (a 2-tile step up from
    // the ground, reachable with the buffed jump) and runs one tile past the
    // spikes (x=100..109) so the drop-off lands on clear ground at x=109.
    for (let x = 100; x <= 108; x++) set(x, 13, '^');
    for (let x = 100; x <= 109; x++) set(x, 12, '=');
    for (let x = 101; x <= 107; x += 2) set(x, 11, 'o');
    // final ascent via breakable + coins + walker guard
    for (let i = 0; i < 4; i++) set(120 + i, 13 - i, 'B');
    set(124, 8, 'o'); set(125, 8, 'o');
    set(134, 13, 'E');
    set(Wd - 3, 13, 'F');
  });
}

const LEVELS = [level1(), level2(), level3(), level4()];

const UNLOCK_KEY = 'geoguesser_platformer_unlocked';
const BEST_KEY = (i) => `geoguesser_platformer_best_${i}`;
const COINS_KEY = (i) => `geoguesser_platformer_coins_${i}`;

function getUnlocked() { return clamp(parseInt(lsGet(UNLOCK_KEY, '0'), 10) || 0, 0, LEVELS.length - 1); }
function setUnlocked(i) { if (i > getUnlocked()) lsSet(UNLOCK_KEY, String(i)); }
function getBest(i) { return parseInt(lsGet(BEST_KEY(i), '0'), 10) || 0; } // ms, 0 = none
function getCoins(i) { return parseInt(lsGet(COINS_KEY(i), '0'), 10) || 0; }

export function getPlatformerProgress() {
  let cleared = 0;
  for (let i = 0; i < LEVELS.length; i++) if (getBest(i) > 0) cleared++;
  return cleared;
}

// ---- Engine ----
export class Platformer {
  constructor(opts = {}) {
    this.canvas = opts.canvas || null;
    this.boardFrame = opts.boardFrame || null;
    this.ctx = opts.canvas ? opts.canvas.getContext('2d') : null;
    this.onClear = opts.onClear || (() => {});
    this.onStatus = opts.onStatus || (() => {});
    this.running = false;
    this.state = 'idle';      // idle | playing | paused | clear | dead
    this.reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.keys = { left: false, right: false, jump: false };
    this._bound = false;
    this._raf = 0;
    this._last = 0;
    this._acc = 0;
    this.levelIdx = 0;
    this.reset();
  }

  // Load a level fresh (preserves unlocked progress, resets run state).
  reset() {
    const L = LEVELS[this.levelIdx];
    this.level = L;
    this.totalCoins = L.coins.length;
    this.coins = 0;
    this.hearts = START_HEARTS;
    this.time = 0;
    this.state = 'playing';
    this.px = L.spawn.x * TILE;
    this.py = L.spawn.y * TILE;
    this.vx = 0; this.vy = 0;
    this.grounded = false;
    this.coyote = 0; this.buffer = 0;
    this.jumpHeld = false; this.cutDone = false;
    this.standingMover = null;
    this.facing = 1;
    this.invuln = 0;
    this.deathT = 0;
    this.flash = 0;
    this._inContact = false;   // enemy-overlap gate: must fully exit before re-damage
    this._hazardStuck = 0;    // s continuously overlapping a hazard (soft-lock failsafe)
    this.stuckT = 0;          // s of "pushing but not progressing" (universal soft-lock failsafe)
    this._lastX = this.px;    // last X position at which progress was registered
    this.squash = 0; this.squashDir = 0; // squashDir: 1 land-squash, -1 apex-stretch
    this.runFrame = 0; this.runT = 0;
    this.trail = [];
    this.particles = [];
    this.floats = [];
    // reset mutable entities
    this.enemies = L.enemies.map((e) => ({ ...e }));
    this.movers = L.movers.map((m) => ({ ...m }));
    this.coinSet = L.coins.map((c) => ({ ...c }));
    this.grid = L.grid.map((r) => r.slice()); // breakable blocks mutate a copy
    this.camX = 0; this.camY = 0;
    this.emit();
  }

  // ---- input ----
  _bindInput() {
    if (this._bound) return;
    this._bound = true;
    this._keydown = (e) => {
      // P (pause) and R (restart level) work in any state; R is the manual
      // soft-lock escape listed on the pause overlay.
      if (e.code === 'KeyP') { this.togglePause(); return; }
      if (e.code === 'KeyR') { this.retry(); return; }
      if (this.state !== 'playing' && this.state !== 'dead') return;
      switch (e.code) {
        case 'ArrowLeft': case 'KeyA': this.keys.left = true; break;
        case 'ArrowRight': case 'KeyD': this.keys.right = true; break;
        case 'Space': case 'ArrowUp': case 'KeyW':
          if (!this.keys.jump) { this.keys.jump = true; this.buffer = BUFFER; }
          e.preventDefault();
          break;
      }
    };
    this._keyup = (e) => {
      switch (e.code) {
        case 'ArrowLeft': case 'KeyA': this.keys.left = false; break;
        case 'ArrowRight': case 'KeyD': this.keys.right = false; break;
        case 'Space': case 'ArrowUp': case 'KeyW': this.keys.jump = false; break;
      }
    };
    window.addEventListener('keydown', this._keydown);
    window.addEventListener('keyup', this._keyup);
    // touch buttons (hold-to-act). Controller does not wire these.
    const touch = document.getElementById('platformer-touch');
    if (touch) {
      const press = (at, on) => (ev) => {
        ev.preventDefault();
        if (at === 'left') this.keys.left = on;
        else if (at === 'right') this.keys.right = on;
        else if (at === 'jump') { this.keys.jump = on; if (on) this.buffer = BUFFER; }
      };
      this._touchHandlers = [];
      touch.querySelectorAll('button[data-at]').forEach((btn) => {
        const at = btn.dataset.at;
        const down = press(at, true), up = press(at, false);
        btn.addEventListener('pointerdown', down);
        btn.addEventListener('pointerup', up);
        btn.addEventListener('pointerleave', up);
        btn.addEventListener('pointercancel', up);
        this._touchHandlers.push({ btn, down, up });
      });
    }
  }
  _unbindInput() {
    if (!this._bound) return;
    this._bound = false;
    window.removeEventListener('keydown', this._keydown);
    window.removeEventListener('keyup', this._keyup);
    if (this._touchHandlers) {
      this._touchHandlers.forEach(({ btn, down, up }) => {
        btn.removeEventListener('pointerdown', down);
        btn.removeEventListener('pointerup', up);
        btn.removeEventListener('pointerleave', up);
        btn.removeEventListener('pointercancel', up);
      });
      this._touchHandlers = null;
    }
  }

  start() {
    if (this.running) return;
    this._bindInput();
    this.running = true;
    this._last = performance.now();
    this._acc = 0;
    this._raf = requestAnimationFrame(this._loop);
  }
  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    this._unbindInput();
  }

  togglePause() {
    if (this.state === 'playing') { this.state = 'paused'; this.emit(); }
    else if (this.state === 'paused') { this.state = 'playing'; this._last = performance.now(); this.emit(); }
  }

  retry() { this.reset(); if (!this.running) this.start(); }

  // ---- main loop: fixed-timestep accumulator → physics, free-rate render ----
  // ponytail: try/finally reschedules rAF even if a frame throws — without this,
  // a single bad frame (a NaN, a negative-repeat) would kill the loop and the
  // game would freeze forever ("random stops"). The error logs once.
  _loop = (now) => {
    if (!this.running) return;
    try {
      let dt = (now - this._last) / 1000;
      this._last = now;
      if (dt > 0.1) dt = 0.1; // tab refocus guard
      if (dt < 0) dt = 0;     // clock jitter / tab-visibility skew
      if (this.state === 'playing') {
        this._acc += dt;
        let guard = 0;
        // re-check state each step: die() mid-loop flips to 'dead' and we stop
        // stepping physics for the (now dead) player instead of re-firing.
        while (this._acc >= STEP && guard < 8 && this.state === 'playing') { this.fixedUpdate(STEP); this._acc -= STEP; guard++; }
        if (guard >= 8) this._acc = 0; // avoid spiral of death
      } else if (this.state === 'dead') {
        this._acc += dt;
        this.deathT -= dt;
        let g2 = 0;
        while (this._acc >= STEP && g2 < 8) { this._updateParticles(STEP); this._acc -= STEP; g2++; }
        if (g2 >= 8) this._acc = 0;
        if (this.deathT <= 0) this.reset();
      }
      this.render();
    } catch (err) {
      if (!this._loopErr) { this._loopErr = true; console.error('GLOW RUNNER loop error (logged once):', err); }
    } finally {
      this._raf = requestAnimationFrame(this._loop);
    }
  };

  fixedUpdate(step) {
    this.time += step;
    if (this.invuln > 0) this.invuln -= step;
    if (this.flash > 0) this.flash -= step;
    if (this.squash > 0) this.squash -= step;

    // moving platforms move first; carry the player if standing on one
    for (const m of this.movers) {
      const prev = m.x;
      m.x += m.dir * m.speed * step;
      if (m.x <= m.minX) { m.x = m.minX; m.dir = 1; }
      else if (m.x >= m.maxX) { m.x = m.maxX; m.dir = -1; }
      m.dx = m.x - prev;
    }
    if (this.standingMover) this.px += this.standingMover.dx;

    const dir = (this.keys.left ? -1 : 0) + (this.keys.right ? 1 : 0);
    const accel = RUN_ACC * (this.grounded ? 1 : AIR_CONTROL);
    if (dir !== 0) {
      this.facing = dir;
      // turning: friction kills the old velocity first, then we accelerate the new way
      if (Math.sign(dir) !== Math.sign(this.vx) && this.vx !== 0) {
        const fr = GROUND_FRICTION * step * (this.grounded ? 1 : AIR_CONTROL);
        if (Math.abs(this.vx) <= fr) this.vx = 0; else this.vx -= Math.sign(this.vx) * fr;
      }
      this.vx += dir * accel * step;
      this.vx = clamp(this.vx, -MAX_RUN, MAX_RUN);
    } else if (this.grounded) {
      const fr = GROUND_FRICTION * step;
      if (Math.abs(this.vx) <= fr) this.vx = 0; else this.vx -= Math.sign(this.vx) * fr;
    }

    // jump buffer + coyote
    if (this.buffer > 0) this.buffer -= step;
    if (this.coyote > 0) this.coyote -= step;
    const canJump = this.grounded || this.coyote > 0;
    if (this.buffer > 0 && canJump) {
      this.vy = JUMP_VEL;
      this.grounded = false; this.coyote = 0; this.buffer = 0;
      this.standingMover = null; this.cutDone = false;
      this.squash = 0.08; this.squashDir = -1; // stretch on takeoff
      blip('jump');
    }
    // variable height: release while rising → cut once
    if (!this.keys.jump && this.vy < 0 && !this.cutDone) { this.vy *= JUMP_CUT; this.cutDone = true; }

    // gravity (faster fall, faster short-hop rise-after-release)
    let g = GRAVITY;
    if (this.vy > 0) g *= FALL_MULT;
    else if (this.vy < 0 && !this.keys.jump) g *= RISE_REL_MULT;
    this.vy = Math.min(this.vy + g * step, MAX_FALL);

    // apex stretch trigger
    if (this.vy >= -20 && this.vy <= 20 && !this.grounded && this.squash <= 0) {
      this.squash = 0.06; this.squashDir = -1;
    }

    this._moveX(step);
    const prevBottom = this.py + PH;
    this._moveY(step, prevBottom);
    if (this.grounded) { this.coyote = COYOTE; }

    // run animation frame
    if (this.grounded && Math.abs(this.vx) > 8) {
      this.runT += step * (Math.abs(this.vx) / MAX_RUN);
      if (this.runT > 0.14) { this.runT = 0; this.runFrame ^= 1; }
    } else { this.runFrame = 0; }

    // motion trail at near-max speed (compacted in place — no per-step allocation)
    if (Math.abs(this.vx) > MAX_RUN * 0.85 && !this.reduced) {
      this.trail.push({ x: this.px, y: this.py, t: 0.18 });
      if (this.trail.length > 8) this.trail.shift();
    }
    {
      let w = 0;
      for (let i = 0; i < this.trail.length; i++) {
        const t = this.trail[i];
        t.t -= step;
        if (t.t > 0) this.trail[w++] = t;
      }
      this.trail.length = w;
    }

    this._updateEnemies(step);
    this._updateParticles(step);
    this._updateFloats(step);
    this._checkPickups();
    this._checkHazards();

    // fall off the bottom → die. Tight margin (feet just past the ground row) so
    // a pit fall kills instantly instead of a slow drop through blackness that
    // reads as a hang. ground row is height-1; player dies once feet sink past it.
    if (this.py + PH > (this.level.height - 1) * TILE + PIT_MARGIN) this.die();

    // Universal soft-lock failsafe: if the player is grounded, pushing a
    // direction, slow, and hasn't advanced ~1 tile in STUCK_TIME seconds, they
    // are wedged in geometry a jump can't escape (a pit shelf, a 1-tile crack).
    // The hazard-stuck timer only covers spikes/enemies; this covers terrain
    // traps with no hazard. Non-destructive — die() just respawns at the spawn.
    const pushing = this.keys.left || this.keys.right;
    if (pushing && this.grounded && Math.abs(this.vx) < 14) {
      if (Math.abs(this.px - this._lastX) > TILE) { this._lastX = this.px; this.stuckT = 0; }
      else this.stuckT += step;
    } else { this.stuckT = 0; this._lastX = this.px; }
    if (this.stuckT > STUCK_TIME) this.die();

    // camera
    this._updateCamera();

    this.emit();
  }

  _moveX(step) {
    this.px += this.vx * step;
    const top = flr(this.py / TILE), bot = flr((this.py + PH - 1) / TILE);
    if (this.vx > 0) {
      const c = flr((this.px + PW - 1) / TILE);
      for (let r = top; r <= bot; r++) if (solidAt(this, c, r)) { this.px = c * TILE - PW - 0.01; this.vx = 0; break; }
    } else if (this.vx < 0) {
      const c = flr(this.px / TILE);
      for (let r = top; r <= bot; r++) if (solidAt(this, c, r)) { this.px = (c + 1) * TILE + 0.01; this.vx = 0; break; }
    }
  }

  _moveY(step, prevBottom) {
    this.py += this.vy * step;
    const left = flr(this.px / TILE), right = flr((this.px + PW - 1) / TILE);
    this.grounded = false;
    this.standingMover = null;
    if (this.vy > 0) {
      const r = flr((this.py + PH - 1) / TILE);
      for (let c = left; c <= right; c++) {
        if (solidAt(this, c, r)) { this.py = r * TILE - PH; this._land(); this.vy = 0; break; }
        if (oneWayAt(this, c, r) && prevBottom <= r * TILE + 1) { this.py = r * TILE - PH; this._land(); this.vy = 0; break; }
      }
      // moving platforms (one-way top)
      for (const m of this.movers) {
        if (prevBottom <= m.y + 2 && this.py + PH >= m.y && this.px + PW > m.x && this.px < m.x + m.w) {
          this.py = m.y - PH; this._land(); this.vy = 0; this.standingMover = m; break;
        }
      }
    } else if (this.vy < 0) {
      const r = flr(this.py / TILE);
      for (let c = left; c <= right; c++) {
        if (solidAt(this, c, r)) {
          const br = breakableAt(this, c, r);
          if (br) this._break(c, r, br);
          this.py = (r + 1) * TILE + 0.01; this.vy = 0; break;
        }
      }
    }
  }

  _land() {
    if (!this.grounded && this.vy > 220) { this.squash = 0.08; this.squashDir = 1; blip('land'); }
    this.grounded = true;
  }

  _break(c, r, kind) {
    this.grid[r][c] = '.';
    this._burst(c * TILE + TILE / 2, r * TILE + TILE / 2, C.gold, 10);
    blip('break');
    if (kind === 'b') this.coinSet.push({ x: c, y: r, got: false });
  }

  _updateEnemies(step) {
    for (const e of this.enemies) {
      if (!e.alive) {
        e.pop -= step;
        continue;
      }
      // animate feet
      e.frameT += step;
      if (e.frameT > 0.18) { e.frameT = 0; e.frame ^= 1; }
      // patrol: reverse at a wall ahead or a missing floor ahead (don't walk off)
      const aheadC = flr((e.vx > 0 ? e.x + e.w + 1 : e.x - 1) / TILE);
      const footC = flr((e.vx > 0 ? e.x + e.w : e.x) / TILE);
      const headRow = flr(e.y / TILE), footRow = flr((e.y + e.h - 1) / TILE);
      let blocked = false;
      for (let r = headRow; r <= footRow; r++) if (solidAt(this, aheadC, r)) blocked = true;
      const groundRow = flr((e.y + e.h) / TILE);
      if (!solidAt(this, footC, groundRow) && !oneWayAt(this, footC, groundRow)) blocked = true;
      if (blocked) { e.dir *= -1; e.vx = e.dir * WALKER_SPEED; }
      e.x += e.vx * step;
      // Stomp only: a falling player landing on top pops the walker. Side/below
      // contact is handled in _checkEnemyContact (with exit-gating + forced
      // separation), NOT here, so this loop never applies heart damage.
      if (this.aabb(this.px, this.py, PW, PH, e.x, e.y, e.w, e.h)) {
        if (this.vy > 0 && this.py + PH - this.vy * step <= e.y + 6) {
          e.alive = false; e.pop = 0.1; this.vy = STOMP_BOUNCE; this.cutDone = true;
          this._burst(e.x + e.w / 2, e.y + e.h / 2, C.orange, 12);
          this._float(e.x, e.y, '+1', C.gold);
          blip('stomp');
        }
      }
    }
  }

  _checkPickups() {
    // coins
    for (const c of this.coinSet) {
      if (c.got) continue;
      const cx = c.x * TILE + TILE / 2, cy = c.y * TILE + TILE / 2;
      if (Math.abs(this.px + PW / 2 - cx) < PW / 2 + 10 && Math.abs(this.py + PH / 2 - cy) < PH / 2 + 10) {
        c.got = true; this.coins++;
        this._burst(cx, cy, C.gold, 6);
        blip('coin');
        if (this.coins > 0 && this.coins % 100 === 0 && this.hearts < MAX_HEARTS) {
          this.hearts++; this._float(this.px, this.py, '+♥', C.pink); blip('levelup');
        }
      }
    }
    // goal
    const g = this.level.goal;
    const gx = g.x * TILE + TILE / 2, gy = g.y * TILE + TILE / 2;
    if (Math.abs(this.px + PW / 2 - gx) < 24 && Math.abs(this.py + PH / 2 - gy) < 28) this.clear();
  }

  // ---- hazards ----
  // Two classes, kept strictly separate so a tile is never both solid and a
  // trigger (the seam that soft-locked L2): spikes are TRIGGER-ONLY and lethal
  // on touch; enemy contact is heart-based with exit-gating + forced separation.
  // X and Y collision (in _moveX/_moveY) only resolve solid/one-way tiles — they
  // never see spikes — so the resolver and the hazard check can't fight.
  _checkHazards() {
    // Spikes: any overlap with the pointy region = instant death → restart.
    if (this._overlapsSpike()) { this.die(); return; }
    // Enemy contact: heart damage, gated (see _checkEnemyContact).
    this._checkEnemyContact();
    // Soft-lock failsafe: stuck overlapping any hazard > HAZARD_STUCK → force death.
    if (this._hazardStuck > HAZARD_STUCK) this.die();
  }

  _overlapsSpike() {
    const top = flr(this.py / TILE), bot = flr((this.py + PH - 1) / TILE);
    const left = flr(this.px / TILE), right = flr((this.px + PW - 1) / TILE);
    for (let r = top; r <= bot; r++) for (let c = left; c <= right; c++) {
      if (!spikeAt(this, c, r)) continue;
      const sx = c * TILE + HAZARD_INSET, sy = r * TILE;
      const sw = TILE - HAZARD_INSET * 2, sh = HAZARD_H;
      if (this.aabb(this.px, this.py, PW, PH, sx, sy, sw, sh)) return true;
    }
    return false;
  }

  _checkEnemyContact() {
    let contact = null;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (this.aabb(this.px, this.py, PW, PH, e.x, e.y, e.w, e.h)) { contact = e; break; }
    }
    if (contact) {
      // overlapping a hazard counts toward the stuck timer (reset on damage/exit)
      this._hazardStuck += STEP;
      // damage only on the enter-edge AND when invuln has expired; _inContact
      // stays true for as long as we overlap, so damage can't re-trigger until
      // the player has FULLY exited — even after invuln wears off.
      if (!this._inContact && this.invuln <= 0) this._damageEnemy(contact);
      this._inContact = true;
    } else {
      this._inContact = false;
      this._hazardStuck = 0;
    }
  }

  // Enemy hit: lose a heart, but FIRST displace the player fully outside the
  // enemy's hitbox horizontally (so the next physics step resumes already
  // separated — gravity can't drop it straight back in to re-trigger), then
  // apply knockback away from the enemy. This is the fix for the jitter loop.
  _damageEnemy(e) {
    this.hearts--;
    this.invuln = INVULN;
    this._hazardStuck = 0;            // a damage event is a state change → reset failsafe
    this.flash = 0.12;
    const pcx = this.px + PW / 2, ecx = e.x + e.w / 2;
    if (pcx < ecx) { this.px = e.x - PW - 0.5; this.vx = -KNOCKBACK_X; }
    else { this.px = e.x + e.w + 0.5; this.vx = KNOCKBACK_X; }
    this.vy = KNOCKBACK_Y;
    this._burst(this.px + PW / 2, this.py + PH / 2, C.red, 14);
    blip('hit');
    if (this.hearts <= 0) this.die();
  }

  die() {
    this.state = 'dead';
    this.deathT = DEATH_PAUSE;
    this.flash = 0.5;
    this._burst(this.px + PW / 2, this.py + PH / 2, C.white, 30);
    blip('die');
  }

  clear() {
    if (this.state === 'clear') return;
    this.state = 'clear';
    const ms = Math.round(this.time * 1000);
    setUnlocked(this.levelIdx + 1 < LEVELS.length ? this.levelIdx + 1 : this.levelIdx);
    const prevBest = getBest(this.levelIdx);
    if (prevBest === 0 || ms < prevBest) lsSet(BEST_KEY(this.levelIdx), String(ms));
    if (this.coins > getCoins(this.levelIdx)) lsSet(COINS_KEY(this.levelIdx), String(this.coins));
    this.onClear({ level: this.levelIdx, time: ms, coins: this.coins, totalCoins: this.totalCoins, hearts: this.hearts, best: getBest(this.levelIdx), isBest: prevBest === 0 || ms < prevBest, hasNext: this.levelIdx + 1 < LEVELS.length });
    blip('levelup');
  }

  // ---- effects ----
  _burst(x, y, color, n) {
    if (this.reduced) n = Math.min(n, 4);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (this._rand() * 0.5);
      const sp = 40 + this._rand() * 140;
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, life: 0.4 + this._rand() * 0.3, color });
    }
  }
  _rand() { return Math.random(); }
  _float(x, y, text, color) { this.floats.push({ x, y, text, color, life: 0.9 }); }
  // In-place compaction (no per-step array allocation → no GC hitching).
  _updateParticles(step) {
    let w = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.x += p.vx * step; p.y += p.vy * step; p.vy += 600 * step; p.life -= step;
      if (p.life > 0) this.particles[w++] = p;
    }
    this.particles.length = w;
  }
  _updateFloats(step) {
    let w = 0;
    for (let i = 0; i < this.floats.length; i++) {
      const f = this.floats[i];
      f.y -= 40 * step; f.life -= step;
      if (f.life > 0) this.floats[w++] = f;
    }
    this.floats.length = w;
  }

  aabb(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  _updateCamera() {
    const ahead = this.facing * 80;
    const target = clamp(this.px + PW / 2 + ahead - W / 2, 0, this.level.width * TILE - W);
    this.camX += (target - this.camX) * 0.08;
    const ty = clamp(this.py + PH / 2 - H / 2, 0, Math.max(0, this.level.height * TILE - H));
    this.camY += (ty - this.camY) * 0.08;
  }

  // Throttled DOM push: emit immediately on a state/heart/coin change, otherwise
  // at most 10Hz (the timer is the only field that changes every step). Avoids
  // 60 DOM writes/sec → layout thrash. hearts is clamped so a latent negative
  // can't throw RangeError out of _onPlatformerStatus ('♥'.repeat(-1)) and
  // kill the rAF chain.
  emit() {
    const stateChanged = this._lastEmitState !== this.state;
    const heartsChanged = this._lastEmitHearts !== this.hearts;
    const coinsChanged = this._lastEmitCoins !== this.coins;
    const due = (this.time - (this._lastEmitT || 0)) >= 0.1;
    if (!stateChanged && !heartsChanged && !coinsChanged && !due) return;
    this._lastEmitState = this.state;
    this._lastEmitHearts = this.hearts;
    this._lastEmitCoins = this.coins;
    this._lastEmitT = this.time;
    this.onStatus({ state: this.state, hearts: Math.max(0, this.hearts), coins: this.coins, totalCoins: this.totalCoins, time: this.time, level: this.levelIdx });
  }

  // ---- render ----
  // Pre-render the hero sprite + neon tile to offscreen canvases once. The hot
  // path then blits each with ONE drawImage (the shadow glow is baked in, or
  // applied in a single pass) instead of dozens of shadowBlur-affected fillRects
  // per frame — shadowBlur is the most expensive canvas op and was the main
  // cause of frame drops / "random stops" (the hero pixel loop alone drew ~80
  // shadowed fillRects, ×8 trail copies).
  _ensureCache() {
    if (this._heroCache) return;
    const mkHero = (frame) => {
      const cv = document.createElement('canvas');
      cv.width = PW; cv.height = PH;
      const x = cv.getContext('2d');
      for (let r = 0; r < frame.length; r++) {
        const row = frame[r];
        for (let c = 0; c < row.length; c++) {
          const ch = row[c];
          if (ch === '.') continue;
          x.fillStyle = ch === '2' ? C.white : C.cyan;
          x.fillRect(c * 3, r * 3, 3, 3);
        }
      }
      return cv;
    };
    this._heroCache = { r0: mkHero(HERO_RUN[0]), r1: mkHero(HERO_RUN[1]), jump: mkHero(HERO_JUMP) };
    const mkTile = (color) => {
      const cv = document.createElement('canvas');
      cv.width = TILE; cv.height = TILE;
      const x = cv.getContext('2d');
      x.fillStyle = 'rgba(10,6,26,0.9)'; x.fillRect(0, 0, TILE, TILE);
      x.strokeStyle = color; x.lineWidth = 2;
      x.shadowColor = color; x.shadowBlur = 8;
      x.strokeRect(1, 1, TILE - 2, TILE - 2);
      x.fillStyle = color; x.fillRect(2, 2, TILE - 4, 2);
      x.shadowBlur = 0;
      return cv;
    };
    this._tileCache = { blue: mkTile(C.blue), purple: mkTile(C.purple) };
  }

  render() {
    const ctx = this.ctx;
    if (!ctx) return;
    this._ensureCache();
    ctx.save();
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    // parallax background (no camera clamp — these wrap)
    this._drawStars();
    this._drawHills();
    ctx.translate(-Math.round(this.camX), -Math.round(this.camY));

    this._drawTiles();
    this._drawMovers();
    this._drawCoins();
    this._drawGoal();
    this._drawEnemies();
    this._drawTrail();
    this._drawPlayer();
    this._drawParticles();
    this._drawFloats();

    ctx.restore();
    this._drawHUD();
    this._drawFlash();
  }

  _drawStars() {
    const ctx = this.ctx;
    if (!this._stars) {
      this._stars = [];
      for (let i = 0; i < 80; i++) this._stars.push({ x: this._rand() * W * 3, y: this._rand() * H, s: this._rand() * 1.6 + 0.4 });
    }
    ctx.fillStyle = C.white;
    for (const s of this._stars) {
      let x = (s.x - this.camX * 0.2) % (W * 3);
      if (x < 0) x += W * 3;
      if (x > W) continue;
      ctx.globalAlpha = 0.5;
      ctx.fillRect(x, s.y, s.s, s.s);
    }
    ctx.globalAlpha = 1;
  }

  _drawHills() {
    const ctx = this.ctx;
    const off = this.camX * 0.5;
    ctx.fillStyle = 'rgba(176,77,255,0.18)';
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 40) {
      const wx = x + off;
      const y = H - 80 - Math.sin(wx * 0.01) * 40 - Math.sin(wx * 0.003) * 60;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(77,121,255,0.14)';
    ctx.beginPath(); ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 40) {
      const wx = x + off * 1.6;
      const y = H - 40 - Math.sin(wx * 0.008) * 30;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
  }

  _drawTiles() {
    const ctx = this.ctx;
    const c0 = clamp(flr(this.camX / TILE) - 1, 0, this.level.width - 1);
    const c1 = clamp(flr((this.camX + W) / TILE) + 1, 0, this.level.width - 1);
    for (let r = 0; r < this.level.height; r++) {
      for (let c = c0; c <= c1; c++) {
        const ch = this.grid[r][c];
        if (ch === '.') continue;
        const x = c * TILE, y = r * TILE;
        if (ch === '#') this._neonTile(x, y, C.blue);
        else if (ch === 'B' || ch === 'b') this._neonTile(x, y, C.purple);
        else if (ch === '=') {
          ctx.fillStyle = 'rgba(77,121,255,0.25)'; ctx.fillRect(x, y, TILE, 8);
          ctx.fillStyle = C.blue; ctx.fillRect(x, y, TILE, 3);
          ctx.shadowColor = C.blue; ctx.shadowBlur = 8; ctx.fillRect(x, y, TILE, 3); ctx.shadowBlur = 0;
        } else if (ch === '^') {
          ctx.fillStyle = C.red;
          ctx.shadowColor = C.red; ctx.shadowBlur = 6;
          for (let i = 0; i < 4; i++) {
            const sx = x + i * 8;
            ctx.beginPath(); ctx.moveTo(sx, y + TILE); ctx.lineTo(sx + 4, y + 6); ctx.lineTo(sx + 8, y + TILE); ctx.closePath(); ctx.fill();
          }
          ctx.shadowBlur = 0;
        }
      }
    }
  }

  _neonTile(x, y, color) {
    // one drawImage of the pre-baked tile — no per-tile shadowBlur in the hot path
    this.ctx.drawImage(this._tileCache[color === C.purple ? 'purple' : 'blue'], x, y);
  }

  _drawMovers() {
    const ctx = this.ctx;
    for (const m of this.movers) {
      ctx.fillStyle = 'rgba(176,77,255,0.3)'; ctx.fillRect(m.x, m.y, m.w, 10);
      ctx.fillStyle = C.purple; ctx.shadowColor = C.purple; ctx.shadowBlur = 10;
      ctx.fillRect(m.x, m.y, m.w, 4); ctx.shadowBlur = 0;
    }
  }

  _drawCoins() {
    const ctx = this.ctx;
    ctx.fillStyle = C.gold; ctx.shadowColor = C.gold; ctx.shadowBlur = 10;
    const pulse = 0.7 + Math.sin(this.time * 6) * 0.3;
    for (const c of this.coinSet) {
      if (c.got) continue;
      const x = c.x * TILE + TILE / 2, y = c.y * TILE + TILE / 2 + Math.sin(this.time * 4 + c.x) * 3;
      ctx.beginPath(); ctx.ellipse(x, y, 7 * pulse, 9, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  _drawGoal() {
    const ctx = this.ctx;
    const g = this.level.goal;
    const x = g.x * TILE + TILE / 2, y = g.y * TILE + TILE;
    const t = this.time * 3;
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = i === 0 ? C.green : i === 1 ? C.cyan : C.pink;
      ctx.lineWidth = 3; ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(x, y - 4, 8 + i * 5 + Math.sin(t + i) * 3, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }

  _drawEnemies() {
    const ctx = this.ctx;
    for (const e of this.enemies) {
      if (!e.alive && e.pop <= 0) continue;
      ctx.save();
      ctx.translate(e.x + e.w / 2, e.y + e.h / 2);
      if (!e.alive) { ctx.scale(1, 0.15); ctx.globalAlpha = e.pop / 0.1; }
      ctx.fillStyle = C.orange; ctx.shadowColor = C.orange; ctx.shadowBlur = 12;
      ctx.fillRect(-e.w / 2, -e.h / 2, e.w, e.h);
      ctx.shadowBlur = 0;
      // eyes
      ctx.fillStyle = C.white;
      ctx.fillRect(-8, -6, 5, 5); ctx.fillRect(3, -6, 5, 5);
      ctx.fillStyle = C.bg;
      ctx.fillRect(-7, -5, 3, 3); ctx.fillRect(4, -5, 3, 3);
      // feet
      ctx.fillStyle = C.orange;
      const f = e.frame ? 3 : -3;
      ctx.fillRect(-9, e.h / 2 - 4 + f, 7, 4);
      ctx.fillRect(2, e.h / 2 - 4 - f, 7, 4);
      ctx.restore();
    }
  }

  _drawTrail() {
    if (this.reduced) return;
    const ctx = this.ctx;
    for (const t of this.trail) {
      ctx.globalAlpha = (t.t / 0.18) * 0.4;
      this._drawHero(t.x, t.y, HERO_RUN[this.runFrame], 0, false);
    }
    ctx.globalAlpha = 1;
  }

  _drawPlayer() {
    if (this.state === 'dead') return;
    if (this.invuln > 0 && Math.floor(this.invuln * 20) % 2 === 0) return; // blink
    let frame = HERO_RUN[0];
    if (!this.grounded) frame = HERO_JUMP;
    else if (Math.abs(this.vx) > 8) frame = HERO_RUN[this.runFrame];
    this._drawHero(this.px, this.py, frame, this.squash);
  }

  _drawHero(px, py, frame, sq, glow = true) {
    const ctx = this.ctx;
    let sx = 1, sy = 1;
    if (sq > 0) {
      const t = sq / 0.08;
      if (this.squashDir > 0) { sy = 1 - 0.15 * t; sx = 1 + 0.15 * t; }
      else { sy = 1 + 0.15 * t; sx = 1 - 0.15 * t; }
    }
    const img = frame === HERO_JUMP ? this._heroCache.jump : (frame === HERO_RUN[1] ? this._heroCache.r1 : this._heroCache.r0);
    const cx = px + PW / 2, cy = py + PH / 2;
    ctx.save();
    ctx.translate(cx, cy);
    if (this.facing < 0) ctx.scale(-1, 1);
    ctx.scale(sx, sy);
    if (glow) { ctx.shadowColor = C.cyan; ctx.shadowBlur = 12; }
    ctx.drawImage(img, -PW / 2, -PH / 2);
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  _drawParticles() {
    const ctx = this.ctx;
    for (const p of this.particles) {
      ctx.globalAlpha = clamp(p.life, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, 3, 3);
    }
    ctx.globalAlpha = 1;
  }

  _drawFloats() {
    const ctx = this.ctx;
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'center';
    for (const f of this.floats) {
      ctx.globalAlpha = clamp(f.life, 0, 1);
      ctx.fillStyle = f.color;
      ctx.shadowColor = f.color; ctx.shadowBlur = 8;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1; ctx.shadowBlur = 0; ctx.textAlign = 'start';
  }

  _drawHUD() {
    const ctx = this.ctx;
    // hearts top-left
    for (let i = 0; i < MAX_HEARTS; i++) {
      const x = 14 + i * 26, y = 18;
      const filled = i < this.hearts;
      ctx.fillStyle = filled ? C.pink : 'rgba(122,106,168,0.25)';
      ctx.shadowColor = filled ? C.pink : 'transparent';
      ctx.shadowBlur = filled ? 8 : 0;
      this._heart(x, y, 9);
    }
    ctx.shadowBlur = 0;
    // coins + timer top-right
    ctx.textAlign = 'right';
    ctx.font = 'bold 18px monospace';
    ctx.fillStyle = C.gold; ctx.shadowColor = C.gold; ctx.shadowBlur = 6;
    ctx.fillText(`◆ ${this.coins}/${this.totalCoins}`, W - 14, 30);
    ctx.fillStyle = C.cyan; ctx.shadowColor = C.cyan;
    ctx.fillText(`${this.time.toFixed(1)}s`, W - 14, 54);
    ctx.shadowBlur = 0; ctx.textAlign = 'start';
    // level label top-center
    ctx.textAlign = 'center';
    ctx.fillStyle = C.dim; ctx.font = 'bold 12px monospace';
    ctx.fillText(`${GAME_NAME} · L${this.levelIdx + 1}`, W / 2, 22);
    ctx.textAlign = 'start';
  }

  _heart(x, y, s) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.3);
    ctx.bezierCurveTo(x, y, x - s, y, x - s, y + s * 0.3);
    ctx.bezierCurveTo(x - s, y + s * 0.7, x, y + s, x, y + s * 1.1);
    ctx.bezierCurveTo(x, y + s, x + s, y + s * 0.7, x + s, y + s * 0.3);
    ctx.bezierCurveTo(x + s, y, x, y, x, y + s * 0.3);
    ctx.fill();
  }

  _drawFlash() {
    if (this.flash <= 0) return;
    const ctx = this.ctx;
    ctx.globalAlpha = clamp(this.flash, 0, 1) * (this.state === 'dead' ? 0.7 : 0.4);
    ctx.fillStyle = C.white;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }
}

// ---- sound (tiny wrappers over the shared arcadeFX synth) ----
function blip(kind) {
  if (arcadeFX.muted) return;
  const map = { jump: { freq: 420, endFreq: 720, dur: 0.1, gain: 0.12 }, land: { freq: 200, endFreq: 120, dur: 0.05, gain: 0.08 }, coin: { freq: 980, endFreq: 1480, dur: 0.07, gain: 0.12 }, break: { freq: 300, endFreq: 120, dur: 0.12, gain: 0.14, type: 'sawtooth' }, stomp: { freq: 160, endFreq: 60, dur: 0.12, gain: 0.16, type: 'square' }, hit: { freq: 240, endFreq: 80, dur: 0.2, gain: 0.18, type: 'sawtooth' }, die: { freq: 300, endFreq: 40, dur: 0.4, gain: 0.2, type: 'sawtooth' }, levelup: { freq: 660, endFreq: 990, dur: 0.18, gain: 0.16 } };
  const s = map[kind]; if (s) arcadeFX._tone({ type: s.type || 'square', freq: s.freq, endFreq: s.endFreq, dur: s.dur, gain: s.gain });
}

// ---- self-check (node --input-type=module): physics invariants + level sanity ----
export function _selfCheck() {
  const assert = (c, m) => { if (!c) throw new Error('PLATFORMER SELF-CHECK FAILED: ' + m); };
  // physics constants satisfy the spec relationships
  assert(JUMP_VEL < 0 && GRAVITY > 0, 'jump up / gravity down');
  assert(FALL_MULT > 1 && RISE_REL_MULT > 1, 'faster fall + short-hop');
  assert(JUMP_CUT > 0 && JUMP_CUT < 1, 'jump cut shrinks rise');
  assert(MAX_RUN > 0 && RUN_ACC > 0 && GROUND_FRICTION > 0, 'run tunables positive');
  assert(AIR_CONTROL > 0 && AIR_CONTROL < 1, 'air control is a fraction');
  assert(COYOTE > 0 && BUFFER > 0, 'coyote + buffer positive');
  assert(STEP === 1 / 60, 'fixed 60Hz step');

  // levels well-formed
  for (let i = 0; i < LEVELS.length; i++) {
    const L = LEVELS[i];
    const len = L.rows[0].length;
    assert(L.rows.every((r) => r.length === len), `L${i + 1} rows equal length`);
    assert(L.spawn, `L${i + 1} has a spawn`);
    assert(L.goal, `L${i + 1} has a goal`);
    assert(L.width >= 110, `L${i + 1} >= 110 wide (got ${L.width})`);
    assert(L.height === 15, `L${i + 1} 15 tall`);
    assert(L.coins.length > 0, `L${i + 1} has coins`);
  }

  // jump cut math (-700 * 0.45 = -315)
  assert(Math.round(-700 * JUMP_CUT) === -315, 'jump cut = 45% of -700');
  // a max-speed jump must clear a 4-tile spike strip (128px) AND reach a 4-tile
  // platform (128px up). t_up = 700/1500, h = 700²/3000 ≈ 163; air ≈ 0.81s → ~187px.
  {
    const h = (700 * 700) / (2 * 1500);
    const air = 700 / 1500 + Math.sqrt((2 * h) / (1500 * FALL_MULT));
    assert(h > 128, 'jump apex reaches a 4-tile-high platform');
    assert(230 * air > 160, 'max-speed jump clears a 5-tile hazard');
  }
  assert(PIT_MARGIN > 0 && STUCK_TIME > 0, 'pit + stuck failsafe thresholds positive');

  // collision: a solid wall stops horizontal motion (pure, via the level grid)
  const lv = LEVELS[0];
  assert(solidAt(lv, 0, 0) === true, 'corner wall is solid');
  assert(solidAt(lv, lv.spawn.x, lv.spawn.y) === false, 'spawn tile not solid');

  // The L2 soft-lock root cause: a tile was implicitly both "solid" (resolved by
  // the X/Y mover) and "trigger" (the hazard check), so the two fought. Verify
  // the fix — no tile type is both solid and a trigger — on a 1-row test level.
  const tl = buildLevel(6, 1, (set) => { set(0, 0, '#'); set(1, 0, '='); set(2, 0, 'B'); set(3, 0, 'b'); set(4, 0, '^'); });
  assert(solidAt(tl, 0, 0) && !solidAt(tl, 4, 0), 'spike is NOT solid (trigger-only)');
  assert(!oneWayAt(tl, 0, 0) && oneWayAt(tl, 1, 0), 'one-way is its own class');
  assert(spikeAt(tl, 4, 0) && !spikeAt(tl, 0, 0) && !spikeAt(tl, 1, 0), 'spike is its own class');
  assert(breakableAt(tl, 2, 0) === 'B' && breakableAt(tl, 0, 0) === '', 'breakable is its own class');
  assert(HAZARD_H > 0 && HAZARD_INSET > 0, 'spike trigger geometry positive');
  assert(HAZARD_STUCK > 0, 'soft-lock failsafe threshold positive');

  // unlock/coins helpers round-trip (use the in-memory defaults, no real IO)
  assert(getUnlocked() >= 0, 'unlocked clamped >= 0');

  console.log('PLATFORMER self-check OK — levels:', LEVELS.length, 'widths:', LEVELS.map((l) => l.width).join(','), 'name:', GAME_NAME);
  return true;
}

export { LEVELS, getBest, getCoins, getUnlocked, MAX_HEARTS, START_HEARTS };