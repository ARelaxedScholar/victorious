# Victorious

A local, zero-dependency **live 3D/2.5D visualizer and interactive tournament host** for [Victris Arena](https://victrisarena.com/). Drop in standalone TypeScript (`strategy.ts`) or Python (`bot.py`) bots, watch them fight live in your browser with instant replay scrubbing, or run a full multi-team workshop tournament—no `npm install` or Python setup required.

## Quick Start

1. Make sure **Node.js 22+** (or Node.js 24) is installed.
2. Start the local server:
   ```bash
   node server.mjs
   ```
   *(Optional: set `PORT=8788 node server.mjs` if port `8787` is busy.)*
3. Open **http://127.0.0.1:8787** in a Chromium-based browser.
4. Upload any combination of `.ts` and `.py` bot files (or use the included starters / sample bots in `ts-bot/` and `py-bot/`).

## Features

* **Live 3D Coliseum & 2.5D Characters:** Pure Canvas 2D renderer scaling cleanly up to native 4K/Retina in fullscreen—drag to orbit, scroll to zoom, toggle **3D Coliseum / 2.5D Flat**, **Auto-Cam**, **Sight Radius**, and **Danger Tiles**.
* **6 Selectable Characters:** Cyber Knight, Neon Fox, Frost Mage, Void Mech, Mecha Dragon, and Shadow Ninja with parabolic tile hops, targeting arcs, hit-stop, and floating combat popups.
* **Built-In Replays & Official Exports:** Scrub any completed match with timeline event markers, step tick-by-tick (`←` / `→`), view post-match accuracy/damage stats, or download verified `.jsonl.gz` replays for https://victrisarena.com/viewer/.
* **Interactive Tournament Mode:** Drag-and-drop multiple `.ts`/`.py` submissions and run **Single Elimination**, **Round Robin → Top-2 Bo3 Final**, or **Swiss (3 Rounds) → Top-2 Bo3 Final** with automatic forfeit handling if a bot crashes or times out.
* **Procedural Combat SFX + Custom BGM:** Synthesized Web Audio SFX out of the box. Drop any `.mp3`, `.wav`, `.ogg`, `.m4a`, or `.flac` files into a local `bgm/` folder (or point `BGM_DIR=/path/to/music`) to auto-shuffle background music during live matches.

## Practice opponents

In **Single 1v1 Match**, upload your strategy once. Choose **Mirror** to face a fresh instance of it, select an individual opponent, or choose **Beat the panel** to fight one game per opponent on the same seed. Each panel game stays in the game log for replay.

Random and TS Starter come from the bundled [official simulator](https://victrisarena.com/guide/simulator). Pursuit is a local opponent that closes distance and fires every fourth tick. The starter’s label gives the dated raw rating for the matching `house-ts-starter` version (`starter-17`) from the [public ladder API](https://victrisarena.com/api/leaderboard). In local simulator 0.85.0 tests on seeds 0–23 with both seat orders, TS Starter beat Pursuit and Random in all 48 games per pairing, and Pursuit beat Random in all 48.

## Agent Self-Training (RSI) Lab

Use `bench.mjs` to run fast headless benchmarks (works with both `.ts` and `.py` bots) and feed structured JSON diagnostics straight to a coding agent for iterative self-improvement (see [AGENTS.md](AGENTS.md)):

```bash
# Benchmark against the 3-bot panel (swapped seats across maps)
node bench.mjs ts-bot/strategy.ts --panel --games 12

# Pit a new version against an older version or another bot with JSON telemetry
node bench.mjs my-v2.ts my-v1.ts --games 20 --seed 100 --json

# Self-play mirror test (supports Python bots too!)
node bench.mjs py-bot/strategy.py --mirror --games 10 --json
```

Each JSON report includes win rates by seat & map (`arena-21`, `columns-21`, `pillars-21`), per-weapon accuracy, pickups, wall-slams, `takenBySource`, `rejectedTurns`, and `worstLosses` seeds you can replay live in the browser UI.

## Bot Submission Rules

* **TypeScript (`.ts`):** Standalone file under 256 KiB exporting a synchronous `decide(obs, match)` using type syntax Node can strip (no external imports).
* **Python (`.py`):** Standalone file under 256 KiB defining a synchronous `decide(obs, match)` returning a `dict` (Python standard library supported by Pyodide 0.27.7; keep any CLI/ladder code under `if __name__ == "__main__":`).

## Sandboxing & Credits

Each bot runs inside an isolated opaque-origin `<iframe sandbox="allow-scripts">` Web Worker with Content Security Policy restricting network access to local loopback assets. For prize competitions with untrusted submissions, run from a disposable browser profile or VM in a foreground tab.

Engine (`arena-sim.mjs`) and official starters (`strategy.ts`, `bot.py`) sourced from https://victrisarena.com/guide/simulator and https://victrisarena.com/download/bots. Python runs in the bundled Pyodide 0.27.7 runtime (license in `python/LICENSE`).
