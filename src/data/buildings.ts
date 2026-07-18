import { BuildingType, ItemType } from '../types';

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
 * Mk upgrades: each tier costs money PLUS the tower's full loaded magazine —
 * the factory literally arms the upgrade, so throughput gates permanent power.
 */
export const UPGRADES: Record<'tower' | 'cannon', { money: number; ammo: number }[]> = {
  tower: [
    { money: 150, ammo: TOWERS.tower.ammoCap },
    { money: 400, ammo: TOWERS.tower.ammoCap },
  ],
  cannon: [
    { money: 250, ammo: TOWERS.cannon.ammoCap },
    { money: 600, ammo: TOWERS.cannon.ammoCap },
  ],
};

const DMG_MK = [1, 1.5, 2.2];
const RNG_MK = [1, 1.12, 1.28];
const RATE_MK = [1, 1.12, 1.3];
export const MAX_MK = 3;

/** Effective combat stats for a tower at a given mark. */
export function effStats(type: 'tower' | 'cannon', mk: number): TowerStats {
  const base = TOWERS[type];
  const i = Math.min(mk, MAX_MK) - 1;
  return {
    ...base,
    damage: Math.round(base.damage * DMG_MK[i]),
    range: Math.round(base.range * RNG_MK[i]),
    fireRate: base.fireRate * RATE_MK[i],
  };
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
