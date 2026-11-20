"""
Victris Arena — Python Bot ("Brawler")
Standalone, zero-dependency Python 3 strategy exporting `decide(observation, match)`.
Compatible with the official `arena_sim` Python simulator and WebSocket `bot.py` wrappers.

Playstyle: High-pressure brawler & combo hunter. Rushes Power pickups, hunts for
Repulsor wall-slams (+10 dmg & 3-tick stun) and zone knockbacks, chains Frostburst
onto stunned/dashless targets, and attempts 1-bounce bank shots around pillars.
"""

from __future__ import annotations

from collections import deque
from typing import Any

Pos = tuple[int, int]
Turn = dict[str, Any]

DIRS: list[tuple[str, int, int]] = [
    ("N", 0, -1),
    ("NE", 1, -1),
    ("E", 1, 0),
    ("SE", 1, 1),
    ("S", 0, 1),
    ("SW", -1, 1),
    ("W", -1, 0),
    ("NW", -1, -1),
]


class _Memory:
    def __init__(self) -> None:
        self.match_key: str = ""
        self.last_enemy_pos: Pos | None = None
        self.last_enemy_tick: int = -999
        self.enemy_vel: tuple[float, float] = (0.0, 0.0)
        self.walls: set[Pos] = set()
        self.width: int = 21
        self.height: int = 21


_MEM = _Memory()


def _get(obj: Any, key: str, default: Any = None) -> Any:
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _pos(p: Any) -> Pos:
    return (int(p[0]), int(p[1]))


def _cheb(a: Pos, b: Pos) -> int:
    return max(abs(a[0] - b[0]), abs(a[1] - b[1]))


def _euclid_sq(a: Pos, b: Pos) -> int:
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2


def _sign(v: int) -> int:
    return 1 if v > 0 else (-1 if v < 0 else 0)


def _clamp(v: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, v))


def _init_match(match: Any) -> None:
    key = str(_get(match, "id") or _get(match, "match_id") or "default")
    if _MEM.match_key == key:
        return
    _MEM.match_key = key
    _MEM.last_enemy_pos = None
    _MEM.last_enemy_tick = -999
    _MEM.enemy_vel = (0.0, 0.0)
    _MEM.walls.clear()

    grid = _get(match, "map")
    if grid and len(grid) > 0:
        _MEM.height = len(grid)
        _MEM.width = len(grid[0])
        for y, row in enumerate(grid):
            for x, ch in enumerate(row):
                if ch == "#":
                    _MEM.walls.add((x, y))
    else:
        _MEM.width = 21
        _MEM.height = 21


def _is_wall(x: int, y: int) -> bool:
    if x < 0 or y < 0 or x >= _MEM.width or y >= _MEM.height:
        return True
    return (x, y) in _MEM.walls


def _effective_radius(obs: dict[str, Any]) -> int:
    zone = obs["zone"]
    shrinks_in = zone.get("shrinks_in")
    next_radius = zone.get("next_radius")
    if shrinks_in is not None and next_radius is not None and shrinks_in <= 14:
        return int(next_radius)
    return int(zone["radius"])


def _in_safe_zone(obs: dict[str, Any], p: Pos) -> bool:
    center = _pos(obs["zone"]["center"])
    return _cheb(p, center) <= _effective_radius(obs)


def _danger_at(obs: dict[str, Any], p: Pos, min_dt: int, max_dt: int) -> int:
    tick = obs["tick"]
    hits = 0
    for d in obs.get("danger", []):
        dt = d["tick"] - tick
        if min_dt <= dt <= max_dt and _pos(d["tile"]) == p:
            hits += 1
    return hits


def _has_los(a: Pos, b: Pos) -> bool:
    if not _MEM.walls:
        return True
    steps = max(abs(b[0] - a[0]), abs(b[1] - a[1])) * 2
    if steps == 0:
        return True
    for i in range(1, steps):
        t = i / steps
        x = round(a[0] + (b[0] - a[0]) * t)
        y = round(a[1] + (b[1] - a[1]) * t)
        if (x, y) != a and (x, y) != b and _is_wall(x, y):
            return False
    return True


def _find_bank_shot_target(origin: Pos, enemy_pos: Pos) -> Pos | None:
    """If direct LOS is blocked, look for a simple 1-bounce reflection off a nearby wall."""
    if not _MEM.walls or _has_los(origin, enemy_pos):
        return None
    # Sample candidate bounce tiles adjacent to walls near the midpoint
    mx = (origin[0] + enemy_pos[0]) // 2
    my = (origin[1] + enemy_pos[1]) // 2
    for dy in range(-5, 6):
        for dx in range(-5, 6):
            bx, by = mx + dx, my + dy
            if _is_wall(bx, by):
                continue
            # Must sit right next to a wall to bounce off
            near_wall = (
                _is_wall(bx + 1, by)
                or _is_wall(bx - 1, by)
                or _is_wall(bx, by + 1)
                or _is_wall(bx, by - 1)
            )
            if not near_wall:
                continue
            cand = (bx, by)
            if _cheb(origin, cand) <= 8 and _has_los(origin, cand) and _has_los(cand, enemy_pos):
                return cand
    return None


def _bfs_step(obs: dict[str, Any], goal: Pos) -> str | None:
    moves = obs.get("moves", [])
    if not moves:
        return None

    dist_map: dict[Pos, int] = {}
    if _MEM.walls:
        q: deque[Pos] = deque([goal])
        dist_map[goal] = 0
        while q:
            cx, cy = q.popleft()
            cd = dist_map[(cx, cy)]
            if cd > 28:
                break
            for _, dx, dy in DIRS:
                nx, ny = cx + dx, cy + dy
                if _is_wall(nx, ny):
                    continue
                if dx != 0 and dy != 0 and (_is_wall(cx + dx, cy) or _is_wall(cx, cy + dy)):
                    continue
                if (nx, ny) not in dist_map:
                    dist_map[(nx, ny)] = cd + 1
                    q.append((nx, ny))

    best_dir: str | None = None
    best_score = 10**9
    for m in moves:
        tile = _pos(m["tile"])
        base = dist_map.get(tile, _cheb(tile, goal) + 50) * 1000
        score = (
            base
            + _euclid_sq(tile, goal)
            + _danger_at(obs, tile, 0, 2) * 20000
            + (0 if _in_safe_zone(obs, tile) else 15000)
        )
        if score < best_score:
            best_score = score
            best_dir = m["dir"]
    return best_dir


def _repulsor_combo_score(obs: dict[str, Any], origin: Pos, enemy_pos: Pos, push_dist: int) -> int:
    if _cheb(origin, enemy_pos) != 1:
        return 0
    dx = _sign(enemy_pos[0] - origin[0])
    dy = _sign(enemy_pos[1] - origin[1])
    cx, cy = enemy_pos
    slammed = False
    for _ in range(push_dist):
        nx, ny = cx + dx, cy + dy
        if _is_wall(nx, ny):
            slammed = True
            break
        cx, cy = nx, ny
    score = 20
    if slammed:
        score += 75  # Wall-slam: 15 total dmg + 3-tick stun
    if not _in_safe_zone(obs, (cx, cy)):
        score += 55  # Shove outside safe zone
    return score


def _choose_pickup(obs: dict[str, Any], match: Any) -> Pos | None:
    me = obs["self"]
    my_pos = _pos(me["pos"])
    enemies = obs.get("enemies", [])
    enemy_pos = _pos(enemies[0]["pos"]) if enemies else None

    rules = _get(match, "rules", {}) or {}
    heal_amt = _get(_get(_get(rules, "pickups", {}), "health", {}), "amount", 32)
    need_heal = me["hp"] <= me["max_hp"] - heal_amt * 0.4

    best_pos: Pos | None = None
    best_score = -10**9
    for p in obs.get("pickups", []):
        p_pos = _pos(p["pos"])
        if not _in_safe_zone(obs, p_pos):
            continue
        my_dist = _cheb(my_pos, p_pos)
        ready_in = int(p.get("ready_in", 0))
        if ready_in > my_dist * 2 + 5:
            continue
        kind = p.get("kind", "")
        if kind == "health" and not need_heal:
            continue
        if enemy_pos is not None and _cheb(enemy_pos, p_pos) + 1 < my_dist:
            continue

        # Brawler loves Power pickups above all else
        score = (150 if kind == "power" else 110) - my_dist * 11 - ready_in * 1.5
        if kind == "health" and me["hp"] < me["max_hp"] * 0.45:
            score += 50
        max_range = 10 if kind == "power" else (6 if enemy_pos else 10)
        if my_dist <= max_range and score > best_score:
            best_score = score
            best_pos = p_pos
    return best_pos


def _choose_search_goal(obs: dict[str, Any]) -> Pos:
    if _MEM.last_enemy_pos and obs["tick"] - _MEM.last_enemy_tick <= 25:
        if _in_safe_zone(obs, _MEM.last_enemy_pos):
            return _MEM.last_enemy_pos
    center = _pos(obs["zone"]["center"])
    r = min(2, max(1, _effective_radius(obs) // 2))
    corners: list[Pos] = [
        (center[0] - r, center[1] - r),
        (center[0] + r, center[1] - r),
        (center[0] + r, center[1] + r),
        (center[0] - r, center[1] + r),
    ]
    return corners[(obs["tick"] // 20) % len(corners)]


def _choose_movement(obs: dict[str, Any], match: Any) -> Turn:
    me = obs["self"]
    my_pos = _pos(me["pos"])
    enemies = obs.get("enemies", [])
    enemy = enemies[0] if enemies else None
    enemy_pos = _pos(enemy["pos"]) if enemy else None

    rules = _get(match, "rules", {}) or {}
    push_dist = _get(_get(_get(rules, "attacks", {}), "repulsor", {}), "push", 3)
    repulsor_ready = me.get("cooldowns", {}).get("repulsor", 99) == 0
    has_power = (me.get("buffs", {}) or {}).get("power", 0) > 0

    in_danger = _danger_at(obs, my_pos, 0, 2) > 0
    out_of_zone = not _in_safe_zone(obs, my_pos)
    pickup_goal = _choose_pickup(obs, match)

    if in_danger or out_of_zone or enemy_pos is not None:
        candidates: list[tuple[Turn, Pos, bool]] = [({}, my_pos, False)]
        for m in obs.get("moves", []):
            candidates.append(({"move": m["dir"]}, _pos(m["tile"]), False))
        for d in obs.get("dashes", []):
            candidates.append(({"dash": d["dir"]}, _pos(d["tile"]), True))

        # Brawler fights close (range 2-3, or range 1 when hunting a wall-slam)
        target_range = 2 if (has_power or repulsor_ready) else 3
        center = _pos(obs["zone"]["center"])
        safe_r = _effective_radius(obs)

        best_turn: Turn = {}
        best_score = -10**9

        for turn, tile, is_dash in candidates:
            score = 0.0

            # Danger avoidance
            hit_now = 0 if is_dash else _danger_at(obs, tile, 0, 0)
            hit_soon = _danger_at(obs, tile, 1, 2)
            hit_later = _danger_at(obs, tile, 3, 4)
            score -= hit_now * 520 + hit_soon * 250 + hit_later * 50

            # Zone safety
            d_center = _cheb(tile, center)
            if d_center > safe_r:
                score -= 320 + (d_center - safe_r) * 50
            else:
                score -= d_center * 1.2

            # Dash cost (allow offensive dash-in for guaranteed wall-slam!)
            slam_bonus = 0
            if enemy_pos is not None and repulsor_ready:
                slam_bonus = _repulsor_combo_score(obs, tile, enemy_pos, push_dist)

            if is_dash:
                if in_danger:
                    score -= 15
                elif slam_bonus >= 75:
                    score -= 25  # Worth dashing in for wall-slam!
                else:
                    score -= 110

            # Pickup pull
            if pickup_goal is not None:
                score -= _cheb(tile, pickup_goal) * 20
                if tile == pickup_goal:
                    score += 75

            # Aggressive brawler positioning
            if enemy_pos is not None:
                d_enemy = _cheb(tile, enemy_pos)
                score -= abs(d_enemy - target_range) * 16
                score += slam_bonus
                if _has_los(tile, enemy_pos):
                    score += 10

            if score > best_score:
                best_score = score
                best_turn = turn

        if not in_danger and out_of_zone and enemy_pos is None:
            bfs_dir = _bfs_step(obs, center)
            if bfs_dir:
                return {"move": bfs_dir}
        return best_turn

    if pickup_goal is not None:
        step = _bfs_step(obs, pickup_goal)
        if step:
            return {"move": step}

    step = _bfs_step(obs, _choose_search_goal(obs))
    return {"move": step} if step else {}


def _end_tile(obs: dict[str, Any], turn: Turn) -> Pos:
    if "move" in turn:
        for m in obs.get("moves", []):
            if m["dir"] == turn["move"]:
                return _pos(m["tile"])
    if "dash" in turn:
        for d in obs.get("dashes", []):
            if d["dir"] == turn["dash"]:
                return _pos(d["tile"])
    return _pos(obs["self"]["pos"])


def _choose_attack(obs: dict[str, Any], match: Any, origin: Pos) -> dict[str, Any] | None:
    enemies = obs.get("enemies", [])
    if not enemies:
        return None
    enemy = enemies[0]
    enemy_pos = _pos(enemy["pos"])
    cds = obs["self"].get("cooldowns", {})
    ready = lambda name: cds.get(name, 99) == 0
    dist = _cheb(origin, enemy_pos)

    rules = _get(match, "rules", {}) or {}
    attacks = _get(rules, "attacks", {}) or {}
    frost_range = _get(_get(attacks, "frostburst", {}), "range", 7)
    ranged_speed = _get(_get(attacks, "ranged", {}), "speed", 2)

    # 1. Repulsor immediately when adjacent
    if dist == 1 and ready("repulsor"):
        return {"name": "repulsor"}

    # 2. Frostburst on stunned/slowed/dashless targets
    dash_cd = enemy.get("dash_cooldown", 0)
    slow_left = enemy.get("slow_ticks_left", 0)
    stunned = enemy.get("state") == "stunned"
    if ready("frostburst") and dist <= frost_range and _has_los(origin, enemy_pos):
        if stunned or dash_cd > 1 or slow_left > 0:
            return {"name": "frostburst", "target": [enemy_pos[0], enemy_pos[1]]}

    # 3. Ranged with velocity lead or 1-bounce bank shot around pillars
    if ready("ranged"):
        if _has_los(origin, enemy_pos):
            travel = min(4.0, dist / max(1, ranged_speed))
            px = _clamp(round(enemy_pos[0] + _MEM.enemy_vel[0] * travel * 0.75), 0, _MEM.width - 1)
            py = _clamp(round(enemy_pos[1] + _MEM.enemy_vel[1] * travel * 0.75), 0, _MEM.height - 1)
            target = (px, py) if (not _is_wall(px, py) and _has_los(origin, (px, py))) else enemy_pos
            return {"name": "ranged", "target": [target[0], target[1]]}
        bank = _find_bank_shot_target(origin, enemy_pos)
        if bank is not None:
            return {"name": "ranged", "target": [bank[0], bank[1]]}

    return None


def decide(observation: dict[str, Any], match: Any = None) -> Turn:
    """Entry point called every tick by Victris Arena / arena_sim."""
    _init_match(match)

    enemies = observation.get("enemies", [])
    tick = observation["tick"]
    if enemies:
        epos = _pos(enemies[0]["pos"])
        if _MEM.last_enemy_pos is not None and 0 < tick - _MEM.last_enemy_tick <= 4:
            dt = tick - _MEM.last_enemy_tick
            vx = max(-1.0, min(1.0, (epos[0] - _MEM.last_enemy_pos[0]) / dt))
            vy = max(-1.0, min(1.0, (epos[1] - _MEM.last_enemy_pos[1]) / dt))
            _MEM.enemy_vel = (vx, vy)
        else:
            _MEM.enemy_vel = (0.0, 0.0)
        _MEM.last_enemy_pos = epos
        _MEM.last_enemy_tick = tick

    if observation["self"].get("state", "idle") != "idle":
        return {}

    turn = _choose_movement(observation, match)
    attack = _choose_attack(observation, match, _end_tile(observation, turn))
    if attack is not None:
        turn["attack"] = attack
    return turn
