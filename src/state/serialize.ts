import { GRID_H, GRID_W, TILE } from '../config';
import {
  isMachine,
  isTower,
  MACHINES,
  MAX_MK,
  recipeNeeds,
  TOWERS,
  UPGRADE_TREE,
} from '../data/buildings';
import { RESERVES } from '../data/map';
import { EARLY_SEND_WINDOW } from '../data/waves';
import { Building, BuildingType, Dir, ItemEnt, ItemType, PathId } from '../types';

/** No tile can legitimately hold more than the richest deposit type. */
const MAX_TILE_RESERVE = Math.max(...Object.values(RESERVES));

/**
 * Run save format. Pure module: no Phaser objects cross this boundary (sprites
 * are flattened to x/y/alpha), no storage or network I/O — that lives in
 * `persistence.ts` and (later) `services/cloud.ts`. Saves are only ever taken
 * during the build phase, so enemies/bullets never serialize and `phase` is
 * implicitly 'build'. Bump the version and branch in `validateSave` when the
 * format changes.
 */

export interface SavedBuilding {
  t: BuildingType;
  x: number;
  y: number;
  d: Dir;
  /** total money invested (sell refunds half) */
  inv: number;
  mk?: number;
  path?: PathId | null;
  ammo?: number;
  /** rounds delivered into this tower over the run (gates its upgrades) */
  fed?: number;
  timer?: number;
  crafting?: boolean;
  /** buffered machine inputs, keyed by item type (v2+) */
  in?: Partial<Record<ItemType, number>>;
  /** v1 only: buffered ore. Read for migration, never written. */
  inOre?: number;
  /** v1 only: buffered crystal. Read for migration, never written. */
  inCry?: number;
  outBuf?: number;
  outIdx?: number;
  /** absent keeps a sorter useful as an ordinary splitter in older saves */
  filter?: ItemType | null;
}

export interface SavedItem {
  t: ItemType;
  /** belt cell the item belongs to */
  cx: number;
  cy: number;
  /** sprite pixel position (mid-glide is fine — it resumes gliding to the cell center) */
  px: number;
  py: number;
  /** sprite alpha; < 1 means tunnel transit */
  a?: number;
}

/**
 * A resource tile whose reserves differ from a full deposit — mined down or
 * exhausted (`n: 0`). Only the changed tiles are stored, so an untouched map
 * costs nothing. Prospected patches ride along in `patches`.
 */
export interface SavedTile {
  x: number;
  y: number;
  /** units left; 0 means the tile is spent and has reverted to grass */
  n: number;
}

export interface SavedPatch {
  x: number;
  y: number;
  w: number;
  h: number;
  k: 'ore' | 'crystal';
}

export const SAVE_VERSION = 2;

export interface SaveV1 {
  v: typeof SAVE_VERSION;
  savedAt: number;
  money: number;
  lives: number;
  wave: number;
  speed: 1 | 2 | 3;
  auto: boolean;
  /** elapsed build-phase time, used to preserve early-send entitlement */
  buildElapsed?: number;
  buildings: SavedBuilding[];
  items: SavedItem[];
  /** surveys bought (drives the next survey's price); absent in pre-prospecting saves */
  surveys?: number;
  /** research banked toward the next level */
  research?: number;
  researchLevel?: number;
  /** research cards taken, by id -> count. Mods are recomputed from this on load. */
  taken?: Record<string, number>;
  patches?: SavedPatch[];
  tiles?: SavedTile[];
  /** layout id; absent (or unknown) falls back to the default map */
  map?: string;
}

interface Snapshot {
  money: number;
  lives: number;
  wave: number;
  speed: 1 | 2 | 3;
  auto: boolean;
  buildElapsed?: number;
  surveys?: number;
  research?: number;
  researchLevel?: number;
  taken?: Record<string, number>;
}

/** What the grid contributes to a save: revealed patches + every changed tile. */
export interface TerrainSnapshot {
  patches: SavedPatch[];
  tiles: SavedTile[];
  map?: string;
}

export function captureRun(
  buildings: readonly Building[],
  items: readonly ItemEnt[],
  gs: Snapshot,
  terrain: TerrainSnapshot = { patches: [], tiles: [] },
): SaveV1 {
  return {
    v: SAVE_VERSION,
    savedAt: Date.now(),
    money: gs.money,
    lives: gs.lives,
    wave: gs.wave,
    speed: gs.speed,
    auto: gs.auto,
    buildElapsed: Math.min(EARLY_SEND_WINDOW, Math.max(0, gs.buildElapsed ?? 0)),
    surveys: gs.surveys ?? 0,
    research: gs.research ?? 0,
    researchLevel: gs.researchLevel ?? 0,
    taken: { ...(gs.taken ?? {}) },
    patches: terrain.patches,
    tiles: terrain.tiles,
    map: terrain.map,
    buildings: buildings.map(captureBuilding),
    items: items.map((it) => {
      const si: SavedItem = { t: it.type, cx: it.cx, cy: it.cy, px: it.sprite.x, py: it.sprite.y };
      if (it.sprite.alpha < 1) si.a = it.sprite.alpha;
      return si;
    }),
  };
}

/**
 * One building in save form.
 *
 * Split out of `captureRun` so undo-a-sale can snapshot a building through the
 * exact same function the save file uses. That is the point: a field added here
 * for persistence is automatically carried across an undo too, rather than
 * quietly restoring a tower that has forgotten its upgrade path.
 */
export function captureBuilding(b: Building): SavedBuilding {
  const sb: SavedBuilding = { t: b.type, x: b.x, y: b.y, d: b.dir, inv: b.invested };
  if (b.mk > 1) sb.mk = b.mk;
  if (b.path) sb.path = b.path;
  if (isTower(b.type)) sb.ammo = b.ammo;
  if (b.fed > 0) sb.fed = b.fed;
  if (b.timer > 0) sb.timer = b.timer;
  if (b.crafting) sb.crafting = true;
  const buffered = Object.entries(b.inputs).filter(([, n]) => (n ?? 0) > 0);
  if (buffered.length > 0) sb.in = Object.fromEntries(buffered);
  if (b.outputBuf > 0) sb.outBuf = b.outputBuf;
  if (b.outIdx > 0) sb.outIdx = b.outIdx;
  if (b.type === 'sorter' && b.filter) sb.filter = b.filter;
  return sb;
}

const BUILDING_TYPES: readonly BuildingType[] = [
  'belt',
  'splitter',
  'sorter',
  'tunnel',
  'miner',
  'press',
  'forge',
  'assembler',
  'chiller',
  'lab',
  'tower',
  'cannon',
  'lancer',
  'cryo',
];
const ITEM_TYPES: readonly ItemType[] = ['ore', 'crystal', 'ammo', 'shell', 'piercing', 'coolant'];
const PATH_IDS: readonly PathId[] = [
  'sniper',
  'gatling',
  'siege',
  'flak',
  'railgun',
  'volley',
  'cryostasis',
  'blizzard',
];

function isFiniteNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * Whole numbers only. Anything that indexes the grid, counts items, or picks a
 * tier must be an integer: `x: 1.5` is finite and in range but addresses no
 * cell, and a fractional `mk` indexes past the end of an upgrade tier list.
 */
function isInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n);
}

/** An integer in [0, max]. The workhorse for every counter and buffer. */
function isCount(n: unknown, max: number): n is number {
  return isInt(n) && n >= 0 && n <= max;
}

function inGrid(x: unknown, y: unknown): boolean {
  return isInt(x) && isInt(y) && x >= 0 && x < GRID_W && y >= 0 && y < GRID_H;
}

/**
 * Generous ceilings for values that have no natural cap but must not be
 * absurd — a tampered save should never be able to hand the sim an
 * astronomically large counter and have it silently propagate into money,
 * upgrade gating or the HUD.
 */
const MAX_INVESTED = 10_000_000;
const MAX_FED = 10_000_000;
/** Seconds. Far above any cycle in `buildings.ts`, even with every speed mod stacked. */
const MAX_TIMER = 3_600;
const MAX_RESEARCH = 1_000_000_000;

/** Cells an item may legitimately rest on — the same set `ConveyorSystem` will accept. */
const ITEM_HOSTS: readonly BuildingType[] = ['belt', 'splitter', 'sorter', 'tunnel'];

/**
 * Structural validation of an untrusted save (localStorage can be hand-edited,
 * cloud JSON can be anything). Returns null unless the whole save is sound —
 * a partially-restored factory is worse than a fresh start.
 */
export function validateSave(raw: unknown): SaveV1 | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const s = raw as Record<string, unknown>;
  const legacy = s.v === 1;
  if (!legacy && s.v !== SAVE_VERSION) return null;
  if (!isFiniteNum(s.savedAt) || !isFiniteNum(s.money) || s.money < 0) return null;
  if (!isFiniteNum(s.lives) || s.lives < 1) return null;
  if (!isFiniteNum(s.wave) || s.wave < 1 || s.wave > 10000) return null;
  if (s.speed !== 1 && s.speed !== 2 && s.speed !== 3) return null;
  if (typeof s.auto !== 'boolean') return null;
  if (
    s.buildElapsed !== undefined &&
    (!isFiniteNum(s.buildElapsed) || s.buildElapsed < 0 || s.buildElapsed > EARLY_SEND_WINDOW)
  ) return null;
  if (!Array.isArray(s.buildings) || !Array.isArray(s.items)) return null;

  /** cell key -> the building type occupying it, so items can be host-checked below */
  const occupied = new Map<string, BuildingType>();
  for (const b of s.buildings as Record<string, unknown>[]) {
    if (typeof b !== 'object' || b === null) return null;
    if (!BUILDING_TYPES.includes(b.t as BuildingType)) return null;
    const type = b.t as BuildingType;
    if (!inGrid(b.x, b.y)) return null;
    if (b.d !== 0 && b.d !== 1 && b.d !== 2 && b.d !== 3) return null;
    if (!isCount(b.inv, MAX_INVESTED)) return null;
    if (b.mk !== undefined && (!isInt(b.mk) || b.mk < 1 || b.mk > MAX_MK)) return null;

    // A specialization must belong to *this* tower's own tree. `pathOf` does a
    // `.find(...)!`, so a cannon carrying 'sniper' yields undefined and throws
    // the moment combat or the upgrade panel resolves its stats. A globally
    // valid id is not good enough.
    if (b.path !== undefined && b.path !== null) {
      if (!PATH_IDS.includes(b.path as PathId)) return null;
      if (!isTower(type)) return null;
      if (!UPGRADE_TREE[type].paths.some((p) => p.id === b.path)) return null;
    }
    // Past Mk2 a tower must have chosen a path; without one `nextTier` and the
    // Mk3+ stat lookup have no branch to read.
    if (isInt(b.mk) && b.mk > 2 && (b.path === undefined || b.path === null)) return null;

    // Ammo is bounded by the magazine the tower actually has, and only towers
    // have one at all.
    if (b.ammo !== undefined) {
      if (!isTower(type)) return null;
      if (!isCount(b.ammo, TOWERS[type].ammoCap)) return null;
    }
    if (!isCount(b.fed ?? 0, MAX_FED)) return null;
    if (b.timer !== undefined && (!isFiniteNum(b.timer) || b.timer < 0 || b.timer > MAX_TIMER)) return null;
    if (b.outIdx !== undefined && !isCount(b.outIdx, 2)) return null; // splitter round-robin: straight/left/right
    if (b.crafting !== undefined && typeof b.crafting !== 'boolean') return null;
    // A filter on any other building is inert state at best and a sign of a
    // hand-edited save at worst. Null is accepted explicitly because clients
    // may write the useful-by-default, ordinary-splitter mode rather than omit it.
    if (b.filter !== undefined) {
      if (type !== 'sorter') return null;
      if (b.filter !== null && !ITEM_TYPES.includes(b.filter as ItemType)) return null;
    }

    // Machine buffers: only machines have them, only for items their own recipe
    // accepts, and never above the buffer's cap. Restoring a machine holding
    // stock it can never consume is the exact failure `migrateV1` exists to
    // prevent — a hand-edited save must not reintroduce it.
    if (b.outBuf !== undefined) {
      if (!isMachine(type)) return null;
      // NOT `outputCap`. A machine starts a cycle whenever its buffer is *below*
      // the cap and then adds `outputPer`, so a chiller (cap 4, 2 per cycle) can
      // legitimately finish holding 5. Capping at `outputCap` would reject real
      // saves and delete the run.
      const { outputCap, outputPer } = MACHINES[type];
      if (!isCount(b.outBuf, outputCap + outputPer - 1)) return null;
    }
    if (b.in !== undefined) {
      if (typeof b.in !== 'object' || b.in === null || Array.isArray(b.in)) return null;
      if (!isMachine(type)) return null;
      for (const [item, n] of Object.entries(b.in as Record<string, unknown>)) {
        if (!ITEM_TYPES.includes(item as ItemType)) return null;
        if (recipeNeeds(type, item as ItemType) === 0) return null;
        if (!isCount(n, MACHINES[type].inputCap)) return null;
      }
    }
    // v1-only fields; migrateV1 drops them, but they must still be sane numbers.
    for (const key of ['inOre', 'inCry'] as const) {
      if (b[key] !== undefined && !isCount(b[key], Number.MAX_SAFE_INTEGER)) return null;
    }

    const cell = `${b.x},${b.y}`;
    if (occupied.has(cell)) return null; // two buildings on one tile
    occupied.set(cell, type);
  }

  const itemCells = new Set<string>();
  for (const it of s.items as Record<string, unknown>[]) {
    if (typeof it !== 'object' || it === null) return null;
    if (!ITEM_TYPES.includes(it.t as ItemType)) return null;
    if (!inGrid(it.cx, it.cy)) return null;
    // An item only ever rests on a belt-like cell. Anywhere else it is
    // unreachable cargo that no system will ever move again.
    const host = occupied.get(`${it.cx},${it.cy}`);
    if (!host || !ITEM_HOSTS.includes(host)) return null;
    // One item per cell is the core conveyor invariant; two would leave an
    // orphan sprite the belt can never advance.
    const key = `${it.cx},${it.cy}`;
    if (itemCells.has(key)) return null;
    itemCells.add(key);
    // Sprite position may be mid-glide, but must be on the board.
    if (!isFiniteNum(it.px) || it.px < 0 || it.px > GRID_W * TILE) return null;
    if (!isFiniteNum(it.py) || it.py < 0 || it.py > GRID_H * TILE) return null;
    if (it.a !== undefined && (!isFiniteNum(it.a) || it.a < 0 || it.a > 1)) return null;
  }

  if (s.surveys !== undefined && !isCount(s.surveys, 1000)) return null;
  if (s.research !== undefined && (!isFiniteNum(s.research) || s.research < 0 || s.research > MAX_RESEARCH)) return null;
  if (s.researchLevel !== undefined && !isCount(s.researchLevel, 100_000)) return null;
  if (s.taken !== undefined) {
    if (typeof s.taken !== 'object' || s.taken === null || Array.isArray(s.taken)) return null;
    for (const [id, n] of Object.entries(s.taken as Record<string, unknown>)) {
      // ids come back as object keys, so they must be shape-checked like any other untrusted string
      if (!/^[a-z0-9_]{1,40}$/.test(id)) return null;
      if (!isFiniteNum(n) || n < 0 || n > 999) return null;
    }
  }
  // An unknown map id is tolerated (falls back to the default) but a non-string is corruption
  if (s.map !== undefined && typeof s.map !== 'string') return null;

  if (s.patches !== undefined) {
    if (!Array.isArray(s.patches)) return null;
    for (const p of s.patches as Record<string, unknown>[]) {
      if (typeof p !== 'object' || p === null) return null;
      if (p.k !== 'ore' && p.k !== 'crystal') return null;
      if (!inGrid(p.x, p.y)) return null;
      if (!isFiniteNum(p.w) || !isFiniteNum(p.h) || p.w < 1 || p.h < 1) return null;
      // must land entirely on the board
      if (!inGrid((p.x as number) + (p.w as number) - 1, (p.y as number) + (p.h as number) - 1)) return null;
    }
  }

  if (s.tiles !== undefined) {
    if (!Array.isArray(s.tiles)) return null;
    for (const t of s.tiles as Record<string, unknown>[]) {
      if (typeof t !== 'object' || t === null) return null;
      if (!inGrid(t.x, t.y)) return null;
      if (!isFiniteNum(t.n) || t.n < 0 || t.n > MAX_TILE_RESERVE) return null;
    }
  }

  return legacy ? migrateV1(s as unknown as SaveV1) : (raw as SaveV1);
}

/**
 * v1 → v2. Recipes changed shape: past the press, machines now consume ammo
 * rather than raw ore, so a v1 machine's buffered `inOre`/`inCry` is stock its
 * new recipe will never accept — the machine would restore permanently stalled.
 * Dropping the buffers costs the player a few seconds of production and never
 * a building, which is the cheapest correct migration.
 */
function migrateV1(s: SaveV1): SaveV1 {
  return {
    ...s,
    v: SAVE_VERSION,
    buildings: s.buildings.map(({ inOre: _o, inCry: _c, ...b }) => b),
  };
}
