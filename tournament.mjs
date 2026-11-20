// Interactive Tournament Engine for Victris Match Runner.
// Supports:
//   1. Single Elimination (with automatic BYEs + Best-of-3 Grand Final)
//   2. Round Robin + Top-2 Best-of-3 Grand Final
//   3. Swiss (3 rounds) + Top-2 Best-of-3 Grand Final

const AVATARS = ['knight', 'fox', 'mage', 'mech', 'dragon', 'ninja'];

export function defaultAvatar(index) {
  return AVATARS[index % AVATARS.length];
}

function shuffle(arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function nextPow2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function roundLabel(matchCount, isFinal) {
  if (isFinal) return '🏆 Grand Final (Bo3)';
  if (matchCount === 2) return 'Semifinals';
  if (matchCount === 4) return 'Quarterfinals';
  return `Round of ${matchCount * 2}`;
}

export function createTournament(format, roster, { shuffleRoster = true, bo3Final = true } = {}) {
  const teams = (shuffleRoster ? shuffle(roster) : [...roster]).map((t, i) => ({
    ...t,
    seedRank: i + 1,
    wins: 0,
    losses: 0,
    draws: 0,
    damageDealt: 0,
    opponents: new Set(),
  }));

  const state = {
    format, // 'single-elim' | 'round-robin' | 'swiss'
    bo3Final,
    teams,
    rounds: [], // [{ name, matches: [MatchNode] }]
    champion: null,
    swissMaxRounds: Math.min(3, Math.max(1, teams.length - 1)),
    finalCreated: false,
  };

  let nextMatchId = 1;
  const makeMatch = (roundIndex, a, b, isFinal = false) => ({
    id: nextMatchId++,
    roundIndex,
    teamA: a ?? null,
    teamB: b ?? null,
    isFinal,
    targetWins: isFinal && bo3Final ? 2 : 1,
    status: 'pending', // 'pending' | 'bye' | 'running' | 'done' | 'waiting'
    winner: null,
    score: [0, 0],
    seed: null,
    games: [],
  });

  if (format === 'single-elim') {
    const size = nextPow2(teams.length);
    const totalRounds = Math.round(Math.log2(size));
    // Place teams into first-round slots with BYEs spread cleanly
    const slots = Array(size).fill(null);
    for (let i = 0; i < teams.length; i++) {
      // Interleave so top seeds get BYEs first
      const pos = i < size / 2 ? i * 2 : (i - size / 2) * 2 + 1;
      slots[pos] = teams[i];
    }

    for (let r = 0; r < totalRounds; r++) {
      const count = size / (2 ** (r + 1));
      const isFinal = r === totalRounds - 1;
      const matches = [];
      for (let m = 0; m < count; m++) {
        if (r === 0) {
          const a = slots[m * 2];
          const b = slots[m * 2 + 1];
          const node = makeMatch(r, a, b, isFinal);
          if (a && !b) {
            node.status = 'bye';
            node.winner = a;
          } else if (!a && b) {
            node.status = 'bye';
            node.winner = b;
          }
          matches.push(node);
        } else {
          const node = makeMatch(r, null, null, isFinal);
          node.status = 'waiting';
          matches.push(node);
        }
      }
      state.rounds.push({ name: roundLabel(count, isFinal), matches });
    }
    propagateSingleElim(state);
  } else if (format === 'round-robin') {
    // Circle method for balanced rounds
    const list = [...teams];
    if (list.length % 2 === 1) list.push(null); // BYE sentinel
    const n = list.length;
    const numRounds = n - 1;
    for (let r = 0; r < numRounds; r++) {
      const matches = [];
      for (let i = 0; i < n / 2; i++) {
        const a = list[i];
        const b = list[n - 1 - i];
        if (a && b) matches.push(makeMatch(r, a, b, false));
      }
      state.rounds.push({ name: `Round ${r + 1}`, matches });
      // Rotate all except index 0
      const last = list.pop();
      list.splice(1, 0, last);
    }
  } else if (format === 'swiss') {
    state.rounds.push(buildSwissRound(state, 0, makeMatch));
  }

  state._makeMatch = makeMatch;
  return state;
}

function propagateSingleElim(state) {
  for (let r = 0; r < state.rounds.length - 1; r++) {
    const curr = state.rounds[r].matches;
    const next = state.rounds[r + 1].matches;
    for (let i = 0; i < next.length; i++) {
      const m1 = curr[i * 2];
      const m2 = curr[i * 2 + 1];
      const target = next[i];
      if (target.status === 'done' || target.status === 'running') continue;
      target.teamA = m1.winner;
      target.teamB = m2.winner;
      if (target.teamA && target.teamB) {
        target.status = 'pending';
      } else {
        target.status = 'waiting';
      }
    }
  }
  const finalMatch = state.rounds[state.rounds.length - 1]?.matches[0];
  if (finalMatch?.winner) state.champion = finalMatch.winner;
}

export function getStandings(state) {
  return [...state.teams].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (a.losses !== b.losses) return a.losses - b.losses;
    if (b.damageDealt !== a.damageDealt) return b.damageDealt - a.damageDealt;
    return a.seedRank - b.seedRank;
  });
}

function buildSwissRound(state, roundIndex, makeMatch) {
  const ranked = getStandings(state);
  const used = new Set();
  const matches = [];

  for (let i = 0; i < ranked.length; i++) {
    const a = ranked[i];
    if (used.has(a.id)) continue;
    // Prefer an opponent with closest score who hasn't been played yet
    let pick = null;
    for (let j = i + 1; j < ranked.length; j++) {
      const b = ranked[j];
      if (!used.has(b.id) && !a.opponents.has(b.id)) {
        pick = b;
        break;
      }
    }
    if (!pick) {
      for (let j = i + 1; j < ranked.length; j++) {
        const b = ranked[j];
        if (!used.has(b.id)) {
          pick = b;
          break;
        }
      }
    }
    used.add(a.id);
    if (pick) {
      used.add(pick.id);
      matches.push(makeMatch(roundIndex, a, pick, false));
    } else {
      // Odd team out gets a BYE win
      const byeMatch = makeMatch(roundIndex, a, null, false);
      byeMatch.status = 'bye';
      byeMatch.winner = a;
      a.wins += 1;
      matches.push(byeMatch);
    }
  }

  return { name: `Swiss Round ${roundIndex + 1}`, matches };
}

export function recordMatchResult(state, match, { winner, score, seed, games, damageA = 0, damageB = 0 }) {
  // Never let an 8-game draw stall an elimination bracket or Grand Final
  let resolvedWinner = winner;
  if (!resolvedWinner && (state.format === 'single-elim' || match.isFinal) && match.teamA && match.teamB) {
    resolvedWinner = damageA > damageB ? match.teamA : damageB > damageA ? match.teamB : match.teamA;
  }
  match.status = 'done';
  match.winner = resolvedWinner;
  match.score = score;
  match.seed = seed;
  match.games = games;

  if (match.teamA && match.teamB) {
    match.teamA.opponents.add(match.teamB.id);
    match.teamB.opponents.add(match.teamA.id);
    match.teamA.damageDealt += damageA;
    match.teamB.damageDealt += damageB;

    if (!match.isFinal) {
      if (resolvedWinner === match.teamA) {
        match.teamA.wins += 1;
        match.teamB.losses += 1;
      } else if (resolvedWinner === match.teamB) {
        match.teamB.wins += 1;
        match.teamA.losses += 1;
      } else {
        match.teamA.draws += 1;
        match.teamB.draws += 1;
      }
    }
  }

  if (state.format === 'single-elim') {
    propagateSingleElim(state);
    return;
  }

  // Check if all current rounds are finished
  const allDone = state.rounds.every((r) => r.matches.every((m) => m.status === 'done' || m.status === 'bye'));
  if (!allDone) return;

  if (match.isFinal) {
    state.champion = resolvedWinner;
    return;
  }

  if (state.format === 'swiss' && state.rounds.length < state.swissMaxRounds) {
    state.rounds.push(buildSwissRound(state, state.rounds.length, state._makeMatch));
    return;
  }

  // Group / Swiss stage complete -> create Top-2 Best-of-3 Grand Final!
  if (!state.finalCreated && state.teams.length >= 2) {
    state.finalCreated = true;
    const top = getStandings(state);
    const finalMatch = state._makeMatch(state.rounds.length, top[0], top[1], true);
    state.rounds.push({
      name: state.bo3Final ? '🏆 Grand Final (Best of 3)' : '🏆 Grand Final',
      matches: [finalMatch],
    });
  }
}

export function getNextPendingMatch(state) {
  for (const round of state.rounds) {
    for (const m of round.matches) {
      if (m.status === 'pending' && m.teamA && m.teamB) return m;
    }
  }
  return null;
}

export function getActiveRoundPendingMatches(state) {
  for (const round of state.rounds) {
    const pending = round.matches.filter((m) => m.status === 'pending' && m.teamA && m.teamB);
    if (pending.length) return { round, matches: pending };
  }
  return null;
}
