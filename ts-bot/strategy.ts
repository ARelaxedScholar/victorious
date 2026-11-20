// Victris Arena — TypeScript Bot ("Tactician")
// Standalone, zero-import, strippable TypeScript strategy.
// Compatible with the Victris Match Runner, local simulator, and ladder bot.ts.
//
// Playstyle: Disciplined spacing, BFS pillar navigation, pickup timing (Power/Health),
// multi-tick danger scoring, predictive ranged shots, Frostburst traps, and Repulsor
// wall-slam / zone-shove opportunism.

type Dir = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";
type Pos = [number, number];

export interface Observation {
  tick: number;
  self: {
    id?: number;
    pos: Pos;
    hp: number;
    max_hp: number;
    state: string;
    state_ticks_left?: number;
    slow_ticks_left?: number;
    buffs?: Record<string, number>;
    cooldowns: Record<string, number>;
  };
  enemies: {
    id?: number;
    pos: Pos;
    hp?: number;
    state?: string;
    dash_cooldown: number;
    slow_ticks_left: number;
    buffs?: Record<string, number>;
  }[];
  projectiles?: { pos: Pos; vel?: Pos; owner?: number }[];
  moves: { dir: Dir; tile: Pos }[];
  dashes: { dir: Dir; tile: Pos; distance?: number }[];
  danger: { tile: Pos; tick: number }[];
  pickups: { id?: number; pos: Pos; kind: string; ready_in: number }[];
  zone: {
    center: Pos;
    radius: number;
    next_radius: number | null;
    shrinks_in: number | null;
  };
}

export interface Rules {
  stats?: { move_cooldown?: number; sight_radius?: number };
  attacks?: {
    ranged?: { damage?: number; speed?: number; cooldown?: number; bounces?: number };
    frostburst?: { damage?: number; range?: number; cooldown?: number; fuse?: number; radius?: number };
    repulsor?: { damage?: number; range?: number; cooldown?: number; push?: number };
  };
  pickups?: {
    health?: { amount?: number };
    power?: { duration?: number };
  };
}

export interface Match {
  id?: string;
  match_id?: string;
  rules?: Rules;
  map?: string[];
}

export interface Turn {
  move?: Dir;
  dash?: Dir;
  attack?: { name: string; target?: Pos };
}

interface Memory {
  matchKey: string;
  lastEnemyPos: Pos | null;
  lastEnemyTick: number;
  enemyVel: Pos;
  walls: Set<string>;
  width: number;
  height: number;
}

const mem: Memory = {
  matchKey: "",
  lastEnemyPos: null,
  lastEnemyTick: -999,
  enemyVel: [0, 0],
  walls: new Set<string>(),
  width: 21,
  height: 21,
};

const DIRS: { dir: Dir; dx: number; dy: number }[] = [
  { dir: "N", dx: 0, dy: -1 },
  { dir: "NE", dx: 1, dy: -1 },
  { dir: "E", dx: 1, dy: 0 },
  { dir: "SE", dx: 1, dy: 1 },
  { dir: "S", dx: 0, dy: 1 },
  { dir: "SW", dx: -1, dy: 1 },
  { dir: "W", dx: -1, dy: 0 },
  { dir: "NW", dx: -1, dy: -1 },
];

const keyOf = (x: number, y: number): string => `${x},${y}`;
const cheb = (a: Pos, b: Pos): number => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
const euclidSq = (a: Pos, b: Pos): number => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
const same = (a: Pos, b: Pos): boolean => a[0] === b[0] && a[1] === b[1];
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

function initMatch(match: Match): void {
  const key = match.id ?? match.match_id ?? "default";
  if (mem.matchKey === key) return;
  mem.matchKey = key;
  mem.lastEnemyPos = null;
  mem.lastEnemyTick = -999;
  mem.enemyVel = [0, 0];
  mem.walls.clear();
  if (match.map && match.map.length > 0) {
    mem.height = match.map.length;
    mem.width = match.map[0]!.length;
    for (let y = 0; y < mem.height; y++) {
      const row = match.map[y]!;
      for (let x = 0; x < mem.width; x++) {
        if (row[x] === "#") mem.walls.add(keyOf(x, y));
      }
    }
  } else {
    mem.width = 21;
    mem.height = 21;
  }
}

function isWall(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= mem.width || y >= mem.height) return true;
  return mem.walls.has(keyOf(x, y));
}

function effectiveRadius(obs: Observation): number {
  if (obs.zone.shrinks_in !== null && obs.zone.next_radius !== null && obs.zone.shrinks_in <= 14) {
    return obs.zone.next_radius;
  }
  return obs.zone.radius;
}

function inSafeZone(obs: Observation, p: Pos): boolean {
  return cheb(p, obs.zone.center) <= effectiveRadius(obs);
}

function dangerAt(obs: Observation, p: Pos, minDt: number, maxDt: number): number {
  let hits = 0;
  for (const d of obs.danger) {
    const dt = d.tick - obs.tick;
    if (dt >= minDt && dt <= maxDt && same(d.tile, p)) hits++;
  }
  return hits;
}

function hasLineOfSight(a: Pos, b: Pos): boolean {
  if (mem.walls.size === 0) return true;
  const steps = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) * 2;
  if (steps === 0) return true;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = Math.round(a[0] + (b[0] - a[0]) * t);
    const y = Math.round(a[1] + (b[1] - a[1]) * t);
    if ((x !== a[0] || y !== a[1]) && (x !== b[0] || y !== b[1]) && isWall(x, y)) {
      return false;
    }
  }
  return true;
}

/** BFS distance map from `goal` for pillar-aware navigation. */
function bfsNextStep(obs: Observation, goal: Pos): Dir | null {
  if (obs.moves.length === 0) return null;
  if (mem.walls.size === 0) return greedyStep(obs, goal);

  const distMap = new Map<string, number>();
  const queue: Pos[] = [goal];
  distMap.set(keyOf(goal[0], goal[1]), 0);

  let head = 0;
  while (head < queue.length) {
    const [cx, cy] = queue[head++]!;
    const cd = distMap.get(keyOf(cx, cy))!;
    if (cd > 28) break;
    for (const d of DIRS) {
      const nx = cx + d.dx;
      const ny = cy + d.dy;
      if (isWall(nx, ny)) continue;
      // Prevent diagonal corner cutting around walls
      if (d.dx !== 0 && d.dy !== 0 && (isWall(cx + d.dx, cy) || isWall(cx, cy + d.dy))) continue;
      const nk = keyOf(nx, ny);
      if (!distMap.has(nk)) {
        distMap.set(nk, cd + 1);
        queue.push([nx, ny]);
      }
    }
  }

  let bestDir: Dir | null = null;
  let bestScore = Infinity;
  for (const m of obs.moves) {
    const d = distMap.get(keyOf(m.tile[0], m.tile[1]));
    const base = d !== undefined ? d * 1000 : cheb(m.tile, goal) * 1000 + 50000;
    const dangerPenalty = dangerAt(obs, m.tile, 0, 2) * 20000;
    const zonePenalty = inSafeZone(obs, m.tile) ? 0 : 15000;
    const score = base + euclidSq(m.tile, goal) + dangerPenalty + zonePenalty;
    if (score < bestScore) {
      bestScore = score;
      bestDir = m.dir;
    }
  }
  return bestDir;
}

function greedyStep(obs: Observation, goal: Pos): Dir | null {
  let bestDir: Dir | null = null;
  let bestScore = Infinity;
  for (const m of obs.moves) {
    const score =
      cheb(m.tile, goal) * 1000 +
      euclidSq(m.tile, goal) +
      dangerAt(obs, m.tile, 0, 2) * 20000 +
      (inSafeZone(obs, m.tile) ? 0 : 15000);
    if (score < bestScore) {
      bestScore = score;
      bestDir = m.dir;
    }
  }
  return bestDir;
}

/** Check if repulsing enemy from `from` slams them into a wall or outside the safe zone. */
function evaluateRepulsorValue(obs: Observation, from: Pos, enemyPos: Pos, pushDist: number): number {
  if (cheb(from, enemyPos) !== 1) return 0;
  const dx = Math.sign(enemyPos[0] - from[0]);
  const dy = Math.sign(enemyPos[1] - from[1]);
  let cx = enemyPos[0];
  let cy = enemyPos[1];
  let slammed = false;
  for (let i = 0; i < pushDist; i++) {
    const nx = cx + dx;
    const ny = cy + dy;
    if (isWall(nx, ny)) {
      slammed = true;
      break;
    }
    cx = nx;
    cy = ny;
  }
  let value = 10; // Base repulsor value
  if (slammed) value += 40; // +10 dmg + 3-tick stun
  if (!inSafeZone(obs, [cx, cy])) value += 30; // Shoved out of zone
  return value;
}

function choosePickup(obs: Observation, match: Match): Pos | null {
  const me = obs.self;
  const enemy = obs.enemies[0];
  const healAmt = match.rules?.pickups?.health?.amount ?? 32;
  const needHealth = me.hp <= me.max_hp - healAmt * 0.45;
  const enemyHurt = enemy && enemy.hp !== undefined && enemy.hp < me.max_hp * 0.7;

  let best: { pos: Pos; score: number } | null = null;
  for (const p of obs.pickups) {
    if (!inSafeZone(obs, p.pos)) continue;
    const myDist = cheb(me.pos, p.pos);
    // Allow approaching pickups shortly before they spawn
    if (p.ready_in > myDist * 2 + 4) continue;

    if (p.kind === "health" && !needHealth && !enemyHurt) continue;

    const enemyDist = enemy ? cheb(enemy.pos, p.pos) : 99;
    if (enemy && enemyDist + 1 < myDist) continue;

    let score = p.kind === "power" ? 120 : needHealth ? 105 : 65;
    score -= myDist * 10 + p.ready_in * 1.5;
    if (me.hp < me.max_hp * 0.5 && p.kind === "health") score += 40;

    const maxRange = p.kind === "power" ? 9 : enemy ? 5 : 9;
    if (myDist <= maxRange && (!best || score > best.score)) {
      best = { pos: p.pos, score };
    }
  }
  return best ? best.pos : null;
}

function chooseSearchGoal(obs: Observation): Pos {
  // Briefly pursue last seen enemy position if it is inside the safe zone
  if (mem.lastEnemyPos && obs.tick - mem.lastEnemyTick <= 18 && inSafeZone(obs, mem.lastEnemyPos)) {
    return mem.lastEnemyPos;
  }
  // Patrol around the zone center / power pickup corridor
  const r = Math.min(3, Math.max(1, Math.floor(effectiveRadius(obs) / 2)));
  const [cx, cy] = obs.zone.center;
  const waypoints: Pos[] = [
    [cx, cy - r],
    [cx + r, cy],
    [cx, cy + r],
    [cx - r, cy],
  ];
  return waypoints[Math.floor(obs.tick / 24) % waypoints.length]!;
}

function chooseMovement(obs: Observation, match: Match): Turn {
  const me = obs.self;
  const enemy = obs.enemies[0];
  const pushDist = match.rules?.attacks?.repulsor?.push ?? 3;
  const repulsorReady = (me.cooldowns.repulsor ?? 99) === 0;
  const hasPower = (me.buffs?.power ?? 0) > 0;
  const enemyHasPower = (enemy?.buffs?.power ?? 0) > 0;

  // Desired kiting range: closer when powered up, farther when enemy is powered up
  const preferredRange = hasPower ? 3 : enemyHasPower ? 6 : 5;

  const immediateDanger = dangerAt(obs, me.pos, 0, 2) > 0;
  const outOfZone = !inSafeZone(obs, me.pos);

  // 1. Emergency dodge or tactical positioning score across all moves + dashes + stay
  if (immediateDanger || outOfZone || enemy) {
    type Candidate = { turn: Turn; tile: Pos; isDash: boolean };
    const candidates: Candidate[] = [{ turn: {}, tile: me.pos, isDash: false }];
    for (const m of obs.moves) candidates.push({ turn: { move: m.dir }, tile: m.tile, isDash: false });
    for (const d of obs.dashes) candidates.push({ turn: { dash: d.dir }, tile: d.tile, isDash: true });

    const pickupGoal = choosePickup(obs, match);
    let best: { turn: Turn; score: number } | null = null;

    for (const c of candidates) {
      let score = 0;

      // Danger avoidance (dash is invulnerable on tick 0, vulnerable on ticks 1+)
      const hitNow = c.isDash ? 0 : dangerAt(obs, c.tile, 0, 0);
      const hitSoon = dangerAt(obs, c.tile, 1, 2);
      const hitLater = dangerAt(obs, c.tile, 3, 4);
      score -= hitNow * 500 + hitSoon * 260 + hitLater * 60;

      // Safe zone priority
      const distCenter = cheb(c.tile, obs.zone.center);
      const safeR = effectiveRadius(obs);
      if (distCenter > safeR) {
        score -= 320 + (distCenter - safeR) * 45;
      } else {
        // Mild preference for central map control
        score -= distCenter * 1.5;
      }

      // Preserve dash unless dodging lethal/imminent danger or landing a high-value wall slam
      if (c.isDash) {
        score -= immediateDanger ? 18 : 115;
      }

      // Pickup pull
      if (pickupGoal) {
        score -= cheb(c.tile, pickupGoal) * 18;
        if (same(c.tile, pickupGoal)) score += 65;
      }

      // Combat spacing & opportunism
      if (enemy) {
        const dEnemy = cheb(c.tile, enemy.pos);
        score -= Math.abs(dEnemy - preferredRange) * 14;

        // Avoid stepping into enemy repulsor range unless our own repulsor is ready for a wall-slam
        if (dEnemy === 1) {
          const slamVal = repulsorReady ? evaluateRepulsorValue(obs, c.tile, enemy.pos, pushDist) : 0;
          if (slamVal >= 40) {
            score += 95;
          } else {
            score -= 35;
          }
        }

        // Prefer tiles with clear line of sight when ranged is ready
        if ((me.cooldowns.ranged ?? 0) <= 1 && hasLineOfSight(c.tile, enemy.pos)) {
          score += 12;
        }
      }

      if (!best || score > best.score) {
        best = { turn: c.turn, score };
      }
    }

    // If enemy is visible or we're in danger/out-of-zone, use the tactical scorer directly
    if (best && (immediateDanger || outOfZone || enemy)) {
      // When far from a pickup or out of zone behind walls, let BFS route cleanly if safe
      if (!immediateDanger && outOfZone && !enemy) {
        const bfsDir = bfsNextStep(obs, obs.zone.center);
        if (bfsDir) return { move: bfsDir };
      }
      return best.turn;
    }
  }

  // 2. Out-of-combat navigation: grab pickups or search using BFS
  const pickupGoal = choosePickup(obs, match);
  if (pickupGoal) {
    const dir = bfsNextStep(obs, pickupGoal);
    if (dir) return { move: dir };
  }

  const searchDir = bfsNextStep(obs, chooseSearchGoal(obs));
  return searchDir ? { move: searchDir } : {};
}

function endTile(obs: Observation, turn: Turn): Pos {
  if (turn.move) {
    const found = obs.moves.find((m) => m.dir === turn.move);
    if (found) return found.tile;
  }
  if (turn.dash) {
    const found = obs.dashes.find((d) => d.dir === turn.dash);
    if (found) return found.tile;
  }
  return obs.self.pos;
}

function chooseAttack(obs: Observation, match: Match, from: Pos): Turn["attack"] {
  const enemy = obs.enemies[0];
  if (!enemy) return undefined;

  const ready = (name: string): boolean => (obs.self.cooldowns[name] ?? 99) === 0;
  const dist = cheb(from, enemy.pos);

  // 1. Repulsor at melee range (especially strong near walls or zone edge)
  if (dist === 1 && ready("repulsor")) {
    return { name: "repulsor" };
  }

  // 2. Frostburst when enemy can't easily dash out, or is stunned/slowed
  const frostRange = match.rules?.attacks?.frostburst?.range ?? 7;
  const enemyImmobile = enemy.state === "stunned" || enemy.dash_cooldown > 2 || enemy.slow_ticks_left > 0;
  if (ready("frostburst") && dist <= frostRange && hasLineOfSight(from, enemy.pos) && enemyImmobile) {
    const leadX = clamp(Math.round(enemy.pos[0] + mem.enemyVel[0] * 1.5), 0, mem.width - 1);
    const leadY = clamp(Math.round(enemy.pos[1] + mem.enemyVel[1] * 1.5), 0, mem.height - 1);
    const target: Pos = !isWall(leadX, leadY) && cheb(from, [leadX, leadY]) <= frostRange ? [leadX, leadY] : enemy.pos;
    return { name: "frostburst", target };
  }

  // 3. Ranged projectile with velocity lead prediction (only when LOS is clear)
  if (ready("ranged") && hasLineOfSight(from, enemy.pos)) {
    const projSpeed = match.rules?.attacks?.ranged?.speed ?? 2;
    const travelTicks = Math.min(4, dist / Math.max(1, projSpeed));
    const predX = clamp(Math.round(enemy.pos[0] + mem.enemyVel[0] * travelTicks * 0.7), 0, mem.width - 1);
    const predY = clamp(Math.round(enemy.pos[1] + mem.enemyVel[1] * travelTicks * 0.7), 0, mem.height - 1);
    const target: Pos = !isWall(predX, predY) && hasLineOfSight(from, [predX, predY]) ? [predX, predY] : enemy.pos;
    return { name: "ranged", target };
  }

  return undefined;
}

export function decide(obs: Observation, match: Match = {}): Turn {
  initMatch(match);

  // Update enemy tracking memory
  const enemy = obs.enemies[0];
  if (enemy) {
    if (mem.lastEnemyPos && obs.tick > mem.lastEnemyTick && obs.tick - mem.lastEnemyTick <= 4) {
      const dt = obs.tick - mem.lastEnemyTick;
      mem.enemyVel = [
        clamp((enemy.pos[0] - mem.lastEnemyPos[0]) / dt, -1, 1),
        clamp((enemy.pos[1] - mem.lastEnemyPos[1]) / dt, -1, 1),
      ];
    } else {
      mem.enemyVel = [0, 0];
    }
    mem.lastEnemyPos = [enemy.pos[0], enemy.pos[1]];
    mem.lastEnemyTick = obs.tick;
  }

  if (obs.self.state !== "idle") return {};

  const turn = chooseMovement(obs, match);
  const fire = chooseAttack(obs, match, endTile(obs, turn));
  return fire ? { ...turn, attack: fire } : turn;
}
