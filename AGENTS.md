# Agent Guide — Victorious Bot Training & RSI Lab

This repository contains the local Victris Arena simulator (`arena-sim.mjs`), a live 3D/2.5D web visualizer (`server.mjs`), and a fast headless benchmark CLI (`bench.mjs`) designed for **recursive self-improvement (RSI)** and iterative bot training.

## Fast Training Loop

1. **Baseline against the built-in panel** (`random`, `pursuit`, `starter`):
   ```bash
   node bench.mjs my-bot.ts --panel --games 12 --json
   ```
2. **Self-play / version-vs-version evaluation** (keep your previous best copy as `prev-best.ts` and only promote a new candidate when it beats both the panel and `prev-best.ts` across swapped seats and all 3 maps):
   ```bash
   node bench.mjs my-bot.ts prev-best.ts --games 20 --seed 100 --json
   node bench.mjs my-bot.ts --mirror --games 10 --json
   ```
   Python bots (`.py`) are also supported natively via `python3`:
   ```bash
   node bench.mjs my-bot.py ts-bot/strategy.ts --games 12 --json
   ```
3. **Diagnose weaknesses from the JSON report:**
   * `byMap`: Check if your bot struggles on `columns-21` or `pillars-21` (usually means greedy movement instead of BFS pathfinding or poor wall-bounce / cover play).
   * `tactics.rejectedTurns`: Any non-zero entry (`not_visible`, `out_of_range`, `on_cooldown`) is a wasted tick you can eliminate immediately.
   * `tactics.takenBySource`: High `wall_slam` means you're fighting with your back to a wall; high `zone` means you're rotating late; high `frostburst` means you're wasting `dash` cooldown.
   * `tactics.powerPickups` & `healthPickups`: Power gives 1.5× damage for 50 ticks—contesting tick-20 and respawn waves swings close matchups.
   * `worstLosses`: Open `http://127.0.0.1:8787`, lock the reported seed, and watch the slow-motion replay to visually spot the failure mode.

## Submission Constraints

* Single standalone `.ts` (strippable types, zero imports, synchronous `export function decide(obs, match)`) or `.py` (standard library only, synchronous `def decide(obs, match) -> dict`) under 256 KiB.
* Per-tick deadline: 1,000 ms (aim for < 10 ms/tick); total match budget: 15 s (TS) / 25 s (Python).
* No network access, workers, or JS-bridge imports (`js`, `pyodide`, `fetch`, `Worker`) inside the tournament sandbox.
