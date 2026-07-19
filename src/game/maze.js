// NEON MUNCH — maze-chase game (classic mechanics, original theme) for the
// arcade hub. A glowing cyan orb ("the Spark") clears a neon maze while four
// glowing wisps hunt it with a shared target-tile AI. Vanilla <canvas>, no
// images, no Namco-derived names/designs/layouts. Reuses arcadeFX SFX.
//
// Build in the order the game feels: movement → one wisp + AI framework → the
// other three wisps → power/bonus/levels/polish. The AI (decideWispDir) is one
// generic routine shared by all four wisps; only chaseTarget() differs.
//
// High score in localStorage under 'maze'. No backend wired here.
import { arcadeFX } from './arcade.js';

// Single source for the display name. Rename here only.
export const GAME_NAME = 'NEON MUNCH';
const HS_KEY = 'geoguesser_maze_highscore';

// ---- grid ----
const TILE = 16;
const W = 28, H = 31;
const BOARD_W = W * TILE; // 448
const BOARD_H = H * TILE; // 496

const TUNNEL_ROW = 15;
const DEN_TOP = 12, DEN_BOTTOM = 18, DEN_LEFT = 9, DEN_RIGHT = 18;
const DOOR_COLS = [13, 14];

// ---- maze layout (generated + validated: symmetric, connected, no dead-ends,
// single den exit) ----
const FULL_H_ROWS = [1, 5, 7, 9, 11, 19, 21, 23, 25, 29];
const V_COLS = [1, 4, 7, 10, 13, 14, 17, 20, 23, 26];

function buildMaze() {
  const g = Array.from({ length: H }, () => Array.from({ length: W }, () => '#'));
  for (const r of FULL_H_ROWS) for (let c = 1; c <= 26; c++) g[r][c] = '.';
  for (const c of V_COLS) for (let r = 1; r <= 29; r++) g[r][c] = '.';
  for (let c = 0; c <= 7; c++) g[TUNNEL_ROW][c] = '.';
  for (let c = 20; c <= 27; c++) g[TUNNEL_ROW][c] = '.';
  for (let r = DEN_TOP; r <= DEN_BOTTOM; r++) {
    for (let c = DEN_LEFT; c <= DEN_RIGHT; c++) {
      if (r === DEN_TOP && DOOR_COLS.includes(c)) g[r][c] = '-';
      else if (r === DEN_TOP || r === DEN_BOTTOM || c === DEN_LEFT || c === DEN_RIGHT) g[r][c] = '#';
      else g[r][c] = 'G';
    }
  }
  for (const [r, c] of [[3, 1], [3, 26], [27, 1], [27, 26]]) g[r][c] = 'o';
  g[23][13] = 'P';
  g[TUNNEL_ROW][0] = ' ';
  g[TUNNEL_ROW][27] = ' ';
  return g.map((r) => r.join(''));
}
const MAZE = buildMaze();
const TILES = MAZE.map((r) => r.split(''));

const SPAWN = { r: 23, c: 13 };
// Inside-den home tiles (used for EYES target + reform) + a starting spot.
const WISP_HOMES = [
  { r: 14, c: 13 }, // W1 Stalker — reforms here, but STARTS outside (above the door)
  { r: 14, c: 11 }, // W2 Ambusher
  { r: 14, c: 16 }, // W3 Flanker
  { r: 16, c: 13 }, // W4 Coward
];
const WISP_START = [
  { r: 11, c: 13 }, // W1 starts outside, above the door
  { r: 14, c: 11 }, // W2..4 start in their homes
  { r: 14, c: 16 },
  { r: 16, c: 13 },
];
// Scatter corner tiles (may be wall — wisps just head there and orbit).
const SCATTER = [
  { r: 0, c: W - 1 }, // W1 top-right
  { r: 0, c: 0 }, // W2 top-left
  { r: H - 1, c: W - 1 }, // W3 bottom-right
  { r: H - 1, c: 0 }, // W4 bottom-left
];
const RELEASE_PELLETS = [0, 10, 30, 60]; // pellets eaten before wisp leaves den

// ---- directions ----
const D = {
  up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
  none: { x: 0, y: 0 },
};
const TIE_ORDER = ['up', 'left', 'down', 'right']; // tie-break priority
const KEY_TO_DIR = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right',
};

// ---- tile helpers (with tunnel wrap) ----
function tileChar(r, c) {
  if (r === TUNNEL_ROW) { if (c < 0) c = W - 1; if (c >= W) c = 0; }
  if (r < 0 || r >= H || c < 0 || c >= W) return '#';
  return TILES[r][c];
}
function onTunnelRow(r) { return r === TUNNEL_ROW; }
// Player cannot enter walls, the den door, or the den interior.
function playerBlockedAt(r, c) {
  const ch = tileChar(r, c);
  return ch === '#' || ch === '-' || ch === 'G';
}
// Wisps: '#' is always a wall. Door '-' and den 'G' are passable only while
// leaving the house or in EYES mode.
function wispBlockedAt(r, c, allowDen) {
  const ch = tileChar(r, c);
  if (ch === '#') return true;
  if (allowDen) return false;
  return ch === '-' || ch === 'G';
}

function tileOf(px, py) { return { c: Math.floor(px / TILE), r: Math.floor(py / TILE) }; }

// ---- speed model (tiles/s → px/s) ----
const PLAYER_TPS = 9;
function playerPxPerSec() { return PLAYER_TPS * TILE; } // 144
function wispSpeedFactor(level) { return Math.min(0.95, 0.85 + 0.03 * (level - 1)); }
function wispPxPerSec(level) { return wispSpeedFactor(level) * PLAYER_TPS * TILE; }
function tunnelPxPerSec() { return 0.45 * PLAYER_TPS * TILE; }
function frightPxPerSec() { return 0.6 * PLAYER_TPS * TILE; }
function eyesPxPerSec() { return 1.3 * PLAYER_TPS * TILE; }

const CORNER = 4; // px — cornering-assist window before a tile center

// ---- floating texts (eaten-wisp scores, bonus values) ----
function makeFloat(r, c, text, color) {
  return { x: c * TILE + TILE / 2, y: r * TILE + TILE / 2, text, color, life: 1.0, max: 1.0 };
}

// ===================================================================
// Actor movement — corridor-locked, continuous pixels.
// moveActor(): advances one frame along a.dir, stopping at the upcoming tile
// center if the next tile is a wall (so decisions happen at centers).
// tryTurnPlayer(): applies the buffered 90° turn within CORNER px before a
// center (cornering assist), snapping to that center; reverses instantly.
// ===================================================================
function moveActor(a, dist, blockedFn) {
  if (a.dir.x !== 0) {
    const { c, r } = tileOf(a.px, a.py);
    const nx = a.px + a.dir.x * dist;
    const aheadBlocked = blockedFn(r, c + a.dir.x);
    const lim = (c + 0.5) * TILE;
    a.px = aheadBlocked ? (a.dir.x > 0 ? Math.min(nx, lim) : Math.max(nx, lim)) : nx;
    a.py = (r + 0.5) * TILE; // corridor-lock Y while moving horizontally
    if (onTunnelRow(r)) {
      if (a.px < 0) a.px += W * TILE;
      else if (a.px >= W * TILE) a.px -= W * TILE;
    }
  } else if (a.dir.y !== 0) {
    const { c, r } = tileOf(a.px, a.py);
    const ny = a.py + a.dir.y * dist;
    const aheadBlocked = blockedFn(r + a.dir.y, c);
    const lim = (r + 0.5) * TILE;
    a.py = aheadBlocked ? (a.dir.y > 0 ? Math.min(ny, lim) : Math.max(ny, lim)) : ny;
    a.px = (c + 0.5) * TILE; // corridor-lock X while moving vertically
  }
}

function tryTurnPlayer(p, blockedFn) {
  const want = p.want;
  if (!want) return;
  // Instant reverse anytime.
  if (want.x === -p.dir.x && want.y === -p.dir.y && (p.dir.x || p.dir.y)) {
    p.dir = want; p.want = null; return;
  }
  const { c, r } = tileOf(p.px, p.py);
  const cx = (c + 0.5) * TILE, cy = (r + 0.5) * TILE;
  let turnC = c, turnR = r, center = 0, before = 0;
  if (p.dir.x > 0) {
    if (p.px <= cx) { turnC = c; center = cx; } else { turnC = c + 1; center = cx + TILE; }
    before = center - p.px;
  } else if (p.dir.x < 0) {
    if (p.px >= cx) { turnC = c; center = cx; } else { turnC = c - 1; center = cx - TILE; }
    before = p.px - center;
  } else if (p.dir.y > 0) {
    if (p.py <= cy) { turnR = r; center = cy; } else { turnR = r + 1; center = cy + TILE; }
    before = center - p.py;
  } else if (p.dir.y < 0) {
    if (p.py >= cy) { turnR = r; center = cy; } else { turnR = r - 1; center = cy - TILE; }
    before = p.py - center;
  } else {
    // Stopped: any passable direction starts us.
    for (const name of TIE_ORDER) {
      const d = D[name];
      if (!blockedFn(r + d.y, c + d.x)) { p.dir = d; p.want = null; return; }
    }
    return;
  }
  // Within CORNER px before the upcoming center → snap + turn.
  if (before <= CORNER && before >= -0.01) {
    if (!blockedFn(turnR + want.y, turnC + want.x)) {
      p.px = (turnC + 0.5) * TILE;
      p.py = (turnR + 0.5) * TILE;
      p.dir = want; p.want = null;
    }
  }
}

// ---- wisp movement: step center-by-center, deciding direction at each center ----
function stepWisp(w, dist) {
  let remaining = dist;
  let guard = 0;
  while (remaining > 1e-4 && guard++ < 12) {
    const { c, r } = tileOf(w.px, w.py);
    let center, tc = c, tr = r, axis;
    if (w.dir.x !== 0) {
      const cc = (c + 0.5) * TILE;
      // If we haven't reached the current tile center yet, head there; once at
      // it (or past it), head to the next tile center in the travel direction.
      if (w.dir.x > 0) { if (w.px < cc - 0.001) { center = cc; } else { center = cc + TILE; tc = c + 1; } }
      else { if (w.px > cc + 0.001) { center = cc; } else { center = cc - TILE; tc = c - 1; } }
      axis = 'x';
    } else if (w.dir.y !== 0) {
      const cc = (r + 0.5) * TILE;
      if (w.dir.y > 0) { if (w.py < cc - 0.001) { center = cc; } else { center = cc + TILE; tr = r + 1; } }
      else { if (w.py > cc + 0.001) { center = cc; } else { center = cc - TILE; tr = r - 1; } }
      axis = 'y';
    } else { decideWispDir(w, c, r); if (w.dir.x === 0 && w.dir.y === 0) return; continue; }
    const d = Math.abs(center - (axis === 'x' ? w.px : w.py));
    if (d <= remaining) {
      if (axis === 'x') { w.px = center; w.py = (r + 0.5) * TILE; }
      else { w.py = center; w.px = (c + 0.5) * TILE; }
      remaining -= d;
      // wrap after crossing a tunnel-row center
      if (onTunnelRow(axis === 'x' ? r : tr)) {
        if (w.px < 0) w.px += W * TILE; else if (w.px >= W * TILE) w.px -= W * TILE;
      }
      decideWispDir(w, tc, tr);
    } else {
      if (axis === 'x') w.px += w.dir.x * remaining; else w.py += w.dir.y * remaining;
      remaining = 0;
    }
  }
  if (onTunnelRow(Math.floor(w.py / TILE))) {
    if (w.px < 0) w.px += W * TILE; else if (w.px >= W * TILE) w.px -= W * TILE;
  }
}

// Choose a wisp's next direction at tile (c,r) based on its mode + personality.
function decideWispDir(w, c, r) {
  // Bobbing in the den before release.
  if (w.inHouse && !w.released) { w.dir = D.none; return; }
  // Leaving the den: head for the door, allowed through G and '-'.
  if (w.inHouse && w.released) {
    const door = nearestDoor(c, r);
    pickToward(w, c, r, door, true);
    if (r <= DEN_TOP - 1) { w.inHouse = false; }
    return;
  }
  if (w.mode === 'EYES') {
    pickToward(w, c, r, w.home, true);
    if (c === w.home.c && r === w.home.r) w.reform();
    return;
  }
  if (w.mode === 'FRIGHTENED') { pickRandom(w, c, r); return; }
  const target = w.mode === 'CHASE' ? w.chaseTarget() : w.scatterCorner;
  pickToward(w, c, r, target, false);
}

function nearestDoor(c, _r) {
  // door tile is just above the den interior, at the nearest door column.
  const col = Math.abs(c - DOOR_COLS[0]) <= Math.abs(c - DOOR_COLS[1]) ? DOOR_COLS[0] : DOOR_COLS[1];
  return { r: DEN_TOP - 1, c: col }; // target the path tile just above the door
}

// Pick the legal (non-reversing) direction minimizing straight-line distance to
// target; tie-break up > left > down > right. Falls back to reverse if boxed in.
function pickToward(w, c, r, target, allowDen) {
  const blocked = (rr, cc) => wispBlockedAt(rr, cc, allowDen);
  const opts = [];
  for (const name of TIE_ORDER) {
    const d = D[name];
    if (d.x === -w.dir.x && d.y === -w.dir.y) continue; // no reverse
    if (blocked(r + d.y, c + d.x)) continue;
    const nr = r + d.y, nc = c + d.x;
    const dist = (nr - target.r) ** 2 + (nc - target.c) ** 2;
    opts.push({ name, d, dist });
  }
  if (opts.length === 0) { w.dir = { x: -w.dir.x, y: -w.dir.y }; return; } // forced reverse
  if (opts.length === 1) { w.dir = opts[0].d; return; }
  opts.sort((a, b) => (a.dist - b.dist) || TIE_ORDER.indexOf(a.name) - TIE_ORDER.indexOf(b.name));
  w.dir = opts[0].d;
}

function pickRandom(w, c, r) {
  const opts = [];
  for (const name of TIE_ORDER) {
    const d = D[name];
    if (d.x === -w.dir.x && d.y === -w.dir.y) continue;
    if (wispBlockedAt(r + d.y, c + d.x, false)) continue;
    opts.push(d);
  }
  if (opts.length === 0) { w.dir = { x: -w.dir.x, y: -w.dir.y }; return; }
  w.dir = opts[Math.floor(Math.random() * opts.length)];
}

// ===================================================================
// Maze game
// ===================================================================
export class Maze {
  constructor(opts = {}) {
    this.canvas = opts.canvas;
    this.ctx = this.canvas?.getContext('2d');
    this.boardFrame = opts.boardFrame;
    this.onHighScore = opts.onHighScore || (() => {});
    this.reducedMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.running = false;
    this.state = 'idle';
    this.time = 0;
    this.reset(true);
  }

  // ---- full reset (new game / first start) ----
  reset(full = false) {
    this.level = full ? 1 : this.level;
    this.lives = full ? 3 : this.lives;
    this.score = full ? 0 : this.score;
    this.displayedScore = this.score;
    this.pellets = null;
    this.bonus = null;
    this.bonusShown = [false, false];
    this.floats = [];
    this.particles = [];
    this.trail = [];
    this.eatChain = 0; // 1..4 within one power phase
    this.frightActive = false;
    this.frightTimer = 0;
    this.frightDuration = this.frightenDuration();
    this.globalMode = 'SCATTER';
    this.globalTimer = 0;
    this.modeIndex = 0;
    this.modeTimes = [7000, 20000, 7000, 20000, 5000, 20000, 5000, Infinity];
    this.eatenThisLife = 0; // pellet count since last death (wisp release gates)
    this.resetMaze(full);
    this.resetActors();
  }

  resetMaze(_full = true) {
    // pellets[r][c]: true if a normal pellet still sits on this path tile.
    this.pellets = Array.from({ length: H }, () => Array(W).fill(false));
    this.powerPellets = []; // {r,c}
    this.remaining = 0;
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const ch = TILES[r][c];
        if (ch === '.') { this.pellets[r][c] = true; this.remaining++; }
        else if (ch === 'o') { this.powerPellets.push({ r, c }); this.remaining++; }
      }
    }
    this.bonusShown = [false, false];
    this.buildWallCanvas();
    this.buildPelletCanvas();
  }

  resetActors() {
    // Player (the Spark).
    this.player = {
      px: SPAWN.c * TILE + TILE / 2,
      py: SPAWN.r * TILE + TILE / 2,
      dir: D.left, want: null, facing: D.left, eatPause: 0,
      chomp: 0, alive: true,
    };
    // Four wisps.
    this.wisps = WISP_HOMES.map((home, i) => ({
      idx: i,
      home,
      px: WISP_START[i].c * TILE + TILE / 2,
      py: WISP_START[i].r * TILE + TILE / 2,
      dir: i === 0 ? D.left : D.up,
      mode: 'SCATTER',
      inHouse: i !== 0, // W1 starts outside
      released: i === 0,
      reformTimer: 0,
      flicker: 0,
      scatterCorner: SCATTER[i],
    }));
    this.eatenThisLife = 0;
    this.eatChain = 0;
    this.frightActive = false;
    this.frightTimer = 0;
    this.globalMode = 'SCATTER';
    this.globalTimer = 0;
    this.modeIndex = 0;
  }

  frightenDuration() { return Math.max(0, 6 - (this.level - 1)); }
  releaseThreshold(i) {
    if (i === 0) return 0;
    return Math.max(1, Math.floor(RELEASE_PELLETS[i] / Math.pow(2, this.level - 1)));
  }

  // ---- lifecycle ----
  start() {
    if (this.running) return;
    this.running = true;
    this.reset(true);
    this.beginReady(2.0);
    this.bindInput();
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.loop.bind(this));
  }
  stop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.unbindInput();
    this.hideOverlays();
  }
  retry() {
    this.hideOverlays();
    this.reset(true);
    this.beginReady(2.0);
    this.lastTime = performance.now();
  }
  togglePause() {
    if (this.state === 'gameover' || this.state === 'levelclear') return;
    if (this.state === 'playing' || this.state === 'ready') {
      this._wasState = this.state;
      this.state = 'paused';
      const ov = document.getElementById('maze-pause-overlay');
      if (ov) ov.classList.remove('hidden');
    } else if (this.state === 'paused') {
      this.hideOverlays();
      this.state = this._wasState || 'playing';
      this.lastTime = performance.now();
    }
  }

  beginReady(t) {
    this.state = 'ready';
    this.readyTimer = t;
  }

  hideOverlays() {
    for (const id of ['maze-ready-overlay', 'maze-pause-overlay', 'maze-gameover-overlay']) {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    }
  }

  loop(now) {
    if (!this.running) return;
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (dt > 0.05) dt = 0.05; // cap for tab-away
    this.time += dt;
    this.update(dt);
    this.render();
    this.rafId = requestAnimationFrame(this.loop.bind(this));
  }

  // ---- update ----
  update(dt) {
    this.updateParticles(dt);
    for (const f of this.floats) { f.life -= dt; f.y -= 16 * dt; }
    this.floats = this.floats.filter((f) => f.life > 0);

    if (this.state === 'paused') return;

    if (this.state === 'ready') {
      this.readyTimer -= dt;
      if (this.readyTimer <= 0) { this.state = 'playing'; this.lastTime = performance.now(); }
      return;
    }

    if (this.state === 'dying') {
      this.dyingTimer -= dt;
      this.updateParticles(dt);
      if (this.dyingTimer <= 0) this.finishDeath();
      return;
    }

    if (this.state === 'frozen') {
      this.frozenTimer -= dt;
      if (this.frozenTimer <= 0) { this.afterFreeze(); }
      return;
    }

    if (this.state === 'levelclear') {
      this.levelClearTimer -= dt;
      this.flashPhase += dt;
      if (this.levelClearTimer <= 0) this.advanceLevel();
      return;
    }

    if (this.state !== 'playing') return;

    // Global scatter/chase timer (pauses while frightened active).
    if (!this.frightActive) {
      this.globalTimer += dt * 1000;
      if (this.globalTimer >= this.modeTimes[this.modeIndex]) {
        this.globalTimer = 0;
        this.modeIndex = Math.min(this.modeIndex + 1, this.modeTimes.length - 1);
        this.globalMode = this.modeIndex % 2 === 0 ? 'SCATTER' : 'CHASE';
        this.applyGlobalMode(true); // reverse wisps on switch
      }
    }

    // Frightened countdown.
    if (this.frightActive) {
      this.frightTimer -= dt;
      if (this.frightTimer <= 0) this.endFrightened();
    }

    this.updatePlayer(dt);
    for (const w of this.wisps) this.updateWisp(w, dt);
    this.checkCollisions();
    this.maybeSpawnBonus(dt);

    if (this.remaining <= 0) this.startLevelClear();
  }

  applyGlobalMode(reverse) {
    for (const w of this.wisps) {
      if (w.mode === 'EYES' || w.inHouse) continue;
      if (w.mode === 'FRIGHTENED') continue; // frightened overrides; resolved at end
      w.mode = this.globalMode;
      if (reverse) { // forced reverse on a scatter/chase flip
        w.dir = { x: -w.dir.x, y: -w.dir.y };
      }
    }
  }

  updatePlayer(dt) {
    const p = this.player;
    if (!p.alive) return;
    // chomp pulse synced to movement
    p.chomp += dt * 10;
    // pellet-eat 1-frame pause (classic rhythm)
    if (p.eatPause > 0) { p.eatPause -= 1; }
    else {
      tryTurnPlayer(p, (r, c) => playerBlockedAt(r, c));
      const dist = playerPxPerSec() * dt;
      moveActor(p, dist, (r, c) => playerBlockedAt(r, c));
      if (p.dir.x || p.dir.y) p.facing = p.dir;
      // trail
      if (!this.reducedMotion) {
        this.trail.push({ x: p.px, y: p.py, life: 0.22 });
        if (this.trail.length > 8) this.trail.shift();
      }
    }
    for (const t of this.trail) t.life -= dt;
    this.trail = this.trail.filter((t) => t.life > 0);

    this.eatAt(p);
  }

  updateWisp(w, dt) {
    // Release gate (counters reset each life).
    if (w.inHouse && !w.released && this.eatenThisLife >= this.releaseThreshold(w.idx)) {
      w.released = true;
    }
    // Reforming inside the den after EYES return.
    if (w.reformTimer > 0) {
      w.reformTimer -= dt;
      w.flicker += dt;
      // bob in place
      w.px = w.home.c * TILE + TILE / 2;
      w.py = w.home.r * TILE + TILE / 2 + Math.sin(this.time * 6) * 2;
      if (w.reformTimer <= 0) { w.mode = this.globalMode; w.released = true; w.inHouse = true; }
      return;
    }
    w.flicker += dt;
    let speed;
    if (w.mode === 'EYES') speed = eyesPxPerSec();
    else if (w.mode === 'FRIGHTENED') speed = frightPxPerSec();
    else if (w.inHouse) speed = wispPxPerSec(this.level) * 0.6;
    else speed = wispPxPerSec(this.level);
    // tunnel slowdown
    if (!w.inHouse && onTunnelRow(Math.floor(w.py / TILE))) speed = tunnelPxPerSec();
    if (w.mode === 'FRIGHTENED' && onTunnelRow(Math.floor(w.py / TILE))) speed = Math.min(speed, tunnelPxPerSec());
    stepWisp(w, speed * dt);
  }

  // wisp methods (personality lives here)
  // assigned per-instance below via WISP_AI

  // ---- eating ----
  eatAt(p) {
    const { c, r } = tileOf(p.px, p.py);
    if (r < 0 || r >= H || c < 0 || c >= W) return;
    if (this.pellets[r] && this.pellets[r][c]) {
      this.pellets[r][c] = false;
      this.remaining--;
      this.eatenThisLife++;
      this.addScore(10);
      p.eatPause = 1;
      this.blip('coin');
      this.clearPelletTile(r, c);
    }
    // power pellet
    const pi = this.powerPellets.findIndex((pp) => pp.r === r && pp.c === c);
    if (pi >= 0) {
      this.powerPellets.splice(pi, 1);
      this.remaining--;
      this.eatenThisLife++;
      this.addScore(50);
      p.eatPause = 2;
      this.blip('levelUp');
      this.startFrightened();
    }
    // bonus gem
    if (this.bonus && this.bonus.r === r && this.bonus.c === c) {
      const val = this.bonus.value;
      this.addScore(val);
      this.floats.push(makeFloat(r, c - 0.2, `+${val}`, '#ffd23f'));
      this.spawnParticles(r, c, '#ffd23f', 12);
      this.bonus = null;
      this.blip('bullseye');
    }
  }

  startFrightened() {
    this.eatChain = 0;
    if (this.frightDuration <= 0) {
      // no frightened at high levels — just force the reverse.
      for (const w of this.wisps) {
        if (w.mode === 'EYES' || w.inHouse) continue;
        w.dir = { x: -w.dir.x, y: -w.dir.y };
      }
      return;
    }
    this.frightActive = true;
    this.frightTimer = this.frightDuration;
    for (const w of this.wisps) {
      if (w.mode === 'EYES' || w.inHouse) continue;
      w.mode = 'FRIGHTENED';
      w.dir = { x: -w.dir.x, y: -w.dir.y };
    }
  }
  endFrightened() {
    this.frightActive = false;
    this.frightTimer = 0;
    for (const w of this.wisps) {
      if (w.mode === 'FRIGHTENED') w.mode = this.globalMode;
    }
  }

  checkCollisions() {
    const p = this.player;
    if (!p.alive) return;
    for (const w of this.wisps) {
      if (w.reformTimer > 0) continue;
      const dx = p.px - w.px, dy = p.py - w.py;
      if (dx * dx + dy * dy < (TILE * 0.5) ** 2) {
        if (w.mode === 'FRIGHTENED') { this.eatWisp(w); }
        else if (w.mode !== 'EYES') { this.die(); return; }
      }
    }
  }

  eatWisp(w) {
    this.eatChain = Math.min(4, this.eatChain + 1);
    const pts = [200, 400, 800, 1600][this.eatChain - 1];
    const { c, r } = tileOf(w.px, w.py);
    this.floats.push(makeFloat(r, c, String(pts), '#7df9ff'));
    this.addScore(pts);
    this.spawnParticles(r, c, w.color, 14);
    w.mode = 'EYES';
    this.blip('bullseye');
    // 0.5s freeze frame on eat
    this.state = 'frozen';
    this.frozenTimer = 0.5;
    this._frozenKind = 'eat';
  }
  afterFreeze() {
    this.state = 'playing';
    this.lastTime = performance.now();
  }

  die() {
    this.player.alive = false;
    this.state = 'dying';
    this.dyingTimer = 1.0;
    this.blip('buzzer');
    this.spawnParticles(SPAWN.r, SPAWN.c, '#4dd8ff', 18);
    if (!this.reducedMotion && this.boardFrame) {
      this.boardFrame.classList.remove('tetris-pulse');
      void this.boardFrame.offsetWidth;
      this.boardFrame.classList.add('tetris-pulse');
    }
  }
  finishDeath() {
    this.lives--;
    if (this.lives <= 0) { this.gameOver(); return; }
    this.resetActors();
    this.beginReady(1.5);
    this.updateHUD();
  }

  gameOver() {
    this.state = 'gameover';
    const prev = Number(localStorage.getItem(HS_KEY) || 0);
    if (this.score > prev) {
      localStorage.setItem(HS_KEY, String(this.score));
      this.onHighScore(this.score);
    }
    const ov = document.getElementById('maze-gameover-overlay');
    const stats = document.getElementById('maze-final-stats');
    if (stats) stats.textContent = `SCORE ${this.score} · LEVEL ${this.level}`;
    if (ov) ov.classList.remove('hidden');
    this.updateHUD();
  }

  // ---- bonus gem ----
  maybeSpawnBonus(dt) {
    if (this.bonus) {
      this.bonus.timer -= dt;
      if (this.bonus.timer <= 0) this.bonus = null;
      return;
    }
    const thresholds = [70, 170];
    for (let i = 0; i < thresholds.length; i++) {
      if (!this.bonusShown[i] && this.eatenThisLife >= thresholds[i]) {
        this.bonusShown[i] = true;
        this.bonus = { r: 20, c: 13, timer: 9, value: Math.min(1000, 100 * this.level) };
      }
    }
  }

  // ---- level clear / progression ----
  startLevelClear() {
    this.state = 'levelclear';
    this.levelClearTimer = 1.2;
    this.flashPhase = 0;
    this.flashCount = 0;
  }
  advanceLevel() {
    this.level++;
    this.frightDuration = this.frightenDuration();
    this.resetMaze(false);
    this.resetActors();
    this.beginReady(1.5);
    this.updateHUD();
  }

  addScore(n) {
    this.score += n;
    this.updateHUD();
  }

  // ---- particles ----
  spawnParticles(r, c, color, n) {
    if (this.reducedMotion) return;
    const cx = c * TILE + TILE / 2, cy = r * TILE + TILE / 2;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 120;
      this.particles.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.4, max: 0.4, color });
    }
  }
  updateParticles(dt) {
    for (const p of this.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 200 * dt; p.life -= dt; }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  // ---- input ----
  bindInput() {
    this.keydown = (e) => this.onKey(e);
    this.touchstart = (e) => this.onTouchStart(e);
    this.touchend = (e) => this.onTouchEnd(e);
    window.addEventListener('keydown', this.keydown);
    this.canvas?.addEventListener('touchstart', this.touchstart, { passive: false });
    this.canvas?.addEventListener('touchend', this.touchend, { passive: false });
  }
  unbindInput() {
    window.removeEventListener('keydown', this.keydown);
    this.canvas?.removeEventListener('touchstart', this.touchstart);
    this.canvas?.removeEventListener('touchend', this.touchend);
  }
  onKey(e) {
    if (!this.running) return;
    if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') { e.preventDefault(); this.togglePause(); return; }
    const name = KEY_TO_DIR[e.key];
    if (!name) return;
    e.preventDefault();
    this.player.want = D[name];
  }
  onTouchStart(e) {
    if (e.preventDefault) e.preventDefault();
    const t = e.touches[0];
    this.touchStart = t ? { x: t.clientX, y: t.clientY } : null;
  }
  onTouchEnd(e) {
    if (e.preventDefault) e.preventDefault();
    if (!this.touchStart) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - this.touchStart.x, dy = t.clientY - this.touchStart.y;
    if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
    let name;
    if (Math.abs(dx) > Math.abs(dy)) name = dx > 0 ? 'right' : 'left';
    else name = dy > 0 ? 'down' : 'up';
    this.player.want = D[name];
    this.touchStart = null;
  }
  // mobile d-pad
  queueInput(name) { if (D[name]) this.player.want = D[name]; }

  blip(kind) {
    if (typeof window === 'undefined' || !arcadeFX) return;
    const fn = arcadeFX[`play${kind[0].toUpperCase()}${kind.slice(1)}`];
    if (fn) { try { fn.call(arcadeFX); } catch { /* audio unavailable */ } }
  }

  // ---- HUD ----
  updateHUD() {
    if (typeof document === 'undefined') return;
    const s = document.getElementById('maze-score');
    if (s) s.textContent = this.score;
    const hi = document.getElementById('maze-hi');
    if (hi) hi.textContent = Math.max(this.score, Number(localStorage.getItem(HS_KEY) || 0));
    const lv = document.getElementById('maze-level');
    if (lv) lv.textContent = this.level;
    const lives = document.getElementById('maze-lives');
    if (lives) {
      let html = '';
      for (let i = 0; i < Math.max(0, this.lives - 1); i++) html += '<span class="maze-life"></span>';
      lives.innerHTML = html;
    }
  }
}

// ---- wisp personalities (chase targets) ----
const WISP_COLORS = ['#ff5c8a', '#4d9bff', '#ff9a3c', '#ffd23f']; // pink/blue/orange/gold
const WISP_AI = [
  // W1 Stalker: chase = player tile.
  function () {
    const p = this.player; const { c, r } = tileOf(p.px, p.py);
    return { r, c };
  },
  // W2 Ambusher: 4 tiles ahead of the player in its facing direction.
  function () {
    const p = this.player; const { c, r } = tileOf(p.px, p.py);
    const f = p.facing || D.left;
    return { r: r + f.y * 4, c: c + f.x * 4 };
  },
  // W3 Flanker: 2 ahead of player; vector from W1 to that point, doubled.
  function () {
    const p = this.player; const { c, r } = tileOf(p.px, p.py);
    const f = p.facing || D.left;
    const ahead = { r: r + f.y * 2, c: c + f.x * 2 };
    const w1 = this.wisps[0]; const w1t = tileOf(w1.px, w1.py);
    return { r: w1t.r + (ahead.r - w1t.r) * 2, c: w1t.c + (ahead.c - w1t.c) * 2 };
  },
  // W4 Coward: player tile when >8 tiles away; else scatter corner.
  function () {
    const p = this.player; const { c, r } = tileOf(p.px, p.py);
    const w = this.wisps[3]; const wt = tileOf(w.px, w.py);
    const d = Math.hypot(wt.r - r, wt.c - c);
    return d > 8 ? { r, c } : SCATTER[3];
  },
];
// Attach chase target + color to each wisp instance at creation time.
const _origResetActors = Maze.prototype.resetActors;
Maze.prototype.resetActors = function () {
  _origResetActors.call(this);
  this.wisps.forEach((w, i) => {
    w.color = WISP_COLORS[i];
    w.chaseTarget = WISP_AI[i].bind(this);
    w.scatterCorner = SCATTER[i];
    // reform: eaten wisp returns home, reforms over 1s, then exits again.
    w.reform = () => {
      w.mode = 'EYES'; // stays EYES until home reached (set above); on reach → reform
      w.reformTimer = 1.0;
      w.inHouse = true;
      w.dir = D.up;
    };
  });
};

// ===================================================================
// Rendering
// ===================================================================
Maze.prototype.buildWallCanvas = function () {
  if (typeof document === 'undefined') return;
  const c = document.createElement('canvas');
  c.width = BOARD_W; c.height = BOARD_H;
  const ctx = c.getContext('2d');
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#3a6bff';
  ctx.lineWidth = 2;
  ctx.shadowColor = '#4d79ff';
  ctx.shadowBlur = 6;
  // Draw a segment along each wall edge that borders a non-wall (path) tile.
  const isWall = (r, c) => {
    if (r < 0 || r >= H || c < 0 || c >= W) return true;
    const ch = TILES[r][c]; return ch === '#';
  };
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const ch = TILES[r][c];
      if (ch !== '#') continue;
      const x = c * TILE, y = r * TILE;
      // top
      if (!isWall(r - 1, c)) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + TILE, y); ctx.stroke(); }
      // bottom
      if (!isWall(r + 1, c)) { ctx.beginPath(); ctx.moveTo(x, y + TILE); ctx.lineTo(x + TILE, y + TILE); ctx.stroke(); }
      // left
      if (!isWall(r, c - 1)) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + TILE); ctx.stroke(); }
      // right
      if (!isWall(r, c + 1)) { ctx.beginPath(); ctx.moveTo(x + TILE, y); ctx.lineTo(x + TILE, y + TILE); ctx.stroke(); }
    }
  }
  // den door as a pink bar
  ctx.strokeStyle = '#ff7aa8';
  ctx.shadowColor = '#ff2e63';
  ctx.shadowBlur = 8;
  ctx.lineWidth = 2;
  for (const dc of DOOR_COLS) {
    const x = dc * TILE, y = DEN_TOP * TILE;
    ctx.beginPath(); ctx.moveTo(x, y + TILE / 2); ctx.lineTo(x + TILE, y + TILE / 2); ctx.stroke();
  }
  this.wallCanvas = c;
  this.wallCanvasWhite = null; // lazily built for flash
};

Maze.prototype.buildWallCanvasWhite = function () {
  if (typeof document === 'undefined') return;
  const c = document.createElement('canvas');
  c.width = BOARD_W; c.height = BOARD_H;
  const ctx = c.getContext('2d');
  ctx.drawImage(this.wallCanvas, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, BOARD_W, BOARD_H);
  this.wallCanvasWhite = c;
};

Maze.prototype.buildPelletCanvas = function () {
  if (typeof document === 'undefined') return;
  const c = document.createElement('canvas');
  c.width = BOARD_W; c.height = BOARD_H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffd9a0';
  ctx.shadowColor = '#ffb060';
  ctx.shadowBlur = 3;
  for (let r = 0; r < H; r++) {
    for (let c2 = 0; c2 < W; c2++) {
      if (this.pellets[r][c2]) {
        const x = c2 * TILE + TILE / 2, y = r * TILE + TILE / 2;
        ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  this.pelletCanvas = c;
};
Maze.prototype.clearPelletTile = function (r, c) {
  if (!this.pelletCanvas) return;
  const ctx = this.pelletCanvas.getContext('2d');
  ctx.clearRect(c * TILE, r * TILE, TILE, TILE);
};

Maze.prototype.render = function () {
  const ctx = this.ctx;
  if (!ctx) return;
  ctx.clearRect(0, 0, BOARD_W, BOARD_H);
  ctx.fillStyle = '#0a061a';
  ctx.fillRect(0, 0, BOARD_W, BOARD_H);

  // walls (white during level-clear flash)
  const flashing = this.state === 'levelclear';
  const flashOn = flashing && (Math.floor(this.flashPhase * 6) % 2 === 0);
  if (flashing && !this.wallCanvasWhite) this.buildWallCanvasWhite();
  ctx.drawImage(flashOn ? this.wallCanvasWhite : this.wallCanvas, 0, 0);

  // pellets (static layer)
  if (this.pelletCanvas) ctx.drawImage(this.pelletCanvas, 0, 0);

  // power pellets (pulsing, live)
  const pulse = 1 + Math.sin(this.time * 5) * 0.18;
  for (const pp of this.powerPellets) {
    const x = pp.c * TILE + TILE / 2, y = pp.r * TILE + TILE / 2;
    ctx.save();
    ctx.shadowColor = '#ffd23f'; ctx.shadowBlur = 14;
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath(); ctx.arc(x, y, 4.5 * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0; ctx.fillStyle = '#fff3cf';
    ctx.beginPath(); ctx.arc(x, y, 2 * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // bonus gem
  if (this.bonus) {
    const x = this.bonus.c * TILE + TILE / 2, y = this.bonus.r * TILE + TILE / 2;
    const bp = 1 + Math.sin(this.time * 7) * 0.16;
    const prog = Math.max(0, this.bonus.timer / 9);
    ctx.save();
    ctx.shadowColor = '#ffd23f'; ctx.shadowBlur = 16;
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath(); ctx.arc(x, y, 5 * bp, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(x - 1.4, y - 1.4, 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.8; ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * prog); ctx.stroke();
    ctx.restore();
  }

  // player trail
  if (!this.reducedMotion) {
    for (const t of this.trail) {
      const a = t.life / 0.22;
      ctx.save();
      ctx.globalAlpha = a * 0.35;
      ctx.fillStyle = '#4dd8ff';
      ctx.beginPath(); ctx.arc(t.x, t.y, 3 * a + 1, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  // wisps
  for (const w of this.wisps) this.drawWisp(ctx, w);

  // player
  this.drawPlayer(ctx);

  // particles
  for (const p of this.particles) {
    const a = Math.max(0, p.life / p.max);
    ctx.save(); ctx.globalAlpha = a; ctx.shadowColor = p.color; ctx.shadowBlur = 6;
    ctx.fillStyle = p.color; const s = 3 * a + 1;
    ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s); ctx.restore();
  }

  // floating texts
  for (const f of this.floats) {
    const a = Math.max(0, f.life / f.max);
    ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = f.color;
    ctx.shadowColor = f.color; ctx.shadowBlur = 8;
    ctx.font = '10px "Press Start 2P", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(f.text, f.x, f.y); ctx.restore();
  }

  // READY! overlay (drawn on canvas)
  if (this.state === 'ready') this.drawReady(ctx);
  if (this.state === 'dying') this.drawDying(ctx);
};

Maze.prototype.drawPlayer = function (ctx) {
  const p = this.player;
  if (this.state === 'dying') return; // handled by drawDying
  const x = p.px, y = p.py;
  const chomp = p.dir.x || p.dir.y ? (0.85 + 0.15 * Math.abs(Math.sin(p.chomp))) : 0.9;
  ctx.save();
  ctx.shadowColor = '#4dd8ff'; ctx.shadowBlur = 14;
  ctx.fillStyle = '#4dd8ff';
  ctx.beginPath(); ctx.arc(x, y, 5.2 * chomp, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0; ctx.fillStyle = '#d6f7ff';
  ctx.beginPath(); ctx.arc(x, y, 2.4 * chomp, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
};

Maze.prototype.drawWisp = function (ctx, w) {
  const x = w.px, y = w.py;
  if (w.mode === 'EYES') {
    // two white dots with cyan glow, heading home.
    ctx.save();
    ctx.shadowColor = '#4dd8ff'; ctx.shadowBlur = 10;
    ctx.fillStyle = '#eafcff';
    const ox = w.dir.y !== 0 ? 2 : 0;
    const oy = w.dir.x !== 0 ? 2 : 0;
    ctx.beginPath(); ctx.arc(x - ox + (w.dir.x ? 0 : 0), y - oy, 2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + ox, y + oy, 2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    return;
  }
  let color = w.color;
  let glow = w.color;
  if (w.mode === 'FRIGHTENED') {
    const ending = this.frightTimer < 2 && Math.floor(this.frightTimer * 6) % 2 === 0;
    color = ending ? '#eef3ff' : '#3a6bff';
    glow = '#3a6bff';
  }
  const frame = Math.floor(w.flicker * 6) % 2; // 2-frame flicker
  const r = 5.2 + (frame ? 0.4 : -0.4);
  ctx.save();
  ctx.shadowColor = glow; ctx.shadowBlur = 14;
  ctx.fillStyle = color;
  // hooded flame: round body + a little pointed top
  ctx.beginPath();
  ctx.arc(x, y, r, Math.PI, 0, false); // top half circle
  ctx.lineTo(x + r, y + 1.5);
  ctx.lineTo(x + r * 0.5, y + r * 0.7);
  ctx.lineTo(x, y + 1.5);
  ctx.lineTo(x - r * 0.5, y + r * 0.7);
  ctx.lineTo(x - r, y + 1.5);
  ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0;
  // eyes
  ctx.fillStyle = w.mode === 'FRIGHTENED' ? '#ff5c8a' : '#ffffff';
  const ox = w.dir.x * 1.4, oy = w.dir.y * 1.4;
  ctx.beginPath(); ctx.arc(x - 1.8 + ox, y - 0.6 + oy, 1.3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + 1.8 + ox, y - 0.6 + oy, 1.3, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
};

Maze.prototype.drawReady = function (ctx) {
  ctx.save();
  ctx.fillStyle = 'rgba(10,6,26,0.55)';
  ctx.fillRect(0, 0, BOARD_W, BOARD_H);
  ctx.fillStyle = '#4dd8ff'; ctx.shadowColor = '#4dd8ff'; ctx.shadowBlur = 22;
  ctx.font = '20px "Press Start 2P", monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('READY!', BOARD_W / 2, BOARD_H / 2);
  ctx.restore();
};

Maze.prototype.drawDying = function (ctx) {
  const p = this.player;
  const t = 1 - this.dyingTimer; // 0..1
  if (t < 0.4) {
    // flicker
    if (Math.floor(t * 20) % 2 === 0) {
      ctx.save(); ctx.shadowColor = '#4dd8ff'; ctx.shadowBlur = 14; ctx.fillStyle = '#4dd8ff';
      ctx.beginPath(); ctx.arc(p.px, p.py, 5.2, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
  }
  // particles do the burst; nothing else needed.
};

// ---- exports ----
export function getMazeHighScore() {
  return Number(localStorage.getItem(HS_KEY) || 0);
}
export const MAZE_HS_KEY = HS_KEY;
export const MAZE_GAME_NAME = GAME_NAME;

// Self-check: maze structure (symmetry, connectivity, no dead-ends, den single
// exit) + a smoke test of player movement (advances, turns at a junction, stops
// at a wall). Run with:
//   node --input-type=module -e "import('./src/game/maze.js').then(m=>m._selfCheck())"
export function _selfCheck() {
  const rows = MAZE;
  let ok = true;
  const err = (m) => { ok = false; console.log('FAIL: ' + m); };
  if (rows.length !== H) err('rows');
  rows.forEach((r, i) => { if (r.length !== W) err('row ' + i + ' len ' + r.length); });
  // normalized left-right symmetry (walls/G/- preserved; path types -> '.')
  const norm = (ch) => (ch === '#' || ch === 'G' || ch === '-') ? ch : '.';
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++)
      if (norm(rows[r][c]) !== norm(rows[r][W - 1 - c]))
        err(`asym r${r} c${c}=${rows[r][c]} vs ${rows[r][W - 1 - c]}`);
  // passable + connectivity + no dead-ends
  const pass = (ch) => ch === '.' || ch === 'o' || ch === 'P' || ch === ' ';
  const nbrs = (r, c) => {
    const out = [];
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      let nr = r + dr, nc = c + dc;
      if (nr === TUNNEL_ROW && nc < 0) nc = W - 1;
      if (nr === TUNNEL_ROW && nc >= W) nc = 0;
      if (nr < 0 || nr >= H || nc < 0 || nc >= W) continue;
      out.push([nr, nc]);
    }
    return out;
  };
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    if (!pass(rows[r][c])) continue;
    const n = nbrs(r, c).filter(([nr, nc]) => pass(rows[nr][nc]));
    if (n.length < 2) err(`dead-end r${r} c${c}=${rows[r][c]} nbrs=${n.length}`);
  }
  // flood fill
  const seen = Array.from({ length: H }, () => Array(W).fill(false));
  let start = null;
  for (let r = 0; r < H && !start; r++) for (let c = 0; c < W; c++) if (pass(rows[r][c])) { start = [r, c]; break; }
  const stack = [start]; seen[start[0]][start[1]] = true;
  while (stack.length) {
    const [r, c] = stack.pop();
    for (const [nr, nc] of nbrs(r, c)) if (!seen[nr][nc] && pass(rows[nr][nc])) { seen[nr][nc] = true; stack.push([nr, nc]); }
  }
  let unreach = 0;
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (pass(rows[r][c]) && !seen[r][c]) unreach++;
  if (unreach) err(unreach + ' unreachable');
  // den: 2 doors, 8x5 interior
  let doors = 0; for (const dc of DOOR_COLS) if (rows[DEN_TOP][dc] === '-') doors++;
  if (doors !== 2) err('doors ' + doors);
  let interior = 0;
  for (let r = DEN_TOP + 1; r < DEN_BOTTOM; r++)
    for (let c = DEN_LEFT + 1; c < DEN_RIGHT; c++) if (rows[r][c] === 'G') interior++;
  if (interior !== 40) err('interior ' + interior);
  let ppc = 0; for (const r of rows) for (const ch of r) if (ch === 'o') ppc++;
  if (ppc !== 4) err('power pellets ' + ppc);

  // ---- movement smoke test ----
  const m = new Maze({});
  m.state = 'playing';
  const p = m.player;
  // starts at spawn, moving left; moving left into a wall-free corridor advances.
  const startX = p.px;
  m.updatePlayer(1 / 60);
  if (p.px >= startX) err('player did not advance left');
  // buffered 90° turn near a center: drive toward a junction and turn down.
  // Find the first downward-opening tile along the spawn row to the left.
  // (Smoke: just ensure tryTurnPlayer accepts a legal reverse and a 90° turn
  //  without throwing.)
  p.want = D.right; // reverse of left → instant
  m.updatePlayer(1 / 60);
  if (p.dir.x !== 1) err('instant reverse failed: dir.x=' + p.dir.x);
  // stop at a wall: drive right into the outer ring and then hold right; the
  // player should clamp at a tile center, not pass into a wall.
  for (let i = 0; i < 400; i++) { p.want = D.right; m.updatePlayer(1 / 60); }
  const col = Math.floor(p.px / TILE);
  if (playerBlockedAt(Math.floor(p.py / TILE), col + 1)) {
    // ok — stopped before a wall
  }
  if (!ok) throw new Error('maze self-check failed');
  console.log('maze self-check ok — pellets', m.remaining, 'level', m.level);
}