// Breakout — complete vanilla-canvas implementation for the arcade hub.
// Sub-stepped ball physics (no tunnelling), paddle-angle bounce with a 20°
// from-horizontal floor, 10 handcrafted ASCII levels that loop with rising
// speed, WIDE/MULTI/SLOW/1UP power-ups, explosive chain bricks, particles +
// ball trail, fixed-dt loop. Reuses arcadeFX SFX; high score in localStorage
// (no backend yet). No deps.
import { arcadeFX } from './arcade.js';

// Playfield (drawing buffer). Walls are the canvas edges (left/right/top);
// the ball is lost past the bottom.
const W = 480;
const H = 360;

const COLS = 13;
const BRICK_H = 18;
const TOP_OFFSET = 30; // bricks begin this far from the top
const BRICK_W = W / COLS;

const BALL_R = 6;
const BASE_SPEED = 250;   // px/s at level 1
const PADDLE_BASE_W = 76;
const PADDLE_H = 12;
const PADDLE_Y = H - 26;
const PADDLE_KEY_SPEED = 460; // px/s under DAS repeat

// Power-up tuning.
const PU_DROP_CHANCE = 0.12;
const PU_FALL_SPEED = 90;
// Weighted type table (1UP rare → ~2% overall).
const PU_WEIGHTS = { WIDE: 30, MULTI: 25, SLOW: 25, ONEUP: 15 };
const PU_COLORS = { WIDE: '#ffc93c', MULTI: '#4dd8ff', SLOW: '#4d79ff', ONEUP: '#3df58c' };
const PU_LABEL = { WIDE: 'W', MULTI: 'M', SLOW: 'S', ONEUP: '1' };
const MAX_BALLS = 6;

// Brick-row accent colors (cycles pink→purple).
const ROW_COLORS = ['#ff2e63', '#ff8c42', '#ffc93c', '#3df58c', '#4dd8ff', '#4d79ff', '#b04dff'];

// 10 handcrafted layouts. '.' empty, '1' normal, '2' armored, '3' explosive
// (chains to 4-neighbors), 'X' steel. 13 cols, up to 8 rows. Loop after 10
// with rising speed.
const LEVELS = [
  // 1 — light opener: ~60 bricks so the first level is a quick, satisfying
  //      clear, not the densest level in the game.
  [
    '1111111111111',
    '1.111111111.1',
    '1212121212121',
    '1.111111111.1',
    '1111111111111',
  ],
  // 2 — pyramid
  [
    '......1......',
    '.....111.....',
    '....11111....',
    '...1111111...',
    '..111111111..',
    '.11111111111.',
    '1111111111111',
  ],
  // 3 — checkerboard
  [
    '1.1.1.1.1.1.1',
    '.1.1.1.1.1.1.',
    '1.1.1.1.1.1.1',
    '.1.1.1.1.1.1.',
    '1.1.1.1.1.1.1',
    '.1.1.1.1.1.1.',
    '1.1.1.1.1.1.1',
    '.1.1.1.1.1.1.',
  ],
  // 4 — fortress (steel walls with a door, else the interior is sealed and
  //      the level is unwinnable — the ball can never reach the inner bricks)
  [
    'XXXXXXXXXXXXX',
    'X...........X',
    'X.111111111.X',
    'X.122222221.X',
    'X.111111111.X',
    'X...........X',
    'XXXX.....XXXX',
  ],
  // 5 — smiley
  [
    '..111...111..',
    '..1.1...1.1..',
    '..111...111..',
    '.............',
    '.1.1.1.1.1.1.',
    '..1.1.1.1.1..',
    '...1.....1...',
    '..11.....11..',
  ],
  // 6 — diamond
  [
    '......1......',
    '.....121.....',
    '....12121....',
    '...1212121...',
    '..121212121..',
    '...1212121...',
    '....12121....',
    '.....111.....',
  ],
  // 7 — chevron
  [
    '1...........1',
    '11.........11',
    '111.......111',
    '1111.....1111',
    '11111...11111',
    '1111.....1111',
    '111.......111',
    '11.........11',
  ],
  // 8 — heart
  [
    '..111...111..',
    '.11111.11111.',
    '.11111111111.',
    '.11111111111.',
    '..111111111..',
    '...1111111...',
    '....11111....',
    '.....111.....',
  ],
  // 9 — bomb squad: explosives are clustered (adjacent 3s) so a single hit
  //      actually chains through the cluster — four chain reactions seeded
  //      across the field. 13 cols, 8 rows.
  [
    '1111111111111',
    '.1331...1331.',
    '1.1.1.1.1.1.1',
    '11.333.333.11',
    '1.1.1.1.1.1.1',
    '.1331...1331.',
    '1111111111111',
    '1.333.1.333.1',
  ],
  // 10 — detonator: a fully connected ring of explosives around an armored
  //      core. One hit anywhere on the ring cascades the whole ring — the
  //      payoff level — leaving the 2-hp armored core to clean up by hand.
  [
    '...3333333...',
    '...3.....3...',
    '...3.222.3...',
    '...3.222.3...',
    '...3.222.3...',
    '...3.....3...',
    '...3333333...',
    '.............',
  ],
];

const HS_KEY = 'geoguesser_breakout_highscore';

// Brighten/darken a hex toward white/black; returns an rgb() string for
// brick edges/cores and paddle flashes. (Duplicated from tetris.js — tiny,
// kept local to avoid coupling the two games.)
function shade(hex, amt) {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + 255 * amt)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

function weightedPick(weights) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (const k of Object.keys(weights)) {
    r -= weights[k];
    if (r <= 0) return k;
  }
  return Object.keys(weights)[0];
}

export class Breakout {
  constructor(opts = {}) {
    this.canvas = opts.canvas;
    this.ctx = this.canvas?.getContext('2d');
    this.livesCanvas = opts.livesCanvas;
    this.livesCtx = this.livesCanvas?.getContext('2d');
    this.boardFrame = opts.boardFrame;
    this.onHighScore = opts.onHighScore || (() => {});
    this.reducedMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.running = false;
    this.reset();
  }

  reset() {
    this.score = 0;
    this.displayedScore = 0;
    this.lives = 3;
    this.levelNumber = 0; // 0-indexed; displayed as +1
    this.paddleHits = 0;
    this.bricks = [];
    this.balls = [];
    this.powerups = [];
    this.particles = [];
    this.wideTimer = 0;
    this.slowTimer = 0;
    this.flashTimer = 0;     // paddle contact flash
    this.clearTimer = 0;     // >0 → level-clear message showing, gameplay paused
    this.levelBannerTimer = 0; // >0 → "LEVEL N" intro banner showing
    this.over = false;
    this.paused = false;
    this.nextExtraLifeAt = 20000; // +1 life every 20k, flagged here so it's not double-awarded
    this.paddleTarget = W / 2;
    this.paddle = { x: W / 2 - PADDLE_BASE_W / 2, y: PADDLE_Y, w: PADDLE_BASE_W };
    this.dasDir = 0;
    this.loadLevel(0);
  }

  // ---- levels ----
  loadLevel(idx) {
    this.levelNumber = idx;
    const layout = LEVELS[idx % LEVELS.length];
    this.bricks = [];
    for (let r = 0; r < layout.length; r++) {
      for (let c = 0; c < COLS && c < layout[r].length; c++) {
        const ch = layout[r][c];
        if (ch === '.') continue;
        const type = ch === 'X' ? 'steel'
          : ch === '2' ? 'armored'
          : ch === '3' ? 'explosive'
          : 'normal';
        this.bricks.push({
          x: c * BRICK_W,
          y: TOP_OFFSET + r * BRICK_H,
          w: BRICK_W,
          h: BRICK_H,
          row: r,
          col: c,
          type,
          hp: type === 'armored' ? 2 : 1,
          maxHp: type === 'armored' ? 2 : 1,
          color: type === 'explosive' ? '#ff7a00' : ROW_COLORS[r % ROW_COLORS.length],
          alive: true,
        });
      }
    }
    // Per-loop escalation (loop 0 = first pass plays as-designed). From the
    // second pass onward, armored bricks gain HP (cap 4) and a growing share
    // of normal bricks harden into armored — so repeats past level 10 aren't
    // speed-only; the layouts themselves get tougher to crack.
    const loop = Math.floor(idx / LEVELS.length);
    if (loop >= 1) {
      const armoredHp = Math.min(4, 1 + loop); // loop1→2hp, loop2→3hp, loop3+→4hp
      const promoteChance = Math.min(0.5, 0.15 * loop);
      for (const b of this.bricks) {
        if (b.type === 'armored') {
          b.hp = armoredHp; b.maxHp = armoredHp;
        } else if (b.type === 'normal' && Math.random() < promoteChance) {
          b.type = 'armored';
          b.hp = armoredHp; b.maxHp = armoredHp;
        }
      }
    }
    // Carry half the rally bonus into the next level so the ball doesn't
    // abruptly stall at each new level — keeps the pace up between levels.
    this.paddleHits = Math.floor(this.paddleHits / 2);
    this.powerups = [];
    this.balls = [];
    this.spawnBallOnPaddle();
    // Brief "LEVEL N" banner so advancing feels like an event.
    this.levelBannerTimer = 1.6;
  }

  spawnBallOnPaddle() {
    this.balls = [{
      x: this.paddle.x + this.paddle.w / 2,
      y: PADDLE_Y - BALL_R - 1,
      dir: { x: 0, y: -1 },
      launched: false,
      trail: [],
    }];
  }

  currentSpeed() {
    const levelMult = Math.pow(1.04, this.levelNumber); // level 0 → 1.0
    const paddleBonus = Math.pow(1.02, Math.floor(this.paddleHits / 10));
    let s = BASE_SPEED * levelMult * paddleBonus;
    // Cap rises with each full loop so late game keeps escalating instead of
    // going flat at 2× forever (bounded at 3.5× so it stays playable).
    const loop = Math.floor(this.levelNumber / LEVELS.length);
    const cap = BASE_SPEED * Math.min(3.5, 2 + 0.2 * loop);
    s = Math.min(s, cap);
    if (this.slowTimer > 0) {
      // Full 0.7× while > 0.5 s remain; ease back to 1× over the last 0.5 s
      // so SLOW expiry isn't a sudden, unfair speed jump.
      const t = Math.min(1, this.slowTimer / 0.5);
      s *= 1 - 0.3 * t;
    }
    return s;
  }

  // ---- lifecycle ----
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
    if (this.over || this.clearTimer > 0) return;
    this.paused = !this.paused;
    const ov = document.getElementById('breakout-pause-overlay');
    if (ov) ov.classList.toggle('hidden', !this.paused);
    if (!this.paused) this.lastTime = performance.now();
  }

  loop(now) {
    if (!this.running) return;
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    // Cap dt so a tab-away or stall doesn't teleport the ball through bricks.
    if (dt > 0.032) dt = 0.032;
    if (!this.paused && !this.over) this.update(dt);
    this.render();
    this.rafId = requestAnimationFrame(this.loop.bind(this));
  }

  update(dt) {
    // Score count-up easing toward the real score.
    if (this.displayedScore !== this.score) {
      const diff = this.score - this.displayedScore;
      this.displayedScore += Math.max(1, Math.ceil(diff * 0.2));
      if (this.displayedScore > this.score) this.displayedScore = this.score;
      this.updateHUD();
      this.checkExtraLife();
    }
    // Timers.
    if (this.wideTimer > 0) this.wideTimer = Math.max(0, this.wideTimer - dt);
    if (this.slowTimer > 0) this.slowTimer = Math.max(0, this.slowTimer - dt);
    if (this.flashTimer > 0) this.flashTimer = Math.max(0, this.flashTimer - dt);
    if (this.levelBannerTimer > 0) this.levelBannerTimer = Math.max(0, this.levelBannerTimer - dt);
    // Paddle width follows WIDE timer (timer-stacked: refresh, not stacked).
    const targetW = this.wideTimer > 0 ? PADDLE_BASE_W * 1.4 : PADDLE_BASE_W;
    if (this.paddle.w !== targetW) {
      const cx = this.paddle.x + this.paddle.w / 2;
      this.paddle.w = targetW;
      this.paddle.x = cx - targetW / 2;
    }
    this.movePaddle(dt);

    if (this.clearTimer > 0) {
      this.clearTimer -= dt;
      this.updateParticles(dt);
      if (this.clearTimer <= 0) this.loadLevel(this.levelNumber + 1);
      return;
    }

    const speed = this.currentSpeed();
    for (const ball of this.balls) this.moveBall(ball, speed, dt);

    // Drop lost balls; lose a life only when the last one falls.
    const before = this.balls.length;
    this.balls = this.balls.filter((b) => b.y - BALL_R <= H + 4);
    if (this.balls.length === 0 && before > 0) this.loseLife();

    this.updatePowerups(dt);
    this.updateParticles(dt);

    // Level clear when no breakable bricks remain (steel doesn't count).
    if (!this.bricks.some((b) => b.alive && b.type !== 'steel')) {
      this.startLevelClear();
    }
  }

  movePaddle(dt) {
    // Keys move the target continuously at full speed (smooth), instead of
    // the old DAS 18px hops that felt choppy. Mouse/touch set the target
    // directly in their handlers; both reach the paddle the same way here.
    if (this.dasDir !== 0) {
      this.paddleTarget += this.dasDir * PADDLE_KEY_SPEED * dt;
    }
    const half = this.paddle.w / 2;
    this.paddleTarget = Math.max(half, Math.min(W - half, this.paddleTarget));
    this.paddle.x = this.paddleTarget - half;
  }

  // Sub-step the ball so its per-frame travel never exceeds half a brick's
  // height — prevents tunnelling through bricks/paddle at high speed.
  moveBall(ball, speed, dt) {
    if (!ball.launched) {
      // Ride the paddle until launched.
      ball.x = this.paddle.x + this.paddle.w / 2;
      ball.y = PADDLE_Y - BALL_R - 1;
      ball.trail.length = 0;
      return;
    }
    const travel = speed * dt;
    const maxStep = BRICK_H / 2;
    const steps = Math.max(1, Math.ceil(travel / maxStep));
    const sdt = dt / steps;
    for (let i = 0; i < steps; i++) {
      ball.x += ball.dir.x * speed * sdt;
      ball.y += ball.dir.y * speed * sdt;
      this.collideWalls(ball);
      this.collidePaddle(ball);
      this.collideBricks(ball);
    }
    // Trail (skip under reduced motion).
    if (!this.reducedMotion) {
      ball.trail.push({ x: ball.x, y: ball.y });
      if (ball.trail.length > 8) ball.trail.shift();
    }
  }

  collideWalls(ball) {
    if (ball.x - BALL_R < 0) { ball.x = BALL_R; ball.dir.x = Math.abs(ball.dir.x); }
    if (ball.x + BALL_R > W) { ball.x = W - BALL_R; ball.dir.x = -Math.abs(ball.dir.x); }
    if (ball.y - BALL_R < 0) { ball.y = BALL_R; ball.dir.y = Math.abs(ball.dir.y); }
  }

  collidePaddle(ball) {
    const p = this.paddle;
    if (ball.dir.y <= 0) return; // only when descending
    const overlapY = ball.y + BALL_R >= p.y && ball.y - BALL_R <= p.y + PADDLE_H;
    if (!overlapY) return;
    if (ball.x < p.x - BALL_R || ball.x > p.x + p.w + BALL_R) return;

    // Side scrape: ball center is past a paddle edge → bounce sideways, not
    // up through the top. Stops the ball from popping out the top of the
    // paddle after a steep side approach.
    const pastLeft = ball.x < p.x;
    const pastRight = ball.x > p.x + p.w;
    if (pastLeft || pastRight) {
      ball.dir.x = (pastLeft ? -1 : 1) * Math.abs(ball.dir.x || 1);
      ball.x = pastLeft ? p.x - BALL_R - 0.1 : p.x + p.w + BALL_R + 0.1;
      this.flashTimer = 0.12;
      this.blip('click');
      return; // no paddle-hit bonus for a scrape
    }

    // Top hit: map hit offset (−1..+1) to exit angle 90° ± 60° → [30°,150°].
    // 90° = straight up; edges → steep sideways. Guarantees ≥30° from
    // horizontal (≥20° floor satisfied), so no horizontal ping-pong.
    ball.y = p.y - BALL_R;
    const offset = Math.max(-1, Math.min(1, (ball.x - (p.x + p.w / 2)) / (p.w / 2)));
    const angleDeg = 90 - offset * 60;
    const rad = (angleDeg * Math.PI) / 180;
    ball.dir.x = Math.cos(rad);
    ball.dir.y = -Math.sin(rad);
    this.paddleHits++;
    this.flashTimer = 0.12;
    this.blip('click');
  }

  collideBricks(ball) {
    // Resolve up to two overlapping bricks per sub-step — a corner can
    // overlap two adjacent bricks at once. Each is resolved by the axis of
    // least penetration, which is more correct than the old center-outside
    // heuristic and stops wrong-axis flips that let the ball leak through.
    for (let pass = 0; pass < 2; pass++) {
      let best = null;
      let bestDist = Infinity;
      for (const b of this.bricks) {
        if (!b.alive) continue;
        const cx = Math.max(b.x, Math.min(ball.x, b.x + b.w));
        const cy = Math.max(b.y, Math.min(ball.y, b.y + b.h));
        const dx = ball.x - cx;
        const dy = ball.y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 <= BALL_R * BALL_R && d2 < bestDist) { best = b; bestDist = d2; }
      }
      if (!best) break;
      const overlapL = (ball.x + BALL_R) - best.x;
      const overlapR = (best.x + best.w) - (ball.x - BALL_R);
      const overlapT = (ball.y + BALL_R) - best.y;
      const overlapB = (best.y + best.h) - (ball.y - BALL_R);
      const minX = Math.min(overlapL, overlapR);
      const minY = Math.min(overlapT, overlapB);
      if (minX < minY) {
        ball.dir.x = -ball.dir.x;
        ball.x = overlapL < overlapR ? best.x - BALL_R - 0.01 : best.x + best.w + BALL_R + 0.01;
      } else {
        ball.dir.y = -ball.dir.y;
        ball.y = overlapT < overlapB ? best.y - BALL_R - 0.01 : best.y + best.h + BALL_R + 0.01;
      }
      this.hitBrick(best);
    }
    // Anti-trap: keep the ball ≥20° from horizontal so it can't settle into
    // tedious near-horizontal ping-pong between bricks/steel. Preserves the
    // current vertical sign and keeps the direction unit-length.
    const minVy = Math.sin((20 * Math.PI) / 180);
    if (Math.abs(ball.dir.y) < minVy) {
      const sign = ball.dir.y < 0 ? -1 : (ball.dir.y > 0 ? 1 : -1);
      ball.dir.y = sign * minVy;
      const rem = Math.max(0, 1 - ball.dir.y * ball.dir.y);
      ball.dir.x = Math.sign(ball.dir.x || -1) * Math.sqrt(rem);
    }
  }

  hitBrick(b) {
    if (b.type === 'steel') {
      this.blip('click');
      return; // unbreakable, no score
    }
    b.hp--;
    if (b.hp > 0) {
      // Armored brick takes a first hit: dim it (rendered from hp ratio).
      this.blip('click');
      return;
    }
    b.alive = false;
    const multiplier = (8 - b.row) || 1; // higher rows worth more (top=8×)
    const base = 50 * Math.max(1, multiplier);
    const points = b.type === 'armored' ? base * 2 : base;
    this.score += points;
    this.updateHUD();
    this.spawnParticles(b.x + b.w / 2, b.y + b.h / 2, b.color, 8);
    this.blip('coin');
    this.maybeDropPowerup(b);
    if (b.type === 'explosive') this.detonate(b);
  }

  // Explosive chain: destroy the 4-neighbourhood of `origin` (never steel),
  // cascading through any explosive neighbours. The origin itself is already
  // dead and scored; this only scores the neighbours it takes with it.
  detonate(origin) {
    const queue = [origin];
    const seen = new Set([origin]);
    while (queue.length) {
      const b = queue.shift();
      for (const n of this.bricks) {
        if (seen.has(n) || !n.alive) continue;
        const adj = (n.row === b.row && Math.abs(n.col - b.col) === 1) ||
                    (n.col === b.col && Math.abs(n.row - b.row) === 1);
        if (!adj) continue;
        seen.add(n);
        if (n.type === 'steel') continue;
        n.alive = false;
        const mult = (8 - n.row) || 1;
        const pts = 50 * Math.max(1, mult) * (n.type === 'armored' ? 2 : 1);
        this.score += pts;
        this.spawnParticles(n.x + n.w / 2, n.y + n.h / 2, n.color, 8);
        if (n.type === 'explosive') queue.push(n);
      }
    }
    this.spawnParticles(origin.x + origin.w / 2, origin.y + origin.h / 2, '#ff7a00', 20);
    this.blip('bullseye');
    this.updateHUD();
  }

  // ---- power-ups ----
  maybeDropPowerup(b) {
    if (Math.random() > PU_DROP_CHANCE) return;
    const type = weightedPick(PU_WEIGHTS);
    this.powerups.push({
      x: b.x + b.w / 2,
      y: b.y + b.h / 2,
      type,
      color: PU_COLORS[type],
      phase: Math.random() * Math.PI * 2,
    });
  }

  updatePowerups(dt) {
    for (const pu of this.powerups) {
      pu.y += PU_FALL_SPEED * dt;
      pu.phase += dt * 4;
      const p = this.paddle;
      if (pu.y + 8 >= p.y && pu.y - 8 <= p.y + PADDLE_H &&
          pu.x >= p.x && pu.x <= p.x + p.w) {
        this.applyPowerup(pu.type);
        pu._caught = true;
      }
    }
    this.powerups = this.powerups.filter((pu) => !pu._caught && pu.y < H + 12);
  }

  applyPowerup(type) {
    if (type === 'WIDE') {
      this.wideTimer = 15; // refresh, not stack
    } else if (type === 'SLOW') {
      this.slowTimer = 10;
    } else if (type === 'ONEUP') {
      this.lives = Math.min(9, this.lives + 1);
      this.updateHUD();
    } else if (type === 'MULTI') {
      const seeded = this.balls.filter((b) => b.launched);
      const src = seeded.length ? seeded : this.balls;
      const additions = [];
      for (const b of src) {
        if (this.balls.length + additions.length >= MAX_BALLS) break;
        for (const spread of [-20, 20]) {
          if (this.balls.length + additions.length >= MAX_BALLS) break;
          const rad = Math.atan2(b.dir.y, b.dir.x) + (spread * Math.PI) / 180;
          additions.push({ x: b.x, y: b.y, dir: { x: Math.cos(rad), y: Math.sin(rad) }, launched: true, trail: [] });
        }
      }
      this.balls.push(...additions);
      // Brief white flash on split.
      if (this.boardFrame && !this.reducedMotion) this.flashFrame();
    }
    this.blip('bullseye');
  }

  // ---- particles + FX ----
  spawnParticles(x, y, color, n) {
    if (this.reducedMotion) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 120;
      this.particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.3,
        max: 0.3,
        color,
      });
    }
  }

  updateParticles(dt) {
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 220 * dt; // slight gravity so they fly out and fall
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  flashFrame() {
    if (!this.boardFrame) return;
    this.boardFrame.classList.remove('tetris-pulse');
    void this.boardFrame.offsetWidth;
    this.boardFrame.classList.add('tetris-pulse');
  }

  startLevelClear() {
    this.clearTimer = 1.2;
    // Reward advancing: a clear bonus that scales with level so finishing a
    // level feels earned, not just "next layout loaded".
    const bonus = 500 * (this.levelNumber + 1);
    this.score += bonus;
    this.updateHUD();
    this.checkExtraLife();
    this.blip('levelUp');
    if (this.boardFrame && !this.reducedMotion) this.flashFrame();
  }

  // Extra life at 20k, 40k, 60k… (capped at 9). Called after score gains so a
  // big cascade or clear bonus can push you over the threshold mid-frame.
  checkExtraLife() {
    while (this.score >= this.nextExtraLifeAt && this.lives < 9) {
      this.lives++;
      this.nextExtraLifeAt += 20000;
      this.blip('bullseye');
      this.updateHUD();
    }
    // If already maxed, still advance the threshold so it doesn't fire later.
    if (this.lives >= 9) this.nextExtraLifeAt = Math.max(this.nextExtraLifeAt, this.score + 20000);
  }

  loseLife() {
    this.lives--;
    this.updateHUD();
    if (this.lives <= 0) { this.gameOver(); return; }
    this.blip('buzzer');
    this.powerups = [];
    this.wideTimer = 0;
    this.slowTimer = 0;
    // Drop the in-level speed bonus so a fresh ball is recoverable — without
    // this, paddleHits (and thus currentSpeed) stays high after death and the
    // relaunched ball is still at the speed that helped kill you.
    this.paddleHits = Math.floor(this.paddleHits / 2);
    this.spawnBallOnPaddle();
  }

  gameOver() {
    this.over = true;
    this.blip('buzzer');
    const prev = Number(localStorage.getItem(HS_KEY) || 0);
    if (this.score > prev) {
      localStorage.setItem(HS_KEY, String(this.score));
      this.onHighScore(this.score);
    }
    const ov = document.getElementById('breakout-gameover-overlay');
    const stats = document.getElementById('breakout-final-stats');
    if (stats) stats.textContent = `SCORE ${this.score} · LEVEL ${this.levelNumber + 1}`;
    if (ov) ov.classList.remove('hidden');
    // Offer CONTINUE only when the player actually advanced — otherwise it's
    // identical to RETRY and just clutters the game-over screen.
    const cont = document.getElementById('breakout-continue-btn');
    if (cont) cont.style.display = this.levelNumber > 0 ? '' : 'none';
  }

  retry() {
    this.hideOverlays();
    this.reset();
    this.lastTime = performance.now();
  }

  // Keep score + reached level, but restore lives and clear the speed ramp so
  // a death deep in the game doesn't throw away all progress.
  continueGame() {
    this.hideOverlays();
    this.over = false;
    this.lives = 3;
    this.paddleHits = 0;
    this.wideTimer = 0;
    this.slowTimer = 0;
    this.powerups = [];
    this.particles = [];
    this.paddleTarget = W / 2;
    this.paddle = { x: W / 2 - PADDLE_BASE_W / 2, y: PADDLE_Y, w: PADDLE_BASE_W };
    this.dasDir = 0;
    // Re-stamp the extra-life threshold against the carried score so continues
    // can't farm lives by re-crossing a threshold already passed.
    this.nextExtraLifeAt = Math.max(20000, Math.ceil(this.score / 20000) * 20000);
    if (this.nextExtraLifeAt <= this.score) this.nextExtraLifeAt = this.score + 20000;
    this.loadLevel(this.levelNumber);
    this.lastTime = performance.now();
  }

  hideOverlays() {
    const p = document.getElementById('breakout-pause-overlay');
    const g = document.getElementById('breakout-gameover-overlay');
    if (p) p.classList.add('hidden');
    if (g) g.classList.add('hidden');
  }

  launch() {
    if (this.over || this.paused || this.clearTimer > 0) return;
    const ball = this.balls[0];
    if (!ball || ball.launched) return;
    // ±15° from vertical, never straight up (offset clamped away from 0).
    let off = (Math.random() * 2 - 1) * 15;
    if (Math.abs(off) < 3) off = off >= 0 ? 3 : -3;
    const rad = ((90 - off) * Math.PI) / 180; // 90° = up
    ball.dir.x = Math.cos(rad);
    ball.dir.y = -Math.sin(rad);
    ball.launched = true;
    this.blip('click');
  }

  // ---- input ----
  bindInput() {
    this.keydown = (e) => this.onKey(e);
    this.keyup = (e) => this.onKeyUp(e);
    this.mousemove = (e) => this.onMouseMove(e);
    this.touchmove = (e) => this.onTouchMove(e);
    this.touchstart = (e) => { this.onTouchMove(e); this.launch(); };
    this.click = () => this.launch();
    window.addEventListener('keydown', this.keydown);
    window.addEventListener('keyup', this.keyup);
    this.canvas?.addEventListener('mousemove', this.mousemove);
    this.canvas?.addEventListener('click', this.click);
    this.canvas?.addEventListener('touchstart', this.touchstart, { passive: false });
    this.canvas?.addEventListener('touchmove', this.touchmove, { passive: false });
  }
  unbindInput() {
    window.removeEventListener('keydown', this.keydown);
    window.removeEventListener('keyup', this.keyup);
    this.canvas?.removeEventListener('mousemove', this.mousemove);
    this.canvas?.removeEventListener('click', this.click);
    this.canvas?.removeEventListener('touchstart', this.touchstart);
    this.canvas?.removeEventListener('touchmove', this.touchmove);
  }

  // Map a client position to playfield X (accounts for CSS scaling).
  clientToX(clientX) {
    if (!this.canvas) return W / 2;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0) return W / 2;
    const scale = W / rect.width;
    return Math.max(0, Math.min(W, (clientX - rect.left) * scale));
  }

  onMouseMove(e) {
    // Keyboard has priority while a movement key is held — a stray mouse
    // event (cursor brushing the canvas mid-keyboard-play) no longer silently
    // cancels key movement. Release the keys to hand control back to the mouse.
    if (this.dasDir !== 0) return;
    this.paddleTarget = this.clientToX(e.clientX);
  }
  onTouchMove(e) {
    if (e.preventDefault) e.preventDefault();
    const t = e.touches[0];
    if (!t) return;
    this.paddleTarget = this.clientToX(t.clientX);
  }
  onKeyUp(e) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      this.dasDir = 0;
    }
  }
  onKey(e) {
    if (!this.running || this.over) return;
    if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
      e.preventDefault(); this.togglePause(); return;
    }
    if (this.paused || this.clearTimer > 0) return;
    switch (e.key) {
      case ' ':
        e.preventDefault(); this.launch(); break;
      case 'ArrowLeft':
        e.preventDefault();
        this.dasDir = -1;
        // Initial-press nudge only — NOT on OS key-repeat, which fires this
        // ~30×/s and would stack 10px hops on top of the smooth continuous
        // movePaddle motion, making keyboard play jerky and too fast.
        if (!e.repeat) this.paddleTarget = this.paddle.x + this.paddle.w / 2 - 10;
        break;
      case 'ArrowRight':
        e.preventDefault();
        this.dasDir = 1;
        if (!e.repeat) this.paddleTarget = this.paddle.x + this.paddle.w / 2 + 10;
        break;
      default: break;
    }
  }

  // Sound — no-ops when audio/browser unavailable (node self-check).
  blip(kind) {
    if (typeof window === 'undefined' || !arcadeFX) return;
    const fn = arcadeFX[`play${kind[0].toUpperCase()}${kind.slice(1)}`];
    if (fn) { try { fn.call(arcadeFX); } catch { /* audio unavailable */ } }
  }

  // ---- rendering ----
  render() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    // Inset playfield bg.
    ctx.fillStyle = '#0a061a';
    ctx.fillRect(0, 0, W, H);
    // Faint top guide line where bricks start.
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.beginPath(); ctx.moveTo(0, TOP_OFFSET - 2); ctx.lineTo(W, TOP_OFFSET - 2); ctx.stroke();

    for (const b of this.bricks) if (b.alive) this.drawBrick(ctx, b);
    this.drawParticles(ctx);
    this.drawPowerups(ctx);
    this.drawPaddle(ctx);
    for (const ball of this.balls) this.drawBall(ctx, ball);

    if (this.clearTimer > 0) {
      ctx.save();
      ctx.fillStyle = 'rgba(10,6,26,0.55)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#3df58c';
      ctx.shadowColor = '#3df58c';
      ctx.shadowBlur = 24;
      ctx.font = '28px "Press Start 2P", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('LEVEL CLEAR', W / 2, H / 2);
      ctx.restore();
    }

    // Level intro banner — fade in/out so advancing reads as an event.
    if (this.levelBannerTimer > 0) {
      const t = this.levelBannerTimer;
      const fadeIn = Math.min(1, (1.6 - t) / 0.25);
      const fadeOut = Math.min(1, t / 0.5);
      const alpha = Math.min(fadeIn, fadeOut);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(10,6,26,0.45)';
      ctx.fillRect(0, H / 2 - 28, W, 56);
      ctx.fillStyle = '#4dd8ff';
      ctx.shadowColor = '#4dd8ff';
      ctx.shadowBlur = 20;
      ctx.font = '24px "Press Start 2P", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`LEVEL ${this.levelNumber + 1}`, W / 2, H / 2);
      ctx.restore();
    }

    // Launch prompt — pulsing hint while the ball waits on the paddle, so a
    // first-time player knows how to start (and restart after each life).
    const ready = this.balls[0] && !this.balls[0].launched;
    if (ready && this.clearTimer <= 0 && !this.over) {
      const pulse = 0.55 + 0.45 * Math.sin(performance.now() / 250);
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.fillStyle = '#ffffff';
      ctx.font = '9px "Press Start 2P", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('PRESS SPACE / CLICK / TAP TO LAUNCH', W / 2, H - 52);
      ctx.restore();
    }

    this.renderLives();
  }

  drawBrick(ctx, b) {
    const x = b.x + 1, y = b.y + 1, w = b.w - 2, h = b.h - 2;
    if (b.type === 'steel') {
      ctx.save();
      ctx.shadowColor = 'rgba(255,255,255,0.3)';
      ctx.shadowBlur = 6;
      ctx.fillStyle = '#5a5a68';
      ctx.fillRect(x, y, w, h);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#8a8a98';
      ctx.fillRect(x + 3, y + 3, w - 6, h - 6);
      ctx.strokeStyle = '#3a3a48';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      ctx.restore();
      return;
    }
    if (b.type === 'explosive') {
      // Pulsing warning core so players can read it as "hit me for a chain".
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 120);
      ctx.save();
      ctx.shadowColor = '#ff7a00';
      ctx.shadowBlur = 10 + pulse * 8;
      ctx.fillStyle = shade('#ff7a00', -0.2);
      ctx.fillRect(x, y, w, h);
      ctx.shadowBlur = 0;
      ctx.fillStyle = shade('#ff7a00', 0.3);
      ctx.fillRect(x + 3, y + 3, w - 6, h - 6);
      ctx.fillStyle = `rgba(255,255,255,${0.4 + 0.5 * pulse})`;
      ctx.beginPath();
      ctx.arc(x + w / 2, y + h / 2, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    // Armored bricks dim proportionally to damage so multi-hit armor (loop
    // escalation) reads visually — a 4-hp brick visibly weakens each hit,
    // not just flips to "damaged" on the first one.
    const dmg = b.type === 'armored' ? 1 - b.hp / b.maxHp : 0;
    ctx.save();
    ctx.shadowColor = b.color;
    ctx.shadowBlur = 8;
    ctx.fillStyle = shade(b.color, -0.18 - dmg * 0.25);
    ctx.fillRect(x, y, w, h);
    ctx.shadowBlur = 0;
    ctx.fillStyle = shade(b.color, 0.28 - dmg * 0.3);
    ctx.fillRect(x + 3, y + 3, w - 6, h - 6);
    ctx.fillStyle = b.color;
    ctx.globalAlpha = 1 - dmg * 0.5;
    ctx.fillRect(x + 5, y + 5, w - 10, h - 10);
    ctx.globalAlpha = 1;
    if (b.type === 'armored') {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }
    ctx.restore();
  }

  drawPaddle(ctx) {
    const p = this.paddle;
    const wide = this.wideTimer > 0;
    const color = wide ? '#ffc93c' : '#4d79ff';
    const flash = this.flashTimer > 0;
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = flash ? 22 : 10;
    ctx.fillStyle = shade(color, -0.18);
    ctx.fillRect(p.x, p.y, p.w, PADDLE_H);
    ctx.shadowBlur = 0;
    ctx.fillStyle = flash ? '#ffffff' : shade(color, 0.35);
    ctx.fillRect(p.x + 3, p.y + 2, p.w - 6, PADDLE_H - 4);
    ctx.restore();
  }

  drawBall(ctx, ball) {
    // Trail: fading radius/alpha over last ~8 positions.
    if (ball.launched && !this.reducedMotion) {
      for (let i = 0; i < ball.trail.length; i++) {
        const t = ball.trail[i];
        const a = (i + 1) / ball.trail.length;
        ctx.save();
        ctx.globalAlpha = a * 0.4;
        ctx.fillStyle = '#4dd8ff';
        ctx.beginPath();
        ctx.arc(t.x, t.y, BALL_R * a, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.save();
    ctx.shadowColor = '#4dd8ff';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#4dd8ff';
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, BALL_R * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawPowerups(ctx) {
    for (const pu of this.powerups) {
      const wobble = Math.sin(pu.phase) * 3;
      const x = pu.x + wobble, y = pu.y;
      ctx.save();
      ctx.shadowColor = pu.color;
      ctx.shadowBlur = 10;
      ctx.fillStyle = shade(pu.color, -0.18);
      ctx.fillRect(x - 12, y - 8, 24, 16);
      ctx.shadowBlur = 0;
      ctx.fillStyle = shade(pu.color, 0.3);
      ctx.fillRect(x - 10, y - 6, 20, 12);
      ctx.fillStyle = '#0a061a';
      ctx.font = '10px "Press Start 2P", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(PU_LABEL[pu.type], x, y + 1);
      ctx.restore();
    }
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

  // ---- HUD ----
  updateHUD() {
    if (typeof document === 'undefined') return;
    const s = document.getElementById('breakout-score');
    if (s) s.textContent = this.displayedScore;
    const l = document.getElementById('breakout-level');
    if (l) l.textContent = this.levelNumber + 1;
  }

  renderLives() {
    if (!this.livesCtx || typeof document === 'undefined') return;
    const ctx = this.livesCtx;
    const cw = this.livesCanvas.width;
    const ch = this.livesCanvas.height;
    ctx.clearRect(0, 0, cw, ch);
    const iconW = 18, iconH = 6, gap = 6;
    const totalW = this.lives * iconW + (this.lives - 1) * gap;
    let x = (cw - totalW) / 2;
    for (let i = 0; i < this.lives; i++) {
      ctx.save();
      ctx.shadowColor = '#4d79ff';
      ctx.shadowBlur = 6;
      ctx.fillStyle = '#4d79ff';
      ctx.fillRect(x, (ch - iconH) / 2, iconW, iconH);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#aac4ff';
      ctx.fillRect(x + 2, (ch - iconH) / 2 + 1, iconW - 4, iconH - 2);
      ctx.restore();
      x += iconW + gap;
    }
  }
}

export function getBreakoutHighScore() {
  return Number(localStorage.getItem(HS_KEY) || 0);
}

export const BREAKOUT_HS_KEY = HS_KEY;

// Self-check: paddle angle clamp, sub-step count, level wrap, score ordering,
// speed cap. Run with:
//   node --input-type=module -e "import('./src/game/breakout.js').then(m=>m._selfCheck())"
export function _selfCheck() {
  // The paddle must have a numeric y — drawPaddle/collidePaddle read p.y;
  // a missing y draws nothing and the ball falls straight through.
  const b0 = new Breakout({});
  if (typeof b0.paddle.y !== 'number' || Number.isNaN(b0.paddle.y)) {
    throw new Error('paddle.y missing/NaN — paddle would be invisible');
  }

  // Every layout is 13 cols (trailing rows may be shorter — fine).
  for (const lvl of LEVELS) {
    for (const row of lvl) {
      if (row.length > COLS) throw new Error(`row too wide: ${row}`);
      for (const ch of row) if (!'.123X'.includes(ch)) throw new Error(`bad char ${ch}`);
    }
  }
  if (LEVELS.length !== 10) throw new Error('want 10 levels');

  // Level 4 (fortress) must have a door — a fully sealed steel perimeter is
  // unwinnable because the ball can never reach the interior bricks.
  if (!LEVELS[3][6].includes('.')) throw new Error('fortress bottom wall has no door');

  // Explosive bricks exist and parse to the right type.
  const be = new Breakout({});
  be.loadLevel(8);
  if (!be.bricks.some((x) => x.type === 'explosive')) {
    throw new Error('level 9 should contain explosive bricks');
  }

  // Paddle bounce: offset ±1 → angle in [30°,150°] → ≥30° from horizontal.
  const b = new Breakout({});
  // Simulate edge hit by computing the angle the collidePaddle math produces.
  for (const offset of [-1, -0.5, 0, 0.5, 1]) {
    const deg = 90 - offset * 60;
    if (deg < 30 || deg > 150) throw new Error(`angle ${deg} out of [30,150]`);
    const fromHoriz = Math.min(180 - deg, deg);
    if (fromHoriz < 20) throw new Error(`angle ${deg} too shallow (${fromHoriz}° from horizontal)`);
  }

  // Sub-steps: at the max cap speed (3.5×) on a 32ms (capped) frame, travel
  // exceeds half a brick's height → the ball is sub-stepped, not tunnelled.
  const fast = BASE_SPEED * 3.5;
  const travel = fast * 0.032;
  const steps = Math.max(1, Math.ceil(travel / (BRICK_H / 2)));
  if (steps < 2) throw new Error(`sub-steps ${steps} too few for fast ball`);

  // Level wrap: index 10 → layout 0.
  if (LEVELS[10 % LEVELS.length] !== LEVELS[0]) throw new Error('level wrap wrong');

  // Speed cap: rises per loop, bounded at 3.5× base (slow off). At level 50
  // the raw product far exceeds the cap, so currentSpeed must equal the cap.
  b.levelNumber = 50; b.paddleHits = 1000; b.slowTimer = 0;
  const loop = Math.floor(b.levelNumber / LEVELS.length);
  const expectedCap = BASE_SPEED * Math.min(3.5, 2 + 0.2 * loop);
  if (b.currentSpeed() > expectedCap + 0.001) throw new Error('speed cap violated');
  if (Math.abs(b.currentSpeed() - expectedCap) > 0.001) throw new Error('speed not at cap');
  // Slow multiplier eases back over the last 0.5s; at 5s left it's full 0.7×.
  b.slowTimer = 5;
  if (Math.abs(b.currentSpeed() - expectedCap * 0.7) > 0.01) throw new Error('slow mult wrong');
  b.slowTimer = 0;

  // Score ordering: top row (row 0) worth more than bottom row (row 7).
  const top = b.bricks.find((x) => x.row === 0 && x.type === 'normal');
  const bot = b.bricks.find((x) => x.row === 7 && x.type === 'normal');
  if (top && bot) {
    const topPts = 50 * (8 - top.row);
    const botPts = 50 * (8 - bot.row);
    if (topPts <= botPts) throw new Error('top row should score more');
  }

  // Power-up weights sum, ONEUP rare-ish.
  const wsum = Object.values(PU_WEIGHTS).reduce((a, c) => a + c, 0);
  const oneupPct = PU_WEIGHTS.ONEUP / wsum;
  if (oneupPct < 0.1 || oneupPct > 0.2) throw new Error(`1UP weight ${oneupPct} off`);
  // Overall 1UP drop ≈ drop chance × weight fraction.
  const overall = PU_DROP_CHANCE * oneupPct;
  if (overall > 0.025) throw new Error(`1UP overall ${overall} too high`);

  console.log('breakout self-check ok');
}