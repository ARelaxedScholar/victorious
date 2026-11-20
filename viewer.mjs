// GOATED 2.5D-in-3D Interactive Tournament Arena Renderer for Victris Match Runner.
// Combines a true 3D perspective coliseum (drag-to-orbit, scroll-to-zoom, Auto-Cam)
// with expressive billboarded 2.5D animated character sprites, 3D rising frost spikes,
// muzzle flashes, dynamic floor lighting, sight-radius & danger overlays, shout bubbles,
// timeline event markers, and gravity-driven 3D particle physics. Zero external deps.

const PALETTE = {
  bgTop: '#040812',
  bgBottom: '#0b142a',
  slabTop: '#0c1528',
  slabSideA: '#16223b',
  slabSideB: '#0d1629',
  floorA: '#101b33',
  floorB: '#14223e',
  floorLine: 'rgba(148, 163, 184, 0.085)',
  wallTop: '#475569',
  wallTopHi: '#64748b',
  wallLeft: '#26354d',
  wallRight: '#182336',
  zoneEdge: '#f87171',
  nextZoneEdge: '#fbbf24',
  health: '#22c55e',
  power: '#f59e0b',
  frost: '#38bdf8',
  frostBright: '#e0f2fe',
  p1: '#38bdf8',
  p1Dark: '#0369a1',
  p1Light: '#bae6fd',
  p2: '#fb7185',
  p2Dark: '#be123c',
  p2Light: '#fecdd3',
};

const BIOMES = {
  'arena-21': {
    bgTop: '#040812',
    bgBottom: '#0b142a',
    slabTop: '#0b1826',
    slabSideA: '#132436',
    slabSideB: '#0c1826',
    slabStroke: 'rgba(56, 189, 248, 0.55)',
    floorA: '#112232',
    floorB: '#15293b',
    floorLine: 'rgba(148, 197, 214, 0.09)',
    wallTop: '#475569',
    wallLeft: '#26354d',
    wallRight: '#182336',
    wallStroke: 'rgba(148, 163, 184, 0.4)',
    beaconA: '#38bdf8',
    beaconB: '#fb7185',
    moteColor: '125, 211, 252',
  },
  'columns-21': {
    bgTop: '#040e0b',
    bgBottom: '#0b1f19',
    slabTop: '#0b1e18',
    slabSideA: '#17332a',
    slabSideB: '#0d211b',
    slabStroke: 'rgba(52, 211, 153, 0.52)',
    floorA: '#112821',
    floorB: '#153229',
    floorLine: 'rgba(110, 231, 183, 0.09)',
    wallTop: '#78716c',
    wallLeft: '#57534e',
    wallRight: '#44403c',
    wallStroke: 'rgba(167, 243, 208, 0.34)',
    beaconA: '#34d399',
    beaconB: '#fbbf24',
    moteColor: '110, 231, 183',
  },
  'pillars-21': {
    bgTop: '#0f0608',
    bgBottom: '#210e12',
    slabTop: '#1c0f12',
    slabSideA: '#33191d',
    slabSideB: '#1f0e11',
    slabStroke: 'rgba(251, 146, 60, 0.58)',
    floorA: '#1f1417',
    floorB: '#28191d',
    floorLine: 'rgba(251, 146, 60, 0.1)',
    wallTop: '#52525b',
    wallLeft: '#3f3f46',
    wallRight: '#27272a',
    wallStroke: 'rgba(251, 146, 60, 0.48)',
    beaconA: '#fb923c',
    beaconB: '#f43f5e',
    moteColor: '251, 191, 36',
  },
};

function getBiome(mapName) {
  return BIOMES[mapName] || BIOMES['arena-21'];
}

function mergeById(listA = [], listB = []) {
  const map = new Map();
  for (const item of listA) map.set(item.id, item);
  for (const item of listB) map.set(item.id, item);
  return [...map.values()];
}

export function captureFrame(obs1, obs2) {
  const events = [];
  const seen = new Set();
  for (const ev of [...(obs1.events ?? []), ...(obs2.events ?? [])]) {
    const key = JSON.stringify(ev);
    if (!seen.has(key)) {
      seen.add(key);
      events.push(ev);
    }
  }
  const danger = [];
  const dSeen = new Set();
  for (const d of [...(obs1.danger ?? []), ...(obs2.danger ?? [])]) {
    const k = `${d.tile[0]},${d.tile[1]},${d.tick}`;
    if (!dSeen.has(k)) {
      dSeen.add(k);
      danger.push(d);
    }
  }
  return {
    tick: obs1.tick,
    fighters: [
      {
        id: 1,
        pos: obs1.self.pos,
        hp: obs1.self.hp,
        max_hp: obs1.self.max_hp,
        state: obs1.self.state,
        slow_ticks_left: obs1.self.slow_ticks_left ?? 0,
        buffs: obs1.self.buffs ?? {},
        cooldowns: obs1.self.cooldowns ?? {},
      },
      {
        id: 2,
        pos: obs2.self.pos,
        hp: obs2.self.hp,
        max_hp: obs2.self.max_hp,
        state: obs2.self.state,
        slow_ticks_left: obs2.self.slow_ticks_left ?? 0,
        buffs: obs2.self.buffs ?? {},
        cooldowns: obs2.self.cooldowns ?? {},
      },
    ],
    projectiles: mergeById(obs1.projectiles, obs2.projectiles),
    areas: mergeById(obs1.areas, obs2.areas),
    pickups: obs1.pickups ?? [],
    zone: obs1.zone,
    danger,
    events,
  };
}

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const POKEMON_ROSTER = {
  pikachu: {
    id: 25,
    color: '#facc15',
    fallback: 'fox',
    moves: { ranged: 'Thunderbolt', frostburst: 'Thunder', repulsor: 'Discharge', dash: 'Quick Attack' },
  },
  charizard: {
    id: 6,
    color: '#fb923c',
    fallback: 'dragon',
    moves: { ranged: 'Flamethrower', frostburst: 'Fire Blast', repulsor: 'Heat Wave', dash: 'Flame Charge' },
  },
  greninja: {
    id: 658,
    color: '#38bdf8',
    fallback: 'ninja',
    moves: { ranged: 'Water Shuriken', frostburst: 'Blizzard', repulsor: 'Surf', dash: 'Shadow Sneak' },
  },
  lucario: {
    id: 448,
    color: '#60a5fa',
    fallback: 'knight',
    moves: { ranged: 'Aura Sphere', frostburst: 'Ice Punch', repulsor: 'Force Palm', dash: 'Extreme Speed' },
  },
  gengar: {
    id: 94,
    color: '#c084fc',
    fallback: 'mage',
    moves: { ranged: 'Shadow Ball', frostburst: 'Icy Wind', repulsor: 'Dark Pulse', dash: 'Phantom Force' },
  },
  gardevoir: {
    id: 282,
    color: '#f472b6',
    fallback: 'mage',
    moves: { ranged: 'Moonblast', frostburst: 'Psyshock', repulsor: 'Psychic', dash: 'Teleport' },
  },
};

const spriteCache = new Map();
function getPokemonSprite(kind, variant = 'front') {
  const entry = POKEMON_ROSTER[kind];
  if (!entry) return null;
  const cacheKey = `${kind}:${variant}`;
  let img = spriteCache.get(cacheKey);
  if (!img && typeof Image !== 'undefined') {
    img = new Image();
    img.crossOrigin = 'anonymous';
    const sub = variant === 'back' ? 'back/' : variant === 'shiny' ? 'shiny/' : '';
    img.src = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${sub}${entry.id}.png`;
    spriteCache.set(cacheKey, img);
  }
  if (img && img.complete && img.naturalWidth > 0) return img;
  if (variant !== 'front') return getPokemonSprite(kind, 'front');
  return null;
}
for (const key of Object.keys(POKEMON_ROSTER)) {
  getPokemonSprite(key, 'front');
  getPokemonSprite(key, 'back');
  getPokemonSprite(key, 'shiny');
}

/** Draw a crisp billboarded 2.5D character (or action-reactive HD-2D Pokémon sprite) standing upright at (cx, cy). */
function drawCharacter(ctx, kind, cx, cy, r, teamColor, darkColor, lightColor, facingScreenX, now, isHit, bob, recoil, tilt = 0, pose = {}) {
  const flipX = facingScreenX < -0.15 ? -1 : 1;
  const poke = POKEMON_ROSTER[kind];
  const variant = pose.attacking || pose.powered ? 'shiny' : pose.facingAway ? 'back' : 'front';
  const sprite = poke ? getPokemonSprite(kind, variant) : null;
  if (sprite) {
    ctx.save();
    ctx.translate(cx, cy + bob);
    if (tilt) ctx.rotate(tilt);
    const dashStretch = pose.dashing ? 0.24 : 0;
    const atkCharge = pose.attacking ? 0.14 : 0;
    const sx = 1 + recoil * 0.18 + dashStretch + atkCharge;
    const sy = 1 - recoil * 0.12 - dashStretch * 0.45 + atkCharge * 0.5;
    // Front sprites face slightly left; back sprites face slightly right
    const dirSign = variant === 'back' ? flipX : -flipX;
    ctx.scale(dirSign * sx, sy);
    const size = r * 3.2;
    ctx.imageSmoothingEnabled = false;

    // Elemental charge flare behind the Pokémon when firing a move or dashing
    if (pose.attacking || pose.dashing) {
      ctx.save();
      ctx.globalAlpha = pose.attacking ? 0.45 : 0.3;
      const g = ctx.createRadialGradient(0, -size * 0.08, 2, 0, -size * 0.08, size * 0.52);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.4, poke.color || teamColor);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, -size * 0.08, size * 0.52, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.shadowColor = isHit ? '#ffffff' : (pose.altTint ? teamColor : (poke.color || teamColor));
    ctx.shadowBlur = isHit ? 18 : (pose.attacking ? 16 : 9);
    const filters = [];
    if (pose.altTint) filters.push('hue-rotate(155deg) saturate(1.25)');
    if (isHit) filters.push('brightness(2.8)');
    if (filters.length) ctx.filter = filters.join(' ');
    ctx.drawImage(sprite, -size / 2, -size * 0.56, size, size);
    ctx.restore();
    return;
  }
  if (poke) kind = poke.fallback;
  ctx.save();
  ctx.translate(cx, cy + bob);
  if (tilt) ctx.rotate(tilt);
  // Subtle squash-and-stretch on recoil or hop
  const sx = 1 + recoil * 0.14;
  const sy = 1 - recoil * 0.1;
  ctx.scale(flipX * sx, sy);

  const primary = isHit ? '#ffffff' : teamColor;
  const shade = isHit ? '#e2e8f0' : darkColor;
  const hi = isHit ? '#ffffff' : lightColor;

  if (kind === 'knight') {
    const capeWave = Math.sin(now / 130) * 2.8;
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.moveTo(-r * 0.48, -r * 0.12);
    ctx.lineTo(-r * 1.12, r * 0.76 + capeWave);
    ctx.lineTo(-r * 0.12, r * 0.68);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = primary;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.roundRect(-r * 0.62, -r * 0.08, r * 1.24, r * 0.84, r * 0.3);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = primary;
    ctx.beginPath();
    ctx.arc(-r * 0.62, r * 0.08, r * 0.28, 0, Math.PI * 2);
    ctx.arc(r * 0.62, r * 0.08, r * 0.28, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#334155';
    ctx.beginPath();
    ctx.arc(0, -r * 0.34, r * 0.58, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = hi;
    ctx.lineWidth = 1.3;
    ctx.stroke();

    ctx.fillStyle = hi;
    ctx.shadowColor = primary;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.roundRect(-r * 0.1, -r * 0.46, r * 0.64, r * 0.24, 3);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = primary;
    ctx.beginPath();
    ctx.moveTo(-r * 0.15, -r * 0.88);
    ctx.lineTo(r * 0.32, -r * 1.18);
    ctx.lineTo(r * 0.18, -r * 0.78);
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'fox') {
    const tailWag = Math.sin(now / 115) * 3.2;
    ctx.fillStyle = primary;
    ctx.beginPath();
    ctx.moveTo(-r * 0.38, r * 0.35);
    ctx.quadraticCurveTo(-r * 1.3, r * 0.1 + tailWag, -r * 0.96, -r * 0.4 + tailWag);
    ctx.quadraticCurveTo(-r * 0.65, r * 0.15, -r * 0.28, r * 0.55);
    ctx.fill();

    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.roundRect(-r * 0.52, -r * 0.05, r * 1.04, r * 0.8, r * 0.32);
    ctx.fill();
    ctx.fillStyle = hi;
    ctx.fillRect(-r * 0.48, -r * 0.04, r * 0.96, r * 0.22);

    ctx.fillStyle = primary;
    ctx.beginPath();
    ctx.moveTo(-r * 0.48, -r * 0.52);
    ctx.lineTo(-r * 0.64, -r * 1.18);
    ctx.lineTo(-r * 0.08, -r * 0.74);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(r * 0.08, -r * 0.74);
    ctx.lineTo(r * 0.64, -r * 1.18);
    ctx.lineTo(r * 0.48, -r * 0.52);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = primary;
    ctx.beginPath();
    ctx.arc(0, -r * 0.34, r * 0.56, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.arc(r * 0.12, -r * 0.18, r * 0.34, 0, Math.PI);
    ctx.fill();

    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.roundRect(-r * 0.15, -r * 0.52, r * 0.68, r * 0.28, 4);
    ctx.fill();
    ctx.fillStyle = '#fde047';
    ctx.shadowColor = '#fde047';
    ctx.shadowBlur = 8;
    ctx.fillRect(-r * 0.04, -r * 0.45, r * 0.22, r * 0.15);
    ctx.fillRect(r * 0.24, -r * 0.45, r * 0.22, r * 0.15);
    ctx.shadowBlur = 0;
  } else if (kind === 'mage') {
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.35);
    ctx.lineTo(r * 0.76, r * 0.8);
    ctx.lineTo(-r * 0.76, r * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = primary;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#090f1d';
    ctx.beginPath();
    ctx.arc(0, -r * 0.28, r * 0.48, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = hi;
    ctx.shadowColor = primary;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(r * 0.02, -r * 0.28, r * 0.11, 0, Math.PI * 2);
    ctx.arc(r * 0.28, -r * 0.28, r * 0.11, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = primary;
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.56, r * 0.88, r * 0.23, -0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-r * 0.52, -r * 0.58);
    ctx.lineTo(-r * 0.12, -r * 1.36);
    ctx.lineTo(r * 0.48, -r * 0.58);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fde047';
    ctx.fillRect(-r * 0.38, -r * 0.68, r * 0.74, r * 0.12);
  } else if (kind === 'mech') {
    ctx.strokeStyle = hi;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.75);
    ctx.lineTo(0, -r * 1.18);
    ctx.stroke();
    ctx.fillStyle = '#fde047';
    ctx.beginPath();
    ctx.arc(0, -r * 1.2, r * 0.14, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#334155';
    ctx.strokeStyle = primary;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-r * 0.72, -r * 0.72, r * 1.44, r * 1.4, r * 0.26);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = primary;
    ctx.beginPath();
    ctx.roundRect(-r * 0.55, r * 0.05, r * 1.1, r * 0.45, 4);
    ctx.fill();

    ctx.fillStyle = '#090f1d';
    ctx.beginPath();
    ctx.roundRect(-r * 0.48, -r * 0.52, r * 1.0, r * 0.4, 5);
    ctx.fill();
    ctx.fillStyle = hi;
    ctx.shadowColor = primary;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(r * 0.14, -r * 0.32, r * 0.17, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  } else if (kind === 'dragon') {
    const flap = Math.sin(now / 145) * 3.5;
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.moveTo(-r * 0.35, 0);
    ctx.lineTo(-r * 1.22, -r * 0.52 + flap);
    ctx.lineTo(-r * 0.94, r * 0.36 + flap);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = primary;
    ctx.beginPath();
    ctx.roundRect(-r * 0.55, -r * 0.05, r * 1.1, r * 0.82, r * 0.32);
    ctx.fill();
    ctx.fillStyle = '#fde68a';
    ctx.beginPath();
    ctx.roundRect(-r * 0.24, r * 0.1, r * 0.6, r * 0.55, r * 0.2);
    ctx.fill();

    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.moveTo(-r * 0.35, -r * 0.65);
    ctx.lineTo(-r * 0.68, -r * 1.22);
    ctx.lineTo(-r * 0.05, -r * 0.78);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(r * 0.05, -r * 0.78);
    ctx.lineTo(r * 0.48, -r * 1.18);
    ctx.lineTo(r * 0.38, -r * 0.65);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = primary;
    ctx.beginPath();
    ctx.arc(0, -r * 0.34, r * 0.56, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fef08a';
    ctx.shadowColor = '#f59e0b';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(r * 0.05, -r * 0.44);
    ctx.lineTo(r * 0.44, -r * 0.36);
    ctx.lineTo(r * 0.12, -r * 0.22);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
  } else {
    const bandWave = Math.sin(now / 110) * 3.2;
    ctx.strokeStyle = primary;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-r * 0.42, -r * 0.42);
    ctx.lineTo(-r * 1.14, -r * 0.52 + bandWave);
    ctx.moveTo(-r * 0.42, -r * 0.32);
    ctx.lineTo(-r * 1.04, -r * 0.15 - bandWave);
    ctx.stroke();

    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = primary;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.roundRect(-r * 0.54, -r * 0.06, r * 1.08, r * 0.82, r * 0.3);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = primary;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-r * 0.42, 0);
    ctx.lineTo(r * 0.42, r * 0.68);
    ctx.stroke();

    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(0, -r * 0.34, r * 0.56, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = primary;
    ctx.fillRect(-r * 0.54, -r * 0.55, r * 1.08, r * 0.18);
    ctx.fillStyle = hi;
    ctx.shadowColor = primary;
    ctx.shadowBlur = 9;
    ctx.fillRect(0, -r * 0.36, r * 0.16, r * 0.11);
    ctx.fillRect(r * 0.24, -r * 0.36, r * 0.16, r * 0.11);
    ctx.shadowBlur = 0;
  }

  ctx.restore();
}

export function createArenaViewer(canvas, hudEls, { onEvent } = {}) {
  const ctx = canvas.getContext('2d');
  const W = 780;
  const H = 580;

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(W, Math.round(rect.width || W));
    const cssH = Math.max(H, Math.round(rect.height || H));
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const targetW = Math.min(3840, Math.round(cssW * dpr));
    const targetH = Math.min(2860, Math.round(cssH * dpr));
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  }
  resizeCanvas();
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(resizeCanvas).observe(canvas);
  }
  window.addEventListener('resize', resizeCanvas);
  document.addEventListener('fullscreenchange', () => setTimeout(resizeCanvas, 50));

  // Interactive camera & overlay state
  let mode3D = true; // true = 3D Coliseum with 2.5D sprites, false = 2.5D Flat Top-Down
  let autoCam = false;
  let showSight = false;
  let showDanger = false;

  let camYaw = 0.66;
  let targetYaw = 0.66;
  let camTilt = 0.55;
  let targetTilt = 0.55;
  let camZoom = 1.0;
  let targetZoom = 1.0;
  let camFocusX = 10.5;
  let camFocusY = 10.5;

  // Mouse drag-to-orbit & wheel zoom right on the canvas!
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  canvas.style.cursor = 'grab';
  canvas.addEventListener('pointerdown', (e) => {
    if (!mode3D) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture?.(e.pointerId);
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    targetYaw += dx * 0.0075;
    targetTilt = clamp(targetTilt + dy * 0.003, 0.34, 0.85);
  });
  const endDrag = () => {
    dragging = false;
    canvas.style.cursor = mode3D ? 'grab' : 'default';
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    targetZoom = clamp(targetZoom * (e.deltaY > 0 ? 0.92 : 1.08), 0.72, 1.85);
  }, { passive: false });

  // Ambient floating arena motes (subtle atmosphere)
  const motes = Array.from({ length: 24 }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    r: 0.8 + Math.random() * 1.4,
    vy: -0.12 - Math.random() * 0.25,
    a: 0.15 + Math.random() * 0.35,
  }));

  let meta = {
    map: [],
    mapName: '',
    seed: 0,
    names: ['Team A', 'Team B'],
    avatars: ['knight', 'fox'],
    sightRadius: 8,
    maxTicks: 600,
  };

  let prevFrame = null;
  let currFrame = null;
  let frameStartTime = performance.now();
  let tickDurationMs = 50;
  let banner = '';
  let bannerSince = 0;
  let vsUntil = 0;
  let vsStart = 0;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let lastEventTick = -1;

  // VFX pools
  const particles = [];
  const rings = [];
  const trails = [];
  const spikes = [];
  const flashes = [];
  const attackArcs = [];
  const popups = [];
  const shouts = [];
  const feedItems = [];
  const facing = { 1: 0, 2: Math.PI };
  const hitDirection = new Map();
  const hitFlash = { 1: 0, 2: 0 };
  const recoil = { 1: 0, 2: 0 };
  let shakeMag = 0;
  let zoomPunch = 0;
  let hitStopUntil = 0;

  function makeProjector(cols, rows) {
    const cx = autoCam ? camFocusX : cols / 2;
    const cy = autoCam ? camFocusY : rows / 2;
    if (!mode3D) {
      const cell = Math.min((W - 44) / cols, (H - 36) / rows) * camZoom;
      const ox = W / 2 - cx * cell;
      const oy = H / 2 - cy * cell;
      return {
        is3D: false,
        tiltY: 1,
        project: (gx, gy, gz = 0) => ({
          x: ox + gx * cell,
          y: oy + gy * cell - gz * cell * 0.45,
          s: cell,
          depth: gy,
        }),
      };
    }
    const cosA = Math.cos(camYaw);
    const sinA = Math.sin(camYaw);
    const tileScale = 24.4 * camZoom;
    const heightScale = 28.5 * camZoom;
    const ox = W / 2;
    const oy = H * 0.49;
    return {
      is3D: true,
      tiltY: camTilt,
      cosA,
      sinA,
      project: (gx, gy, gz = 0) => {
        const dx = gx - cx;
        const dy = gy - cy;
        const rx = dx * cosA - dy * sinA;
        const ry = dx * sinA + dy * cosA;
        const persp = 1 / (1 - clamp(ry * 0.014, -0.35, 0.42));
        return {
          x: ox + rx * tileScale * persp,
          y: oy + ry * tileScale * camTilt * persp - gz * heightScale * persp,
          s: tileScale * persp,
          depth: ry,
        };
      },
    };
  }

  function poly(pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
  }

  function drawTileQuad(proj, x, y, z = 0) {
    poly([
      proj.project(x, y, z),
      proj.project(x + 1, y, z),
      proj.project(x + 1, y + 1, z),
      proj.project(x, y + 1, z),
    ]);
  }

  function draw3DBox(proj, x0, y0, x1, y1, z0, z1, colors) {
    const b00 = proj.project(x0, y0, z0);
    const b10 = proj.project(x1, y0, z0);
    const b11 = proj.project(x1, y1, z0);
    const b01 = proj.project(x0, y1, z0);
    const t00 = proj.project(x0, y0, z1);
    const t10 = proj.project(x1, y0, z1);
    const t11 = proj.project(x1, y1, z1);
    const t01 = proj.project(x0, y1, z1);

    if (!proj.is3D) {
      // 2.5D top-down extruded front face + lifted cap
      poly([b01, b11, t11, t01]);
      ctx.fillStyle = colors.sideA;
      ctx.fill();
      poly([t00, t10, t11, t01]);
      ctx.fillStyle = colors.top;
      ctx.fill();
      ctx.strokeStyle = colors.stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
      return;
    }

    const faces = [
      { pts: [b00, b10, t10, t00], d: (b00.depth + b10.depth) / 2, fill: colors.sideA },
      { pts: [b10, b11, t11, t10], d: (b10.depth + b11.depth) / 2, fill: colors.sideB },
      { pts: [b11, b01, t01, t11], d: (b11.depth + b01.depth) / 2, fill: colors.sideA },
      { pts: [b01, b00, t00, t01], d: (b01.depth + b00.depth) / 2, fill: colors.sideB },
    ];
    faces.sort((a, b) => a.d - b.d);
    for (let i = 2; i < 4; i++) {
      poly(faces[i].pts);
      ctx.fillStyle = faces[i].fill;
      ctx.fill();
      ctx.strokeStyle = 'rgba(2, 6, 23, 0.55)';
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }
    poly([t00, t10, t11, t01]);
    ctx.fillStyle = colors.top;
    ctx.fill();
    ctx.strokeStyle = colors.stroke;
    ctx.lineWidth = 1.1;
    ctx.stroke();
  }

const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function pushFeed(text, accent = '#94a3b8') {
    feedItems.unshift({ text, accent });
    if (feedItems.length > 5) feedItems.pop();
    if (hudEls.feed) {
      hudEls.feed.innerHTML = feedItems
        .map((it) => `<span class="feed-chip" style="border-color:${it.accent}55;color:${it.accent}">${escHtml(it.text)}</span>`)
        .join('');
    }
  }

  function spawnBurst3D(gx, gy, gz, color, count = 14, speed = 0.15, upBoost = 0.16, size = 3.2) {
    if (particles.length > 140) particles.splice(0, count);
    for (let i = 0; i < count; i++) {
      const a = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.6;
      const sp = speed * (0.4 + Math.random() * 0.9);
      particles.push({
        x: gx, y: gy, z: gz,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        vz: upBoost * (0.4 + Math.random() * 0.95),
        life: 1,
        decay: 0.025 + Math.random() * 0.022,
        color,
        size: size * (0.65 + Math.random() * 0.7),
      });
    }
  }

  function spawnRing3D(gx, gy, gz, color, maxRadius, lineWidth = 3.5, decay = 0.048) {
    rings.push({ x: gx, y: gy, z: gz, r: 0.2, maxR: maxRadius, color, lineWidth, life: 1, decay });
  }

  function spawnPopup3D(gx, gy, gz, text, color, scale = 1) {
    popups.push({ x: gx, y: gy, z: gz, text, color, life: 1, scale });
  }

  function processEvents(frame, silent = false) {
    if (!frame || frame.tick === lastEventTick) return;
    lastEventTick = frame.tick;
    const fMap = new Map(frame.fighters.map((f) => [f.id, f]));
    const pokeOf = (id) => POKEMON_ROSTER[meta.avatars?.[id - 1]];
    const colorOf = (id) => pokeOf(id)?.color || (id === 1 ? PALETTE.p1 : PALETTE.p2);
    const moveNameOf = (id, attack) => pokeOf(id)?.moves?.[attack] || attack;
    const nameOf = (id) => meta.names[id - 1] || `Seat ${id}`;

    for (const ev of frame.events ?? []) {
      if (!silent && onEvent) onEvent(ev);
      switch (ev.kind) {
        case 'attack': {
          const f = fMap.get(ev.fighter);
          if (f) {
            recoil[ev.fighter] = 1;
            if (ev.target) {
              facing[ev.fighter] = Math.atan2(ev.target[1] - f.pos[1], ev.target[0] - f.pos[0]);
              // Triangle Strategy style glowing targeting arc!
              attackArcs.push({
                from: [f.pos[0] + 0.5, f.pos[1] + 0.5],
                to: [ev.target[0] + 0.5, ev.target[1] + 0.5],
                color: ev.attack === 'frostburst' ? PALETTE.frostBright : colorOf(ev.fighter),
                peakZ: ev.attack === 'frostburst' ? 2.6 : 1.05,
                life: 1,
                decay: ev.attack === 'frostburst' ? 0.032 : 0.075,
              });
            }
            if (ev.attack === 'ranged') {
              flashes.push({
                x: f.pos[0] + 0.5 + Math.cos(facing[ev.fighter]) * 0.5,
                y: f.pos[1] + 0.5 + Math.sin(facing[ev.fighter]) * 0.5,
                z: 0.62,
                color: colorOf(ev.fighter),
                life: 1,
              });
            } else if (ev.attack === 'frostburst' && pokeOf(ev.fighter)) {
              const mv = moveNameOf(ev.fighter, 'frostburst');
              spawnPopup3D(f.pos[0] + 0.5, f.pos[1] + 0.5, 2.0, `${mv}!`, colorOf(ev.fighter), 0.95);
            }
          }
          break;
        }
        case 'shout': {
          const f = fMap.get(ev.fighter);
          if (f && ev.text) {
            shouts.push({ fighter: ev.fighter, text: String(ev.text).slice(0, 40), life: 1 });
          }
          break;
        }
        case 'dash': {
          if (ev.from && ev.to) {
            trails.push({ from: ev.from, to: ev.to, color: colorOf(ev.fighter), fighter: ev.fighter, life: 1, kind: 'dash' });
            facing[ev.fighter] = Math.atan2(ev.to[1] - ev.from[1], ev.to[0] - ev.from[0]);
          }
          break;
        }
        case 'knockback': {
          if (ev.from && ev.to) {
            trails.push({ from: ev.from, to: ev.to, color: '#facc15', life: 1, kind: 'knockback' });
          }
          break;
        }
        case 'projectile_bounce': {
          if (ev.pos) {
            spawnBurst3D(ev.pos[0] + 0.5, ev.pos[1] + 0.5, 0.65, colorOf(ev.owner), 9, 0.13, 0.12, 2.5);
            spawnRing3D(ev.pos[0] + 0.5, ev.pos[1] + 0.5, 0.65, '#e2e8f0', 0.9, 2, 0.08);
          }
          break;
        }
        case 'hit': {
          const t = fMap.get(ev.target);
          if (t) {
            const origin = fMap.get(ev.attacker)?.pos;
            if (origin) {
              const dx = t.pos[0] - origin[0], dy = t.pos[1] - origin[1];
              const distance = Math.hypot(dx, dy) || 1;
              hitDirection.set(t.id, [dx / distance, dy / distance]);
            }
            hitFlash[ev.target] = 1;
            const col = ev.attack === 'frostburst' ? PALETTE.frostBright : colorOf(ev.attacker);
            spawnBurst3D(t.pos[0] + 0.5, t.pos[1] + 0.5, 0.7, col, 16, 0.16, 0.18, 3.3);
            spawnPopup3D(t.pos[0] + 0.5, t.pos[1] + 0.5, 1.7, `-${ev.damage}`, '#fda4af', 1.05);
            shakeMag = Math.max(shakeMag, ev.damage >= 14 ? 5.5 : 2.8);
            if (ev.attack === 'frostburst') {
              zoomPunch = Math.max(zoomPunch, 0.06);
              if (!silent) hitStopUntil = Math.max(hitStopUntil, performance.now() + 55);
              const mv = moveNameOf(ev.attacker, 'frostburst');
              pushFeed(`t${frame.tick} ❄ ${nameOf(ev.attacker)} used ${mv}! (-${ev.damage})`, colorOf(ev.attacker));
            }
          }
          break;
        }
        case 'wall_slam': {
          const t = fMap.get(ev.target);
          if (t) {
            hitFlash[ev.target] = 1;
            spawnBurst3D(t.pos[0] + 0.5, t.pos[1] + 0.5, 0.8, '#facc15', 28, 0.21, 0.25, 3.9);
            spawnRing3D(t.pos[0] + 0.5, t.pos[1] + 0.5, 0.5, '#facc15', 2.3, 4.5, 0.042);
            const label = pokeOf(ev.attacker) ? `SUPER EFFECTIVE -${ev.damage}!` : `SLAM -${ev.damage}!`;
            spawnPopup3D(t.pos[0] + 0.5, t.pos[1] + 0.5, 2.1, label, '#fde047', 1.25);
            shakeMag = Math.max(shakeMag, 10);
            zoomPunch = Math.max(zoomPunch, 0.09);
            if (!silent) hitStopUntil = Math.max(hitStopUntil, performance.now() + 75);
            const mv = moveNameOf(ev.attacker, 'repulsor');
            pushFeed(`t${frame.tick} 💥 ${nameOf(ev.attacker)}'s ${mv} wall-slammed ${nameOf(ev.target)} (-${ev.damage})`, '#facc15');
          }
          break;
        }
        case 'repulse': {
          if (ev.pos) {
            const ownerKind = meta.avatars?.[ev.owner - 1];
            const col = colorOf(ev.owner);
            const cx = ev.pos[0] + 0.5, cy = ev.pos[1] + 0.5;
            // Multi-ring anime signature burst for every Pokémon!
            spawnRing3D(cx, cy, 0.55, col, 2.35, 5, 0.05);
            spawnRing3D(cx, cy, 0.25, '#ffffff', 1.75, 3, 0.065);
            if (ownerKind === 'lucario' || ownerKind === 'gardevoir') {
              spawnRing3D(cx, cy, 0.9, col, 2.6, 3.5, 0.042);
            } else if (ownerKind === 'gengar') {
              spawnRing3D(cx, cy, 0.4, '#1e1033', 2.45, 7, 0.045);
              spawnRing3D(cx, cy, 0.45, '#c084fc', 2.45, 3, 0.045);
            } else if (ownerKind === 'greninja') {
              spawnRing3D(cx, cy, 0.18, '#e0f2fe', 2.5, 4.5, 0.045);
            } else if (ownerKind === 'pikachu') {
              spikes.push({ x: cx, y: cy, h: 2.2, life: 1, color: '#fde047', style: 'discharge' });
            }
            spawnBurst3D(cx, cy, 0.55, col, 22, 0.2, 0.16, 3.2);
            shakeMag = Math.max(shakeMag, 4.5);
            if (pokeOf(ev.owner)) {
              spawnPopup3D(cx, cy, 1.95, `${moveNameOf(ev.owner, 'repulsor')}!`, col, 1.0);
            }
          }
          break;
        }
        case 'area_explode': {
          if (ev.pos) {
            const ownerKind = meta.avatars?.[ev.owner - 1];
            const col = pokeOf(ev.owner)?.color || PALETTE.frost;
            const cx = ev.pos[0] + 0.5, cy = ev.pos[1] + 0.5;
            spawnRing3D(cx, cy, 0.2, col, 2.6, 5, 0.045);
            spawnRing3D(cx, cy, 0.45, '#ffffff', 1.9, 3, 0.06);
            spawnBurst3D(cx, cy, 0.25, col, 30, 0.2, 0.3, 3.8);

            // Signature anime sky-strike / vortex / star spectacle per Pokémon!
            if (ownerKind === 'pikachu') {
              spikes.push({ x: cx, y: cy, h: 7.8, life: 1, color: '#fde047', style: 'lightning' });
              spikes.push({ x: cx - 0.6, y: cy + 0.4, h: 6.5, life: 0.9, color: '#fef08a', style: 'lightning' });
              spikes.push({ x: cx + 0.6, y: cy - 0.3, h: 6.5, life: 0.9, color: '#bae6fd', style: 'lightning' });
            } else if (ownerKind === 'charizard') {
              spikes.push({ x: cx, y: cy, h: 2.6, life: 1, color: '#f97316', style: 'fireblast' });
            } else if (ownerKind === 'greninja') {
              spikes.push({ x: cx, y: cy, h: 4.8, life: 1, color: '#7dd3fc', style: 'blizzard' });
            } else if (ownerKind === 'lucario') {
              spikes.push({ x: cx, y: cy, h: 6.5, life: 1, color: '#60a5fa', style: 'aurameteor' });
            } else if (ownerKind === 'gengar') {
              spikes.push({ x: cx, y: cy, h: 4.6, life: 1, color: '#a855f7', style: 'voidvortex' });
            } else if (ownerKind === 'gardevoir') {
              spikes.push({ x: cx, y: cy, h: 7.5, life: 1, color: '#f472b6', style: 'moonbeam' });
            }

            for (const [tx, ty] of ev.tiles ?? [ev.pos]) {
              spikes.push({
                x: tx + 0.5,
                y: ty + 0.5,
                h: (ownerKind === 'charizard' ? 1.65 : 1.1) + Math.random() * 0.9,
                life: 1,
                color: ownerKind ? col : PALETTE.frostBright,
                style: 'spire',
              });
            }
            shakeMag = Math.max(shakeMag, 6.5);
          }
          break;
        }
        case 'pickup': {
          if (ev.pos) {
            const isPower = ev.pickup === 'power';
            const col = isPower ? PALETTE.power : PALETTE.health;
            spawnRing3D(ev.pos[0] + 0.5, ev.pos[1] + 0.5, 0.4, col, 1.8, 3.5, 0.05);
            spawnBurst3D(ev.pos[0] + 0.5, ev.pos[1] + 0.5, 0.5, col, 14, 0.14, 0.22, 3.1);
            spawnPopup3D(ev.pos[0] + 0.5, ev.pos[1] + 0.5, 1.75, isPower ? '⚡ POWER!' : '+32 HP', col, 1.15);
            pushFeed(
              `t${frame.tick} ${isPower ? '⚡' : '✚'} ${nameOf(ev.fighter)} grabbed ${isPower ? 'Power' : 'Health'}`,
              col,
            );
          }
          break;
        }
        case 'zone_damage': {
          const f = fMap.get(ev.fighter);
          if (f) {
            spawnPopup3D(f.pos[0] + 0.5, f.pos[1] + 0.5, 1.6, `-${ev.damage}`, '#f87171', 0.95);
            hitFlash[ev.fighter] = Math.max(hitFlash[ev.fighter], 0.6);
          }
          break;
        }
        case 'zone_shrink': {
          pushFeed(`t${frame.tick} ⚠ Zone shrank to radius ${ev.radius}`, '#f87171');
          break;
        }
      }
    }

    if (prevFrame) {
      frame.fighters.forEach((f, idx) => {
        const prev = prevFrame.fighters[idx];
        if (prev && prev.hp > 0 && f.hp <= 0) {
          spawnBurst3D(f.pos[0] + 0.5, f.pos[1] + 0.5, 0.6, colorOf(f.id), 44, 0.25, 0.34, 4.5);
          spawnBurst3D(f.pos[0] + 0.5, f.pos[1] + 0.5, 0.7, '#ffffff', 20, 0.19, 0.28, 3.2);
          spawnRing3D(f.pos[0] + 0.5, f.pos[1] + 0.5, 0.4, colorOf(f.id), 3.8, 5.5, 0.03);
          shakeMag = 14;
          pushFeed(`t${frame.tick} 🏆 ${nameOf(f.id)} eliminated!`, '#fbbf24');
        }
      });
    }
  }

  function renderPills(el, f) {
    if (!el) return;
    const cd = f.cooldowns ?? {};
    const skills = [
      ['SHOT', cd.ranged ?? 0],
      ['FROST', cd.frostburst ?? 0],
      ['PUSH', cd.repulsor ?? 0],
      ['DASH', cd.dash ?? 0],
    ];
    const badges = [];
    if ((f.buffs?.power ?? 0) > 0) badges.push(`<span class="pill pill-power">⚡PWR ${f.buffs.power}</span>`);
    if (f.state === 'stunned') badges.push(`<span class="pill pill-stun">STUN</span>`);
    else if (f.slow_ticks_left > 0) badges.push(`<span class="pill pill-slow">SLOW</span>`);
    for (const [label, rem] of skills) {
      badges.push(rem === 0
        ? `<span class="pill pill-ready">${label}</span>`
        : `<span class="pill pill-cd">${label} ${rem}</span>`);
    }
    el.innerHTML = badges.join('');
  }

  function updateHud(frame) {
    const [f1, f2] = frame.fighters;
    const p1Pct = `${clamp((f1.hp / f1.max_hp) * 100, 0, 100)}%`;
    const p2Pct = `${clamp((f2.hp / f2.max_hp) * 100, 0, 100)}%`;
    if (hudEls.p1HpText) hudEls.p1HpText.textContent = `${Math.max(0, f1.hp)} / ${f1.max_hp}`;
    if (hudEls.p2HpText) hudEls.p2HpText.textContent = `${Math.max(0, f2.hp)} / ${f2.max_hp}`;
    if (hudEls.p1HpBar) hudEls.p1HpBar.style.width = p1Pct;
    if (hudEls.p2HpBar) hudEls.p2HpBar.style.width = p2Pct;
    if (hudEls.p1HpTrail) hudEls.p1HpTrail.style.width = p1Pct;
    if (hudEls.p2HpTrail) hudEls.p2HpTrail.style.width = p2Pct;
    renderPills(hudEls.p1Status, f1);
    renderPills(hudEls.p2Status, f2);
    if (hudEls.tickInfo) {
      const z = frame.zone;
      const zoneText = z?.shrinks_in != null
        ? ` · ⚠ Zone shrinks in ${z.shrinks_in}`
        : ` · Zone r=${z?.radius ?? '?'}`;
      hudEls.tickInfo.textContent = `Tick ${frame.tick} / ${meta.maxTicks}${zoneText}`;
    }
  }

  function drawScene(now) {
    requestAnimationFrame(drawScene);

    // Guarantee clean canvas state every frame (immune to any partial-frame leak)
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.filter = 'none';
    ctx.setLineDash([]);

    // Smooth camera interpolation + optional Auto-Cam tracking
    if (autoCam && currFrame) {
      const alive = currFrame.fighters.filter((f) => f.hp > 0);
      if (alive.length === 2) {
        const mx = (alive[0].pos[0] + alive[1].pos[0]) / 2 + 0.5;
        const my = (alive[0].pos[1] + alive[1].pos[1]) / 2 + 0.5;
        const dist = Math.hypot(alive[0].pos[0] - alive[1].pos[0], alive[0].pos[1] - alive[1].pos[1]);
        camFocusX = lerp(camFocusX, mx, 0.06);
        camFocusY = lerp(camFocusY, my, 0.06);
        targetZoom = clamp(1.38 - dist * 0.025, 0.96, 1.32);
      } else {
        camFocusX = lerp(camFocusX, 10.5, 0.05);
        camFocusY = lerp(camFocusY, 10.5, 0.05);
      }
    }
    camYaw = lerp(camYaw, targetYaw, 0.14);
    camTilt = lerp(camTilt, targetTilt, 0.14);
    camZoom = lerp(camZoom, targetZoom + zoomPunch, 0.16);
    zoomPunch *= 0.86;
    if (zoomPunch < 0.002) zoomPunch = 0;

    // Deep atmospheric backdrop + ambient floating motes (biome-themed!)
    const biome = getBiome(meta.mapName);
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, biome.bgTop);
    bg.addColorStop(1, biome.bgBottom);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    for (const m of motes) {
      m.y += m.vy;
      if (m.y < -4) { m.y = H + 4; m.x = Math.random() * W; }
      ctx.fillStyle = `rgba(${biome.moteColor}, ${m.a})`;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    if (!currFrame || !meta.map.length) return;

    const rows = meta.map.length;
    const cols = meta.map[0].length;
    const proj = makeProjector(cols, rows);
    const inHitStop = now < hitStopUntil;
    const alpha = inHitStop ? 0.92 : (tickDurationMs > 0 ? clamp((now - frameStartTime) / tickDurationMs, 0, 1) : 1);

    ctx.save();
    if (shakeMag > 0.2) {
      ctx.translate((Math.random() - 0.5) * shakeMag, (Math.random() - 0.5) * shakeMag);
      shakeMag *= 0.84;
    } else {
      shakeMag = 0;
    }

    // 1. Floating 3D Pokémon Stadium Coliseum Platform Slab with Corner Floodlights
    if (proj.is3D) {
      draw3DBox(proj, -0.5, -0.5, cols + 0.5, rows + 0.5, -1.15, 0, {
        top: biome.slabTop,
        sideA: biome.slabSideA,
        sideB: biome.slabSideB,
        stroke: biome.slabStroke,
      });
      // Corner stadium floodlight pylons + sweeping light beams
      const corners = [[-0.28, -0.28], [cols + 0.28, -0.28], [cols + 0.28, rows + 0.28], [-0.28, rows + 0.28]];
      corners.forEach(([bx, by], ci) => {
        const bp = proj.project(bx, by, 0.22);
        const mid = proj.project(cols / 2, rows / 2, 0.05);
        const bc = ci % 2 === 0 ? biome.beaconA : biome.beaconB;
        ctx.save();
        const beam = ctx.createLinearGradient(bp.x, bp.y, mid.x, mid.y);
        beam.addColorStop(0, `${bc}29`);
        beam.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.strokeStyle = beam;
        ctx.lineWidth = 22;
        ctx.beginPath();
        ctx.moveTo(bp.x, bp.y);
        ctx.lineTo(lerp(bp.x, mid.x, 0.55), lerp(bp.y, mid.y, 0.55));
        ctx.stroke();

        ctx.fillStyle = bc;
        ctx.shadowColor = bc;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(bp.x, bp.y, 3.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });
    }

    // 2. Stadium Battle Court Turf + Danger Zone Tint
    const zone = currFrame.zone;
    const [zcx, zcy] = zone ? zone.center : [10, 10];
    const zRad = zone ? zone.radius : 99;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        drawTileQuad(proj, x, y, 0);
        const outside = Math.max(Math.abs(x - zcx), Math.abs(y - zcy)) > zRad;
        ctx.fillStyle = outside
          ? '#261120'
          : (x + y) % 2 === 0 ? biome.floorA : biome.floorB;
        ctx.fill();
        ctx.strokeStyle = outside ? 'rgba(248, 113, 113, 0.16)' : biome.floorLine;
        ctx.lineWidth = 0.75;
        ctx.stroke();
      }
    }

    // Pokémon Stadium Court Sidelines & Center Pokéball Emblem!
    {
      const c = proj.project(cols / 2, rows / 2, 0.015);
      const rOuter = c.s * 3.1;
      const rInner = c.s * 0.92;
      ctx.save();
      // Court outer boundary line
      poly([
        proj.project(0.5, 0.5, 0.012),
        proj.project(cols - 0.5, 0.5, 0.012),
        proj.project(cols - 0.5, rows - 0.5, 0.012),
        proj.project(0.5, rows - 0.5, 0.012),
      ]);
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.2)';
      ctx.lineWidth = 1.6;
      ctx.stroke();

      // Center dividing line
      const mL = proj.project(0.5, rows / 2, 0.013);
      const mR = proj.project(cols - 0.5, rows / 2, 0.013);
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.18)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(mL.x, mL.y);
      ctx.lineTo(mR.x, mR.y);
      ctx.stroke();

      // Pokéball center emblem (soft crimson top half + crisp white bottom half)
      ctx.fillStyle = 'rgba(239, 68, 68, 0.18)';
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, rOuter, rOuter * proj.tiltY, 0, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(248, 250, 252, 0.1)';
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, rOuter, rOuter * proj.tiltY, 0, 0, Math.PI);
      ctx.fill();
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.34)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, rOuter, rOuter * proj.tiltY, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#112232';
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, rInner, rInner * proj.tiltY, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.45)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }

    // Optional Sight-Radius Tactical Overlay (8-tile vision rings!)
    if (showSight) {
      const sr = meta.sightRadius || 8;
      currFrame.fighters.forEach((f, idx) => {
        if (f.hp <= 0) return;
        const pf = prevFrame?.fighters[idx];
        const gx = (pf ? lerp(pf.pos[0], f.pos[0], alpha) : f.pos[0]) + 0.5;
        const gy = (pf ? lerp(pf.pos[1], f.pos[1], alpha) : f.pos[1]) + 0.5;
        const p = proj.project(gx, gy, 0.03);
        const col = idx === 0 ? PALETTE.p1 : PALETTE.p2;
        ctx.save();
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.42;
        ctx.setLineDash([6, 5]);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.s * sr, p.s * sr * proj.tiltY, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.05;
        ctx.fill();
        ctx.restore();
      });
    }

    // Optional Danger-Tile Overlay (predicted incoming hit tiles!)
    if (showDanger && currFrame.danger?.length) {
      ctx.save();
      for (const d of currFrame.danger) {
        const dt = d.tick - currFrame.tick;
        if (dt < 0 || dt > 5) continue;
        drawTileQuad(proj, d.tile[0] + 0.08, d.tile[1] + 0.08, 0.025);
        ctx.fillStyle = dt <= 1 ? 'rgba(251, 191, 36, 0.34)' : 'rgba(251, 191, 36, 0.15)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.6)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.restore();
    }

    // Next-zone animated warning perimeter
    if (zone && zone.shrinks_in != null && zone.next_radius != null) {
      const nr = zone.next_radius;
      const x0 = zcx - nr, y0 = zcy - nr, x1 = zcx + nr + 1, y1 = zcy + nr + 1;
      ctx.save();
      poly([
        proj.project(x0, y0, 0.04),
        proj.project(x1, y0, 0.04),
        proj.project(x1, y1, 0.04),
        proj.project(x0, y1, 0.04),
      ]);
      ctx.setLineDash([8, 6]);
      ctx.lineDashOffset = -(now / 35);
      ctx.strokeStyle = PALETTE.nextZoneEdge;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }

    // 3. Frostburst 3x3 Icy Floor Tiles
    for (const area of currFrame.areas) {
      const ticksLeft = area.ticks_left ?? Math.max(0, area.explodes_tick - currFrame.tick + 1);
      const urgent = ticksLeft <= 2;
      const pulse = urgent ? 0.44 + 0.22 * Math.sin(now / 55) : 0.24;
      for (const [tx, ty] of area.tiles ?? []) {
        drawTileQuad(proj, tx + 0.05, ty + 0.05, 0.03);
        ctx.fillStyle = `rgba(56, 189, 248, ${pulse})`;
        ctx.fill();
        ctx.strokeStyle = urgent ? '#e0f2fe' : '#7dd3fc';
        ctx.lineWidth = urgent ? 1.6 : 1;
        ctx.stroke();
      }
      if (area.pos) {
        const p = proj.project(area.pos[0] + 0.5, area.pos[1] + 0.5, 0.5);
        ctx.save();
        // Six inward-moving teeth follow the fuse; their footprint stays on the arena floor.
        const fuse = Math.max(0, ticksLeft - alpha);
        const radius = 0.32 + Math.min(1.2, fuse * 0.22);
        const cx = area.pos[0] + 0.5, cy = area.pos[1] + 0.5;
        ctx.strokeStyle = '#ddf8ff';
        ctx.lineWidth = 2;
        for (let n = 0; n < 6; n++) {
          const angle = n * Math.PI / 3;
          const point = (r, a) => proj.project(cx + r * Math.cos(a), cy + r * Math.sin(a), 0.08);
          const left = point(radius + 0.26, angle - 0.12);
          const tip = point(radius, angle);
          const right = point(radius + 0.26, angle + 0.12);
          ctx.beginPath();
          ctx.moveTo(left.x, left.y);
          ctx.lineTo(tip.x, tip.y);
          ctx.lineTo(right.x, right.y);
          ctx.stroke();
        }
        ctx.fillStyle = '#f0f9ff';
        ctx.shadowColor = PALETTE.frost;
        ctx.shadowBlur = 10;
        ctx.font = '800 13px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(ticksLeft), p.x, p.y);
        ctx.restore();
      }
    }

    // 4. Dash & Knockback Volumetric Trails
    for (let i = trails.length - 1; i >= 0; i--) {
      const tr = trails[i];
      const a = proj.project(tr.from[0] + 0.5, tr.from[1] + 0.5, 0.48);
      const b = proj.project(tr.to[0] + 0.5, tr.to[1] + 0.5, 0.48);
      ctx.save();
      ctx.globalAlpha = tr.life * 0.72;
      ctx.strokeStyle = tr.color;
      ctx.lineWidth = (tr.kind === 'dash' ? 15 : 6) * tr.life;
      ctx.lineCap = 'round';
      ctx.shadowColor = tr.color;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      if (tr.kind === 'dash' && !reducedMotion.matches) {
        ctx.shadowBlur = 0;
        for (const t of [0.12, 0.42, 0.7]) {
          const echo = proj.project(lerp(tr.from[0], tr.to[0], t) + 0.5, lerp(tr.from[1], tr.to[1], t) + 0.5, 0.6);
          ctx.globalAlpha = tr.life * (0.12 + t * 0.28);
          drawCharacter(ctx, meta.avatars[tr.fighter - 1], echo.x, echo.y, echo.s * 0.56,
            tr.color, tr.color, '#e0f2fe', b.x - a.x, now, false, 0, 0.65);
        }
      }
      ctx.restore();
      tr.life -= 0.06;
      if (tr.life <= 0) trails.splice(i, 1);
    }

    // 5. Expanding 3D Shockwave Rings
    for (let i = rings.length - 1; i >= 0; i--) {
      const rg = rings[i];
      rg.r = lerp(rg.r, rg.maxR, 0.22);
      const p = proj.project(rg.x, rg.y, rg.z);
      ctx.save();
      ctx.globalAlpha = rg.life * 0.92;
      ctx.strokeStyle = rg.color;
      ctx.shadowColor = rg.color;
      ctx.shadowBlur = 14;
      ctx.lineWidth = rg.lineWidth * rg.life;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, rg.r * p.s, rg.r * p.s * proj.tiltY, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      rg.life -= rg.decay;
      if (rg.life <= 0) rings.splice(i, 1);
    }

    // 6. Depth-Sorted 3D World Queue (Pillars + Ice Spikes + Pickups + 2.5D Characters + Projectiles + Zone Curtains)
    const drawables = [];

    // 6a. 3D Extruded Monolith Pillars
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (meta.map[y][x] !== '#') continue;
        const c = proj.project(x + 0.5, y + 0.5, 0);
        drawables.push({
          depth: c.depth,
          draw: () => {
            draw3DBox(proj, x + 0.06, y + 0.06, x + 0.94, y + 0.94, 0, 1.38, {
              top: biome.wallTop,
              sideA: biome.wallLeft,
              sideB: biome.wallRight,
              stroke: biome.wallStroke,
            });
          },
        });
      }
    }

    // 6b. 3D Signature Elemental Spectacles (Thunder / Fire Blast / Blizzard / Aura Meteor / Void Vortex / Moonbeam)
    for (let i = spikes.length - 1; i >= 0; i--) {
      const sp = spikes[i];
      const life = clamp(sp.life, 0.01, 1);
      const base = proj.project(sp.x, sp.y, 0.02);
      const tip = proj.project(sp.x, sp.y, sp.h * (sp.style === 'spire' ? Math.sin(life * Math.PI) : 1));
      const left = proj.project(sp.x - 0.24, sp.y, 0.02);
      const right = proj.project(sp.x + 0.24, sp.y, 0.02);
      drawables.push({
        depth: base.depth + 0.12,
        draw: () => {
          ctx.save();
          ctx.globalAlpha = life * 0.94;
          if (sp.style === 'lightning') {
            ctx.strokeStyle = sp.color || '#fef08a';
            ctx.shadowColor = '#facc15';
            ctx.shadowBlur = 24;
            ctx.lineWidth = Math.max(0.5, 4.6 * life);
            ctx.beginPath();
            ctx.moveTo(tip.x, tip.y);
            for (let s = 1; s <= 6; s++) {
              const t = s / 6;
              const jx = s < 6 ? (Math.random() - 0.5) * 26 : 0;
              ctx.lineTo(lerp(tip.x, base.x, t) + jx, lerp(tip.y, base.y, t));
            }
            ctx.stroke();
          } else if (sp.style === 'discharge') {
            // Radial crackling electric arcs around Pikachu
            ctx.strokeStyle = '#fef08a';
            ctx.shadowColor = '#facc15';
            ctx.shadowBlur = 16;
            ctx.lineWidth = Math.max(0.5, 2.4 * life);
            for (let b = 0; b < 6; b++) {
              const a = (b * Math.PI) / 3 + now / 120;
              const end = proj.project(sp.x + Math.cos(a) * 1.9, sp.y + Math.sin(a) * 1.9, 0.45);
              const mid = proj.project(sp.x + Math.cos(a + 0.22) * 0.95, sp.y + Math.sin(a + 0.22) * 0.95, 0.75);
              ctx.beginPath();
              ctx.moveTo(base.x, base.y - 10);
              ctx.lineTo(mid.x, mid.y);
              ctx.lineTo(end.x, end.y);
              ctx.stroke();
            }
          } else if (sp.style === 'fireblast') {
            // Iconic 5-pointed blazing Fire Blast star on the 3x3 arena floor!
            const rad = 1.65 * (1.2 - life * 0.25);
            const pts = [];
            for (let k = 0; k < 10; k++) {
              const a = (k * Math.PI) / 5 - Math.PI / 2;
              const r = k % 2 === 0 ? rad : rad * 0.42;
              pts.push(proj.project(sp.x + Math.cos(a) * r, sp.y + Math.sin(a) * r, 0.14));
            }
            poly(pts);
            ctx.fillStyle = 'rgba(249, 115, 22, 0.65)';
            ctx.shadowColor = '#f97316';
            ctx.shadowBlur = 22;
            ctx.fill();
            ctx.strokeStyle = '#fef08a';
            ctx.lineWidth = 2.6;
            ctx.stroke();
          } else if (sp.style === 'blizzard' || sp.style === 'voidvortex') {
            // Swirling 3D elemental cyclone rising up from the 3x3 impact zone!
            const isVoid = sp.style === 'voidvortex';
            ctx.strokeStyle = isVoid ? '#c084fc' : '#e0f2fe';
            ctx.shadowColor = isVoid ? '#9333ea' : '#38bdf8';
            ctx.shadowBlur = 18;
            for (let ring = 0; ring < 5; ring++) {
              const z = 0.25 + ring * 0.78 + (1 - life) * 1.1;
              const r = Math.max(0.05, (0.55 + ring * 0.28) * life);
              const rp = proj.project(sp.x, sp.y, z);
              const rx = Math.max(1, r * rp.s);
              const ry = Math.max(1, r * rp.s * proj.tiltY);
              ctx.lineWidth = Math.max(0.5, (3.4 - ring * 0.4) * life);
              ctx.setLineDash([12, 8]);
              ctx.lineDashOffset = (ring % 2 === 0 ? 1 : -1) * (now / 14);
              ctx.beginPath();
              ctx.ellipse(rp.x, rp.y, rx, ry, 0, 0, Math.PI * 2);
              ctx.stroke();
            }
          } else if (sp.style === 'aurameteor') {
            // Descending sapphire Aura beam + shockwave pillar!
            const grad = ctx.createLinearGradient(tip.x, tip.y, base.x, base.y);
            grad.addColorStop(0, 'rgba(96,165,250,0)');
            grad.addColorStop(0.6, '#60a5fa');
            grad.addColorStop(1, '#ffffff');
            ctx.strokeStyle = grad;
            ctx.shadowColor = '#3b82f6';
            ctx.shadowBlur = 24;
            ctx.lineWidth = Math.max(1, 18 * life);
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(tip.x, tip.y);
            ctx.lineTo(base.x, base.y);
            ctx.stroke();
          } else if (sp.style === 'moonbeam') {
            // Radiant rose-pink Moonbeam / Psyshock pillar + glowing rings!
            const grad = ctx.createLinearGradient(tip.x, tip.y, base.x, base.y);
            grad.addColorStop(0, 'rgba(244,114,182,0)');
            grad.addColorStop(0.5, 'rgba(244,114,182,0.75)');
            grad.addColorStop(1, '#ffffff');
            ctx.strokeStyle = grad;
            ctx.shadowColor = '#ec4899';
            ctx.shadowBlur = 24;
            ctx.lineWidth = Math.max(1, 22 * life);
            ctx.beginPath();
            ctx.moveTo(tip.x, tip.y);
            ctx.lineTo(base.x, base.y);
            ctx.stroke();
            for (let ring = 0; ring < 3; ring++) {
              const rp = proj.project(sp.x, sp.y, 0.5 + ring * 1.1);
              const rr = Math.max(1, (1.3 - ring * 0.25) * rp.s);
              ctx.strokeStyle = '#fde68a';
              ctx.lineWidth = Math.max(0.5, 2.2 * life);
              ctx.beginPath();
              ctx.ellipse(rp.x, rp.y, rr, Math.max(1, rr * proj.tiltY), 0, 0, Math.PI * 2);
              ctx.stroke();
            }
          } else {
            poly([left, tip, right]);
            ctx.fillStyle = sp.color || PALETTE.frostBright;
            ctx.shadowColor = sp.color || PALETTE.frost;
            ctx.shadowBlur = 14;
            ctx.fill();
          }
          ctx.restore();
        },
      });
      sp.life -= 0.045;
      if (sp.life <= 0) spikes.splice(i, 1);
    }

    // 6c. Levitating 3D Pickups with Vertical Light Columns
    for (const pk of currFrame.pickups) {
      const gx = pk.pos[0] + 0.5;
      const gy = pk.pos[1] + 0.5;
      const base = proj.project(gx, gy, 0.02);
      const isHealth = pk.kind === 'health';
      const color = isHealth ? PALETTE.health : PALETTE.power;
      drawables.push({
        depth: base.depth + 0.05,
        draw: () => {
          // Dynamic colored floor light pool
          if (pk.ready_in === 0) {
            const g = ctx.createRadialGradient(base.x, base.y, 2, base.x, base.y, base.s * 0.95);
            g.addColorStop(0, `${color}44`);
            g.addColorStop(1, `${color}00`);
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.ellipse(base.x, base.y, base.s * 0.95, base.s * 0.95 * proj.tiltY, 0, 0, Math.PI * 2);
            ctx.fill();
          }

          ctx.save();
          ctx.strokeStyle = color;
          ctx.globalAlpha = pk.ready_in === 0 ? 0.78 : 0.28;
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.ellipse(base.x, base.y, base.s * 0.44, base.s * 0.44 * proj.tiltY, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();

          if (pk.ready_in === 0) {
            const bob = 0.7 + Math.sin(now / 250 + gx) * 0.16;
            const top = proj.project(gx, gy, bob);
            if (proj.is3D) {
              ctx.save();
              const beam = ctx.createLinearGradient(base.x, base.y, top.x, top.y - 16);
              beam.addColorStop(0, `${color}55`);
              beam.addColorStop(1, `${color}00`);
              ctx.strokeStyle = beam;
              ctx.lineWidth = base.s * 0.52;
              ctx.beginPath();
              ctx.moveTo(base.x, base.y);
              ctx.lineTo(top.x, top.y - 14);
              ctx.stroke();
              ctx.restore();
            }
            ctx.save();
            ctx.fillStyle = color;
            ctx.shadowColor = color;
            ctx.shadowBlur = 16;
            if (isHealth) {
              const r = top.s * 0.34, t = top.s * 0.13;
              ctx.fillRect(top.x - r, top.y - t, r * 2, t * 2);
              ctx.fillRect(top.x - t, top.y - r, t * 2, r * 2);
            } else {
              const r = top.s * 0.38;
              ctx.translate(top.x, top.y);
              ctx.rotate(now / 620);
              ctx.beginPath();
              ctx.moveTo(0, -r);
              ctx.lineTo(r * 0.8, 0);
              ctx.lineTo(0, r);
              ctx.lineTo(-r * 0.8, 0);
              ctx.closePath();
              ctx.fill();
            }
            ctx.restore();
          } else if (Number.isFinite(pk.ready_in) && pk.ready_in > 0) {
            ctx.save();
            ctx.fillStyle = '#cbd5e1';
            ctx.font = '700 10px system-ui';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(pk.ready_in), base.x, base.y);
            ctx.restore();
          }
        },
      });
    }

    // 6d. Billboarded 2.5D Animated Characters standing on the 3D Coliseum!
    currFrame.fighters.forEach((f, idx) => {
      if (f.hp <= 0) return;
      const pf = prevFrame?.fighters[idx];
      const gx = (pf ? lerp(pf.pos[0], f.pos[0], alpha) : f.pos[0]) + 0.5;
      const gy = (pf ? lerp(pf.pos[1], f.pos[1], alpha) : f.pos[1]) + 0.5;
      const moving = pf && (pf.pos[0] !== f.pos[0] || pf.pos[1] !== f.pos[1]);
      const moveDist = moving ? Math.hypot(f.pos[0] - pf.pos[0], f.pos[1] - pf.pos[1]) : 0;
      if (moving) {
        facing[f.id] = Math.atan2(f.pos[1] - pf.pos[1], f.pos[0] - pf.pos[0]);
      }

      // Demeo-style tactile parabolic miniature hop when stepping/dashing between tiles!
      const hopZ = moving ? Math.sin(alpha * Math.PI) * Math.min(0.65, 0.34 + moveDist * 0.1) : 0;
      const ground = proj.project(gx, gy, 0.02);
      const [dx, dy] = hitDirection.get(f.id) ?? [0, 0];
      const stagger = reducedMotion.matches ? 0 : hitFlash[f.id] ** 2 * 0.44;
      const bodyPt = proj.project(gx + dx * stagger, gy + dy * stagger, 0.55 + hopZ);
      const headPt = proj.project(gx, gy, 1.55 + hopZ);
      const ang = facing[f.id] ?? 0;
      const aimPt = proj.project(gx + Math.cos(ang) * 0.72, gy + Math.sin(ang) * 0.72, 0.55 + hopZ);
      const facingScreenX = aimPt.x - bodyPt.x;
      const moveTilt = moving ? Math.sin(alpha * Math.PI) * (facingScreenX >= 0 ? 0.16 : -0.16) : 0;

      const color = idx === 0 ? PALETTE.p1 : PALETTE.p2;
      const dark = idx === 0 ? PALETTE.p1Dark : PALETTE.p2Dark;
      const light = idx === 0 ? PALETTE.p1Light : PALETTE.p2Light;
      const avatar = meta.avatars?.[idx] || (idx === 0 ? 'knight' : 'fox');

      drawables.push({
        depth: ground.depth + 0.16,
        draw: () => {
          const r = bodyPt.s * 0.56;
          const bob = moving ? 0 : Math.sin(now / 260 + idx * 2) * 1.8;

          // Dynamic floor light pool + ambient occlusion shadow + Demeo painted tabletop base ring with radial HP arc!
          const pool = ctx.createRadialGradient(ground.x, ground.y, 2, ground.x, ground.y, r * 1.8);
          pool.addColorStop(0, `${color}3a`);
          pool.addColorStop(1, `${color}00`);
          ctx.fillStyle = pool;
          ctx.beginPath();
          ctx.ellipse(ground.x, ground.y, r * 1.8, r * 1.8 * proj.tiltY, 0, 0, Math.PI * 2);
          ctx.fill();

          const shadowScale = 1 - hopZ * 0.25;
          ctx.save();
          ctx.fillStyle = 'rgba(2, 6, 23, 0.72)';
          ctx.beginPath();
          ctx.ellipse(ground.x, ground.y, r * 1.02 * shadowScale, r * 1.02 * proj.tiltY * shadowScale, 0, 0, Math.PI * 2);
          ctx.fill();
          // Recessed base track
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.ellipse(ground.x, ground.y, r * 1.02, r * 1.02 * proj.tiltY, 0, 0, Math.PI * 2);
          ctx.stroke();
          // Persistent faction HP arc right on the miniature base ring!
          const hpFrac = clamp(f.hp / f.max_hp, 0, 1);
          ctx.strokeStyle = color;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.ellipse(ground.x, ground.y, r * 1.02, r * 1.02 * proj.tiltY, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * hpFrac);
          ctx.stroke();
          ctx.restore();

          if (banner && f.id === meta.winner) {
            // A pool of light and rising gold sparks frame the winning miniature.
            ctx.save();
            const glow = ctx.createLinearGradient(0, ground.y - r * 6, 0, ground.y);
            glow.addColorStop(0, 'rgba(255,211,117,0)');
            glow.addColorStop(1, 'rgba(255,211,117,0.32)');
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.moveTo(ground.x - r * 1.4, ground.y);
            ctx.lineTo(ground.x - r * 2.6, ground.y - r * 6);
            ctx.lineTo(ground.x + r * 2.6, ground.y - r * 6);
            ctx.lineTo(ground.x + r * 1.4, ground.y);
            ctx.fill();
            for (let k = 0; k < 12; k++) {
              const phase = (k / 12 + (reducedMotion.matches ? 0 : (now - bannerSince) / 2200)) % 1;
              const angle = k * 2.4;
              const spark = proj.project(gx + Math.cos(angle) * 0.85, gy + Math.sin(angle) * 0.85, 0.2 + phase * 2.5);
              ctx.globalAlpha = Math.sin(phase * Math.PI);
              ctx.fillStyle = '#ffe6a8';
              ctx.fillRect(spark.x - 1, spark.y - 2, 2, 4);
            }
            ctx.restore();
          }

          // Power buff crackling golden halo
          if ((f.buffs?.power ?? 0) > 0) {
            ctx.save();
            ctx.strokeStyle = PALETTE.power;
            ctx.shadowColor = PALETTE.power;
            ctx.shadowBlur = 14;
            ctx.lineWidth = 2.6;
            ctx.setLineDash([6, 4]);
            ctx.lineDashOffset = -(now / 38);
            ctx.beginPath();
            ctx.ellipse(ground.x, ground.y, r * 1.32, r * 1.32 * proj.tiltY, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
          }

          // Slow frost ring
          if (f.slow_ticks_left > 0) {
            ctx.save();
            ctx.strokeStyle = PALETTE.frostBright;
            ctx.lineWidth = 2.2;
            ctx.beginPath();
            ctx.ellipse(ground.x, ground.y, r * 1.18, r * 1.18 * proj.tiltY, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
          }

          // Draw the upright 2.5D character / action-reactive Pokémon sprite!
          const isMirrorAlt = idx === 1 && meta.avatars?.[0] && meta.avatars[0] === meta.avatars[1];
          drawCharacter(
            ctx, avatar, bodyPt.x, bodyPt.y, r,
            color, dark, light, facingScreenX, now,
            hitFlash[f.id] > 0.2, bob, recoil[f.id], moveTilt,
            {
              attacking: recoil[f.id] > 0.25,
              dashing: moveDist >= 2,
              powered: (f.buffs?.power ?? 0) > 0,
              facingAway: aimPt.y - bodyPt.y < -5,
              altTint: isMirrorAlt,
            },
          );

          // Floating glowing weapon orb aimed in 3D direction
          ctx.save();
          ctx.fillStyle = light;
          ctx.shadowColor = color;
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.arc(aimPt.x, aimPt.y + bob * 0.6, r * 0.22, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();

          if (hitFlash[f.id] > 0) hitFlash[f.id] = Math.max(0, hitFlash[f.id] - 0.12);
          if (recoil[f.id] > 0) recoil[f.id] = Math.max(0, recoil[f.id] - 0.14);

          // Orbiting 3D stun stars
          if (f.state === 'stunned') {
            for (let s = 0; s < 3; s++) {
              const sa = now / 150 + (s * Math.PI * 2) / 3;
              const sp = proj.project(gx + Math.cos(sa) * 0.58, gy + Math.sin(sa) * 0.58, 1.45);
              ctx.fillStyle = '#fde047';
              ctx.beginPath();
              ctx.arc(sp.x, sp.y, 3.2, 0, Math.PI * 2);
              ctx.fill();
            }
          }

          // Floating HP bar + Team Name Tag
          const bw = Math.max(36, bodyPt.s * 1.45);
          const bh = 5;
          const bx = headPt.x - bw / 2;
          const by = headPt.y - 6;
          ctx.fillStyle = 'rgba(2, 6, 23, 0.88)';
          ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
          ctx.fillStyle = color;
          ctx.fillRect(bx, by, bw * clamp(f.hp / f.max_hp, 0, 1), bh);

          const tag = (meta.names[idx] || `Team ${idx + 1}`).slice(0, 14);
          ctx.save();
          ctx.font = '700 10.5px system-ui';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.lineWidth = 3.2;
          ctx.strokeStyle = 'rgba(2, 6, 23, 0.92)';
          ctx.strokeText(tag, headPt.x, by - 2);
          ctx.fillStyle = '#f8fafc';
          ctx.fillText(tag, headPt.x, by - 2);
          ctx.restore();
        },
      });
    });

    // 6e. Elevated 3D Projectiles + Muzzle Flashes
    const prevProjMap = new Map((prevFrame?.projectiles ?? []).map((p) => [p.id, p]));
    for (const pr of currFrame.projectiles) {
      const curX = (pr.exact_pos ? pr.exact_pos[0] / 1000 : pr.pos[0]) + 0.5;
      const curY = (pr.exact_pos ? pr.exact_pos[1] / 1000 : pr.pos[1]) + 0.5;
      const prev = prevProjMap.get(pr.id);
      const prevX = (prev ? (prev.exact_pos ? prev.exact_pos[0] / 1000 : prev.pos[0]) : (pr.origin?.[0] ?? curX - 0.5)) + 0.5;
      const prevY = (prev ? (prev.exact_pos ? prev.exact_pos[1] / 1000 : prev.pos[1]) : (pr.origin?.[1] ?? curY - 0.5)) + 0.5;

      const ix = lerp(prevX, curX, alpha);
      const iy = lerp(prevY, curY, alpha);
      const tx = lerp(prevX, curX, Math.max(0, alpha - 0.68));
      const ty = lerp(prevY, curY, Math.max(0, alpha - 0.68));
      const pAir = proj.project(ix, iy, 0.64);
      const pTail = proj.project(tx, ty, 0.64);
      const pShadow = proj.project(ix, iy, 0.02);
      const ownerKind = meta.avatars?.[pr.owner - 1];
      const ownerPoke = POKEMON_ROSTER[ownerKind];
      const color = ownerPoke?.color || (pr.owner === 1 ? PALETTE.p1 : PALETTE.p2);

      drawables.push({
        depth: pAir.depth + 0.22,
        draw: () => {
          // Ground shadow
          ctx.fillStyle = 'rgba(2, 6, 23, 0.55)';
          ctx.beginPath();
          ctx.ellipse(pShadow.x, pShadow.y, 6, 6 * proj.tiltY, 0, 0, Math.PI * 2);
          ctx.fill();

          ctx.save();
          if (ownerKind === 'pikachu') {
            // THUNDERBOLT: jagged crackling lightning bolt!
            ctx.strokeStyle = '#fde047';
            ctx.shadowColor = '#facc15';
            ctx.shadowBlur = 16;
            ctx.lineWidth = 3.2;
            ctx.beginPath();
            ctx.moveTo(pTail.x, pTail.y);
            for (let s = 1; s <= 4; s++) {
              const t = s / 4;
              const jx = s < 4 ? (Math.random() - 0.5) * 11 : 0;
              const jy = s < 4 ? (Math.random() - 0.5) * 11 : 0;
              ctx.lineTo(lerp(pTail.x, pAir.x, t) + jx, lerp(pTail.y, pAir.y, t) + jy);
            }
            ctx.stroke();
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(pAir.x, pAir.y, 4.5, 0, Math.PI * 2);
            ctx.fill();
          } else if (ownerKind === 'charizard') {
            // FLAMETHROWER: roaring fireballs + ember plume!
            const grad = ctx.createLinearGradient(pTail.x, pTail.y, pAir.x, pAir.y);
            grad.addColorStop(0, 'rgba(239,68,68,0)');
            grad.addColorStop(0.5, '#f97316');
            grad.addColorStop(1, '#fde047');
            ctx.strokeStyle = grad;
            ctx.lineWidth = 10;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(pTail.x, pTail.y);
            ctx.lineTo(pAir.x, pAir.y);
            ctx.stroke();
            ctx.fillStyle = '#fb923c';
            ctx.shadowColor = '#f97316';
            ctx.shadowBlur = 18;
            ctx.beginPath();
            ctx.arc(pAir.x, pAir.y, 7.2, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#fef08a';
            ctx.beginPath();
            ctx.arc(pAir.x, pAir.y, 3.6, 0, Math.PI * 2);
            ctx.fill();
          } else if (ownerKind === 'greninja') {
            // WATER SHURIKEN: spinning 4-blade cyan star!
            ctx.translate(pAir.x, pAir.y);
            ctx.rotate(now / 40);
            ctx.fillStyle = '#38bdf8';
            ctx.shadowColor = '#7dd3fc';
            ctx.shadowBlur = 16;
            ctx.beginPath();
            for (let b = 0; b < 8; b++) {
              const a = (b * Math.PI) / 4;
              const rad = b % 2 === 0 ? 10.5 : 3.2;
              if (b === 0) ctx.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
              else ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
            }
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
            ctx.fill();
          } else if (ownerKind === 'gengar') {
            // SHADOW BALL: dark-core violet spectral sphere with wisp rings!
            ctx.strokeStyle = '#a855f7';
            ctx.shadowColor = '#9333ea';
            ctx.shadowBlur = 16;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(pAir.x, pAir.y, 7.5 + Math.sin(now / 60) * 1.5, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = '#1e1033';
            ctx.beginPath();
            ctx.arc(pAir.x, pAir.y, 5.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#e9d5ff';
            ctx.lineWidth = 1.4;
            ctx.stroke();
          } else if (ownerKind === 'lucario') {
            // AURA SPHERE: pulsing double-ring sapphire energy orb!
            ctx.strokeStyle = '#93c5fd';
            ctx.shadowColor = '#3b82f6';
            ctx.shadowBlur = 18;
            ctx.lineWidth = 2.4;
            ctx.beginPath();
            ctx.arc(pAir.x, pAir.y, 8.5, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = '#60a5fa';
            ctx.beginPath();
            ctx.arc(pAir.x, pAir.y, 5.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(pAir.x, pAir.y, 2.6, 0, Math.PI * 2);
            ctx.fill();
          } else if (ownerKind === 'gardevoir') {
            // MOONBLAST: radiant rose-pink lunar comet + starlight halo!
            const grad = ctx.createLinearGradient(pTail.x, pTail.y, pAir.x, pAir.y);
            grad.addColorStop(0, 'rgba(244,114,182,0)');
            grad.addColorStop(1, '#f472b6');
            ctx.strokeStyle = grad;
            ctx.lineWidth = 7.5;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(pTail.x, pTail.y);
            ctx.lineTo(pAir.x, pAir.y);
            ctx.stroke();
            ctx.fillStyle = '#fbcfe8';
            ctx.shadowColor = '#ec4899';
            ctx.shadowBlur = 18;
            ctx.beginPath();
            ctx.arc(pAir.x, pAir.y, 6.8, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(pAir.x, pAir.y, 3.2, 0, Math.PI * 2);
            ctx.fill();
          } else {
            // Default plasma comet
            const grad = ctx.createLinearGradient(pTail.x, pTail.y, pAir.x, pAir.y);
            grad.addColorStop(0, 'rgba(255,255,255,0)');
            grad.addColorStop(1, color);
            ctx.strokeStyle = grad;
            ctx.lineWidth = 6.5;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(pTail.x, pTail.y);
            ctx.lineTo(pAir.x, pAir.y);
            ctx.stroke();
            ctx.fillStyle = color;
            ctx.shadowColor = color;
            ctx.shadowBlur = 16;
            ctx.beginPath();
            ctx.arc(pAir.x, pAir.y, 5.4, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(pAir.x, pAir.y, 2.5, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        },
      });
    }

    // 6f. 3D Translucent Crimson Laser Zone Curtains
    if (zone) {
      const x0 = zcx - zRad, y0 = zcy - zRad, x1 = zcx + zRad + 1, y1 = zcy + zRad + 1;
      const wallH = proj.is3D ? 1.55 : 0.05;
      const edges = [
        [x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0],
      ];
      for (const [ax, ay, bx, by] of edges) {
        const mid = proj.project((ax + bx) / 2, (ay + by) / 2, 0);
        drawables.push({
          depth: mid.depth,
          draw: () => {
            const p0 = proj.project(ax, ay, 0);
            const p1 = proj.project(bx, by, 0);
            const q1 = proj.project(bx, by, wallH);
            const q0 = proj.project(ax, ay, wallH);
            ctx.save();
            if (proj.is3D) {
              poly([p0, p1, q1, q0]);
              const g = ctx.createLinearGradient(p0.x, p0.y, q0.x, q0.y);
              g.addColorStop(0, 'rgba(239, 68, 68, 0.34)');
              g.addColorStop(1, 'rgba(239, 68, 68, 0.02)');
              ctx.fillStyle = g;
              ctx.fill();
            }
            ctx.strokeStyle = PALETTE.zoneEdge;
            ctx.shadowColor = PALETTE.zoneEdge;
            ctx.shadowBlur = 10;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(p1.x, p1.y);
            ctx.stroke();
            if (proj.is3D) {
              ctx.globalAlpha = 0.55;
              ctx.beginPath();
              ctx.moveTo(q0.x, q0.y);
              ctx.lineTo(q1.x, q1.y);
              ctx.stroke();
            }
            ctx.restore();
          },
        });
      }
    }

    drawables.sort((a, b) => a.depth - b.depth);
    for (const item of drawables) item.draw();

    // 7. Triangle Strategy Glowing 3D Targeting Arcs + Muzzle Flashes
    for (let i = attackArcs.length - 1; i >= 0; i--) {
      const arc = attackArcs[i];
      const p0 = proj.project(arc.from[0], arc.from[1], 0.72);
      const p2 = proj.project(arc.to[0], arc.to[1], 0.15);
      const pm = proj.project((arc.from[0] + arc.to[0]) / 2, (arc.from[1] + arc.to[1]) / 2, arc.peakZ);
      ctx.save();
      ctx.globalAlpha = arc.life * 0.82;
      ctx.strokeStyle = arc.color;
      ctx.shadowColor = arc.color;
      ctx.shadowBlur = 10;
      ctx.lineWidth = 2.2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.quadraticCurveTo(pm.x, pm.y, p2.x, p2.y);
      ctx.stroke();
      ctx.restore();
      arc.life -= arc.decay;
      if (arc.life <= 0) attackArcs.splice(i, 1);
    }

    for (let i = flashes.length - 1; i >= 0; i--) {
      const fl = flashes[i];
      const p = proj.project(fl.x, fl.y, fl.z);
      ctx.save();
      ctx.globalAlpha = fl.life;
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = fl.color;
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 9 * fl.life, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      fl.life -= 0.18;
      if (fl.life <= 0) flashes.splice(i, 1);
    }

    // 8. 3D Gravity-Driven Spark & Debris Fountains
    for (let i = particles.length - 1; i >= 0; i--) {
      const pt = particles[i];
      pt.x += pt.vx;
      pt.y += pt.vy;
      pt.z += pt.vz;
      pt.vz -= 0.012;
      if (pt.z < 0.04) {
        pt.z = 0.04;
        pt.vz *= -0.45;
        pt.vx *= 0.8;
        pt.vy *= 0.8;
      }
      const p = proj.project(pt.x, pt.y, pt.z);
      ctx.save();
      ctx.globalAlpha = pt.life;
      ctx.fillStyle = pt.color;
      ctx.shadowColor = pt.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, pt.size * pt.life, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      pt.life -= pt.decay;
      if (pt.life <= 0) particles.splice(i, 1);
    }

    // 9. Floating Shout Speech Bubbles
    for (let i = shouts.length - 1; i >= 0; i--) {
      const sh = shouts[i];
      const f = currFrame.fighters.find((x) => x.id === sh.fighter);
      if (f && f.hp > 0) {
        const p = proj.project(f.pos[0] + 0.5, f.pos[1] + 0.5, 2.35);
        ctx.save();
        ctx.globalAlpha = clamp(sh.life * 2, 0, 1);
        ctx.font = '700 11px system-ui';
        const tw = ctx.measureText(sh.text).width + 16;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
        ctx.strokeStyle = sh.fighter === 1 ? PALETTE.p1 : PALETTE.p2;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(p.x - tw / 2, p.y - 14, tw, 22, 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#f8fafc';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(sh.text, p.x, p.y - 3);
        ctx.restore();
      }
      sh.life -= 0.01;
      if (sh.life <= 0) shouts.splice(i, 1);
    }

    // 10. Floating 3D Damage & Pickup Popups
    for (let i = popups.length - 1; i >= 0; i--) {
      const pop = popups[i];
      pop.z += 0.036;
      const p = proj.project(pop.x, pop.y, pop.z);
      ctx.save();
      ctx.globalAlpha = clamp(pop.life * 1.4, 0, 1);
      ctx.font = `800 ${Math.round(14 * pop.scale)}px system-ui`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(2, 6, 23, 0.92)';
      ctx.strokeText(pop.text, p.x, p.y);
      ctx.fillStyle = pop.color;
      ctx.fillText(pop.text, p.x, p.y);
      ctx.restore();
      pop.life -= 0.024;
      if (pop.life <= 0) popups.splice(i, 1);
    }

    // 10b. Pre-Match Fighting-Game "VS" Intro Splash
    if (now < vsUntil) {
      const dur = Math.max(1, vsUntil - vsStart);
      const t = clamp((now - vsStart) / dur, 0, 1);
      const fade = t < 0.14 ? t / 0.14 : t > 0.8 ? (1 - t) / 0.2 : 1;
      const slide = (1 - Math.min(1, t * 5)) * 70;
      ctx.save();
      ctx.globalAlpha = clamp(fade, 0, 1);
      // Split banner backdrop
      ctx.fillStyle = 'rgba(4, 8, 18, 0.86)';
      ctx.fillRect(0, H / 2 - 76, W, 152);
      const gradL = ctx.createLinearGradient(0, 0, W / 2, 0);
      gradL.addColorStop(0, 'rgba(56, 189, 248, 0.34)');
      gradL.addColorStop(1, 'rgba(56, 189, 248, 0.04)');
      ctx.fillStyle = gradL;
      ctx.fillRect(0, H / 2 - 76, W / 2, 152);
      const gradR = ctx.createLinearGradient(W / 2, 0, W, 0);
      gradR.addColorStop(0, 'rgba(251, 113, 133, 0.04)');
      gradR.addColorStop(1, 'rgba(251, 113, 133, 0.34)');
      ctx.fillStyle = gradR;
      ctx.fillRect(W / 2, H / 2 - 76, W / 2, 152);
      ctx.fillStyle = PALETTE.p1;
      ctx.fillRect(0, H / 2 - 76, W / 2, 3);
      ctx.fillStyle = PALETTE.p2;
      ctx.fillRect(W / 2, H / 2 - 76, W / 2, 3);
      ctx.fillRect(0, H / 2 + 73, W, 2);

      // Both fighters facing off!
      const av1 = meta.avatars?.[0] || 'pikachu';
      const av2 = meta.avatars?.[1] || 'charizard';
      const sameAv = av1 === av2;
      drawCharacter(ctx, av1, W * 0.26 - slide, H / 2 - 2, 32, PALETTE.p1, PALETTE.p1Dark, PALETTE.p1Light, 10, now, false, 0, 0, 0, {});
      drawCharacter(ctx, av2, W * 0.74 + slide, H / 2 - 2, 32, PALETTE.p2, PALETTE.p2Dark, PALETTE.p2Light, -10, now, false, 0, 0, 0, { altTint: sameAv });

      // Team names
      ctx.font = '800 20px system-ui';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#bae6fd';
      ctx.fillText((meta.names[0] || 'Team A').slice(0, 18), W * 0.26 - slide, H / 2 + 54);
      ctx.fillStyle = '#fecdd3';
      ctx.fillText((meta.names[1] || 'Team B').slice(0, 18), W * 0.74 + slide, H / 2 + 54);

      // Center glowing VS badge
      ctx.font = '900 42px system-ui';
      ctx.fillStyle = '#fde047';
      ctx.shadowColor = '#f59e0b';
      ctx.shadowBlur = 22;
      ctx.textBaseline = 'middle';
      ctx.fillText('VS', W / 2, H / 2);
      ctx.restore();
    }

    // 11. Victory Banner
    if (banner) {
      ctx.save();
      const enter = reducedMotion.matches ? 1 : clamp((now - bannerSince) / 340, 0, 1);
      ctx.translate(0, (1 - enter) ** 2 * 48);
      const y = H - 65;
      const grad = ctx.createLinearGradient(0, y - 22, 0, H);
      grad.addColorStop(0, 'rgba(5,9,20,0)');
      grad.addColorStop(0.5, 'rgba(5,9,20,0.93)');
      grad.addColorStop(1, '#080e1e');
      ctx.fillStyle = grad;
      ctx.fillRect(0, y - 22, W, H - y + 22);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#efd396';
      ctx.font = '700 11px system-ui';
      ctx.fillText('MATCH RESULT', W / 2, y + 13);
      ctx.fillStyle = '#f8fafc';
      ctx.font = '800 24px system-ui';
      ctx.fillText(banner, W / 2, y + 45, W - 32);
      ctx.restore();
    }

    ctx.restore();
  }

  requestAnimationFrame(drawScene);

  function setMeta(nextMeta) {
    meta = { ...meta, ...nextMeta };
    banner = '';
    prevFrame = null;
    currFrame = null;
    lastEventTick = -1;
    hitDirection.clear();
    particles.length = 0;
    rings.length = 0;
    trails.length = 0;
    spikes.length = 0;
    flashes.length = 0;
    attackArcs.length = 0;
    popups.length = 0;
    shouts.length = 0;
    feedItems.length = 0;
    hitFlash[1] = 0;
    hitFlash[2] = 0;
    recoil[1] = 0;
    recoil[2] = 0;
    shakeMag = 0;
    zoomPunch = 0;
    hitStopUntil = 0;
    if (hudEls.feed) hudEls.feed.innerHTML = '';
    if (hudEls.p1Name) hudEls.p1Name.textContent = meta.names[0];
    if (hudEls.p2Name) hudEls.p2Name.textContent = meta.names[1];
    if (hudEls.metaInfo) {
      hudEls.metaInfo.textContent = `${meta.mapName || 'arena'} · seed ${meta.seed}`;
    }
  }

  function setBanner(text, winner = meta.winner) {
    if (text && text !== banner) bannerSince = performance.now();
    meta.winner = winner;
    banner = text;
  }

  function render(frame, durationMs = 50, isScrub = false, silent = false) {
    if (!frame || !meta.map.length) return;
    if (isScrub) {
      hitDirection.clear();
      hitFlash[1] = hitFlash[2] = recoil[1] = recoil[2] = 0;
      trails.length = rings.length = particles.length = spikes.length = flashes.length = 0;
      attackArcs.length = popups.length = shouts.length = 0;
      shakeMag = zoomPunch = hitStopUntil = 0;
      lastEventTick = -1;
    }
    prevFrame = isScrub ? frame : (currFrame ?? frame);
    currFrame = frame;
    frameStartTime = performance.now();
    tickDurationMs = isScrub ? 0 : durationMs;
    if (!isScrub) processEvents(frame, silent || durationMs === 0);
    updateHud(frame);
  }

  function resetCamera() {
    targetYaw = 0.66;
    targetTilt = 0.55;
    targetZoom = 1.0;
    camFocusX = 10.5;
    camFocusY = 10.5;
  }

  function setCameraPreset(preset) {
    if (preset === '2.5d') {
      mode3D = false;
      targetZoom = 1.0;
      canvas.style.cursor = 'default';
    } else if (preset === 'dramatic') {
      mode3D = true;
      targetYaw = 0.52;
      targetTilt = 0.37;
      targetZoom = 1.15;
      canvas.style.cursor = 'grab';
    } else {
      mode3D = true;
      targetYaw = 0.66;
      targetTilt = 0.55;
      targetZoom = 1.0;
      canvas.style.cursor = 'grab';
    }
  }

  function showVsIntro(durationMs = 1050) {
    if (reducedMotion.matches || durationMs <= 0) return;
    vsStart = performance.now();
    vsUntil = vsStart + durationMs;
  }

  return {
    setMeta,
    setBanner,
    render,
    showVsIntro,
    setCameraPreset,
    setMode3D: (v) => setCameraPreset(v ? '3d' : '2.5d'),
    setAutoCam: (v) => { autoCam = Boolean(v); if (!autoCam) targetZoom = 1.0; },
    setShowSight: (v) => { showSight = Boolean(v); },
    setShowDanger: (v) => { showDanger = Boolean(v); },
    rotateCamera: (d) => { targetYaw += d; },
    resetCamera,
  };
}
