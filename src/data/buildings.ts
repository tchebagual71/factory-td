import { BuildingType, ItemType, PathId } from '../types';

export const BELT = { cost: 5 };
export const SPLITTER = { cost: 20 };
export const TUNNEL = { cost: 15, reach: 4 }; // exit must be ≤ reach tiles ahead, same facing

/** One miner building, two resources: the tile it stands on decides what it digs and how fast. */
export const MINER = {
  cost: 50,
  cycle: 1.5, // seconds per ore produced
  crystalCycle: 2.6, // crystal comes out of the ground far slower — it is the scarce input
};

export function minerCycle(resource: 'ore' | 'crystal'): number {
  return resource === 'crystal' ? MINER.crystalCycle : MINER.cycle;
}

/** Crafting machines: oreIn ore (+ crystalIn crystal) -> outputPer output items per cycle. */
export interface MachineStats {
  cost: number;
  cycle: number;
  oreIn: number;
  crystalIn: number;
  /** per input type */
  inputCap: number;
  outputCap: number;
  /** items produced per completed cycle — >1 is what makes coolant cheap */
  outputPer: number;
  output: ItemType;
}

export type MachineType = 'press' | 'forge' | 'assembler' | 'chiller';

export const MACHINES: Record<MachineType, MachineStats> = {
  press: { cost: 60, cycle: 1.0, oreIn: 1, crystalIn: 0, inputCap: 5, outputCap: 3, outputPer: 1, output: 'ammo' },
  forge: { cost: 100, cycle: 2.5, oreIn: 2, crystalIn: 0, inputCap: 8, outputCap: 2, outputPer: 1, output: 'shell' },
  assembler: { cost: 170, cycle: 3.0, oreIn: 2, crystalIn: 1, inputCap: 6, outputCap: 2, outputPer: 1, output: 'piercing' },
  // Deliberately the cheapest line in the game: two coolant per ore, so a
  // single miner can keep several cryo towers pulsing.
  chiller: { cost: 70, cycle: 1.4, oreIn: 1, crystalIn: 0, inputCap: 5, outputCap: 4, outputPer: 2, output: 'coolant' },
};

/** How much of `item` this machine's recipe wants (0 = it won't accept it). */
export function recipeNeeds(type: MachineType, item: ItemType): number {
  if (item === 'ore') return MACHINES[type].oreIn;
  if (item === 'crystal') return MACHINES[type].crystalIn;
  return 0;
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
          { money: 900, ammo: TOWERS.tower.ammoCap, mult: { damage: 4.2, range: 1.7, fireRate: 1.12, bulletSpeed: 1.8 } },
        ],
      },
      {
        id: 'gatling',
        name: 'GATLING',
        desc: 'Blistering fire rate',
        tiers: [
          { money: 400, ammo: TOWERS.tower.ammoCap, mult: { damage: 1.7, range: 1.12, fireRate: 1.8 } },
          { money: 900, ammo: TOWERS.tower.ammoCap, mult: { damage: 1.9, range: 1.12, fireRate: 2.6 } },
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
          { money: 1100, ammo: TOWERS.cannon.ammoCap, mult: { damage: 3.8, range: 1.3, fireRate: 1.12, splash: 1.8 } },
        ],
      },
      {
        id: 'flak',
        name: 'FLAK',
        desc: 'Rapid cheap shelling',
        tiers: [
          { money: 450, ammo: TOWERS.cannon.ammoCap, mult: { damage: 1.6, range: 1.12, fireRate: 1.7, splash: 1.15 } },
          { money: 1000, ammo: TOWERS.cannon.ammoCap, mult: { damage: 1.8, range: 1.12, fireRate: 2.4, splash: 1.15 } },
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
          { money: 1200, ammo: TOWERS.lancer.ammoCap, mult: { damage: 4.0, range: 1.6, fireRate: 1.12, bulletSpeed: 1.5, pierce: 1.67 } },
        ],
      },
      {
        id: 'volley',
        name: 'VOLLEY',
        desc: 'Rapid lances, deeper skewers',
        tiers: [
          { money: 500, ammo: TOWERS.lancer.ammoCap, mult: { damage: 1.7, range: 1.12, fireRate: 1.8, pierce: 1.67 } },
          { money: 1100, ammo: TOWERS.lancer.ammoCap, mult: { damage: 1.9, range: 1.12, fireRate: 2.5, pierce: 2.34 } },
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
          { money: 950, ammo: TOWERS.cryo.ammoCap, mult: { damage: 1, range: 1.2, fireRate: 1.15, slow: 0.45, slowDur: 2.2 } },
        ],
      },
      {
        id: 'blizzard',
        name: 'BLIZZARD',
        desc: 'Wide field, rapid pulses',
        // slow mults are cumulative vs BASE, so these must stay at or below mk2's 0.88
        tiers: [
          { money: 400, ammo: TOWERS.cryo.ammoCap, mult: { damage: 1, range: 1.5, fireRate: 1.7, slow: 0.86, slowDur: 1.3 } },
          { money: 900, ammo: TOWERS.cryo.ammoCap, mult: { damage: 1, range: 1.85, fireRate: 2.3, slow: 0.84, slowDur: 1.4 } },
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
 * Effective combat stats for a tower at a given mark/path. Pure — never
 * mutates TOWERS; combat must always read through here. A mk≥3 tower with no
 * path (shouldn't happen) defensively clamps to Mk2 stats.
 */
export function effStats(type: TowerType, mk: number, path: PathId | null = null): TowerStats {
  const base = TOWERS[type];
  const m = Math.min(mk, MAX_MK);
  if (m <= 1) return { ...base };
  if (m === 2 || !path) return applyMult(base, UPGRADE_TREE[type].mk2.mult);
  return applyMult(base, pathOf(type, path).tiers[(m - 3) as 0 | 1].mult);
}

export function isMachine(type: BuildingType): type is MachineType {
  return type in MACHINES;
}

export const BUILD_INFO: {
  type: BuildingType;
  name: string;
  cost: number;
  hotkey: string;
  desc: string;
}[] = [
  { type: 'belt', name: 'Belt', cost: BELT.cost, hotkey: '1', desc: 'Moves items. R to rotate, drag to paint.' },
  { type: 'splitter', name: 'Splitter', cost: SPLITTER.cost, hotkey: '2', desc: 'Splits a belt between straight/left/right outputs.' },
  { type: 'tunnel', name: 'Tunnel', cost: TUNNEL.cost, hotkey: '3', desc: 'Items dive underground and surface at the next tunnel facing the same way (≤4 tiles) — crosses anything, even the enemy path.' },
  { type: 'miner', name: 'Miner', cost: MINER.cost, hotkey: '4', desc: 'Place on ore or crystal. Digs whatever it stands on — crystal comes out slower.' },
  { type: 'press', name: 'Press', cost: MACHINES.press.cost, hotkey: '5', desc: '1 ore → 1 ammo. Feeds gun towers.' },
  { type: 'forge', name: 'Forge', cost: MACHINES.forge.cost, hotkey: '6', desc: '2 ore → 1 shell. Feeds cannons.' },
  { type: 'assembler', name: 'Assembler', cost: MACHINES.assembler.cost, hotkey: '7', desc: '2 ore + 1 crystal → 1 piercing round. Needs BOTH inputs belted in. Feeds lancers.' },
  { type: 'chiller', name: 'Chiller', cost: MACHINES.chiller.cost, hotkey: '8', desc: '1 ore → 2 coolant. The cheapest line in the game. Feeds cryo towers.' },
  { type: 'tower', name: 'Gun', cost: TOWERS.tower.cost, hotkey: '9', desc: 'Fast single-target. Eats ammo. Click a placed tower to upgrade it.' },
  { type: 'cannon', name: 'Cannon', cost: TOWERS.cannon.cost, hotkey: '0', desc: 'Slow splash damage. Eats shells. Armored enemies resist bullets but not shells.' },
  { type: 'lancer', name: 'Lancer', cost: TOWERS.lancer.cost, hotkey: 'C', desc: 'Fires a lance straight down the path, skewering up to 3 enemies. Ignores armor. Eats piercing rounds.' },
  { type: 'cryo', name: 'Cryo', cost: TOWERS.cryo.cost, hotkey: 'V', desc: 'No damage — pulses coolant to slow everything in range, multiplying every gun covering the same choke point.' },
];

export function costOf(type: BuildingType): number {
  return BUILD_INFO.find((b) => b.type === type)!.cost;
}
