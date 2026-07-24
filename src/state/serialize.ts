import { GRID_H, GRID_W } from '../config';
import { MAX_MK } from '../data/buildings';
import { RESERVES } from '../data/map';
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
  timer?: number;
  crafting?: boolean;
  inOre?: number;
  /** buffered crystal (assembler); absent in saves written before crystal existed */
  inCry?: number;
  outBuf?: number;
  outIdx?: number;
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

export interface SaveV1 {
  v: 1;
  savedAt: number;
  money: number;
  lives: number;
  wave: number;
  speed: 1 | 2 | 3;
  auto: boolean;
  buildings: SavedBuilding[];
  items: SavedItem[];
  /** surveys bought (drives the next survey's price); absent in pre-prospecting saves */
  surveys?: number;
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
  surveys?: number;
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
    v: 1,
    savedAt: Date.now(),
    money: gs.money,
    lives: gs.lives,
    wave: gs.wave,
    speed: gs.speed,
    auto: gs.auto,
    surveys: gs.surveys ?? 0,
    patches: terrain.patches,
    tiles: terrain.tiles,
    map: terrain.map,
    buildings: buildings.map((b) => {
      const sb: SavedBuilding = { t: b.type, x: b.x, y: b.y, d: b.dir, inv: b.invested };
      if (b.mk > 1) sb.mk = b.mk;
      if (b.path) sb.path = b.path;
      if (b.ammo > 0) sb.ammo = b.ammo;
      if (b.timer > 0) sb.timer = b.timer;
      if (b.crafting) sb.crafting = true;
      if (b.inputOre > 0) sb.inOre = b.inputOre;
      if (b.inputCrystal > 0) sb.inCry = b.inputCrystal;
      if (b.outputBuf > 0) sb.outBuf = b.outputBuf;
      if (b.outIdx > 0) sb.outIdx = b.outIdx;
      return sb;
    }),
    items: items.map((it) => {
      const si: SavedItem = { t: it.type, cx: it.cx, cy: it.cy, px: it.sprite.x, py: it.sprite.y };
      if (it.sprite.alpha < 1) si.a = it.sprite.alpha;
      return si;
    }),
  };
}

const BUILDING_TYPES: readonly BuildingType[] = [
  'belt',
  'splitter',
  'tunnel',
  'miner',
  'press',
  'forge',
  'assembler',
  'chiller',
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

function inGrid(x: unknown, y: unknown): boolean {
  return isFiniteNum(x) && isFiniteNum(y) && x >= 0 && x < GRID_W && y >= 0 && y < GRID_H;
}

/**
 * Structural validation of an untrusted save (localStorage can be hand-edited,
 * cloud JSON can be anything). Returns null unless the whole save is sound —
 * a partially-restored factory is worse than a fresh start.
 */
export function validateSave(raw: unknown): SaveV1 | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const s = raw as Record<string, unknown>;
  if (s.v !== 1) return null;
  if (!isFiniteNum(s.savedAt) || !isFiniteNum(s.money) || s.money < 0) return null;
  if (!isFiniteNum(s.lives) || s.lives < 1) return null;
  if (!isFiniteNum(s.wave) || s.wave < 1 || s.wave > 10000) return null;
  if (s.speed !== 1 && s.speed !== 2 && s.speed !== 3) return null;
  if (typeof s.auto !== 'boolean') return null;
  if (!Array.isArray(s.buildings) || !Array.isArray(s.items)) return null;

  const seen = new Set<string>();
  for (const b of s.buildings as Record<string, unknown>[]) {
    if (typeof b !== 'object' || b === null) return null;
    if (!BUILDING_TYPES.includes(b.t as BuildingType)) return null;
    if (!inGrid(b.x, b.y)) return null;
    if (b.d !== 0 && b.d !== 1 && b.d !== 2 && b.d !== 3) return null;
    if (!isFiniteNum(b.inv) || b.inv < 0) return null;
    if (b.mk !== undefined && (!isFiniteNum(b.mk) || b.mk < 1 || b.mk > MAX_MK)) return null;
    if (b.path !== undefined && b.path !== null && !PATH_IDS.includes(b.path as PathId)) return null;
    for (const key of ['ammo', 'timer', 'inOre', 'inCry', 'outBuf', 'outIdx'] as const) {
      if (b[key] !== undefined && (!isFiniteNum(b[key]) || (b[key] as number) < 0)) return null;
    }
    if (b.crafting !== undefined && typeof b.crafting !== 'boolean') return null;
    const cell = `${b.x},${b.y}`;
    if (seen.has(cell)) return null; // two buildings on one tile
    seen.add(cell);
  }

  for (const it of s.items as Record<string, unknown>[]) {
    if (typeof it !== 'object' || it === null) return null;
    if (!ITEM_TYPES.includes(it.t as ItemType)) return null;
    if (!inGrid(it.cx, it.cy)) return null;
    if (!isFiniteNum(it.px) || !isFiniteNum(it.py)) return null;
    if (it.a !== undefined && (!isFiniteNum(it.a) || it.a < 0 || it.a > 1)) return null;
  }

  if (s.surveys !== undefined && (!isFiniteNum(s.surveys) || s.surveys < 0 || s.surveys > 1000)) return null;
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

  return raw as SaveV1;
}
