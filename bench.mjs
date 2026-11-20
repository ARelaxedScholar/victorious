#!/usr/bin/env node
// Victorious Headless RSI / Self-Play Benchmark CLI.
// Run fast deterministic matchups between .ts bots, .py bots, and built-in panel opponents
// with rich per-map, per-weapon, and diagnostic stats for human or AI agent iteration.
//
// Examples:
//   node bench.mjs ts-bot/strategy.ts --panel --games 12
//   node bench.mjs ts-bot/strategy.ts --mirror --games 10
//   node bench.mjs ts-bot/strategy.ts py-bot/strategy.py --games 10 --json
//   node bench.mjs my-v2.ts my-v1.ts --games 20 --seed 100

import { readFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Game } from './arena-sim.mjs';
import { panel } from './practice.mjs';

const PY_BRIDGE = `
import json, sys, types
sys.modules["websockets"] = types.ModuleType("websockets")
path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    src = f.read()
scope = {"__name__": "victris_submission"}
exec(compile(src, path, "exec"), scope)
decide = scope.get("decide")
if not callable(decide):
    raise SystemExit("Python bot must define decide(obs, match)")
print(json.dumps({"ready": True}), flush=True)
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    msg = json.loads(line)
    if msg.get("cmd") == "quit":
        break
    try:
        turn = decide(msg["obs"], msg["match"])
        if not isinstance(turn, dict):
            raise ValueError("decide() must return a dict")
        print(json.dumps({"turn": turn}, allow_nan=False), flush=True)
    except Exception as e:
        print(json.dumps({"error": str(e)}), flush=True)
`;

function usage() {
  console.log(`Victorious Headless Benchmark & RSI Lab

Usage:
  node bench.mjs <botA.ts|py> <botB.ts|py|random|pursuit|starter> [options]
  node bench.mjs <botA.ts|py> --mirror [options]
  node bench.mjs <botA.ts|py> --panel [options]

Options:
  --games <N>     Number of games per matchup (default: 10, swaps seats each game)
  --seed <N>      Starting seed (default: 0)
  --mirror        Pit botA against a fresh copy of itself
  --panel         Pit botA against all 3 built-in opponents (random, pursuit, starter)
  --json          Output structured JSON report for AI agents / RSI scripts
  --help          Show this help
`);
}

function parseArgs(argv) {
  const opts = { bots: [], games: 10, seed: 0, mirror: false, panel: false, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--mirror') opts.mirror = true;
    else if (a === '--panel') opts.panel = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--games') opts.games = Math.max(1, Number(argv[++i] ?? 10));
    else if (a === '--seed') opts.seed = Number(argv[++i] ?? 0);
    else if (!a.startsWith('-')) opts.bots.push(a);
    else throw new Error(`Unknown flag: ${a}`);
  }
  return opts;
}

async function loadBotFactory(spec) {
  const builtin = panel.find((p) => p.key === spec);
  if (builtin) {
    return {
      name: builtin.name,
      kind: 'builtin',
      async create(hello) {
        const fn = builtin.start(hello);
        return { turn: async (obs) => fn(obs), close: () => {} };
      },
    };
  }
  const fullPath = resolve(spec);
  const name = spec.replace(/^\.\//, '');
  if (/\.py$/i.test(fullPath)) {
    return {
      name,
      kind: 'python',
      async create() {
        const proc = spawn('python3', ['-u', '-c', PY_BRIDGE, fullPath], {
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        let stderr = '';
        proc.stderr.on('data', (d) => { stderr += d.toString(); });
        const rl = createInterface({ input: proc.stdout });
        const nextLine = () => new Promise((res, rej) => {
          const onLine = (line) => { cleanup(); res(line); };
          const onClose = () => { cleanup(); rej(new Error(`Python bot exited: ${stderr.slice(0, 300)}`)); };
          const cleanup = () => { rl.off('line', onLine); proc.off('close', onClose); };
          rl.once('line', onLine);
          proc.once('close', onClose);
        });
        const init = JSON.parse(await nextLine());
        if (!init.ready) throw new Error('Python bot failed to start');
        return {
          async turn(obs, match) {
            proc.stdin.write(JSON.stringify({ obs, match }) + '\n');
            const reply = JSON.parse(await nextLine());
            if (reply.error) throw new Error(reply.error);
            return reply.turn;
          },
          close() {
            try { proc.stdin.write('{"cmd":"quit"}\n'); } catch {}
            try { rl.close(); } catch {}
            try { proc.kill(); } catch {}
          },
        };
      },
    };
  }
  if (/\.ts$/i.test(fullPath)) {
    const raw = readFileSync(fullPath, 'utf8');
    const stripped = stripTypeScriptTypes(raw, { mode: 'strip' });
    const dataUrl = 'data:text/javascript;base64,' + Buffer.from(stripped).toString('base64');
    return {
      name,
      kind: 'typescript',
      async create() {
        // Cache-bust query isn't supported on data URLs, so embed a tiny comment nonce to get a fresh module instance per game!
        const freshUrl = 'data:text/javascript;base64,' + Buffer.from(`${stripped}\n// nonce:${Math.random()}`).toString('base64');
        const mod = await import(freshUrl);
        if (typeof mod.decide !== 'function') throw new Error(`${spec} must export decide(obs, match)`);
        return {
          turn: async (obs, match) => mod.decide(obs, match) ?? {},
          close: () => {},
        };
      },
    };
  }
  throw new Error(`Unsupported bot spec "${spec}". Use a .ts/.py file or one of: random, pursuit, starter.`);
}

async function runSingleGame(factoryA, factoryB, seed, swapSeats) {
  const game = new Game({ seed });
  const seats = swapSeats ? [factoryB, factoryA] : [factoryA, factoryB];
  const hellos = [1, 2].map((id) => game.hello(id));
  const matches = hellos.map((h) => ({ ...h, id: h.match_id }));
  const runners = [];
  let error = null;

  try {
    runners.push(await seats[0].create(hellos[0]));
    runners.push(await seats[1].create(hellos[1]));
    while (!game.over) {
      const obs1 = game.next(1);
      const obs2 = game.next(2);
      const t1 = await runners[0].turn(obs1, matches[0]);
      const t2 = await runners[1].turn(obs2, matches[1]);
      game.step({ 1: t1, 2: t2 });
    }
  } catch (err) {
    error = err.message;
  } finally {
    for (const r of runners) r.close();
  }

  if (error) {
    return { seed, map: hellos[0].map_name, swapSeats, error };
  }

  const summary = game.summary();
  const s = summary.stats;
  const idxA = swapSeats ? 1 : 0;
  const idxB = swapSeats ? 0 : 1;
  const fa = s.fighters[idxA];
  const fb = s.fighters[idxB];
  const winnerSeat = summary.result.winner; // 1 | 2 | null
  const outcome = winnerSeat === null
    ? 'draw'
    : (winnerSeat === idxA + 1 ? 'win' : 'loss');

  return {
    seed,
    map: s.map,
    seatA: idxA + 1,
    ticks: s.ticks,
    reason: s.reason,
    outcome,
    a: fa,
    b: fb,
  };
}

function summarize(nameA, nameB, results) {
  let wins = 0, losses = 0, draws = 0, errors = 0;
  let seat1Wins = 0, seat1Games = 0, seat2Wins = 0, seat2Games = 0;
  let totalTicks = 0;
  let dmgDealt = 0, dmgTaken = 0;
  let rangedUses = 0, rangedHits = 0;
  let frostUses = 0, frostHits = 0;
  let repulsorUses = 0, repulsorHits = 0;
  let wallSlamsDealt = 0, wallSlamsTaken = 0;
  let healthPickups = 0, powerPickups = 0, healed = 0, zoneTicks = 0;
  const rejected = {};
  const takenBySource = {};
  const byMap = {};
  const worstLosses = [];

  for (const r of results) {
    if (r.error) { errors++; continue; }
    if (r.outcome === 'win') wins++;
    else if (r.outcome === 'loss') losses++;
    else draws++;

    if (r.seatA === 1) { seat1Games++; if (r.outcome === 'win') seat1Wins++; }
    else { seat2Games++; if (r.outcome === 'win') seat2Wins++; }

    const bm = (byMap[r.map] ??= { wins: 0, losses: 0, draws: 0 });
    bm[r.outcome === 'win' ? 'wins' : r.outcome === 'loss' ? 'losses' : 'draws']++;

    totalTicks += r.ticks;
    const a = r.a;
    const b = r.b;
    dmgDealt += a.damage_dealt ?? 0;
    dmgTaken += a.damage_taken ?? 0;
    rangedUses += a.weapons?.ranged?.uses ?? 0;
    rangedHits += a.weapons?.ranged?.hits ?? 0;
    frostUses += a.weapons?.frostburst?.uses ?? 0;
    frostHits += a.weapons?.frostburst?.hits ?? 0;
    repulsorUses += a.weapons?.repulsor?.uses ?? 0;
    repulsorHits += a.weapons?.repulsor?.hits ?? 0;
    wallSlamsDealt += a.wall_slams ?? 0;
    wallSlamsTaken += b.wall_slams ?? 0;
    healthPickups += a.pickups?.health ?? 0;
    powerPickups += a.pickups?.power ?? 0;
    healed += a.healed ?? 0;
    zoneTicks += a.zone_ticks ?? 0;

    for (const [k, v] of Object.entries(a.rejected ?? {})) {
      rejected[k] = (rejected[k] ?? 0) + v;
    }
    for (const [k, v] of Object.entries(a.taken_by_source ?? {})) {
      takenBySource[k] = (takenBySource[k] ?? 0) + v;
    }
    if (r.outcome === 'loss') {
      worstLosses.push({
        seed: r.seed,
        map: r.map,
        seat: r.seatA,
        ticks: r.ticks,
        hpDiff: (a.hp ?? 0) - (b.hp ?? 0),
        dmgDealt: a.damage_dealt ?? 0,
        dmgTaken: a.damage_taken ?? 0,
        oppHpLeft: b.hp ?? 0,
      });
    }
  }

  const played = wins + losses + draws;
  const avg = (n) => (played ? Number((n / played).toFixed(1)) : 0);
  const pct = (num, den) => (den ? Number(((num / den) * 100).toFixed(1)) : 0);
  worstLosses.sort((x, y) => x.hpDiff - y.hpDiff);

  return {
    botA: nameA,
    botB: nameB,
    games: played,
    errors,
    record: { wins, losses, draws, winRatePct: pct(wins, played) },
    bySeat: {
      seat1WinRatePct: pct(seat1Wins, seat1Games),
      seat2WinRatePct: pct(seat2Wins, seat2Games),
    },
    byMap,
    averages: {
      ticks: avg(totalTicks),
      damageDealt: avg(dmgDealt),
      damageTaken: avg(dmgTaken),
      healed: avg(healed),
      zoneTicks: avg(zoneTicks),
    },
    accuracy: {
      ranged: { hits: rangedHits, uses: rangedUses, pct: pct(rangedHits, rangedUses) },
      frostburst: { hits: frostHits, uses: frostUses, pct: pct(frostHits, frostUses) },
      repulsor: { hits: repulsorHits, uses: repulsorUses, pct: pct(repulsorHits, repulsorUses) },
    },
    tactics: {
      wallSlamsDealt,
      wallSlamsTaken,
      powerPickups,
      healthPickups,
      takenBySource,
      rejectedTurns: rejected,
    },
    worstLosses: worstLosses.slice(0, 5),
  };
}

function printHumanReport(rep) {
  const { record, averages, accuracy, tactics, byMap } = rep;
  console.log(`\n=== ${rep.botA} vs ${rep.botB} (${rep.games} games) ===`);
  console.log(`Record: ${record.wins}W - ${record.losses}L - ${record.draws}D (${record.winRatePct}% win rate) | Seat1: ${rep.bySeat.seat1WinRatePct}% | Seat2: ${rep.bySeat.seat2WinRatePct}%`);
  console.log(`Avg/game: ${averages.ticks} ticks | Dmg dealt ${averages.damageDealt} vs taken ${averages.damageTaken} | Healed ${averages.healed} | Zone ticks ${averages.zoneTicks}`);
  console.log(`Accuracy: Ranged ${accuracy.ranged.hits}/${accuracy.ranged.uses} (${accuracy.ranged.pct}%) | Frost ${accuracy.frostburst.hits}/${accuracy.frostburst.uses} (${accuracy.frostburst.pct}%) | Repulsor ${accuracy.repulsor.hits}/${accuracy.repulsor.uses}`);
  console.log(`Tactics:  Power ${tactics.powerPickups} | Health ${tactics.healthPickups} | Wall-slams ${tactics.wallSlamsDealt} dealt / ${tactics.wallSlamsTaken} taken`);
  const mapStr = Object.entries(byMap).map(([m, v]) => `${m}: ${v.wins}-${v.losses}-${v.draws}`).join(' | ');
  console.log(`By map:   ${mapStr}`);
  if (Object.keys(tactics.rejectedTurns).length) {
    console.log(`Rejected: ${JSON.stringify(tactics.rejectedTurns)}`);
  }
  if (rep.worstLosses.length) {
    console.log(`Worst losses (replay these seeds in UI): ${rep.worstLosses.map((l) => `seed ${l.seed} (${l.map}, opp ${l.oppHpLeft}hp left)`).join(', ')}`);
  }
}

async function runMatchup(factoryA, factoryB, games, startSeed) {
  const results = [];
  for (let i = 0; i < games; i++) {
    // Pair seeds with swapped seats: seed S as seat 1, then seed S as seat 2
    const seed = startSeed + Math.floor(i / 2);
    const swap = i % 2 === 1;
    results.push(await runSingleGame(factoryA, factoryB, seed, swap));
  }
  return summarize(factoryA.name, factoryB.name, results);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || opts.bots.length === 0) {
    usage();
    process.exit(opts.help ? 0 : 1);
  }
  const factoryA = await loadBotFactory(opts.bots[0]);
  const reports = [];

  if (opts.panel) {
    for (const p of panel) {
      const fb = await loadBotFactory(p.key);
      reports.push(await runMatchup(factoryA, fb, opts.games, opts.seed));
    }
  } else if (opts.mirror) {
    const factoryMirror = await loadBotFactory(opts.bots[0]);
    factoryMirror.name = factoryA.name + ' (mirror)';
    reports.push(await runMatchup(factoryA, factoryMirror, opts.games, opts.seed));
  } else if (opts.bots.length >= 2) {
    const factoryB = await loadBotFactory(opts.bots[1]);
    reports.push(await runMatchup(factoryA, factoryB, opts.games, opts.seed));
  } else {
    throw new Error('Provide a second bot, --mirror, or --panel.');
  }

  if (opts.json) {
    console.log(JSON.stringify(reports.length === 1 ? reports[0] : { bot: factoryA.name, matchups: reports }, null, 2));
  } else {
    for (const r of reports) printHumanReport(r);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
