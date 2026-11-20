// Zero-Dependency Web Audio Combat SFX + Custom Local BGM Player for Victris.
// Synthesizes punchy sci-fi/arcade SFX for every Victris event and lets the host
// load any local MP3/WAV/OGG track as looping tournament BGM.

export function createAudioEngine() {
  let ctx = null;
  let sfxEnabled = true;
  let sfxVolume = 0.55;
  let bgmVolume = 0.38;
  const lastPlayed = new Map();

  // Auto-shuffling Trihorn BGM player
  const bgm = new Audio();
  bgm.volume = bgmVolume;
  let tracks = [];
  let currentTrack = null;
  let userPausedBgm = false;
  let onTrackChange = null;

  fetch('/bgm/list')
    .then((r) => (r.ok ? r.json() : []))
    .then((list) => {
      tracks = Array.isArray(list) ? list : [];
    })
    .catch(() => {});

  bgm.addEventListener('ended', () => {
    if (!userPausedBgm && tracks.length) playRandomTrack();
  });

  function playRandomTrack() {
    if (!tracks.length) return Promise.resolve(null);
    const pool = tracks.length > 1 && currentTrack
      ? tracks.filter((t) => t.id !== currentTrack.id)
      : tracks;
    currentTrack = pool[Math.floor(Math.random() * pool.length)];
    userPausedBgm = false;
    bgm.src = currentTrack.url;
    bgm.volume = bgmVolume;
    if (onTrackChange) onTrackChange(currentTrack, true);
    return bgm.play().then(() => currentTrack).catch(() => currentTrack);
  }

  function ensureBgmPlaying() {
    if (userPausedBgm || !tracks.length) return;
    if (!currentTrack) {
      playRandomTrack();
    } else if (bgm.paused) {
      bgm.play().catch(() => {});
      if (onTrackChange) onTrackChange(currentTrack, true);
    }
  }

  function toggleBgm() {
    if (!currentTrack) {
      playRandomTrack();
      return true;
    }
    if (bgm.paused) {
      userPausedBgm = false;
      bgm.play().catch(() => {});
      if (onTrackChange) onTrackChange(currentTrack, true);
      return true;
    }
    userPausedBgm = true;
    bgm.pause();
    if (onTrackChange) onTrackChange(currentTrack, false);
    return false;
  }

  function ensureCtx() {
    if (!ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      ctx = new AudioCtx();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function throttled(key, minMs = 45) {
    const now = performance.now();
    const prev = lastPlayed.get(key) ?? 0;
    if (now - prev < minMs) return true;
    lastPlayed.set(key, now);
    return false;
  }

  function tone(freqStart, freqEnd, duration, { type = 'triangle', gain = 0.2, delay = 0 } = {}) {
    const ac = ensureCtx();
    if (!ac) return;
    const t0 = ac.currentTime + delay;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, t0);
    if (freqEnd !== freqStart) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + duration);
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain * sfxVolume, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(g);
    g.connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  function noise(duration, { filterFreq = 1200, filterType = 'bandpass', q = 1.5, gain = 0.2, delay = 0 } = {}) {
    const ac = ensureCtx();
    if (!ac) return;
    const t0 = ac.currentTime + delay;
    const len = Math.max(1, Math.floor(ac.sampleRate * duration));
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    const src = ac.createBufferSource();
    src.buffer = buf;

    const filter = ac.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(filterFreq, t0);
    filter.Q.setValueAtTime(q, t0);

    const g = ac.createGain();
    g.gain.setValueAtTime(gain * sfxVolume, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    src.connect(filter);
    filter.connect(g);
    g.connect(ac.destination);
    src.start(t0);
    src.stop(t0 + duration + 0.02);
  }

  function playEvent(ev) {
    if (!sfxEnabled) return;
    switch (ev.kind) {
      case 'attack': {
        if (ev.attack === 'ranged' && !throttled('ranged', 55)) {
          tone(860, 240, 0.09, { type: 'sawtooth', gain: 0.14 });
          tone(1320, 480, 0.06, { type: 'triangle', gain: 0.1 });
        }
        break;
      }
      case 'projectile_bounce': {
        if (!throttled('bounce', 50)) {
          tone(1480, 1980, 0.075, { type: 'sine', gain: 0.14 });
        }
        break;
      }
      case 'dash': {
        if (!throttled('dash', 70)) {
          noise(0.14, { filterFreq: 1600, filterType: 'bandpass', q: 1.2, gain: 0.22 });
          tone(320, 740, 0.11, { type: 'sine', gain: 0.11 });
        }
        break;
      }
      case 'area_spawn': {
        if (!throttled('frost_cast', 90)) {
          tone(680, 1180, 0.14, { type: 'sine', gain: 0.14 });
          tone(1020, 1540, 0.14, { type: 'triangle', gain: 0.09, delay: 0.04 });
        }
        break;
      }
      case 'area_explode': {
        if (!throttled('frost_boom', 90)) {
          noise(0.24, { filterFreq: 2600, filterType: 'highpass', q: 0.8, gain: 0.26 });
          tone(190, 48, 0.26, { type: 'triangle', gain: 0.3 });
        }
        break;
      }
      case 'repulse': {
        if (!throttled('repulse', 80)) {
          tone(210, 52, 0.22, { type: 'sawtooth', gain: 0.28 });
          noise(0.16, { filterFreq: 600, filterType: 'lowpass', q: 1.0, gain: 0.22 });
        }
        break;
      }
      case 'hit': {
        if (!throttled('hit', 45)) {
          tone(180, 62, 0.11, { type: 'triangle', gain: 0.24 });
          noise(0.08, { filterFreq: 1100, filterType: 'bandpass', q: 1.0, gain: 0.2 });
        }
        break;
      }
      case 'wall_slam': {
        if (!throttled('slam', 90)) {
          tone(140, 36, 0.3, { type: 'sawtooth', gain: 0.36 });
          noise(0.22, { filterFreq: 900, filterType: 'lowpass', q: 1.2, gain: 0.34 });
          tone(520, 260, 0.14, { type: 'square', gain: 0.14, delay: 0.02 });
        }
        break;
      }
      case 'pickup': {
        if (!throttled('pickup', 80)) {
          if (ev.pickup === 'power') {
            tone(440, 440, 0.09, { type: 'triangle', gain: 0.18, delay: 0.0 });
            tone(554, 554, 0.09, { type: 'triangle', gain: 0.18, delay: 0.06 });
            tone(659, 659, 0.09, { type: 'triangle', gain: 0.18, delay: 0.12 });
            tone(880, 880, 0.2, { type: 'triangle', gain: 0.22, delay: 0.18 });
          } else {
            tone(523, 523, 0.08, { type: 'sine', gain: 0.18, delay: 0.0 });
            tone(659, 659, 0.08, { type: 'sine', gain: 0.18, delay: 0.06 });
            tone(784, 784, 0.16, { type: 'sine', gain: 0.2, delay: 0.12 });
          }
        }
        break;
      }
      case 'zone_shrink': {
        if (!throttled('zone', 300)) {
          tone(310, 260, 0.18, { type: 'sawtooth', gain: 0.14 });
          tone(310, 260, 0.18, { type: 'sawtooth', gain: 0.12, delay: 0.22 });
        }
        break;
      }
      case 'death': {
        if (!throttled('ko', 300)) {
          tone(160, 32, 0.45, { type: 'sawtooth', gain: 0.38 });
          noise(0.38, { filterFreq: 800, filterType: 'lowpass', q: 0.8, gain: 0.34 });
          // Victory fanfare chime
          tone(523, 523, 0.11, { type: 'triangle', gain: 0.18, delay: 0.22 });
          tone(659, 659, 0.11, { type: 'triangle', gain: 0.18, delay: 0.33 });
          tone(784, 784, 0.11, { type: 'triangle', gain: 0.18, delay: 0.44 });
          tone(1046, 1046, 0.32, { type: 'triangle', gain: 0.24, delay: 0.55 });
        }
        break;
      }
    }
  }

  return {
    unlock: ensureCtx,
    playEvent,
    setSfxEnabled: (v) => { sfxEnabled = Boolean(v); },
    isSfxEnabled: () => sfxEnabled,
    setSfxVolume: (v) => { sfxVolume = Math.max(0, Math.min(1, Number(v))); },
    playRandomTrack,
    ensureBgmPlaying,
    toggleBgm,
    onTrackChange: (fn) => { onTrackChange = fn; },
    getCurrentTrack: () => currentTrack,
    isBgmPlaying: () => Boolean(currentTrack) && !bgm.paused,
    setBgmVolume: (v) => { bgmVolume = Math.max(0, Math.min(1, Number(v))); bgm.volume = bgmVolume; },
  };
}
