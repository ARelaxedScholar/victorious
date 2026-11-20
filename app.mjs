import { panel } from './practice.mjs';
import { Game, HOUSE_BOTS, encodeReplay, verifyReplay } from './arena-sim.mjs';
import { captureFrame, createArenaViewer } from './viewer.mjs';
import { createAudioEngine } from './audio.mjs';
import {
  createTournament,
  defaultAvatar,
  deserializeTournament,
  getActiveRoundPendingMatches,
  getNextPendingMatch,
  getStandings,
  recordMatchResult,
  serializeTournament,
} from './tournament.mjs';

const get = (id) => document.getElementById(id);
const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const VALID_DIRS = new Set(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']);
const VALID_ATTACKS = new Set(['ranged', 'frostburst', 'repulsor']);

function sanitizeTurn(raw, teamName) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(teamName + ' must return a turn object.');
  }
  const clean = {};
  if (raw.move !== undefined) {
    if (typeof raw.move !== 'string' || !VALID_DIRS.has(raw.move)) {
      throw new Error(teamName + ' returned an invalid move direction.');
    }
    clean.move = raw.move;
  }
  if (raw.dash !== undefined) {
    if (typeof raw.dash !== 'string' || !VALID_DIRS.has(raw.dash)) {
      throw new Error(teamName + ' returned an invalid dash direction.');
    }
    clean.dash = raw.dash;
  }
  if (raw.attack !== undefined) {
    if (!raw.attack || typeof raw.attack !== 'object' || Array.isArray(raw.attack)) {
      throw new Error(teamName + ' returned an invalid attack object.');
    }
    if (typeof raw.attack.name !== 'string' || !VALID_ATTACKS.has(raw.attack.name)) {
      throw new Error(teamName + ' returned an unknown attack name.');
    }
    const atk = { name: raw.attack.name };
    if (raw.attack.target !== undefined) {
      if (
        !Array.isArray(raw.attack.target) ||
        raw.attack.target.length !== 2 ||
        !Number.isFinite(raw.attack.target[0]) ||
        !Number.isFinite(raw.attack.target[1]) ||
        Math.abs(raw.attack.target[0]) > 100 ||
        Math.abs(raw.attack.target[1]) > 100
      ) {
        throw new Error(teamName + ' returned an invalid attack target.');
      }
      atk.target = [Math.trunc(raw.attack.target[0]), Math.trunc(raw.attack.target[1])];
    }
    clean.attack = atk;
  }
  if (raw.shout !== undefined) {
    if (typeof raw.shout !== 'string') throw new Error(teamName + ' returned an invalid shout.');
    clean.shout = raw.shout.slice(0, 40);
  }
  return clean;
}
const form = get('match');
const status = get('status');
const games = get('games');
const speedSelect = get('speed');
const btnPause = get('btn-pause');
const btnSkip = get('btn-skip');
const btnPrev = get('btn-prev');
const btnNext = get('btn-next');
const scrubber = get('scrubber');
const markersEl = get('markers');
const statsBox = get('stats-box');
const modeInfo = get('mode-info');
const downloads = [];

const seedInput = get('seed');
const autoSeed = get('auto-seed');
const rollSeed = () => Math.floor(100000 + Math.random() * 900000);
seedInput.value = String(rollSeed());

get('btn-roll-seed')?.addEventListener('click', () => {
  seedInput.value = String(rollSeed());
});
seedInput.addEventListener('input', () => {
  if (autoSeed) autoSeed.checked = false;
});

function pickMatchSeed() {
  if (autoSeed?.checked) seedInput.value = String(rollSeed());
  return seedInput.valueAsNumber;
}

// Mode tabs (Tournament vs Single 1v1)
const tabTourney = get('tab-tournament');
const tabSingle = get('tab-single');
const paneTourney = get('pane-tournament');
const paneSingle = get('pane-single');

tabTourney?.addEventListener('click', () => {
  tabTourney.classList.add('active');
  tabSingle.classList.remove('active');
  paneTourney.classList.remove('hidden');
  paneSingle.classList.add('hidden');
});
tabSingle?.addEventListener('click', () => {
  tabSingle.classList.add('active');
  tabTourney.classList.remove('active');
  paneSingle.classList.remove('hidden');
  paneTourney.classList.add('hidden');
});

const audio = createAudioEngine();

const viewer = createArenaViewer(get('arena'), {
  p1Name: get('p1-name'),
  p2Name: get('p2-name'),
  p1HpText: get('p1-hp-text'),
  p2HpText: get('p2-hp-text'),
  p1HpBar: get('p1-hp-bar'),
  p2HpBar: get('p2-hp-bar'),
  p1HpTrail: get('p1-hp-trail'),
  p2HpTrail: get('p2-hp-trail'),
  p1Status: get('p1-status'),
  p2Status: get('p2-status'),
  metaInfo: get('meta-info'),
  tickInfo: get('tick-info'),
  feed: get('feed'),
}, {
  onEvent: (ev) => audio.playEvent(ev),
});

// Audio & Auto-Shuffling Trihorn BGM Controls
const btnSfx = get('btn-sfx');
const btnBgmNext = get('btn-bgm-next');
const btnBgmToggle = get('btn-bgm-toggle');
const bgmVol = get('bgm-vol');

audio.onTrackChange((track, playing) => {
  if (track && btnBgmNext) {
    btnBgmNext.textContent = `🎵 ${track.title.slice(0, 16)}`;
    btnBgmNext.classList.add('active');
  }
  if (btnBgmToggle) {
    btnBgmToggle.textContent = playing ? '⏸' : '▶';
    btnBgmToggle.classList.toggle('active', playing);
  }
});

btnSfx?.addEventListener('click', () => {
  const next = !audio.isSfxEnabled();
  audio.setSfxEnabled(next);
  if (next) audio.unlock();
  btnSfx.textContent = next ? '🔊 SFX' : '🔇 SFX';
  btnSfx.classList.toggle('active', next);
});
btnBgmNext?.addEventListener('click', () => {
  audio.unlock();
  audio.playRandomTrack();
});
btnBgmToggle?.addEventListener('click', () => {
  audio.unlock();
  audio.toggleBgm();
});
bgmVol?.addEventListener('input', () => audio.setBgmVolume(bgmVol.value));
window.addEventListener('pointerdown', () => audio.unlock(), { once: true });

// Interactive viewer toolbar
const CAM_PRESETS = [
  ['3d', '3D Coliseum'],
  ['dramatic', '🎬 Dramatic Low'],
  ['2.5d', '2.5D Flat'],
];
let camPresetIdx = 0;
let isAutoCam = false;
let isSight = false;
let isDanger = false;

get('btn-view')?.addEventListener('click', (e) => {
  camPresetIdx = (camPresetIdx + 1) % CAM_PRESETS.length;
  const [key, label] = CAM_PRESETS[camPresetIdx];
  viewer.setCameraPreset(key);
  e.currentTarget.textContent = label;
  e.currentTarget.classList.toggle('active', key !== '2.5d');
});
get('btn-autocam')?.addEventListener('click', (e) => {
  isAutoCam = !isAutoCam;
  viewer.setAutoCam(isAutoCam);
  e.currentTarget.classList.toggle('active', isAutoCam);
});
get('btn-sight')?.addEventListener('click', (e) => {
  isSight = !isSight;
  viewer.setShowSight(isSight);
  e.currentTarget.classList.toggle('active', isSight);
});
get('btn-danger')?.addEventListener('click', (e) => {
  isDanger = !isDanger;
  viewer.setShowDanger(isDanger);
  e.currentTarget.classList.toggle('active', isDanger);
});
get('btn-rot-l')?.addEventListener('click', () => viewer.rotateCamera(-Math.PI / 6));
get('btn-rot-r')?.addEventListener('click', () => viewer.rotateCamera(Math.PI / 6));
get('btn-reset-cam')?.addEventListener('click', () => viewer.resetCamera());
get('btn-fullscreen')?.addEventListener('click', () => {
  const stage = get('stage');
  if (!document.fullscreenElement) stage.requestFullscreen?.();
  else document.exitFullscreen?.();
});

// Live / Replay playback state
let busy = false;
let livePaused = false;
let liveSkip = false;
let replayTimer = null;
let activeReplay = null;
let replayIndex = 0;
let replayPlaying = false;
let clipEnd = null;

function stopReplayTimer() {
  if (replayTimer !== null) {
    clearTimeout(replayTimer);
    replayTimer = null;
  }
  replayPlaying = false;
  clipEnd = null;
}

function getTickDelayMs() {
  return Number(speedSelect.value);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitIfPaused() {
  while (livePaused && !liveSkip) {
    await sleep(50);
  }
}

function renderStats(record) {
  const fighters = record?.stats?.fighters;
  if (!fighters || fighters.length < 2) {
    statsBox.style.display = 'none';
    return;
  }
  const [a, b] = fighters;
  const pct = (w) => (w?.uses ? `${w.hits}/${w.uses} (${Math.round((w.hits / w.uses) * 100)}%)` : '0/0');
  const rows = [
    [a.damage_dealt ?? 0, 'Damage Dealt', b.damage_dealt ?? 0],
    [pct(a.weapons?.ranged), 'Ranged Accuracy', pct(b.weapons?.ranged)],
    [`${a.weapons?.frostburst?.hits ?? 0}/${a.weapons?.frostburst?.uses ?? 0}`, 'Frostburst Hits', `${b.weapons?.frostburst?.hits ?? 0}/${b.weapons?.frostburst?.uses ?? 0}`],
    [a.wall_slams ?? 0, 'Wall Slams', b.wall_slams ?? 0],
    [`${a.pickups?.power ?? 0}⚡ / ${a.pickups?.health ?? 0}✚`, 'Pickups', `${b.pickups?.power ?? 0}⚡ / ${b.pickups?.health ?? 0}✚`],
    [a.healed ?? 0, 'HP Healed', b.healed ?? 0],
  ];
  statsBox.innerHTML =
    `<div style="font-weight:700;margin-bottom:6px;display:flex;justify-content:space-between">` +
    `<span class="p1-text">${escHtml(record.meta.names[0])}</span>` +
    `<span style="color:#94a3b8;font-size:.75rem">Game ${record.gameNumber} Stats</span>` +
    `<span class="p2-text">${escHtml(record.meta.names[1])}</span></div>` +
    `<div class="stats-grid">` +
    rows.map(([l, lbl, r]) => `<span class="stats-val-l">${escHtml(l)}</span><span class="stats-lbl">${escHtml(lbl)}</span><span class="stats-val-r">${escHtml(r)}</span>`).join('') +
    `</div>`;
  statsBox.style.display = 'block';
}

function renderMarkers(frames) {
  if (!markersEl) return;
  const max = Math.max(1, frames.length - 1);
  const pips = [];
  frames.forEach((f, idx) => {
    for (const ev of f.events ?? []) {
      let col = null;
      if (ev.kind === 'wall_slam') col = '#facc15';
      else if (ev.kind === 'pickup' && ev.pickup === 'power') col = '#f59e0b';
      else if (ev.kind === 'hit' && ev.attack === 'frostburst') col = '#38bdf8';
      else if (ev.kind === 'zone_shrink') col = '#f87171';
      else if (ev.kind === 'death') col = '#ffffff';
      if (col) {
        pips.push(`<span class="marker-pip" style="left:${(idx / max) * 100}%;background:${col}"></span>`);
        break;
      }
    }
  });
  markersEl.innerHTML = pips.join('');
}

function renderMoments(record) {
  const strip = get('moments');
  strip.replaceChildren();
  const picks = [];
  function offer(idx, label, detail, rank) {
    picks.push({ idx, label, detail, rank });
  }
  record.frames.forEach((frame, idx) => {
    for (const ev of frame.events ?? []) {
      const actor = record.meta.names[(ev.attacker ?? ev.fighter) - 1];
      if (ev.kind === 'wall_slam') offer(idx, 'Wall slam', actor, 4);
      if (ev.kind === 'pickup') offer(idx, ev.pickup + ' pickup', actor, 2);
      if (ev.kind === 'hit') offer(idx, ev.attack + ' hit', actor + ' · ' + ev.damage + ' damage', 3 + Math.min(ev.damage, 99) / 100);
    }
  });
  const selected = [];
  for (const candidate of picks.sort((a, b) => b.rank - a.rank)) {
    if (selected.some(p => p.label === candidate.label || Math.abs(p.idx - candidate.idx) < 12)) continue;
    selected.push(candidate);
    if (selected.length === 3) break;
  }
  if (!selected.length) selected.push({ idx: record.frames.length - 1, label: 'Finish', detail: 'Final exchange' });
  const heading = document.createElement('strong');
  heading.textContent = 'Replay a moment';
  strip.append(heading);
  for (const { idx, label, detail } of selected.sort((a, b) => a.idx - b.idx)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary';
    button.textContent = '▶ ' + label[0].toUpperCase() + label.slice(1);
    const caption = document.createElement('small');
    caption.textContent = detail + ' · t' + record.frames[idx].tick;
    button.append(caption);
    button.onclick = () => {
      if (busy || activeReplay !== record) return;
      stopReplayTimer();
      seekReplay(Math.max(0, idx - 8));
      clipEnd = Math.min(record.frames.length - 1, idx + 5);
      replayPlaying = true;
      btnPause.textContent = 'Pause';
      modeInfo.textContent = 'Slow motion · ' + label;
      replayTimer = setTimeout(stepReplay, 160);
    };
    strip.append(button);
  }
}

function seekReplay(idx, isScrub = true) {
  if (!activeReplay) return;
  const frames = activeReplay.frames;
  replayIndex = Math.max(0, Math.min(frames.length - 1, idx));
  viewer.setBanner(replayIndex === frames.length - 1 ? activeReplay.banner : '');
  viewer.render(frames[replayIndex], 0, isScrub);
  scrubber.value = String(replayIndex);
}

function stepReplay() {
  if (!activeReplay || !replayPlaying) return;
  const frames = activeReplay.frames;
  if (clipEnd !== null && replayIndex >= clipEnd) {
    stopReplayTimer();
    btnPause.textContent = 'Play';
    modeInfo.textContent = 'Highlight finished';
    return;
  }
  if (replayIndex >= frames.length - 1) {
    viewer.setBanner(activeReplay.banner);
    viewer.render(frames[frames.length - 1], 0, false);
    scrubber.value = String(frames.length - 1);
    stopReplayTimer();
    btnPause.textContent = 'Play';
    modeInfo.textContent = 'Replay finished';
    return;
  }
  replayIndex++;
  const delay = clipEnd !== null ? 160 : Math.max(20, getTickDelayMs() || 35);
  viewer.setBanner(replayIndex === frames.length - 1 ? activeReplay.banner : '');
  viewer.render(frames[replayIndex], delay, false);
  scrubber.value = String(replayIndex);
  replayTimer = setTimeout(stepReplay, delay);
}

function loadReplay(record) {
  if (busy) return;
  stopReplayTimer();
  activeReplay = record;
  replayIndex = 0;
  viewer.setMeta(record.meta);
  viewer.setBanner('');
  viewer.render(record.frames[0], 0, true);
  renderMarkers(record.frames);
  renderMoments(record);
  renderStats(record);
  scrubber.disabled = false;
  scrubber.min = '0';
  scrubber.max = String(Math.max(0, record.frames.length - 1));
  scrubber.value = '0';
  btnPause.disabled = false;
  btnSkip.disabled = false;
  btnPrev.disabled = false;
  btnNext.disabled = false;
  btnPause.textContent = 'Pause';
  modeInfo.textContent = `Replaying ${record.meta.names[0]} vs ${record.meta.names[1]}`;
  replayPlaying = true;
  replayTimer = setTimeout(stepReplay, Math.max(20, getTickDelayMs() || 35));
}

function togglePlayPause() {
  if (busy) {
    livePaused = !livePaused;
    btnPause.textContent = livePaused ? 'Resume' : 'Pause';
    modeInfo.textContent = livePaused ? 'Live (paused)' : 'Live';
  } else if (activeReplay) {
    if (replayPlaying) {
      stopReplayTimer();
      btnPause.textContent = 'Play';
      modeInfo.textContent = 'Replay (paused)';
    } else {
      if (replayIndex >= activeReplay.frames.length - 1) replayIndex = 0;
      replayPlaying = true;
      btnPause.textContent = 'Pause';
      modeInfo.textContent = `Replaying Game ${activeReplay.gameNumber}`;
      stepReplay();
    }
  }
}

btnPause.addEventListener('click', togglePlayPause);
btnPrev.addEventListener('click', () => {
  if (!activeReplay || busy) return;
  stopReplayTimer();
  btnPause.textContent = 'Play';
  seekReplay(replayIndex - 1, true);
  modeInfo.textContent = 'Replay (step)';
});
btnNext.addEventListener('click', () => {
  if (!activeReplay || busy) return;
  stopReplayTimer();
  btnPause.textContent = 'Play';
  seekReplay(replayIndex + 1, false);
  modeInfo.textContent = 'Replay (step)';
});
btnSkip.addEventListener('click', () => {
  if (busy) {
    liveSkip = true;
    livePaused = false;
    btnPause.textContent = 'Pause';
    modeInfo.textContent = 'Skipping…';
  } else if (activeReplay) {
    stopReplayTimer();
    seekReplay(activeReplay.frames.length - 1, true);
    btnPause.textContent = 'Play';
    modeInfo.textContent = 'Replay finished';
  }
});
scrubber.addEventListener('input', () => {
  if (!activeReplay || busy) return;
  stopReplayTimer();
  btnPause.textContent = 'Play';
  seekReplay(Number(scrubber.value), true);
  modeInfo.textContent = 'Replay (scrubbing)';
});

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  const k = e.key.toLowerCase();
  if (e.code === 'Space') {
    if (tag === 'BUTTON') return;
    e.preventDefault();
    if (!btnPause.disabled) togglePlayPause();
  } else if (e.code === 'ArrowLeft') {
    if (!btnPrev.disabled) btnPrev.click();
  } else if (e.code === 'ArrowRight') {
    if (!btnNext.disabled) btnNext.click();
  } else if (e.key === 'Escape') {
    bracketModal?.classList.add('hidden');
  } else if (k === 'b') {
    if (tourney && bracketModal) {
      if (bracketModal.classList.contains('hidden')) {
        renderBracketModal();
        bracketModal.classList.remove('hidden');
      } else {
        bracketModal.classList.add('hidden');
      }
    }
  } else if (k === 'f') {
    get('btn-fullscreen')?.click();
  } else if (k === 'v') {
    get('btn-view')?.click();
  } else if (k === 'c') {
    get('btn-autocam')?.click();
  } else if (k === 's') {
    get('btn-sight')?.click();
  } else if (k === 'd') {
    get('btn-danger')?.click();
  } else if (k === 'r') {
    viewer.resetCamera();
  } else if (k === 'm') {
    get('btn-bgm-toggle')?.click();
  } else if (k === 'n') {
    get('btn-bgm-next')?.click();
  } else if (k === 'x') {
    get('btn-sfx')?.click();
  }
});

async function compileText(name, text) {
  if (text.length > 256 * 1024) throw new Error(name + ': File exceeds 256 KiB.');
  if (/\.py$/i.test(name)) return { language: 'python', code: text };
  if (!/\.ts$/i.test(name)) throw new Error(name + ': Choose a .ts or .py file.');
  const response = await fetch('/strip', { method: 'POST', body: text });
  const stripped = await response.text();
  if (!response.ok) throw new Error(name + ': ' + stripped);
  return { language: 'typescript', code: stripped };
}

async function compile(file) {
  if (file.size > 256 * 1024) throw new Error(file.name + ': File exceeds 256 KiB.');
  return compileText(file.name, await file.text());
}

function isolate(team) {
  const frame = document.createElement('iframe');
  frame.sandbox = 'allow-scripts';
  frame.src = '/bot.html';
  const { port1, port2 } = new MessageChannel();
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    try { port1.postMessage({ kind: 'close' }); } catch {}
    port1.close();
    frame.remove();
  };
  let lastStage = 'loading sandbox iframe';
  let seqCounter = 0;
  let totalComputeMs = 0;
  const matchBudgetMs = team.language === 'python' ? 25000 : 15000;

  function fail(msg) {
    close();
    const err = new Error(msg);
    err.faultyBotId = team.id;
    err.faultyTeamName = team.name;
    return err;
  }
  function receive(send, timeout, phase, expectedSeq = null) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(fail(`${team.name} timed out ${phase} (stuck at: ${lastStage}).`)), timeout);
      port1.onmessage = ({ data }) => {
        if (data?.stage && expectedSeq === null) {
          lastStage = String(data.stage).slice(0, 80);
          return;
        }
        if (expectedSeq !== null && data?.seq !== expectedSeq) {
          // Ignore or reject unsolicited/spoofed messages
          if (data?.error) {
            clearTimeout(timer);
            reject(fail(team.name + ': ' + String(data.error).slice(0, 300)));
          }
          return;
        }
        clearTimeout(timer);
        if (data?.error) reject(fail(team.name + ': ' + String(data.error).slice(0, 300)));
        else resolve(data);
      };
      send();
    });
  }
  const ready = receive(() => {
    frame.addEventListener('load', () => {
      lastStage = 'sending strategy to sandbox';
      frame.contentWindow.postMessage({ kind: 'start', code: team.code, language: team.language }, '*', [port2]);
    }, { once: true });
    document.body.append(frame);
  }, team.language === 'python' ? 60000 : 10000, 'while loading its strategy').then((data) => {
    if (data?.ready !== true) throw fail(team.name + ' did not start.');
  });
  return {
    ready, close,
    async turn(observation, match) {
      const seq = ++seqCounter;
      const t0 = performance.now();
      const data = await receive(
        () => port1.postMessage({ seq, observation, match }),
        1000,
        'on tick ' + observation.tick,
        seq,
      );
      const elapsed = Math.max(performance.now() - t0, Number(data?.ms) || 0);
      totalComputeMs += elapsed;
      if (totalComputeMs > matchBudgetMs) {
        throw fail(`${team.name} exceeded the ${Math.round(matchBudgetMs / 1000)}s total match CPU budget.`);
      }
      if (typeof data?.turn !== 'string' || data.turn.length > 4096) {
        throw fail(team.name + ' returned an invalid turn.');
      }
      let parsed;
      try {
        parsed = JSON.parse(data.turn);
      } catch {
        throw fail(team.name + ' returned malformed JSON.');
      }
      try {
        return sanitizeTurn(parsed, team.name);
      } catch (err) {
        throw fail(err.message);
      }
    },
  };
}

async function runGame(teams, seed, gameNumber, { forceInstant = false } = {}) {
  const game = new Game({ seed });
  const workers = [];
  const frames = [];
  let meta;
  livePaused = false;
  liveSkip = forceInstant;
  btnPause.disabled = false;
  btnSkip.disabled = false;
  btnPrev.disabled = true;
  btnNext.disabled = true;
  btnPause.textContent = 'Pause';
  scrubber.disabled = true;
  get('moments').replaceChildren();
  if (markersEl) markersEl.innerHTML = '';

  try {
    for (const team of teams) {
      status.textContent = `Game ${gameNumber}: Loading ${team.name} (${team.language ?? 'built-in'})…`;
      const worker = team.start
        ? { turn: team.start(game.hello(workers.length + 1)) }
        : isolate(team);
      workers.push(worker);
      await worker.ready;
    }
    const matches = [1, 2].map((id) => {
      const hello = game.hello(id);
      return { ...hello, id: hello.match_id };
    });
    meta = {
      map: matches[0].map,
      mapName: matches[0].map_name,
      seed,
      names: [teams[0].name, teams[1].name],
      avatars: [teams[0].avatar, teams[1].avatar],
      sightRadius: matches[0].rules?.stats?.sight_radius ?? 8,
      maxTicks: matches[0].rules?.max_ticks ?? 600,
    };
    viewer.setMeta(meta);
    if (!forceInstant && getTickDelayMs() > 0) {
      audio.ensureBgmPlaying();
      viewer.render(captureFrame(game.next(1), game.next(2)), 0, true);
      viewer.showVsIntro(1050);
      await sleep(1050);
    } else if (!forceInstant) {
      audio.ensureBgmPlaying();
    }
    status.textContent = `Game ${gameNumber}: ${teams[0].name} vs. ${teams[1].name} (seed ${seed})…`;
    modeInfo.textContent = forceInstant ? 'Simulating…' : 'Live';

    while (!game.over) {
      await waitIfPaused();
      const obs1 = game.next(1);
      const obs2 = game.next(2);
      const frame = captureFrame(obs1, obs2);
      frames.push(frame);

      const baseDelay = (forceInstant || liveSkip) ? 0 : getTickDelayMs();
      // Dramatic KO Slow-Mo when either fighter enters critical HP (<= 24) during live play!
      const criticalHp = Math.min(obs1.self.hp, obs2.self.hp) <= 24;
      const delay = baseDelay > 0 && criticalHp ? Math.max(Math.round(baseDelay * 2.1), 135) : baseDelay;
      if (delay > 0 || frame.tick % 12 === 0) {
        viewer.render(frame, delay, false);
      }

      const t0 = performance.now();
      const settled = await Promise.allSettled([
        workers[0].turn(obs1, matches[0]),
        workers[1].turn(obs2, matches[1]),
      ]);
      if (settled[0].status === 'rejected' && settled[1].status === 'rejected') {
        throw new Error(`Both bots failed on tick ${obs1.tick}: ${settled[0].reason?.message} | ${settled[1].reason?.message}`);
      }
      if (settled[0].status === 'rejected') throw settled[0].reason;
      if (settled[1].status === 'rejected') throw settled[1].reason;
      const [first, second] = [settled[0].value, settled[1].value];
      game.step({ 1: first, 2: second });

      if (delay > 0 && !liveSkip && !forceInstant) {
        const remaining = delay - (performance.now() - t0);
        if (remaining > 0) await sleep(remaining);
      }
    }

    const finalState = game.core?.state;
    const prev = frames[frames.length - 1];
    if (finalState && Array.isArray(finalState.fighters)) {
      frames.push({
        tick: game.result?.final_tick ?? finalState.tick ?? (prev ? prev.tick + 1 : 0),
        fighters: finalState.fighters.map((f, idx) => ({
          id: f.id ?? idx + 1,
          pos: f.pos,
          hp: Math.max(0, f.hp),
          max_hp: f.max_hp ?? prev?.fighters[idx]?.max_hp ?? 130,
          state: f.hp <= 0 ? 'dead' : (f.state ?? 'idle'),
          slow_ticks_left: f.slow_ticks_left ?? 0,
          buffs: f.buffs ?? {},
          cooldowns: f.cooldowns ?? prev?.fighters[idx]?.cooldowns ?? {},
        })),
        projectiles: finalState.projectiles ?? [],
        areas: finalState.areas ?? [],
        pickups: prev?.pickups ?? [],
        zone: finalState.zone ?? prev?.zone,
        danger: [],
        events: finalState.events ?? [],
      });
    } else if (prev && game.result?.winner) {
      const loserIdx = game.result.winner === 1 ? 1 : 0;
      const cloned = structuredClone(prev);
      cloned.tick = game.result.final_tick ?? prev.tick + 1;
      cloned.fighters[loserIdx].hp = 0;
      frames.push(cloned);
    }
  } finally {
    workers.forEach((worker) => worker.close?.());
  }

  const summary = game.summary();
  const replay = summary.replay ?? game.replay();
  replay.header.bots.forEach((bot, i) => { bot.name = teams[i].name; });
  if (!verifyReplay(replay).ok) throw new Error('Replay verification failed.');

  const winner = teams[game.result.winner - 1];
  meta.winner = game.result.winner;
  const banner = winner
    ? `${winner.name} wins! · ${game.result.final_tick} ticks`
    : `Draw · ${game.result.final_tick} ticks`;
  if (frames.length) {
    viewer.setBanner(banner, game.result.winner);
    viewer.render(frames[frames.length - 1], 50, false);
  }
  const stream = new Blob([encodeReplay(replay)]).stream().pipeThrough(new CompressionStream('gzip'));
  return {
    result: game.result,
    file: await new Response(stream).blob(),
    record: { gameNumber, meta, frames, banner, stats: summary.stats },
  };
}

async function playSeries(teamA, teamB, { targetWins = 1, startingSeed, forceInstant = false, panelRound = false } = {}) {
  const pair = [
    { ...teamA, _pairIdx: 0 },
    { ...teamB, _pairIdx: 1 },
  ];
  const wins = [0, 0];
  let damageA = 0;
  let damageB = 0;
  const seriesGames = [];
  const isFinal = targetWins > 1;
  if (!panelRound) games.replaceChildren();

  for (let index = 0; index < (panelRound ? 1 : 8) && Math.max(...wins) < targetWins; index++) {
    const seats = index % 2 ? [pair[1], pair[0]] : [pair[0], pair[1]];
    const seed = startingSeed + (isFinal && index < 2 ? 0 : isFinal ? index - 1 : index);
    const { result, file, record } = await runGame(seats, seed, index + 1, { forceInstant });
    const winnerSeat = seats[result.winner - 1];
    if (winnerSeat) wins[winnerSeat._pairIdx]++;

    const fighters = record.stats?.fighters;
    if (fighters && fighters.length >= 2) {
      const dmg0 = fighters[0].damage_dealt ?? 0;
      const dmg1 = fighters[1].damage_dealt ?? 0;
      if (seats[0]._pairIdx === 0) { damageA += dmg0; damageB += dmg1; }
      else { damageA += dmg1; damageB += dmg0; }
    }

    const url = URL.createObjectURL(file);
    downloads.push(url);
    seriesGames.push({ seed, record, url, result, seats });

    const gameNum = panelRound ? games.children.length + 1 : index + 1;
    const item = document.createElement('li');
    const watchBtn = document.createElement('button');
    watchBtn.type = 'button';
    watchBtn.className = 'secondary';
    watchBtn.textContent = 'Watch';
    watchBtn.addEventListener('click', () => loadReplay(record));
    const link = document.createElement('a');
    link.href = url;
    link.download = `game-${gameNum}-seed-${seed}.jsonl.gz`;
    link.textContent = 'Download .jsonl.gz';
    item.append(
      `Game ${gameNum} · ${seats[0].name} vs ${seats[1].name} · seed ${seed} · ${winnerSeat ? winnerSeat.name + ' won' : 'draw'} · ${result.final_tick}t `,
      watchBtn,
      link,
    );
    games.append(item);

    if (!forceInstant && getTickDelayMs() > 0 && Math.max(...wins) < targetWins && index < 7) {
      await sleep(750);
    }
  }

  const winIdx = wins.findIndex((c) => c >= targetWins);
  const winner = winIdx === 0 ? teamA : winIdx === 1 ? teamB : (wins[0] > wins[1] ? teamA : wins[1] > wins[0] ? teamB : null);
  const lastRecord = seriesGames[seriesGames.length - 1]?.record ?? null;
  if (lastRecord) {
    activeReplay = lastRecord;
    replayIndex = lastRecord.frames.length - 1;
    renderMarkers(lastRecord.frames);
    renderMoments(lastRecord);
    renderStats(lastRecord);
    scrubber.disabled = false;
    scrubber.min = '0';
    scrubber.max = String(Math.max(0, lastRecord.frames.length - 1));
    scrubber.value = String(replayIndex);
    btnPause.disabled = false;
    btnPause.textContent = 'Play';
    btnSkip.disabled = false;
    btnPrev.disabled = false;
    btnNext.disabled = false;
  }
  return { winner, score: wins, seed: startingSeed, games: seriesGames, damageA, damageB };
}

// =======================
// SINGLE 1v1 MATCH HANDLER
// =======================
const opponentSelect = get('opponent');
for (const bot of panel) opponentSelect.add(new Option(bot.name + ' · ' + bot.label, bot.key));
function updateOpponent() {
  const upload = opponentSelect.value === 'upload';
  get('opponent-upload').hidden = !upload;
  get('file-b').disabled = !upload;
  get('name-b').disabled = !upload;
  get('format-label').hidden = opponentSelect.value === 'panel';
  get('run').textContent = opponentSelect.value === 'panel' ? 'Fight all three' : 'Run matchup';
}
opponentSelect.addEventListener('change', updateOpponent);
updateOpponent();
let lastSingleRun = null;
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  busy = true;
  stopReplayTimer();
  activeReplay = null;
  statsBox.style.display = 'none';
  get('run').disabled = true;
  get('rematch').disabled = true;
  get('comparison').textContent = '';
  try {
    const names = ['a', 'b'].map((id) => get('name-' + id).value.trim());
    const choice = opponentSelect.value;
    get('practice-result').textContent = '';
    if (!names[0] || (choice === 'upload' && (!names[1] || names[0] === names[1]))) throw new Error('Enter two distinct team names.');
    const rematching = event.submitter === get('rematch') && lastSingleRun;
    const startingSeed = rematching ? lastSingleRun.seed : pickMatchSeed();
    seedInput.value = String(startingSeed);
    const targetWins = get('format').value === 'final' ? 2 : 1;
    const player = { id: 1, name: names[0], avatar: get('avatar-a').value, ...await compile(get('file-a').files[0]) };
    if (choice === 'panel') {
      games.replaceChildren();
      let victories = 0;
      const results = [];
      for (const bot of panel) {
        const outcome = await playSeries(player, { ...bot, id: 2 }, { startingSeed, panelRound: true });
        const result = outcome.games[0].result.winner;
        if (result === 1) victories++;
        results.push(bot.name + ' · ' + (result === 1 ? 'win' : result === 2 ? 'loss' : 'draw'));
        get('practice-result').textContent = results.join('  /  ');
      }
      status.textContent = player.name + ' beat ' + victories + ' of ' + panel.length + ' opponents on seed ' + startingSeed + '.';
      modeInfo.textContent = 'Panel complete';
      lastSingleRun = { seed: startingSeed, choice };
      get('rematch').textContent = 'Rematch on seed ' + startingSeed;
      get('rematch').classList.remove('hidden');
      return;
    }
    let opponent = panel.find(bot => bot.key === choice);
    if (choice === 'upload') opponent = { name: names[1], avatar: get('avatar-b').value, ...await compile(get('file-b').files[0]) };
    if (choice === 'mirror') opponent = { ...player, name: player.name + ' (mirror)', avatar: get('avatar-b').value };
    names[1] = opponent.name;
    const outcome = await playSeries(player, { ...opponent, id: 2 }, { targetWins, startingSeed });
    const damage = outcome.games[0].record.stats.fighters.map(f => f.damage_dealt);
    if (lastSingleRun?.seed === startingSeed && lastSingleRun.choice === choice && lastSingleRun.damage) {
      const changes = damage.map((value, i) => {
        const delta = value - lastSingleRun.damage[i];
        return names[i] + ' ' + (delta > 0 ? '+' : '') + delta;
      });
      get('comparison').textContent = 'Opening game damage vs. previous run on this seed · ' + changes.join(' / ');
    }
    lastSingleRun = { seed: startingSeed, damage, choice };
    get('rematch').textContent = 'Rematch on seed ' + startingSeed;
    get('rematch').classList.remove('hidden');
    status.textContent = (outcome.winner ? outcome.winner.name + ' wins the matchup' : 'No winner after eight games') + ` (${outcome.score[0]}–${outcome.score[1]}).`;
    modeInfo.textContent = 'Match complete';
  } catch (err) {
    status.textContent = err.message;
    modeInfo.textContent = 'Error';
  } finally {
    busy = false;
    get('run').disabled = false;
    get('rematch').disabled = false;
  }
});

// =======================
// INTERACTIVE TOURNAMENT HOST
// =======================
const roster = [];
let nextBotId = 1;
let tourney = null;

const dropzone = get('dropzone');
const rosterInput = get('roster-files');
const rosterList = get('roster-list');
const rosterCount = get('roster-count');
const btnPrecheck = get('btn-precheck');
const btnStartTourney = get('btn-start-tourney');
const btnResetTourney = get('btn-reset-tourney');
const tourneyBoard = get('tourney-board');
const btnNextMatch = get('btn-next-match');
const btnSimRound = get('btn-sim-round');
const btnShowBracket = get('btn-show-bracket');
const btnExportTourney = get('btn-export-tourney');
const bracketModal = get('bracket-modal');
const restoreBar = get('restore-bar');
const standingsSlot = get('standings-slot');
const bracketSlot = get('bracket-slot');
const championSlot = get('champion-slot');
const STORAGE_KEY = 'victorious_tournament_v1';

function saveTournamentState() {
  if (!tourney) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeTournament(tourney)));
  } catch {}
}

function clearSavedTournament() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  restoreBar?.classList.add('hidden');
}

function checkSavedTournament() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && !tourney) restoreBar?.classList.remove('hidden');
  } catch {}
}

const AVATAR_OPTS = [
  ['pikachu', '⚡ Pikachu'],
  ['charizard', '🔥 Charizard'],
  ['greninja', '💧 Greninja'],
  ['lucario', '🥊 Lucario'],
  ['gengar', '👻 Gengar'],
  ['gardevoir', '✨ Gardevoir'],
  ['knight', '⚔️ Knight'],
  ['fox', '🦊 Fox'],
  ['mage', '🧙 Mage'],
  ['mech', '🤖 Mech'],
  ['dragon', '🐉 Dragon'],
  ['ninja', '🥷 Ninja'],
];

function uniqueTeamName(base) {
  let name = base.replace(/\.(ts|py)$/i, '').replace(/[_-]+/g, ' ').trim().slice(0, 32) || 'Bot';
  let candidate = name;
  let n = 2;
  while (roster.some((r) => r.name.toLowerCase() === candidate.toLowerCase())) {
    candidate = `${name} ${n++}`;
  }
  return candidate;
}

function renderRoster() {
  rosterCount.textContent = String(roster.length);
  btnStartTourney.disabled = roster.length < 2 || Boolean(tourney);
  if (btnPrecheck) btnPrecheck.disabled = roster.length < 1 || Boolean(tourney) || busy;
  rosterList.innerHTML = '';
  roster.forEach((bot, idx) => {
    const row = document.createElement('div');
    row.className = 'roster-row';

    const nameIn = document.createElement('input');
    nameIn.value = bot.name;
    nameIn.maxLength = 32;
    nameIn.disabled = Boolean(tourney);
    nameIn.addEventListener('input', () => { bot.name = nameIn.value.trim() || `Bot ${idx + 1}`; });

    const sel = document.createElement('select');
    sel.disabled = Boolean(tourney);
    for (const [val, lbl] of AVATAR_OPTS) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = lbl;
      if (val === bot.avatar) opt.selected = true;
      sel.append(opt);
    }
    sel.addEventListener('change', () => { bot.avatar = sel.value; });

    const badge = document.createElement('span');
    badge.className = 'lang-badge' + (bot.language === 'python' ? ' py' : '');
    badge.textContent = bot.language === 'python' ? 'PY' : 'TS';

    const chk = document.createElement('span');
    if (bot.check?.ok) {
      chk.className = 'check-badge check-ok';
      chk.textContent = `✓ ${bot.check.ms}ms`;
      chk.title = 'Passed 5-tick sandbox smoke test';
    } else if (bot.check && !bot.check.ok) {
      chk.className = 'check-badge check-err';
      chk.textContent = '✕ Fail';
      chk.title = bot.check.error;
    }

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'danger';
    del.textContent = '✕';
    del.style.padding = '3px 7px';
    del.disabled = Boolean(tourney);
    del.addEventListener('click', () => {
      roster.splice(idx, 1);
      renderRoster();
    });

    row.append(nameIn, sel, badge, chk, del);
    rosterList.append(row);
  });
}

async function precheckBot(bot) {
  const game = new Game({ seed: 7 });
  const worker = isolate(bot);
  try {
    await worker.ready;
    const hello1 = game.hello(1);
    const match1 = { ...hello1, id: hello1.match_id };
    const randTurn = HOUSE_BOTS.random.start(game.hello(2));
    const t0 = performance.now();
    for (let tick = 0; tick < 5 && !game.over; tick++) {
      const obs1 = game.next(1);
      const obs2 = game.next(2);
      const turn1 = await worker.turn(obs1, match1);
      const turn2 = randTurn(obs2);
      game.step({ 1: turn1, 2: turn2 });
    }
    return { ok: true, ms: Math.max(1, Math.round(performance.now() - t0)) };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    worker.close();
  }
}

btnPrecheck?.addEventListener('click', async () => {
  if (busy || tourney || !roster.length) return;
  busy = true;
  renderRoster();
  let passed = 0;
  let failed = 0;
  try {
    for (const bot of roster) {
      status.textContent = `Pre-checking ${bot.name} (${bot.language})…`;
      bot.check = await precheckBot(bot);
      if (bot.check.ok) passed++;
      else failed++;
      renderRoster();
    }
    status.textContent = failed === 0
      ? `✓ All ${passed} bots passed the 5-tick sandbox smoke test!`
      : `Pre-check complete: ${passed} passed, ${failed} failed (hover ✕ Fail for details).`;
  } finally {
    busy = false;
    renderRoster();
  }
});

async function addFilesToRoster(fileList) {
  if (tourney) return;
  for (const file of fileList) {
    try {
      const compiled = await compile(file);
      roster.push({
        id: nextBotId++,
        name: uniqueTeamName(file.name),
        avatar: defaultAvatar(roster.length),
        ...compiled,
      });
      status.textContent = `Added ${file.name} (${compiled.language}) to tournament roster.`;
    } catch (err) {
      status.textContent = `Could not add ${file.name}: ${err.message}`;
    }
  }
  renderRoster();
}

dropzone.addEventListener('click', () => { if (!tourney) rosterInput.click(); });
rosterInput.addEventListener('change', () => {
  if (rosterInput.files?.length) addFilesToRoster(rosterInput.files);
  rosterInput.value = '';
});
dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  if (e.dataTransfer?.files?.length) addFilesToRoster(e.dataTransfer.files);
});

async function addStarterBot(url, filename) {
  if (tourney) return;
  try {
    const res = await fetch(url);
    const text = await res.text();
    const compiled = await compileText(filename, text);
    roster.push({
      id: nextBotId++,
      name: uniqueTeamName(filename === 'strategy.ts' ? 'Starter TS' : 'Starter PY'),
      avatar: defaultAvatar(roster.length),
      ...compiled,
    });
    renderRoster();
    status.textContent = `Added ${filename} starter to roster.`;
  } catch (err) {
    status.textContent = err.message;
  }
}

get('btn-add-ts-starter')?.addEventListener('click', () => addStarterBot('/strategy.ts', 'strategy.ts'));
get('btn-add-py-starter')?.addEventListener('click', () => addStarterBot('/bot.py', 'bot.py'));

function renderTournamentBoard() {
  if (!tourney) {
    tourneyBoard.classList.add('hidden');
    return;
  }
  tourneyBoard.classList.remove('hidden');

  // Champion banner
  if (tourney.champion) {
    championSlot.innerHTML =
      `<div class="champion-banner">` +
      `<div class="champ-title">🏆 Tournament Champion</div>` +
      `<div class="champ-name">${escHtml(tourney.champion.name)}</div>` +
      `</div>`;
  } else {
    championSlot.innerHTML = '';
  }

  // Standings table for Round Robin & Swiss
  if (tourney.format === 'round-robin' || tourney.format === 'swiss') {
    const rows = getStandings(tourney);
    standingsSlot.innerHTML =
      `<h3>Standings (Top 2 → Bo3 Final)</h3>` +
      `<table class="standings"><thead><tr><th>#</th><th>Team</th><th>W–L</th><th>Dmg</th></tr></thead><tbody>` +
      rows.map((t, i) =>
        `<tr class="${i < 2 ? 'top2' : ''}"><td>${i + 1}</td><td>${escHtml(t.name)}</td><td>${t.wins}–${t.losses}${t.draws ? `–${t.draws}` : ''}</td><td>${t.damageDealt}</td></tr>`,
      ).join('') +
      `</tbody></table>`;
  } else {
    standingsSlot.innerHTML = '';
  }

  // Rounds & Match Cards
  bracketSlot.innerHTML = '';
  for (const round of tourney.rounds) {
    const block = document.createElement('div');
    block.className = 'round-block';
    const h = document.createElement('h3');
    h.textContent = round.name;
    block.append(h);

    for (const m of round.matches) {
      const card = document.createElement('div');
      card.className = `match-card ${m.status}${m.isFinal ? ' final' : ''}`;

      const nameA = m.teamA ? m.teamA.name : 'TBD';
      const nameB = m.status === 'bye' ? 'BYE' : (m.teamB ? m.teamB.name : 'TBD');
      const scoreText = m.status === 'done'
        ? `${m.score[0]}–${m.score[1]}`
        : m.status === 'bye' ? 'ADV' : (m.isFinal ? 'Bo3' : 'Bo1');

      const top = document.createElement('div');
      top.className = 'match-top';
      const left = document.createElement('span');
      left.innerHTML =
        `<span class="${m.winner === m.teamA && m.teamA ? 'win-name' : ''}">${escHtml(nameA)}</span>` +
        ` <span style="color:#64748b">vs</span> ` +
        `<span class="${m.winner === m.teamB && m.teamB ? 'win-name' : ''}">${escHtml(nameB)}</span>`;
      const right = document.createElement('span');
      right.style.color = m.status === 'done' ? '#4ade80' : '#94a3b8';
      right.textContent = scoreText;
      top.append(left, right);
      card.append(top);

      const metaRow = document.createElement('div');
      metaRow.className = 'match-meta';
      const info = document.createElement('span');
      info.textContent = m.status === 'done'
        ? `seed ${m.seed} · ${m.winner ? m.winner.name + ' won' : 'draw'}`
        : m.status === 'bye' ? 'Automatic bye'
        : m.status === 'running' ? 'Playing live…'
        : m.status === 'waiting' ? 'Waiting on prior round'
        : 'Ready to play';
      metaRow.append(info);

      const btns = document.createElement('span');
      btns.style.display = 'flex';
      btns.style.gap = '5px';

      if (m.status === 'pending' && m.teamA && m.teamB) {
        const playBtn = document.createElement('button');
        playBtn.type = 'button';
        playBtn.textContent = '▶ Play';
        playBtn.disabled = busy;
        playBtn.addEventListener('click', () => runTournamentMatch(m, false));
        btns.append(playBtn);
      } else if (m.status === 'done' && m.games?.length) {
        const lastGame = m.games[m.games.length - 1];
        const watchBtn = document.createElement('button');
        watchBtn.type = 'button';
        watchBtn.className = 'secondary';
        watchBtn.textContent = 'Watch';
        watchBtn.addEventListener('click', () => loadReplay(lastGame.record));
        const dl = document.createElement('a');
        dl.href = lastGame.url;
        dl.download = `match-${m.id}-seed-${lastGame.seed}.jsonl.gz`;
        dl.textContent = '⬇';
        dl.title = 'Download replay .jsonl.gz';
        btns.append(watchBtn, dl);
      }
      metaRow.append(btns);
      card.append(metaRow);
      block.append(card);
    }
    bracketSlot.append(block);
  }

  const nextMatch = getNextPendingMatch(tourney);
  btnNextMatch.disabled = busy || !nextMatch;
  btnSimRound.disabled = busy || !nextMatch;
  btnNextMatch.textContent = nextMatch
    ? `▶ ${nextMatch.isFinal ? 'Play Grand Final (Bo3)' : `Next: ${nextMatch.teamA.name} vs ${nextMatch.teamB.name}`}`
    : (tourney.champion ? '🏆 Tournament Complete' : 'No pending matches');
  saveTournamentState();
  if (bracketModal && !bracketModal.classList.contains('hidden')) renderBracketModal();
}

function renderBracketModal() {
  if (!tourney || !bracketModal) return;
  get('modal-sub').textContent = `${tourney.format} · ${tourney.teams.length} teams`;
  get('modal-champ').innerHTML = championSlot.innerHTML;
  get('modal-standings').innerHTML = standingsSlot.innerHTML;
  const cols = get('modal-cols');
  cols.innerHTML = '';
  for (const round of tourney.rounds) {
    const col = document.createElement('div');
    col.className = 'bracket-col';
    const h = document.createElement('h3');
    h.textContent = round.name;
    col.append(h);
    for (const m of round.matches) {
      const card = document.createElement('div');
      card.className = `match-card ${m.status}${m.isFinal ? ' final' : ''}`;
      const nameA = m.teamA ? m.teamA.name : 'TBD';
      const nameB = m.status === 'bye' ? 'BYE' : (m.teamB ? m.teamB.name : 'TBD');
      const scoreText = m.status === 'done' ? `${m.score[0]}–${m.score[1]}` : m.status === 'bye' ? 'ADV' : (m.isFinal ? 'Bo3' : 'Bo1');
      card.innerHTML =
        `<div class="match-top"><span><span class="${m.winner === m.teamA && m.teamA ? 'win-name' : ''}">${escHtml(nameA)}</span>` +
        ` <span style="color:#64748b">vs</span> <span class="${m.winner === m.teamB && m.teamB ? 'win-name' : ''}">${escHtml(nameB)}</span></span>` +
        `<span style="color:${m.status === 'done' ? '#4ade80' : '#94a3b8'}">${escHtml(scoreText)}</span></div>` +
        `<div class="match-meta"><span>${escHtml(m.status === 'done' ? `seed ${m.seed} · ${m.winner ? m.winner.name + ' won' : 'draw'}` : m.status === 'bye' ? 'Automatic bye' : m.status === 'running' ? 'Playing live…' : m.status === 'waiting' ? 'Waiting on prior round' : 'Ready to play')}</span></div>`;
      col.append(card);
    }
    cols.append(col);
  }
  const next = getNextPendingMatch(tourney);
  const btnModalNext = get('btn-modal-next');
  btnModalNext.disabled = busy || !next;
  btnModalNext.textContent = next
    ? `▶ ${next.isFinal ? 'Play Grand Final (Bo3)' : `Next: ${next.teamA.name} vs ${next.teamB.name}`}`
    : '🏆 Complete';
}

btnShowBracket?.addEventListener('click', () => {
  if (!tourney) return;
  renderBracketModal();
  bracketModal.classList.remove('hidden');
});
get('btn-close-bracket')?.addEventListener('click', () => bracketModal?.classList.add('hidden'));
get('btn-modal-next')?.addEventListener('click', () => {
  bracketModal?.classList.add('hidden');
  const next = tourney && getNextPendingMatch(tourney);
  if (next) runTournamentMatch(next, false);
});

btnExportTourney?.addEventListener('click', () => {
  if (!tourney) return;
  const snap = serializeTournament(tourney);
  // Strip raw code from exported JSON summary so it's a clean results/standings record
  const clean = {
    exportedAt: new Date().toISOString(),
    format: snap.format,
    champion: tourney.champion?.name ?? null,
    standings: getStandings(tourney).map((t, i) => ({ rank: i + 1, name: t.name, wins: t.wins, losses: t.losses, draws: t.draws, damageDealt: t.damageDealt })),
    rounds: snap.rounds,
  };
  const blob = new Blob([JSON.stringify(clean, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `victorious-tournament-${Date.now()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});

get('btn-restore-tourney')?.addEventListener('click', () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const snap = JSON.parse(raw);
    tourney = deserializeTournament(snap);
    roster.splice(0, roster.length, ...tourney.teams);
    nextBotId = Math.max(1, ...roster.map((b) => b.id + 1));
    restoreBar.classList.add('hidden');
    btnResetTourney.classList.remove('hidden');
    renderRoster();
    renderTournamentBoard();
    status.textContent = `Restored saved ${tourney.format} tournament (${tourney.teams.length} teams).`;
  } catch (err) {
    status.textContent = 'Could not restore saved tournament: ' + err.message;
  }
});
get('btn-discard-tourney')?.addEventListener('click', clearSavedTournament);

async function runTournamentMatch(match, forceInstant = false) {
  if (busy || !tourney || match.status !== 'pending') return;
  busy = true;
  stopReplayTimer();
  match.status = 'running';
  renderTournamentBoard();
  try {
    const startingSeed = pickMatchSeed();
    const outcome = await playSeries(match.teamA, match.teamB, {
      targetWins: match.targetWins,
      startingSeed,
      forceInstant,
    });
    recordMatchResult(tourney, match, outcome);
    status.textContent = tourney.champion
      ? `🏆 ${tourney.champion.name} wins the tournament!`
      : `${outcome.winner ? outcome.winner.name + ' won' : 'Draw'} (${outcome.score[0]}–${outcome.score[1]}, seed ${startingSeed}).`;
    modeInfo.textContent = tourney.champion ? 'Champion crowned!' : 'Match complete';
  } catch (err) {
    // Auto-forfeit the crashing/timed-out bot so a broken submission never stalls the tournament!
    if (err.faultyBotId && (err.faultyBotId === match.teamA?.id || err.faultyBotId === match.teamB?.id)) {
      const winner = err.faultyBotId === match.teamA.id ? match.teamB : match.teamA;
      const score = winner === match.teamA ? [match.targetWins, 0] : [0, match.targetWins];
      recordMatchResult(tourney, match, { winner, score, seed: seedInput.valueAsNumber, games: [] });
      viewer.setBanner(`${winner.name} wins by forfeit!`);
      status.textContent = `⚠ ${err.message} → ${winner.name} advances by forfeit!`;
      modeInfo.textContent = 'Forfeit (bot error)';
    } else {
      match.status = 'pending';
      status.textContent = err.message;
      modeInfo.textContent = 'Error';
    }
  } finally {
    busy = false;
    renderTournamentBoard();
  }
}

btnStartTourney.addEventListener('click', () => {
  if (roster.length < 2) return;
  const format = get('t-format').value;
  const shuffleRoster = get('t-shuffle').checked;
  tourney = createTournament(format, roster, { shuffleRoster, bo3Final: true });
  btnResetTourney.classList.remove('hidden');
  renderRoster();
  renderTournamentBoard();
  status.textContent = `Tournament started (${format}, ${roster.length} teams). Click "Run Next Match" to play live!`;
});

btnResetTourney.addEventListener('click', () => {
  if (busy) return;
  tourney = null;
  clearSavedTournament();
  btnResetTourney.classList.add('hidden');
  renderRoster();
  renderTournamentBoard();
  status.textContent = 'Bracket reset. Edit roster or start a new tournament.';
});

btnNextMatch.addEventListener('click', () => {
  const next = tourney && getNextPendingMatch(tourney);
  if (next) runTournamentMatch(next, false);
});

btnSimRound.addEventListener('click', async () => {
  if (busy || !tourney) return;
  const active = getActiveRoundPendingMatches(tourney);
  if (!active) return;
  for (const m of active.matches) {
    if (m.status === 'pending') {
      await runTournamentMatch(m, true);
    }
  }
});

window.addEventListener('beforeunload', (e) => {
  if (tourney && !tourney.champion) {
    e.preventDefault();
    e.returnValue = '';
  }
});

renderRoster();
checkSavedTournament();
