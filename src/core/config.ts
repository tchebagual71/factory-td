import type { BuildingDef, BuildingKind, EnemyDef, EnemyKind, ItemType, SpawnEntry } from './types';

// ---------------------------------------------------------------------------
// World / timing
// ---------------------------------------------------------------------------

export const TILE = 32; // px per tile
export const SIM_DT = 1 / 60; // fixed simulation timestep, seconds

export const START_MONEY = 400;
export const START_LIVES = 20;
export const SELL_REFUND = 0.5;

// ---------------------------------------------------------------------------
// Factory tuning
// ---------------------------------------------------------------------------

export const BELT_SPEED = 2.5; // tiles per second
export const MINE_TIME = 1.5; // seconds per ore at full power
export const MACHINE_INPUT_CAP = 5; // max stored per input item type
export const POWER_PER_GENERATOR = 20;
export const FUEL_SECONDS_PER_COAL = 8;
export const TURRET_STARTING_SHOTS = 15;

export const SMELT_RECIPES: Partial<Record<ItemType, { output: ItemType; time: number }>> = {
  'iron-ore': { output: 'iron-plate', time: 2 },
  'copper-ore': { output: 'copper-plate', time: 2 },
};

export const BUILDING_DEFS: Record<BuildingKind, BuildingDef> = {
  belt: {
    kind: 'belt',
    name: 'Belt',
    cost: 4,
    hotkey: '1',
    power: 0,
    desc: 'Moves items in the direction it faces. Drag to lay runs.',
  },
  miner: {
    kind: 'miner',
    name: 'Miner',
    cost: 20,
    hotkey: '2',
    power: 3,
    desc: 'Place on an ore tile. Extracts that ore and pushes it forward.',
  },
  smelter: {
    kind: 'smelter',
    name: 'Smelter',
    cost: 25,
    hotkey: '3',
    power: 4,
    desc: 'Turns iron/copper ore into plates.',
  },
  generator: {
    kind: 'generator',
    name: 'Generator',
    cost: 25,
    hotkey: '4',
    power: 0,
    desc: `Burns coal to add ${POWER_PER_GENERATOR} power to the grid.`,
  },
  'assembler-ammo': {
    kind: 'assembler-ammo',
    name: 'Ammo Assembler',
    cost: 35,
    hotkey: '5',
    power: 5,
    recipe: { inputs: { 'iron-plate': 1, 'copper-plate': 1 }, output: 'ammo', time: 3 },
    desc: 'Crafts turret ammo from iron + copper plates.',
  },
  'assembler-shell': {
    kind: 'assembler-shell',
    name: 'Shell Assembler',
    cost: 35,
    hotkey: '6',
    power: 5,
    recipe: { inputs: { 'iron-plate': 2, coal: 1 }, output: 'shell', time: 4 },
    desc: 'Crafts cannon shells from iron plates + coal.',
  },
  turret: {
    kind: 'turret',
    name: 'Gun Turret',
    cost: 40,
    hotkey: '7',
    power: 0,
    turret: { range: 3.5 * TILE, damage: 12, rate: 2, ammo: 'ammo', shotsPerItem: 5 },
    desc: 'Fast single-target fire. Feed it ammo by belt.',
  },
  cannon: {
    kind: 'cannon',
    name: 'Cannon',
    cost: 80,
    hotkey: '8',
    power: 0,
    turret: { range: 3.75 * TILE, damage: 30, rate: 0.7, ammo: 'shell', shotsPerItem: 3, splash: 1.25 * TILE },
    desc: 'Slow splash damage. Feed it shells by belt.',
  },
};

// ---------------------------------------------------------------------------
// Enemies / waves
// ---------------------------------------------------------------------------

export const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
  grunt: { kind: 'grunt', hp: 40, speed: 60, reward: 4, damage: 1, radius: 8 },
  fast: { kind: 'fast', hp: 26, speed: 105, reward: 4, damage: 1, radius: 6 },
  tank: { kind: 'tank', hp: 170, speed: 34, reward: 12, damage: 2, radius: 11 },
  boss: { kind: 'boss', hp: 1400, speed: 26, reward: 80, damage: 5, radius: 14 },
};

/** Multiplier applied to enemy HP for a given wave number (1-based). */
export function waveHpMultiplier(wave: number): number {
  return Math.pow(1.13, wave - 1);
}

export function waveClearBonus(wave: number): number {
  return 30 + 10 * wave;
}

/** Spawn schedule for a wave. Deterministic so it is testable and fair. */
export function waveComposition(wave: number): SpawnEntry[] {
  const list: SpawnEntry[] = [];
  let t = 0;
  const push = (kind: EnemyKind, count: number, gap: number) => {
    for (let i = 0; i < count; i++) {
      list.push({ kind, at: t });
      t += gap;
    }
  };
  push('grunt', 6 + 2 * wave, Math.max(0.4, 1.2 - wave * 0.05));
  if (wave >= 3) {
    t += 2;
    push('fast', wave, 0.5);
  }
  if (wave >= 5) {
    t += 2;
    push('tank', Math.floor(wave / 2), 1.6);
  }
  if (wave % 8 === 0) {
    t += 3;
    push('boss', Math.floor(wave / 8), 4);
  }
  return list;
}
