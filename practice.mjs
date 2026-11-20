import { HOUSE_BOTS } from './arena-sim.mjs';

// A local sparring partner that closes the distance and pressures with ranged fire.
function pursuit(obs) {
  const enemy = obs.enemies[0];
  const goal = enemy?.pos ?? obs.zone.center;
  const distance = tile => Math.hypot(tile[0] - goal[0], tile[1] - goal[1]);
  const step = obs.moves.reduce((best, move) => distance(move.tile) < distance(best?.tile ?? obs.self.pos) ? move : best, null);
  const turn = step ? { move: step.dir } : {};
  if (enemy && obs.tick % 4 === 0) turn.attack = { name: 'ranged', target: enemy.pos };
  return turn;
}

export const panel = [
  { key: 'random', label: "Random baseline", name: 'Random', avatar: 'gengar', start: HOUSE_BOTS.random.start },
  { key: 'pursuit', label: "Local pressure bot", name: 'Pursuit', avatar: 'charizard', start: () => pursuit },
  { key: 'starter', label: "Ladder rating 1109 (Nov 20, 2026)", name: 'TS Starter', avatar: 'lucario', start: HOUSE_BOTS['ts-starter'].start },
];
