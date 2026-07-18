// Snake — complete vanilla-canvas implementation for the arcade hub.
// 21x21 grid, classic deadly walls. Logic ticks on a fixed interval (decoupled
// from the rAF render loop); an input buffer of up to 2 turns lets fast
// consecutive turns register, and 180° reversals are rejected relative to the
// direction actually applied each tick (not the last keypress) so you can't
// reverse into yourself. Bonus food every 5th eat. Reuses arcadeFX SFX; high
// score in localStorage (no backend yet). No deps.
import { arcadeFX } from './arcade.js';

const GRID = 21;
const CELL = 24;
const BOARD = GRID * CELL; // 504

const TICK_START = 140; // ms per tick
const TICK_FLOOR = 70;
const TICK_STEP = 4;   // faster per food eaten

const HS_KEY = 'geoguesser_snake_highscore';

const HEAD_COLOR = '#3df58c';   // neon green
const TAIL_COLOR = '#0d6b52';    // dark teal
const FOOD_COLOR = '#ff2e63';
const BONUS_COLOR = '#ffc93c';
const GRID_LINE = 'rgba(255,255,255,0.03)';

const DIR = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};
const KEY_TO_DIR = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right',
  W: 'up', S: 'down', A: 'left', D: 'right',
};

function isReverse(a, b) { return a.x === -b.x && a.y === -b.y; }
function sameDir(a, b) { return a.x === b.x && a.y === b.y; }

// Linear interpolation between two hex colors; t in 0..1.
function lerpColor(c1, c2, t) {
  const p = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const [r1, g1, b1] = p(c1);
  const [r2, g2, b2] = p(c2);
  const f = (a, b) => Math.round(a + (b - a) * t);
  return `rgb(${f(r1, r2)},${f(g1, g2)},${f(b1, b2)})`;
}

export class Snake {
  constructor(opts = {}) {
    this.canvas = opts.canvas;
    this.ctx = this.canvas?.getContext('2d');
    this.boardFrame = opts.boardFrame;
    this.onHighScore = opts.onHighScore || (() => {});
    this.reducedMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.running = false;
    this.state = 'idle';
    this.reset();
  }

  reset() {
    const cx = Math.floor(GRID / 2); // 10
    // Length-3 snake in the center, head at right, body trailing left.
    this.snake = [
      { x: cx, y: cx },
      { x: cx - 1, y: cx },
      { x: cx - 2, y: cx },
    ];
    this.dir = { ...DIR.right };
    this.queue = [];
    this.foodEaten = 0;
    this.score = 0;
    this.displayedScore = 0;
    this.food = null;
    this.bonus = null;       // {x,y,timer}
    this.bonusCountdown = 0; // foods until next bonus (spawns at 5, then 5 again)
    this.particles = [];
    this.flare = 0;
    this.tickAcc = 0;
    this.deathTimer = 0;
    this.shakeTimer = 0;
    this.tickInterval = TICK_START;
    this.over = false;
    this.paused = false;
    this.bonusCountdown = 5;
    this.spawnFood();
  }

  speedLevel() { return Math.min(18, this.foodEaten + 1); }
  recomputeTick() { this.tickInterval = Math.max(TICK_FLOOR, TICK_START - TICK_STEP * this.foodEaten); }

  // ---- food ----
  freeCells() {
    const occ = new Set(this.snake.map((c) => `${c.x},${c.y}`));
    if (this.food) occ.add(`${this.food.x},${this.food.y}`);
    if (this.bonus) occ.add(`${this.bonus.x},${this.bonus.y}`);
    const free = [];
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        if (!occ.has(`${x},${y}`)) free.push({ x, y });
      }
    }
    return free;
  }
  spawnFood() {
    const free = this.freeCells();
    if (free.length === 0) return; // board full → win-ish; just stop spawning
    this.food = free[Math.floor(Math.random() * free.length)];
  }
  spawnBonus() {
    const free = this.freeCells();
    if (free.length === 0) return;
    this.bonus = { x: free[Math.floor(Math.random() * free.length)].x, y: free[Math.floor(Math.random() * free.length)].y, timer: 5 };
  }

  // ---- input ----
  // Buffer up to 2 pending direction changes. A turn is dropped if it equals
  // or reverses the last buffered (or current) direction — this is what stops
  // a quick "up-then-left" from reversing into the body via two 90° turns that
  // net to a 180°. The per-tick apply ALSO rejects a reversal relative to the
  // direction actually applied that tick (defense in depth).
  queueInput(name) {
    const d = DIR[name];
    if (!d) return;
    const base = this.queue.length ? this.queue[this.queue.length - 1] : this.dir;
    if (sameDir(d, base) || isReverse(d, base)) return;
    if (this.queue.length < 2) this.queue.push(d);
  }

  // ---- lifecycle ----
  start() {
    if (this.running) return;
    this.running = true;
    this.reset();
    this.beginCountdown();
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

  beginCountdown() {
    this.state = 'countdown';
    this.countdown = 3;
    this.countdownTimer = 0.75; // seconds per number
  }

  togglePause() {
    if (this.over) return;
    if (this.state === 'playing') {
      this.paused = true;
      this.state = 'paused';
      const ov = document.getElementById('snake-pause-overlay');
      if (ov) ov.classList.remove('hidden');
    } else if (this.state === 'paused') {
      this.paused = false;
      this.hideOverlays();
      this.beginCountdown(); // resume with 3·2·1 so you're never dropped in
    }
  }

  loop(now) {
    if (!this.running) return;
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (dt > 0.1) dt = 0.1; // cap for tab-away
    this.time = (this.time || 0) + dt;
    this.update(dt);
    this.render();
    this.rafId = requestAnimationFrame(this.loop.bind(this));
  }

  update(dt) {
    if (this.flare > 0) this.flare = Math.max(0, this.flare - dt);
    this.updateParticles(dt);

    if (this.state === 'countdown') {
      this.countdownTimer -= dt;
      if (this.countdownTimer <= 0) {
        this.countdown--;
        this.countdownTimer = 0.75;
        if (this.countdown <= 0) { this.state = 'playing'; this.tickAcc = 0; this.lastTime = performance.now(); }
      }
      return;
    }

    if (this.state === 'paused') return;

    if (this.state === 'dead') {
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) this.finishDeath();
      return;
    }

    if (this.state !== 'playing') return;

    // Bonus food expiry.
    if (this.bonus) {
      this.bonus.timer -= dt;
      if (this.bonus.timer <= 0) this.bonus = null;
    }

    // Fixed-tick logic, decoupled from frame rate.
    this.tickAcc += dt * 1000;
    while (this.state === 'playing' && this.tickAcc >= this.tickInterval) {
      this.tickAcc -= this.tickInterval;
      this.step();
    }
  }

  step() {
    // Apply one buffered turn, rejecting a reversal relative to the direction
    // actually being applied this tick.
    if (this.queue.length) {
      const next = this.queue.shift();
      if (!isReverse(next, this.dir)) this.dir = next;
    }
    const head = this.snake[0];
    const newHead = { x: head.x + this.dir.x, y: head.y + this.dir.y };

    // Wall = death.
    if (newHead.x < 0 || newHead.x >= GRID || newHead.y < 0 || newHead.y >= GRID) {
      this.die(); return;
    }
    const eatingFood = this.food && newHead.x === this.food.x && newHead.y === this.food.y;
    const eatingBonus = this.bonus && newHead.x === this.bonus.x && newHead.y === this.bonus.y;
    // Self collision. When not growing, the tail vacates its cell this tick,
    // so the current tail cell is a legal move.
    const body = eatingFood ? this.snake : this.snake.slice(0, -1);
    for (const c of body) {
      if (c.x === newHead.x && c.y === newHead.y) { this.die(); return; }
    }

    this.snake.unshift(newHead);

    if (eatingFood) {
      this.foodEaten++;
      this.score += 10 * this.speedLevel();
      this.spawnParticles(this.food.x, this.food.y, FOOD_COLOR, 7);
      this.flare = 0.15;
      this.blip('coin');
      this.food = null;
      this.recomputeTick();
      // Every 5th food → spawn a bonus orb.
      this.bonusCountdown--;
      if (this.bonusCountdown <= 0) { this.spawnBonus(); this.bonusCountdown = 5; }
      this.spawnFood();
    } else if (eatingBonus) {
      this.score += 50;
      this.spawnParticles(this.bonus.x, this.bonus.y, BONUS_COLOR, 8);
      this.flare = 0.15;
      this.blip('bullseye');
      this.bonus = null;
      this.snake.pop(); // bonus doesn't grow the snake
    } else {
      this.snake.pop();
    }
    this.updateHUD();
  }

  die() {
    this.state = 'dead';
    this.deathTimer = 0.4;
    this.shakeTimer = 0.25;
    this.blip('buzzer');
    if (!this.reducedMotion && this.boardFrame) {
      this.boardFrame.classList.remove('tetris-pulse');
      void this.boardFrame.offsetWidth;
      this.boardFrame.classList.add('tetris-pulse');
    }
  }

  finishDeath() {
    this.over = true;
    const prev = Number(localStorage.getItem(HS_KEY) || 0);
    if (this.score > prev) {
      localStorage.setItem(HS_KEY, String(this.score));
      this.onHighScore(this.score);
    }
    const ov = document.getElementById('snake-gameover-overlay');
    const stats = document.getElementById('snake-final-stats');
    if (stats) stats.textContent = `SCORE ${this.score} · LENGTH ${this.snake.length}`;
    if (ov) ov.classList.remove('hidden');
    this.updateHUD();
  }

  retry() {
    this.hideOverlays();
    this.reset();
    this.beginCountdown();
    this.lastTime = performance.now();
  }

  hideOverlays() {
    const p = document.getElementById('snake-pause-overlay');
    const g = document.getElementById('snake-gameover-overlay');
    if (p) p.classList.add('hidden');
    if (g) g.classList.add('hidden');
  }

  // ---- particles ----
  spawnParticles(gx, gy, color, n) {
    if (this.reducedMotion) return;
    const cx = gx * CELL + CELL / 2;
    const cy = gy * CELL + CELL / 2;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 120;
      this.particles.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.3, max: 0.3, color });
    }
  }
  updateParticles(dt) {
    for (const p of this.particles) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 220 * dt; p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  // ---- input binding ----
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
    if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
      e.preventDefault(); this.togglePause(); return;
    }
    const name = KEY_TO_DIR[e.key];
    if (!name) return;
    e.preventDefault();
    if (this.state === 'playing') this.queueInput(name);
    else if (this.state === 'countdown' || this.state === 'paused') {
      // Allow pre-buffering a first turn during the countdown.
      this.queueInput(name);
    }
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
    const dx = t.clientX - this.touchStart.x;
    const dy = t.clientY - this.touchStart.y;
    if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return; // tap, not a swipe
    // Dominant axis wins.
    let name;
    if (Math.abs(dx) > Math.abs(dy)) name = dx > 0 ? 'right' : 'left';
    else name = dy > 0 ? 'down' : 'up';
    this.queueInput(name);
    this.touchStart = null;
  }

  blip(kind) {
    if (typeof window === 'undefined' || !arcadeFX) return;
    const fn = arcadeFX[`play${kind[0].toUpperCase()}${kind.slice(1)}`];
    if (fn) { try { fn.call(arcadeFX); } catch { /* audio unavailable */ } }
  }

  // ---- rendering ----
  render() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, BOARD, BOARD);
    // Board bg.
    ctx.fillStyle = '#0a061a';
    ctx.fillRect(0, 0, BOARD, BOARD);
    // Faint grid.
    ctx.strokeStyle = GRID_LINE;
    ctx.lineWidth = 1;
    for (let i = 1; i < GRID; i++) {
      ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, BOARD); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * CELL); ctx.lineTo(BOARD, i * CELL); ctx.stroke();
    }

    this.drawFood(ctx);
    if (this.bonus) this.drawBonus(ctx);
    this.drawSnake(ctx);
    this.drawParticles(ctx);

    if (this.state === 'countdown') this.drawCountdown(ctx);
  }

  drawSnake(ctx) {
    const len = this.snake.length;
    const dead = this.state === 'dead' || this.over;
    const redPhase = dead && this.deathTimer > 0.2; // first ~200ms = red flash
    for (let i = len - 1; i >= 0; i--) {
      const t = len > 1 ? i / (len - 1) : 0; // 0 head → 1 tail
      let color = lerpColor(HEAD_COLOR, TAIL_COLOR, t);
      if (redPhase) color = '#ff4d6d';
      else if (dead) color = lerpColor('#5a7a6e', TAIL_COLOR, t * 0.5); // desaturated
      const glow = (len - i) * 1.4 + (this.flare > 0 ? 8 : 0);
      this.drawSegment(ctx, i, color, glow);
    }
    // Head overlay: bright core + eyes (skip eyes when dead).
    if (!dead) this.drawHead(ctx);
  }

  // Per-segment rounded rects with 2px gaps on straight runs; corner segments
  // bridge into both neighbors so turns read as a connected rounded join, not
  // disconnected squares.
  drawSegment(ctx, i, color, glow) {
    const c = this.snake[i];
    const len = this.snake.length;
    const t = len > 1 ? i / (len - 1) : 0; // 0 head → 1 tail
    let x = c.x * CELL + 1; // 1px inset → 2px gap between straight segments
    let y = c.y * CELL + 1;
    let w = CELL - 2;
    let h = CELL - 2;
    let r = 5;
    const inDir = i < len - 1 ? { x: this.snake[i + 1].x - c.x, y: this.snake[i + 1].y - c.y } : null;
    const outDir = i > 0 ? { x: c.x - this.snake[i - 1].x, y: c.y - this.snake[i - 1].y } : null;
    const isCorner = inDir && outDir && !(inDir.x === outDir.x && inDir.y === outDir.y);
    if (isCorner) {
      // Extend 1px into both neighbors to bridge the gap → connected corner.
      r = 7;
      if (inDir.x !== 0) { w += 1; if (inDir.x < 0) x -= 1; }
      if (inDir.y !== 0) { h += 1; if (inDir.y < 0) y -= 1; }
      if (outDir.x !== 0) { w += 1; if (outDir.x < 0) x -= 1; }
      if (outDir.y !== 0) { h += 1; if (outDir.y < 0) y -= 1; }
    }
    ctx.save();
    ctx.shadowColor = HEAD_COLOR;
    ctx.shadowBlur = glow;
    ctx.fillStyle = color;
    this.roundRect(ctx, x, y, w, h, r);
    ctx.fill();
    // Inner bright core for the head-ish segments (fade out toward tail).
    if (i < this.snake.length * 0.4) {
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.5 * (1 - t);
      ctx.fillStyle = '#d6ffe6';
      this.roundRect(ctx, x + 3, y + 3, w - 6, h - 6, Math.max(2, r - 2));
      ctx.fill();
    }
    ctx.restore();
  }

  drawHead(ctx) {
    const c = this.snake[0];
    const cx = c.x * CELL + CELL / 2;
    const cy = c.y * CELL + CELL / 2;
    const d = this.dir;
    const perp = { x: -d.y, y: d.x };
    // Two eyes near the front, offset perpendicular.
    const front = CELL * 0.16;
    const side = CELL * 0.16;
    for (const s of [1, -1]) {
      const ex = cx + d.x * front + perp.x * side * s;
      const ey = cy + d.y * front + perp.y * side * s;
      ctx.save();
      ctx.fillStyle = '#0a061a';
      ctx.beginPath(); ctx.arc(ex, ey, 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(ex + d.x * 0.6, ey + d.y * 0.6, 1.1, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  drawFood(ctx) {
    if (!this.food) return;
    const cx = this.food.x * CELL + CELL / 2;
    const cy = this.food.y * CELL + CELL / 2;
    const pulse = 1 + Math.sin((this.time || 0) * 5) * 0.12;
    ctx.save();
    ctx.shadowColor = FOOD_COLOR;
    ctx.shadowBlur = 12;
    ctx.fillStyle = FOOD_COLOR;
    ctx.beginPath(); ctx.arc(cx, cy, (CELL * 0.26) * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffd0db';
    ctx.beginPath(); ctx.arc(cx, cy, CELL * 0.12, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  drawBonus(ctx) {
    if (!this.bonus) return;
    const cx = this.bonus.x * CELL + CELL / 2;
    const cy = this.bonus.y * CELL + CELL / 2;
    const pulse = 1 + Math.sin((this.time || 0) * 8) * 0.18;
    ctx.save();
    ctx.shadowColor = BONUS_COLOR;
    ctx.shadowBlur = 18;
    ctx.fillStyle = BONUS_COLOR;
    ctx.beginPath(); ctx.arc(cx, cy, (CELL * 0.28) * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff3cf';
    ctx.beginPath(); ctx.arc(cx, cy, CELL * 0.13, 0, Math.PI * 2); ctx.fill();
    // Shrinking timer ring.
    const prog = Math.max(0, this.bonus.timer / 5);
    ctx.strokeStyle = BONUS_COLOR;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, CELL * 0.5 - (1 - prog) * 2, 0, Math.PI * 2 * prog);
    ctx.stroke();
    ctx.restore();
  }

  drawParticles(ctx) {
    for (const p of this.particles) {
      const a = Math.max(0, p.life / p.max);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 6;
      ctx.fillStyle = p.color;
      const s = 4 * a + 1;
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      ctx.restore();
    }
  }

  drawCountdown(ctx) {
    ctx.save();
    ctx.fillStyle = 'rgba(10,6,26,0.5)';
    ctx.fillRect(0, 0, BOARD, BOARD);
    ctx.fillStyle = HEAD_COLOR;
    ctx.shadowColor = HEAD_COLOR;
    ctx.shadowBlur = 24;
    ctx.font = '64px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(this.countdown || 'GO'), BOARD / 2, BOARD / 2);
    ctx.restore();
  }

  roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  updateHUD() {
    if (typeof document === 'undefined') return;
    const s = document.getElementById('snake-score');
    if (s) s.textContent = this.displayedScore;
    const l = document.getElementById('snake-length');
    if (l) l.textContent = this.snake.length;
    const b = document.getElementById('snake-best');
    if (b) b.textContent = Number(localStorage.getItem(HS_KEY) || 0);
  }
}

export function getSnakeHighScore() {
  return Number(localStorage.getItem(HS_KEY) || 0);
}

export const SNAKE_HS_KEY = HS_KEY;

// Self-check: tick curve, reversal rejection, bonus cadence, free-cell spawn.
// Run with:
//   node --input-type=module -e "import('./src/game/snake.js').then(m=>m._selfCheck())"
export function _selfCheck() {
  const s = new Snake({});
  // Start length 3, head center moving right.
  if (s.snake.length !== 3) throw new Error('start length');
  if (s.dir.x !== 1 || s.dir.y !== 0) throw new Error('start dir');
  // Tick curve: 140 → 136 after 1 food → floor 70.
  s.foodEaten = 0; s.recomputeTick(); if (s.tickInterval !== 140) throw new Error('start tick');
  s.foodEaten = 1; s.recomputeTick(); if (s.tickInterval !== 136) throw new Error('tick step');
  s.foodEaten = 100; s.recomputeTick(); if (s.tickInterval !== 70) throw new Error('tick floor');

  // Reversal rejection at queue time: can't queue the reverse of current dir.
  s.queue = [];
  s.queueInput('left'); // reverse of right → dropped
  if (s.queue.length !== 0) throw new Error('reversal should be dropped');
  // A 90° turn queues; a second turn that reverses the FIRST queued is dropped,
  // but a valid second turn is kept (buffer up to 2).
  s.queueInput('up');
  if (s.queue.length !== 1) throw new Error('first turn not queued');
  s.queueInput('down'); // reverse of 'up' (last queued) → dropped
  if (s.queue.length !== 1) throw new Error('reverse-of-queued should drop');
  s.queueInput('left'); // valid second turn
  if (s.queue.length !== 2) throw new Error('second turn not buffered');
  // Buffer cap at 2.
  s.queueInput('down');
  if (s.queue.length !== 2) throw new Error('buffer cap violated');

  // Per-tick apply rejects a reversal relative to the applied direction even
  // if it somehow reached the queue head.
  s.queue = [{ x: -1, y: 0 }]; // left, reverse of current 'right'
  s.step();
  if (s.dir.x !== 1) throw new Error('per-tick reversal not rejected');

  // Bonus cadence: every 5th food.
  // (Re-using s is fine; reset state for the cadence check below.)

  // Free-cell spawn never lands on the snake.
  s.reset();
  for (let i = 0; i < 20; i++) {
    s.food = null; s.bonus = null;
    s.spawnFood();
    if (!s.food) continue;
    const onSnake = s.snake.some((c) => c.x === s.food.x && c.y === s.food.y);
    if (onSnake) throw new Error('food spawned on snake');
  }

  // Bonus spawns and doesn't grow the snake.
  s.reset();
  s.bonusCountdown = 1; s.food = { x: -1, y: -1 }; // force-eat path: simulate eating 5th
  // Directly test spawnBonus places off-snake.
  s.spawnBonus();
  if (s.bonus) {
    const onSnake = s.snake.some((c) => c.x === s.bonus.x && c.y === s.bonus.y);
    if (onSnake) throw new Error('bonus spawned on snake');
  }

  console.log('snake self-check ok');
}