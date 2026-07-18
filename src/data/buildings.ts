import { BuildingType, ItemType } from '../types';

export const BELT = { cost: 5 };
export const SPLITTER = { cost: 20 };

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
  { type: 'miner', name: 'Miner', cost: MINER.cost, hotkey: '3', desc: 'Place on ore. Outputs ore onto the belt it faces.' },
  { type: 'press', name: 'Press', cost: MACHINES.press.cost, hotkey: '4', desc: '1 ore → 1 ammo. Feeds gun towers.' },
  { type: 'forge', name: 'Forge', cost: MACHINES.forge.cost, hotkey: '5', desc: '2 ore → 1 shell. Feeds cannons.' },
  { type: 'tower', name: 'Gun', cost: TOWERS.tower.cost, hotkey: '6', desc: 'Fast single-target. Eats ammo.' },
  { type: 'cannon', name: 'Cannon', cost: TOWERS.cannon.cost, hotkey: '7', desc: 'Slow splash damage. Eats shells.' },
];

export function costOf(type: BuildingType): number {
  return BUILD_INFO.find((b) => b.type === type)!.cost;
}
