// Tetris — complete vanilla-canvas implementation for the arcade hub.
// 10x20 visible board (hidden spawn rows above), 7-bag randomizer, SRS
// rotation with wall kicks, ghost piece, hold (once per drop), 4-deep next
// queue, soft/hard drop, lock delay, DAS, classic scoring + level curve.
// High score lives in localStorage (no backend yet — see CLAUDE.md note).
// Reuses arcadeFX SFX; no external deps.
import { arcadeFX } from './arcade.js';

const COLS = 10;
const ROWS = 20;
const HIDDEN = 4; // spawn rows above the visible board
const FULL_ROWS = ROWS + HIDDEN;

// Cell size in CSS pixels — set from the canvas attribute width (300/10 = 30).
const CELL = 30;

// Tetromino definitions: each shape's 4 rotation states as a 4x4 matrix of
// filled cells, plus its accent color. SRS uses the standard spawn state.
// ponytail: rotation states are hand-listed (no matrix-rotate math) — O(n)
// is tiny and keeps wall-kick lookup trivial; a rotate-in-place fn would be
// the same size for 7 pieces.
const SHAPES = {
  I: {
    color: '#4dd8ff',
    rotations: [
      [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
      [[0,0,1,0],[0,0,1,0],[0,0,1,0],[0,0,1,0]],
      [[0,0,0,0],[0,0,0,0],[1,1,1,1],[0,0,0,0]],
      [[0,1,0,0],[0,1,0,0],[0,1,0,0],[0,1,0,0]],
    ],
  },
  O: {
    color: '#ffc93c',
    rotations: [
      [[0,1,1,0],[0,1,1,0],[0,0,0,0],[0,0,0,0]],
      [[0,1,1,0],[0,1,1,0],[0,0,0,0],[0,0,0,0]],
      [[0,1,1,0],[0,1,1,0],[0,0,0,0],[0,0,0,0]],
      [[0,1,1,0],[0,1,1,0],[0,0,0,0],[0,0,0,0]],
    ],
  },
  T: {
    color: '#b04dff',
    rotations: [
      [[0,1,0,0],[1,1,1,0],[0,0,0,0],[0,0,0,0]],
      [[0,1,0,0],[0,1,1,0],[0,1,0,0],[0,0,0,0]],
      [[0,0,0,0],[1,1,1,0],[0,1,0,0],[0,0,0,0]],
      [[0,1,0,0],[1,1,0,0],[0,1,0,0],[0,0,0,0]],
    ],
  },
  S: {
    color: '#3df58c',
    rotations: [
      [[0,1,1,0],[1,1,0,0],[0,0,0,0],[0,0,0,0]],
      [[0,1,0,0],[0,1,1,0],[0,0,1,0],[0,0,0,0]],
      [[0,0,0,0],[0,1,1,0],[0,1,1,0],[0,0,0,0]],
      [[1,0,0,0],[1,1,0,0],[0,1,0,0],[0,0,0,0]],
    ],
  },
  Z: {
    color: '#ff2e63',
    rotations: [
      [[1,1,0,0],[0,1,1,0],[0,0,0,0],[0,0,0,0]],
      [[0,0,1,0],[0,1,1,0],[0,1,0,0],[0,0,0,0]],
      [[0,0,0,0],[1,1,0,0],[0,1,1,0],[0,0,0,0]],
      [[0,1,0,0],[1,1,0,0],[1,0,0,0],[0,0,0,0]],
    ],
  },
  J: {
    color: '#4d79ff',
    rotations: [
      [[1,0,0,0],[1,1,1,0],[0,0,0,0],[0,0,0,0]],
      [[0,1,1,0],[0,1,0,0],[0,1,0,0],[0,0,0,0]],
      [[0,0,0,0],[1,1,1,0],[0,0,1,0],[0,0,0,0]],
      [[0,1,0,0],[0,1,0,0],[1,1,0,0],[0,0,0,0]],
    ],
  },
  L: {
    color: '#ff8c42',
    rotations: [
      [[0,0,1,0],[1,1,1,0],[0,0,0,0],[0,0,0,0]],
      [[0,1,0,0],[0,1,0,0],[0,1,1,0],[0,0,0,0]],
      [[0,0,0,0],[1,1,1,0],[1,0,0,0],[0,0,0,0]],
      [[1,1,0,0],[0,1,0,0],[0,1,0,0],[0,0,0,0]],
    ],
  },
};
const KEYS = Object.keys(SHAPES);

// SRS wall-kick offsets. JLSTZ share a table; I has its own; O never kicks.
const KICKS_JLSTZ = [
  [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
  [[0,0],[1,0],[1,-1],[0,2],[1,2]],
  [[0,0],[1,0],[1,1],[0,-2],[1,-2]],
  [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
];
const KICKS_I = [
  [[0,0],[-2,0],[1,0],[-2,-1],[1,2]],
  [[0,0],[2,0],[-1,0],[2,1],[-1,-2]],
  [[0,0],[-1,0],[2,0],[-1,1],[2,-1]],
  [[0,0],[1,0],[-2,0],[1,-2],[-2,1]],
];
const KICKS = { I: KICKS_I, O: [[0,0]], default: KICKS_JLSTZ };

const HS_KEY = 'geoguesser_tetris_highscore';

// Gravity per level (seconds per row), classic curve approximation.
const GRAVITY = [
  1.0, 0.79, 0.62, 0.49, 0.39, 0.31, 0.25, 0.20, 0.16, 0.13,
  0.10, 0.08, 0.064, 0.050, 0.039, 0.030, 0.024, 0.018, 0.013, 0.010,
  0.008, 0.007, 0.006,
];

function shade(hex, amt) {
  // amt<0 darkens, amt>0 brightens; returns rgba string for edges/cores.
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + 255 * amt)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

export class Tetris {
  constructor(opts = {}) {
    this.canvas = opts.canvas;
    this.ctx = this.canvas?.getContext('2d');
    this.nextCanvas = opts.nextCanvas;
    this.nextCtx = this.nextCanvas?.getContext('2d');
    this.holdCanvas = opts.holdCanvas;
    this.holdCtx = this.holdCanvas?.getContext('2d');
    this.boardFrame = opts.boardFrame; // for the tetris-pulse class
    this.onHighScore = opts.onHighScore || (() => {});
    this.miniCell = 18; // mini-canvas cell size
    this.running = false;
    this.paused = false;
    this.over = false;
    this.reset();
  }

  reset() {
    this.grid = Array.from({ length: FULL_ROWS }, () => Array(COLS).fill(null));
    this.bag = [];
    this.nextQueue = [];
    this.refillQueue(5);
    this.hold = null;
    this.canHold = true;
    this.current = null;
    this.score = 0;
    this.displayedScore = 0;
    this.level = 1;
    this.lines = 0;
    this.combo = -1;
    this.backToBack = false;
    this.dropAcc = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.locking = false;
    this.lastMoveWasRotate = false;
    this.over = false;
    this.paused = false;
    this.spawn();
  }

  // ---- 7-bag randomizer ----
  refillQueue(n) {
    while (this.nextQueue.length < n) {
      if (this.bag.length === 0) {
        this.bag = [...KEYS];
        for (let i = this.bag.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
        }
      }
      this.nextQueue.push(this.bag.shift());
    }
  }

  spawn(typeOverride) {
    const type = typeOverride || this.nextQueue.shift();
    this.refillQueue(5);
    const shape = SHAPES[type];
    this.current = {
      type,
      color: shape.color,
      rot: 0,
      // Spawn in the top hidden rows, centered.
      x: type === 'O' ? 4 : 3,
      y: 0,
    };
    this.canHold = true;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.locking = false;
    this.lastMoveWasRotate = false;
    if (this.collides(this.current.x, this.current.y, this.current.rot)) {
      this.gameOver();
    }
  }

  cells(x, y, rot) {
    const m = SHAPES[this.current.type].rotations[rot];
    const out = [];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        if (m[r][c]) out.push([x + c, y + r]);
      }
    }
    return out;
  }

  collides(x, y, rot) {
    for (const [cx, cy] of this.cells(x, y, rot)) {
      if (cx < 0 || cx >= COLS || cy >= FULL_ROWS) return true;
      if (cy >= 0 && this.grid[cy][cx]) return true;
    }
    return false;
  }

  move(dx, dy) {
    if (!this.current || this.over || this.paused) return false;
    if (!this.collides(this.current.x + dx, this.current.y + dy, this.current.rot)) {
      this.current.x += dx;
      this.current.y += dy;
      this.lastMoveWasRotate = false;
      if (this.locking) this.resetLockDelay();
      return true;
    }
    return false;
  }

  rotate(dir) {
    if (!this.current || this.over || this.paused) return false;
    const from = this.current.rot;
    const to = (from + dir + 4) % 4;
    const table = KICKS[this.current.type] || KICKS.default;
    for (const [kx, ky] of table[from]) {
      // SRS kick offsets are (x,y) where +y is up; our grid y grows down,
      // so apply ky negated.
      const nx = this.current.x + kx;
      const ny = this.current.y - ky;
      if (!this.collides(nx, ny, to)) {
        this.current.x = nx;
        this.current.y = ny;
        this.current.rot = to;
        this.lastMoveWasRotate = true;
        if (this.locking) this.resetLockDelay();
        return true;
      }
    }
    return false;
  }

  hold_() {
    if (!this.canHold || !this.current || this.over || this.paused) return;
    const prev = this.hold;
    this.hold = this.current.type;
    this.canHold = false;
    if (prev) this.spawn(prev);
    else this.spawn();
  }

  softDrop() {
    if (this.move(0, 1)) {
      this.score += 1;
      this.updateScore();
    }
  }

  hardDrop() {
    if (!this.current || this.over || this.paused) return;
    let dist = 0;
    while (!this.collides(this.current.x, this.current.y + 1, this.current.rot)) {
      this.current.y++;
      dist++;
    }
    this.score += dist * 2;
    this.updateScore();
    this.lock();
  }

  ghostY() {
    let y = this.current.y;
    while (!this.collides(this.current.x, y + 1, this.current.rot)) y++;
    return y;
  }

  // ---- lock delay ----
  resetLockDelay() {
    if (this.lockResets < 15) {
      this.lockTimer = 0;
      this.lockResets++;
    }
  }

  lock() {
    if (!this.current) return;
    const lockedAbove = this.current.y < HIDDEN;
    for (const [cx, cy] of this.cells(this.current.x, this.current.y, this.current.rot)) {
      if (cy >= 0 && cy < FULL_ROWS) this.grid[cy][cx] = this.current.color;
    }
    if (lockedAbove) {
      // Piece locked fully above the visible board → game over.
      this.gameOver();
      return;
    }
    const cleared = this.clearLines();
    this.scoring(cleared);
    this.spawn();
  }

  clearLines() {
    const full = [];
    for (let r = 0; r < FULL_ROWS; r++) {
      if (this.grid[r].every((c) => c !== null)) full.push(r);
    }
    if (full.length) {
      // Flash + dissolve: trigger a quick CSS flash on the canvas.
      this.flash();
      // Remove cleared rows, drop everything above.
      full.sort((a, b) => a - b);
      for (const r of full) {
        this.grid.splice(r, 1);
        this.grid.unshift(Array(COLS).fill(null));
      }
      if (full.length === 4) this.tetrisPulse();
    }
    return full.length;
  }

  scoring(lines) {
    if (lines === 0) {
      this.combo = -1;
      return;
    }
    this.combo++;
    this.lines += lines;
    const base = [0, 100, 300, 500, 800][lines] * this.level;
    let total = base;
    if (lines === 4 && this.backToBack) total = Math.round(total * 1.5);
    this.backToBack = lines === 4;
    if (this.combo > 0) total += 50 * this.combo * this.level;
    this.score += total;
    // Level up every 10 lines.
    const newLevel = Math.floor(this.lines / 10) + 1;
    if (newLevel > this.level) {
      this.level = newLevel;
      this.blip('levelUp');
    }
    this.updateScore();
    this.blip(lines === 4 ? 'coin' : 'click');
  }

  // ---- main loop ----
  start() {
    if (this.running) return;
    this.running = true;
    this.reset();
    this.bindInput();
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.loop.bind(this));
    this.render();
  }

  stop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.unbindInput();
    this.hideOverlays();
  }

  togglePause() {
    if (this.over) return;
    this.paused = !this.paused;
    const ov = document.getElementById('tetris-pause-overlay');
    if (ov) ov.classList.toggle('hidden', !this.paused);
    if (this.paused) this.lastTime = performance.now();
  }

  loop(now) {
    if (!this.running) return;
    const dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (!this.paused && !this.over) this.tick(dt);
    this.render();
    this.rafId = requestAnimationFrame(this.loop.bind(this));
  }

  tick(dt) {
    // Score count-up animation easing toward the real score.
    if (this.displayedScore !== this.score) {
      const diff = this.score - this.displayedScore;
      this.displayedScore += Math.max(1, Math.ceil(diff * 0.2));
      if (this.displayedScore > this.score) this.displayedScore = this.score;
      this.updateScore();
    }
    // DAS auto-repeat is handled in keydown repeat; gravity drives downward.
    const g = GRAVITY[Math.min(this.level - 1, GRAVITY.length - 1)] || 0.01;
    this.dropAcc += dt;
    if (this.dropAcc >= g) {
      this.dropAcc = 0;
      if (!this.collides(this.current.x, this.current.y + 1, this.current.rot)) {
        this.current.y++;
        this.locking = false;
      } else {
        // Can't move down → start lock timer.
        this.locking = true;
      }
    }
    if (this.locking) {
      this.lockTimer += dt;
      if (this.lockTimer >= 0.5) this.lock();
    }
    // Handle held-key DAS for left/right/soft drop.
    this.dasTick(dt);
  }

  // ---- input ----
  bindInput() {
    this.keydown = (e) => this.onKey(e);
    this.keyup = (e) => this.onKeyUp(e);
    window.addEventListener('keydown', this.keydown);
    window.addEventListener('keyup', this.keyup);
    this.dasDir = 0; this.dasTimer = 0; this.dasCharged = false;
    this.softHeld = false;
  }
  unbindInput() {
    window.removeEventListener('keydown', this.keydown);
    window.removeEventListener('keyup', this.keyup);
  }

  onKeyUp(e) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      this.dasDir = 0; this.dasCharged = false;
    }
    if (e.key === 'ArrowDown') this.softHeld = false;
  }

  onKey(e) {
    if (!this.running || this.over) return;
    const k = e.key;
    // Pause toggle takes priority and shouldn't be blocked by repeat.
    if (k === 'p' || k === 'P' || k === 'Escape') {
      e.preventDefault();
      this.togglePause();
      return;
    }
    if (this.paused) return;
    switch (k) {
      case 'ArrowLeft':
        e.preventDefault();
        this.move(-1, 0);
        this.dasDir = -1; this.dasTimer = 0; this.dasCharged = false;
        break;
      case 'ArrowRight':
        e.preventDefault();
        this.move(1, 0);
        this.dasDir = 1; this.dasTimer = 0; this.dasCharged = false;
        break;
      case 'ArrowDown':
        e.preventDefault();
        this.softDrop();
        this.softHeld = true;
        break;
      case 'ArrowUp':
      case 'x':
      case 'X':
        e.preventDefault();
        this.rotate(1);
        break;
      case 'z':
      case 'Z':
        e.preventDefault();
        this.rotate(-1);
        break;
      case 'c':
      case 'C':
        e.preventDefault();
        this.hold_();
        break;
      case ' ':
        e.preventDefault();
        this.hardDrop();
        break;
      default:
        break;
    }
  }

  dasTick(dt) {
    // DAS: ~170ms charge then ~40ms repeat for left/right; soft drop repeats
    // with gravity-ish cadence via the main tick (ArrowDown keydown fires once
    // per OS repeat, but holding is mirrored here for smoothness).
    if (this.dasDir !== 0 && !this.paused && !this.over) {
      this.dasTimer += dt;
      if (!this.dasCharged && this.dasTimer >= 0.17) {
        this.dasCharged = true;
        this.dasTimer = 0;
        this.move(this.dasDir, 0);
      } else if (this.dasCharged && this.dasTimer >= 0.04) {
        this.dasTimer = 0;
        this.move(this.dasDir, 0);
      }
    }
    if (this.softHeld && !this.paused && !this.over) {
      // Soft drop auto-repeat at ~30ms.
      this._softAcc = (this._softAcc || 0) + dt;
      if (this._softAcc >= 0.03) {
        this._softAcc = 0;
        this.softDrop();
      }
    }
  }

  // ---- rendering ----
  render() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);
    // Inset board background + faint grid lines.
    ctx.fillStyle = '#0a061a';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let c = 1; c < COLS; c++) {
      ctx.beginPath();
      ctx.moveTo(c * CELL, 0);
      ctx.lineTo(c * CELL, H);
      ctx.stroke();
    }
    for (let r = 1; r < ROWS; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * CELL);
      ctx.lineTo(W, r * CELL);
      ctx.stroke();
    }
    // Locked cells (only the visible rows).
    for (let r = HIDDEN; r < FULL_ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this.grid[r][c]) this.drawCell(ctx, c, r - HIDDEN, this.grid[r][c]);
      }
    }
    // Ghost piece.
    if (this.current && !this.over) {
      const gy = this.ghostY();
      for (const [cx, cy] of this.cells(this.current.x, gy, this.current.rot)) {
        if (cy >= HIDDEN) this.drawGhost(ctx, cx, cy - HIDDEN, this.current.color);
      }
      // Active piece.
      for (const [cx, cy] of this.cells(this.current.x, this.current.y, this.current.rot)) {
        if (cy >= HIDDEN) this.drawCell(ctx, cx, cy - HIDDEN, this.current.color);
      }
    }
    this.renderMini(this.holdCtx, this.hold ? [this.hold] : [], true);
    this.renderMini(this.nextCtx, this.nextQueue.slice(0, 4), false);
  }

  drawCell(ctx, col, row, color) {
    const x = col * CELL;
    const y = row * CELL;
    // Glow in own color, bright core, darker edge.
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.fillStyle = shade(color, -0.18);
    ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
    ctx.shadowBlur = 0;
    ctx.fillStyle = shade(color, 0.28);
    ctx.fillRect(x + 4, y + 4, CELL - 8, CELL - 8);
    ctx.fillStyle = color;
    ctx.fillRect(x + 7, y + 7, CELL - 14, CELL - 14);
    ctx.restore();
  }

  drawGhost(ctx, col, row, color) {
    const x = col * CELL;
    const y = row * CELL;
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 2, y + 2, CELL - 4, CELL - 4);
    ctx.restore();
  }

  renderMini(ctx, types, isHold) {
    if (!ctx) return;
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    ctx.clearRect(0, 0, W, H);
    const cs = this.miniCell;
    types.forEach((type, i) => {
      const shape = SHAPES[type];
      const m = shape.rotations[0];
      // Find piece bounds in the 4x4 for centering.
      let minR = 4, maxR = -1, minC = 4, maxC = -1;
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
        if (m[r][c]) { minR = Math.min(minR, r); maxR = Math.max(maxR, r); minC = Math.min(minC, c); maxC = Math.max(maxC, c); }
      }
      const w = (maxC - minC + 1) * cs;
      const h = (maxR - minR + 1) * cs;
      const offX = (W - w) / 2 - minC * cs;
      const offY = isHold ? (H - h) / 2 - minR * cs : i * 70 + (60 - h) / 2 - minR * cs;
      ctx.save();
      ctx.shadowColor = shape.color;
      ctx.shadowBlur = 8;
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
        if (m[r][c]) {
          const x = offX + c * cs;
          const y = offY + r * cs;
          ctx.fillStyle = shade(shape.color, -0.18);
          ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
          ctx.shadowBlur = 0;
          ctx.fillStyle = shade(shape.color, 0.28);
          ctx.fillRect(x + 3, y + 3, cs - 6, cs - 6);
          ctx.shadowBlur = 8;
        }
      }
      ctx.restore();
    });
  }

  // ---- score + overlays ----
  updateScore() {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('tetris-score');
    if (el) el.textContent = this.displayedScore;
    const lv = document.getElementById('tetris-level');
    if (lv) lv.textContent = this.level;
    const ln = document.getElementById('tetris-lines');
    if (ln) ln.textContent = this.lines;
  }

  flash() {
    this.canvas.classList.remove('flash');
    void this.canvas.offsetWidth; // reflow to restart animation
    this.canvas.classList.add('flash');
  }

  tetrisPulse() {
    if (!this.boardFrame) return;
    this.boardFrame.classList.remove('tetris-pulse');
    void this.boardFrame.offsetWidth;
    this.boardFrame.classList.add('tetris-pulse');
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // 2-3px shake: nudge the wrap horizontally via a quick class.
      this.boardFrame.style.transform = 'translateX(2px)';
      setTimeout(() => { this.boardFrame.style.transform = 'translateX(-2px)'; }, 60);
      setTimeout(() => { this.boardFrame.style.transform = ''; }, 120);
    }
  }

  hideOverlays() {
    const p = document.getElementById('tetris-pause-overlay');
    const g = document.getElementById('tetris-gameover-overlay');
    if (p) p.classList.add('hidden');
    if (g) g.classList.add('hidden');
  }

  gameOver() {
    this.over = true;
    this.blip('buzzer');
    const prev = Number(localStorage.getItem(HS_KEY) || 0);
    if (this.score > prev) {
      localStorage.setItem(HS_KEY, String(this.score));
      this.onHighScore(this.score);
    }
    const ov = document.getElementById('tetris-gameover-overlay');
    const stats = document.getElementById('tetris-final-stats');
    if (stats) stats.textContent = `SCORE ${this.score} · LV ${this.level} · LINES ${this.lines}`;
    if (ov) ov.classList.remove('hidden');
  }

  retry() {
    this.hideOverlays();
    this.reset();
    this.lastTime = performance.now();
  }

  // Sound helper — no-ops when arcadeFX/browser audio isn't available (node
  // self-check) so the game logic is pure-testable without an AudioContext.
  blip(kind) {
    if (typeof window === 'undefined' || !arcadeFX) return;
    const fn = arcadeFX[`play${kind[0].toUpperCase()}${kind.slice(1)}`];
    if (fn) {
      try { fn.call(arcadeFX); } catch { /* audio unavailable */ }
    }
  }
}

export function getTetrisHighScore() {
  return Number(localStorage.getItem(HS_KEY) || 0);
}

export const TETRIS_HS_KEY = HS_KEY;

// Self-check: shapes produce 4 cells each, every piece has 4 rotations.
// Run with: node --input-type=module -e "import('./src/game/tetris.js').then(m=>m._selfCheck())"
export function _selfCheck() {
  for (const k of KEYS) {
    const s = SHAPES[k];
    if (s.rotations.length !== 4) throw new Error(`${k} missing rotations`);
    for (const rot of s.rotations) {
      const n = rot.flat().reduce((a, b) => a + b, 0);
      if (n !== 4) throw new Error(`${k} rotation has ${n} cells (want 4)`);
    }
  }
  // O kicks table is a single no-op.
  if (KICKS.O.length !== 1) throw new Error('O should not kick');
  // Gravity is monotonically decreasing (faster each level).
  for (let i = 1; i < GRAVITY.length; i++) {
    if (GRAVITY[i] > GRAVITY[i - 1]) throw new Error('gravity not monotonic');
  }
  // Scoring sanity: a tetris at level 1 scores 800.
  const t = new Tetris({});
  t.scoring(4);
  if (t.score !== 800) throw new Error(`tetris score ${t.score} want 800`);
  // Back-to-back tetris: base 800 ×1.5 = 1200, plus combo 50×1×1 = 50 → 1250.
  t.scoring(4);
  if (t.score !== 800 + 1250) throw new Error(`b2b tetris ${t.score}`);
  console.log('tetris self-check ok');
}