import { BuildingType, ItemType, PathId } from '../types';

export const BELT = { cost: 5 };
export const SPLITTER = { cost: 20 };
export const TUNNEL = { cost: 15, reach: 4 }; // exit must be ≤ reach tiles ahead, same facing

export const MINER = {
  cost: 50,
  cycle: 1.5, // seconds per ore produced
};

/** Crafting machines: oreIn ore -> 1 output item per cycle. */
export interface MachineStats {
  cost: number;
  cycle: number;
  oreIn: number;
  inputCap: number;
  outputCap: number;
  output: ItemType;
}

export const MACHINES: Record<'press' | 'forge', MachineStats> = {
  press: { cost: 60, cycle: 1.0, oreIn: 1, inputCap: 5, outputCap: 3, output: 'ammo' },
  forge: { cost: 100, cycle: 2.5, oreIn: 2, inputCap: 8, outputCap: 2, output: 'shell' },
};

export interface TowerStats {
  cost: number;
  range: number;
  damage: number;
  fireRate: number; // shots per second
  ammoCap: number;
  startAmmo: number;
  bulletSpeed: number;
  splash: number; // px radius, 0 = single target
  ammoType: ItemType;
}

export const TOWERS: Record<'tower' | 'cannon', TowerStats> = {
  tower: {
    cost: 90,
    range: 118,
    damage: 18,
    fireRate: 1.2,
    ammoCap: 15,
    startAmmo: 10, // pre-loaded so wave 1 flows before a factory exists
    bulletSpeed: 520,
    splash: 0,
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
    ammoType: 'shell',
  },
};

export function isTower(type: BuildingType): type is 'tower' | 'cannon' {
  return type === 'tower' || type === 'cannon';
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
}

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
  'tower' | 'cannon',
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
};

export function pathOf(type: 'tower' | 'cannon', id: PathId): UpgradePath {
  return UPGRADE_TREE[type].paths.find((p) => p.id === id)!;
}

/**
 * The tier that takes a tower from `mk` to `mk+1`, or null if maxed.
 * At the Mk2 branch the caller passes the *prospective* path; null there means
 * "no choice made yet" and no tier can be quoted.
 */
export function nextTier(type: 'tower' | 'cannon', mk: number, path: PathId | null): UpgradeTier | null {
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
  };
}

/**
 * Effective combat stats for a tower at a given mark/path. Pure — never
 * mutates TOWERS; combat must always read through here. A mk≥3 tower with no
 * path (shouldn't happen) defensively clamps to Mk2 stats.
 */
export function effStats(type: 'tower' | 'cannon', mk: number, path: PathId | null = null): TowerStats {
  const base = TOWERS[type];
  const m = Math.min(mk, MAX_MK);
  if (m <= 1) return { ...base };
  if (m === 2 || !path) return applyMult(base, UPGRADE_TREE[type].mk2.mult);
  return applyMult(base, pathOf(type, path).tiers[(m - 3) as 0 | 1].mult);
}

export function isMachine(type: BuildingType): type is 'press' | 'forge' {
  return type === 'press' || type === 'forge';
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
  { type: 'miner', name: 'Miner', cost: MINER.cost, hotkey: '4', desc: 'Place on ore. Outputs ore onto the belt it faces.' },
  { type: 'press', name: 'Press', cost: MACHINES.press.cost, hotkey: '5', desc: '1 ore → 1 ammo. Feeds gun towers.' },
  { type: 'forge', name: 'Forge', cost: MACHINES.forge.cost, hotkey: '6', desc: '2 ore → 1 shell. Feeds cannons.' },
  { type: 'tower', name: 'Gun', cost: TOWERS.tower.cost, hotkey: '7', desc: 'Fast single-target. Eats ammo. Click a placed tower to upgrade it.' },
  { type: 'cannon', name: 'Cannon', cost: TOWERS.cannon.cost, hotkey: '8', desc: 'Slow splash damage. Eats shells. Armored enemies resist bullets but not shells.' },
];

export function costOf(type: BuildingType): number {
  return BUILD_INFO.find((b) => b.type === type)!.cost;
}
