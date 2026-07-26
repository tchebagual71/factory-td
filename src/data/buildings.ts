import { BuildingType, ItemType, PathId } from '../types';
import { Mods, NO_MODS } from './mods';

export const BELT = { cost: 5 };
export const SPLITTER = { cost: 20 };
export const TUNNEL = { cost: 15, reach: 4 }; // exit must be ≤ reach tiles ahead, same facing
/** Consumes finished goods for research. Has no output, so it needs no facing. */
export const LAB = { cost: 200 };

/** One miner building, two resources: the tile it stands on decides what it digs and how fast. */
export const MINER = {
  cost: 50,
  cycle: 1.5, // seconds per ore produced
  crystalCycle: 2.6, // crystal comes out of the ground far slower — it is the scarce input
};

export function minerCycle(resource: 'ore' | 'crystal'): number {
  return resource === 'crystal' ? MINER.crystalCycle : MINER.cycle;
}

/** What one craft cycle consumes, by item type. Absent = not accepted. */
export type Recipe = Partial<Record<ItemType, number>>;

/** Crafting machines: `inputs` per cycle -> outputPer output items per cycle. */
export interface MachineStats {
  cost: number;
  cycle: number;
  inputs: Recipe;
  /** per input type */
  inputCap: number;
  outputCap: number;
  /** items produced per completed cycle — >1 is what makes coolant cheap */
  outputPer: number;
  output: ItemType;
}

export type MachineType = 'press' | 'forge' | 'assembler' | 'chiller';

/**
 * The production chain. Only the press eats raw ore; everything else is built
 * from the ammo it makes, so `ore → ammo → {shell, piercing, coolant}`.
 *
 * That single intermediate is what turns four independent converters into a
 * factory: presses are a contested backbone, splitters have a real job routing
 * ammo between the guns and the deeper lines, and a press shortage cascades.
 *
 * Ore cost per output is unchanged from the flat-graph version (see `oreCost`)
 * — the topology moved, the difficulty curve did not.
 */
export const MACHINES: Record<MachineType, MachineStats> = {
  press: { cost: 60, cycle: 1.0, inputs: { ore: 1 }, inputCap: 5, outputCap: 3, outputPer: 1, output: 'ammo' },
  forge: { cost: 100, cycle: 2.5, inputs: { ammo: 2 }, inputCap: 8, outputCap: 2, outputPer: 1, output: 'shell' },
  assembler: { cost: 170, cycle: 3.0, inputs: { ammo: 2, crystal: 1 }, inputCap: 6, outputCap: 2, outputPer: 1, output: 'piercing' },
  // Deliberately the cheapest line in the game: two coolant per ammo, so a
  // single supply line can keep several cryo towers pulsing.
  chiller: { cost: 70, cycle: 1.4, inputs: { ammo: 1 }, inputCap: 5, outputCap: 4, outputPer: 2, output: 'coolant' },
};

/** Raw resources — the leaves of the recipe graph, dug rather than crafted. */
export const RAW_ITEMS: readonly ItemType[] = ['ore', 'crystal'];

/**
 * Every input this machine's recipe consumes, as [item, count] pairs.
 *
 * Resolved once per machine type: recipes are static, and ProductionSystem asks
 * for this on every machine on every frame — `Object.entries` there meant a
 * fresh array of fresh tuples per machine per tick. Callers must not mutate it.
 */
const RECIPE_INPUTS: Record<MachineType, [ItemType, number][]> = Object.fromEntries(
  (Object.keys(MACHINES) as MachineType[]).map((m) => [m, Object.entries(MACHINES[m].inputs) as [ItemType, number][]]),
) as Record<MachineType, [ItemType, number][]>;

export function recipeInputs(type: MachineType): readonly [ItemType, number][] {
  return RECIPE_INPUTS[type];
}

/** How much of `item` this machine's recipe wants (0 = it won't accept it). */
export function recipeNeeds(type: MachineType, item: ItemType): number {
  return MACHINES[type].inputs[item] ?? 0;
}

/** The machine that produces `item`, or null if it is raw (or nothing makes it). */
export function producerOf(item: ItemType): MachineType | null {
  const found = (Object.keys(MACHINES) as MachineType[]).find((m) => MACHINES[m].output === item);
  return found ?? null;
}

/**
 * Raw ore consumed per unit of `item`, resolving the whole chain. Crystal is a
 * separate raw input and is deliberately NOT counted here — the balance
 * invariants that use this reason about ore throughput, and crystal scarcity is
 * measured on its own.
 *
 * Depth-limited rather than cycle-detecting: `recipeGraphIsAcyclic` is the test
 * that guarantees termination, and this stays a simple recursion.
 */
export function oreCost(item: ItemType, depth = 0): number {
  if (item === 'ore') return 1;
  if (item === 'crystal' || depth > 8) return 0;
  const maker = producerOf(item);
  if (!maker) return 0;
  const stats = MACHINES[maker];
  let sum = 0;
  for (const [input, n] of recipeInputs(maker)) sum += oreCost(input, depth + 1) * n;
  return sum / stats.outputPer;
}

/** Crystal consumed per unit of `item` — the mirror of `oreCost` for the scarce input. */
export function crystalCost(item: ItemType, depth = 0): number {
  if (item === 'crystal') return 1;
  if (item === 'ore' || depth > 8) return 0;
  const maker = producerOf(item);
  if (!maker) return 0;
  const stats = MACHINES[maker];
  let sum = 0;
  for (const [input, n] of recipeInputs(maker)) sum += crystalCost(input, depth + 1) * n;
  return sum / stats.outputPer;
}

export interface TowerStats {
  cost: number;
  range: number;
  damage: number;
  fireRate: number; // shots per second
  ammoCap: number;
  startAmmo: number;
  bulletSpeed: number;
  splash: number; // px radius, 0 = single target
  /** enemies one shot can skewer before it dies; 0 = homing single-hit projectile */
  pierce: number;
  /** support towers only: fraction of normal speed applied in range (1 = no slow) */
  slowFactor: number;
  /** seconds a slow lasts after the pulse */
  slowDur: number;
  ammoType: ItemType;
}

export type TowerType = 'tower' | 'cannon' | 'lancer' | 'cryo';
export const TOWER_TYPES: readonly TowerType[] = ['tower', 'cannon', 'lancer', 'cryo'];

export const TOWERS: Record<TowerType, TowerStats> = {
  tower: {
    cost: 90,
    range: 118,
    damage: 18,
    fireRate: 1.2,
    ammoCap: 15,
    startAmmo: 10, // pre-loaded so wave 1 flows before a factory exists
    bulletSpeed: 520,
    splash: 0,
    pierce: 0,
    slowFactor: 1,
    slowDur: 0,
    ammoType: 'ammo',
  },
  cannon: {
    cost: 140,
    range: 138,
    damage: 45,
    fireRate: 0.45,
    ammoCap: 8,
    startAmmo: 4,
    bulletSpeed: 380,
    splash: 42,
    pierce: 0,
    slowFactor: 1,
    slowDur: 0,
    ammoType: 'shell',
  },
  /**
   * Tier-2 tower: fires a lance in a straight line that skewers a whole column
   * of enemies. On a fixed single-file path that is devastating — but every
   * round costs crystal, so it is a mid-game investment, not an opener.
   */
  lancer: {
    cost: 230,
    range: 155,
    damage: 30,
    fireRate: 0.8,
    ammoCap: 6,
    startAmmo: 3,
    bulletSpeed: 900,
    splash: 0,
    pierce: 3,
    slowFactor: 1,
    slowDur: 0,
    ammoType: 'piercing',
  },
  /**
   * Support tower: deals no damage at all. It pulses coolant over everything in
   * range, and the slow multiplies every gun covering the same choke point —
   * more seconds under fire is more damage without another round of ammo.
   */
  cryo: {
    cost: 160,
    range: 112,
    damage: 0,
    fireRate: 0.6, // pulses per second
    ammoCap: 10,
    startAmmo: 5,
    bulletSpeed: 0,
    splash: 0,
    pierce: 0,
    slowFactor: 0.55,
    slowDur: 2.5,
    ammoType: 'coolant',
  },
};

export function isTower(type: BuildingType): type is TowerType {
  return TOWER_TYPES.includes(type as TowerType);
}

/** Towers that shoot. Support towers (damage 0) are excluded — they multiply these instead. */
export const DAMAGE_TOWERS: readonly TowerType[] = TOWER_TYPES.filter((t) => TOWERS[t].damage > 0);

/** A support tower deals no damage and works by slowing whatever walks into range. */
export function isSupport(type: TowerType): boolean {
  return TOWERS[type].damage === 0 && TOWERS[type].slowFactor < 1;
}

/**
 * Branching Mk upgrades: Mk2 is a shared tier, then the tower specializes down
 * one of two paths for Mk3/Mk4. Each tier costs money PLUS the tower's full
 * loaded magazine — the factory literally arms the upgrade, so throughput
 * gates permanent power.
 */
export interface StatMult {
  damage: number;
  range: number;
  fireRate: number;
  splash?: number;
  bulletSpeed?: number;
  pierce?: number;
  /** multiplies the *remaining* speed, so < 1 means a deeper slow */
  slow?: number;
  slowDur?: number;
}

/** However deep the slow stacks, enemies never stop dead. */
export const MIN_SLOW_FACTOR = 0.2;

/** One purchasable tier. `mult` is cumulative vs BASE stats, not vs the previous tier. */
export interface UpgradeTier {
  money: number;
  ammo: number;
  mult: StatMult;
}

export interface UpgradePath {
  id: PathId;
  name: string;
  desc: string;
  /** [Mk3, Mk4] */
  tiers: [UpgradeTier, UpgradeTier];
}

export const MAX_MK = 4;

/**
 * Magazines' worth of ammo a tower must have been *delivered* before each tier
 * unlocks, indexed by the mark being bought. Scaled by magazine size so a
 * lancer (6 rounds, slow) and a gun (15 rounds, fast) are asked for a
 * comparable amount of service rather than the same raw count.
 *
 * The money and the full magazine are what an upgrade *costs*; this is what
 * makes it *earned*. A tier-1 tower that has been well supplied all run is
 * ready long before one bought thirty seconds ago with spare cash — which is
 * exactly the behaviour the whole game is about. Tune here.
 */
const FED_MAGAZINES: readonly number[] = [0, 0, 2.5, 8, 18];

/** Rounds delivered into a tower before it may be upgraded to `targetMk`. */
export function fedRequired(type: TowerType, targetMk: number): number {
  return Math.round(TOWERS[type].ammoCap * (FED_MAGAZINES[targetMk] ?? 0));
}

export const UPGRADE_TREE: Record<
  TowerType,
  { mk2: UpgradeTier; paths: [UpgradePath, UpgradePath] }
> = {
  tower: {
    mk2: { money: 150, ammo: TOWERS.tower.ammoCap, mult: { damage: 1.5, range: 1.12, fireRate: 1.12 } },
    paths: [
      {
        id: 'sniper',
        name: 'SNIPER',
        desc: 'Huge damage & range',
        tiers: [
          { money: 400, ammo: TOWERS.tower.ammoCap, mult: { damage: 2.6, range: 1.45, fireRate: 1.12, bulletSpeed: 1.4 } },
          { money: 1300, ammo: TOWERS.tower.ammoCap, mult: { damage: 5.5, range: 1.7, fireRate: 1.12, bulletSpeed: 1.8 } },
        ],
      },
      {
        id: 'gatling',
        name: 'GATLING',
        desc: 'Blistering fire rate',
        tiers: [
          { money: 400, ammo: TOWERS.tower.ammoCap, mult: { damage: 1.7, range: 1.12, fireRate: 1.8 } },
          { money: 1300, ammo: TOWERS.tower.ammoCap, mult: { damage: 2.5, range: 1.12, fireRate: 2.6 } },
        ],
      },
    ],
  },
  cannon: {
    mk2: { money: 250, ammo: TOWERS.cannon.ammoCap, mult: { damage: 1.5, range: 1.12, fireRate: 1.12 } },
    paths: [
      {
        id: 'siege',
        name: 'SIEGE',
        desc: 'Massive splash & damage',
        tiers: [
          { money: 500, ammo: TOWERS.cannon.ammoCap, mult: { damage: 2.4, range: 1.2, fireRate: 1.12, splash: 1.4 } },
          { money: 1500, ammo: TOWERS.cannon.ammoCap, mult: { damage: 4.9, range: 1.3, fireRate: 1.12, splash: 1.8 } },
        ],
      },
      {
        id: 'flak',
        name: 'FLAK',
        desc: 'Rapid cheap shelling',
        tiers: [
          { money: 450, ammo: TOWERS.cannon.ammoCap, mult: { damage: 1.6, range: 1.12, fireRate: 1.7, splash: 1.15 } },
          { money: 1400, ammo: TOWERS.cannon.ammoCap, mult: { damage: 2.35, range: 1.12, fireRate: 2.4, splash: 1.15 } },
        ],
      },
    ],
  },
  lancer: {
    mk2: { money: 300, ammo: TOWERS.lancer.ammoCap, mult: { damage: 1.5, range: 1.12, fireRate: 1.12 } },
    paths: [
      {
        id: 'railgun',
        name: 'RAILGUN',
        desc: 'Devastating long-range lance',
        tiers: [
          { money: 550, ammo: TOWERS.lancer.ammoCap, mult: { damage: 2.5, range: 1.4, fireRate: 1.12, bulletSpeed: 1.3, pierce: 1.34 } },
          { money: 1650, ammo: TOWERS.lancer.ammoCap, mult: { damage: 5.2, range: 1.6, fireRate: 1.12, bulletSpeed: 1.5, pierce: 1.67 } },
        ],
      },
      {
        id: 'volley',
        name: 'VOLLEY',
        desc: 'Rapid lances, deeper skewers',
        tiers: [
          { money: 500, ammo: TOWERS.lancer.ammoCap, mult: { damage: 1.7, range: 1.12, fireRate: 1.8, pierce: 1.67 } },
          { money: 1500, ammo: TOWERS.lancer.ammoCap, mult: { damage: 2.5, range: 1.12, fireRate: 2.5, pierce: 2.34 } },
        ],
      },
    ],
  },
  cryo: {
    mk2: { money: 180, ammo: TOWERS.cryo.ammoCap, mult: { damage: 1, range: 1.15, fireRate: 1.15, slow: 0.88, slowDur: 1.2 } },
    paths: [
      {
        id: 'cryostasis',
        name: 'CRYOSTASIS',
        desc: 'Near-frozen, long lasting',
        tiers: [
          { money: 420, ammo: TOWERS.cryo.ammoCap, mult: { damage: 1, range: 1.15, fireRate: 1.15, slow: 0.62, slowDur: 1.7 } },
          { money: 1300, ammo: TOWERS.cryo.ammoCap, mult: { damage: 1, range: 1.2, fireRate: 1.15, slow: 0.45, slowDur: 2.2 } },
        ],
      },
      {
        id: 'blizzard',
        name: 'BLIZZARD',
        desc: 'Wide field, rapid pulses',
        // slow mults are cumulative vs BASE, so these must stay at or below mk2's 0.88
        tiers: [
          { money: 400, ammo: TOWERS.cryo.ammoCap, mult: { damage: 1, range: 1.5, fireRate: 1.7, slow: 0.86, slowDur: 1.3 } },
          { money: 1250, ammo: TOWERS.cryo.ammoCap, mult: { damage: 1, range: 1.85, fireRate: 2.3, slow: 0.84, slowDur: 1.4 } },
        ],
      },
    ],
  },
};

export function pathOf(type: TowerType, id: PathId): UpgradePath {
  return UPGRADE_TREE[type].paths.find((p) => p.id === id)!;
}

/**
 * The tier that takes a tower from `mk` to `mk+1`, or null if maxed.
 * At the Mk2 branch the caller passes the *prospective* path; null there means
 * "no choice made yet" and no tier can be quoted.
 */
export function nextTier(type: TowerType, mk: number, path: PathId | null): UpgradeTier | null {
  if (mk >= MAX_MK) return null;
  if (mk <= 1) return UPGRADE_TREE[type].mk2;
  if (!path) return null;
  return pathOf(type, path).tiers[(mk - 2) as 0 | 1];
}

function applyMult(base: TowerStats, m: StatMult): TowerStats {
  return {
    ...base,
    damage: Math.round(base.damage * m.damage),
    range: Math.round(base.range * m.range),
    fireRate: base.fireRate * m.fireRate,
    splash: m.splash ? Math.round(base.splash * m.splash) : base.splash,
    bulletSpeed: m.bulletSpeed ? Math.round(base.bulletSpeed * m.bulletSpeed) : base.bulletSpeed,
    pierce: m.pierce ? Math.round(base.pierce * m.pierce) : base.pierce,
    slowFactor: m.slow ? Math.max(MIN_SLOW_FACTOR, base.slowFactor * m.slow) : base.slowFactor,
    slowDur: m.slowDur ? base.slowDur * m.slowDur : base.slowDur,
  };
}

/**
 * Memo for `effStats`. Combat resolves stats for every tower every frame, and
 * the answer only moves when a tower is upgraded or a research card is taken —
 * so a late-game board of forty towers was allocating ~2400 throwaway stat
 * objects a second for nothing.
 *
 * Keyed on the `Mods` object's identity: `modsFrom` always returns a fresh bag,
 * so taking a card naturally invalidates the whole cache and a stale row is
 * impossible. Entries are shared, and callers must treat them as read-only —
 * every caller in the codebase only reads.
 */
const statCache = new WeakMap<Mods, Map<string, TowerStats>>();

/**
 * Effective combat stats for a tower at a given mark/path. Pure — never
 * mutates TOWERS; combat must always read through here. A mk≥3 tower with no
 * path (shouldn't happen) defensively clamps to Mk2 stats.
 *
 * The returned object is cached and shared: read it, never write to it.
 */
export function effStats(
  type: TowerType,
  mk: number,
  path: PathId | null = null,
  mods: Mods = NO_MODS,
): TowerStats {
  let byKey = statCache.get(mods);
  if (!byKey) {
    byKey = new Map();
    statCache.set(mods, byKey);
  }
  const key = `${type}|${mk}|${path ?? ''}`;
  const hit = byKey.get(key);
  if (hit) return hit;

  const base = TOWERS[type];
  const m = Math.min(mk, MAX_MK);
  const tier =
    m <= 1 ? { ...base } : m === 2 || !path ? applyMult(base, UPGRADE_TREE[type].mk2.mult) : applyMult(base, pathOf(type, path).tiers[(m - 3) as 0 | 1].mult);
  const out = mods === NO_MODS ? tier : applyMods(tier, mods);
  byKey.set(key, out);
  return out;
}

/**
 * Fold run-scoped research modifiers over a tier's stats. Separate from
 * `applyMult` because upgrade tiers multiply the BASE table while these
 * multiply whatever the tier produced — and because keeping it here means
 * combat never has to know research exists.
 *
 * Support towers keep damage 0 whatever the run has researched; `isSupport`
 * and the tests depend on that staying true.
 */
function applyMods(s: TowerStats, m: Mods): TowerStats {
  return {
    ...s,
    damage: s.damage === 0 ? 0 : Math.round(s.damage * m.damage),
    range: Math.round(s.range * m.range),
    fireRate: s.fireRate * m.fireRate,
    pierce: s.pierce > 0 ? s.pierce + m.pierce : 0,
    slowFactor: s.slowFactor < 1 ? Math.max(MIN_SLOW_FACTOR, s.slowFactor * m.slow) : s.slowFactor,
  };
}

export function isMachine(type: BuildingType): type is MachineType {
  return type in MACHINES;
}

/**
 * Palette grouping. Guns and factory equipment are bought for opposite reasons
 * — one spends throughput, the other builds it — so they get separate, labelled
 * blocks in the build bar rather than one undifferentiated strip of thirteen.
 *
 * Hotkeys follow the same split: the number row is the factory, ZXCV is the
 * armoury. Knowing the category tells you which half of the keyboard to reach for.
 */
export type BuildCategory = 'logistics' | 'production' | 'defense';

export const BUILD_CATEGORIES: {
  id: BuildCategory;
  /** header shown above the group in the build bar */
  name: string;
  /** short form for narrow bars */
  short: string;
  /** slot border / header tint — the group's identity colour */
  color: number;
  /** hex twin of `color`, for Text styles */
  css: string;
  /** one line explaining what the whole group is for */
  blurb: string;
}[] = [
  {
    id: 'logistics',
    name: 'LOGISTICS',
    short: 'LOGI',
    color: 0x6bd4ff,
    css: '#6bd4ff',
    blurb: 'Move items around the board.',
  },
  {
    id: 'production',
    name: 'PRODUCTION',
    short: 'PROD',
    color: 0xff9f43,
    css: '#ff9f43',
    blurb: 'Dig ore and turn it into rounds.',
  },
  {
    id: 'defense',
    name: 'DEFENSE',
    short: 'GUNS',
    color: 0xff6b6b,
    css: '#ff6b6b',
    blurb: 'Spend those rounds on the enemy.',
  },
];

export interface BuildInfo {
  type: BuildingType;
  name: string;
  cost: number;
  hotkey: string;
  cat: BuildCategory;
  desc: string;
}

/**
 * Ordered by category, and it must stay that way: the build bar draws each
 * group as one contiguous block of slots (`buildGroupSizes` below), and
 * `buildings.test.ts` pins the invariant.
 */
export const BUILD_INFO: BuildInfo[] = [
  { type: 'belt', name: 'Belt', cost: BELT.cost, hotkey: '1', cat: 'logistics', desc: 'Moves items one per tile. Drag to paint a line — it turns corners with you.' },
  { type: 'splitter', name: 'Splitter', cost: SPLITTER.cost, hotkey: '2', cat: 'logistics', desc: 'Splits a belt between straight/left/right outputs.' },
  { type: 'tunnel', name: 'Tunnel', cost: TUNNEL.cost, hotkey: '3', cat: 'logistics', desc: 'Items dive underground and surface at the next tunnel facing the same way (≤4 tiles) — crosses anything, even the enemy path.' },
  { type: 'miner', name: 'Miner', cost: MINER.cost, hotkey: '4', cat: 'production', desc: 'Place on ore or crystal. Digs whatever it stands on — crystal comes out slower.' },
  { type: 'press', name: 'Press', cost: MACHINES.press.cost, hotkey: '5', cat: 'production', desc: '1 ore → 1 ammo. Feeds gun towers — and every other machine downstream.' },
  { type: 'forge', name: 'Forge', cost: MACHINES.forge.cost, hotkey: '6', cat: 'production', desc: '2 ammo → 1 shell. Feeds cannons. Belt ammo in from a press.' },
  { type: 'assembler', name: 'Assembler', cost: MACHINES.assembler.cost, hotkey: '7', cat: 'production', desc: '2 ammo + 1 crystal → 1 piercing round. Needs BOTH inputs belted in. Feeds lancers.' },
  { type: 'chiller', name: 'Chiller', cost: MACHINES.chiller.cost, hotkey: '8', cat: 'production', desc: '1 ammo → 2 coolant. The cheapest line in the game. Feeds cryo towers.' },
  { type: 'lab', name: 'Lab', cost: LAB.cost, hotkey: '9', cat: 'production', desc: 'Belt FINISHED rounds in and it converts them to research — every level lets you pick one of three permanent upgrades. Raw ore is worthless to it: research always costs you ammo.' },
  { type: 'tower', name: 'Gun', cost: TOWERS.tower.cost, hotkey: 'Z', cat: 'defense', desc: 'Fast single-target. Eats ammo. Select a placed tower to open its upgrades.' },
  { type: 'cannon', name: 'Cannon', cost: TOWERS.cannon.cost, hotkey: 'X', cat: 'defense', desc: 'Slow splash damage. Eats shells. Armored enemies resist bullets but not shells.' },
  { type: 'lancer', name: 'Lancer', cost: TOWERS.lancer.cost, hotkey: 'C', cat: 'defense', desc: 'Fires a lance straight down the path, skewering up to 3 enemies. Ignores armor. Eats piercing rounds.' },
  { type: 'cryo', name: 'Cryo', cost: TOWERS.cryo.cost, hotkey: 'V', cat: 'defense', desc: 'No damage — pulses coolant to slow everything in range, multiplying every gun covering the same choke point.' },
];

/** Slots per category, in `BUILD_CATEGORIES` order — the build bar's block sizes. */
export function buildGroupSizes(): number[] {
  return BUILD_CATEGORIES.map((c) => BUILD_INFO.filter((b) => b.cat === c.id).length);
}

/** The category a build type belongs to — its palette colour and shelf. */
export function categoryOf(type: BuildingType): (typeof BUILD_CATEGORIES)[number] | undefined {
  const info = BUILD_INFO.find((b) => b.type === type);
  return info && BUILD_CATEGORIES.find((c) => c.id === info.cat);
}

export function costOf(type: BuildingType): number {
  return BUILD_INFO.find((b) => b.type === type)!.cost;
}
