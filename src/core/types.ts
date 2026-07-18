// Core shared types for the headless simulation. Nothing in src/core may
// reference the DOM — the renderer and HUD read this state, never the reverse.

export type ItemType =
  | 'iron-ore'
  | 'copper-ore'
  | 'coal'
  | 'iron-plate'
  | 'copper-plate'
  | 'ammo'
  | 'shell';

export type BuildingKind =
  | 'belt'
  | 'miner'
  | 'smelter'
  | 'generator'
  | 'assembler-ammo'
  | 'assembler-shell'
  | 'turret'
  | 'cannon';

/** 0=N 1=E 2=S 3=W. Machines output to the tile they face. */
export type Dir = 0 | 1 | 2 | 3;

export interface Recipe {
  inputs: Partial<Record<ItemType, number>>;
  output: ItemType;
  /** Seconds at full power satisfaction. */
  time: number;
}

export interface TurretSpec {
  range: number; // px
  damage: number;
  rate: number; // shots per second
  ammo: ItemType;
  shotsPerItem: number;
  splash?: number; // px radius, omitted = single target
}

export interface BuildingDef {
  kind: BuildingKind;
  name: string;
  cost: number;
  hotkey: string;
  /** Power demand while placed (0 for belts/turrets/generators). */
  power: number;
  recipe?: Recipe;
  turret?: TurretSpec;
  desc: string;
}

export interface Building {
  id: number;
  kind: BuildingKind;
  x: number;
  y: number;
  dir: Dir;
  // Belt state: at most one item, progress 0..1 across the tile.
  item: ItemType | null;
  progress: number;
  // Machine state.
  input: Partial<Record<ItemType, number>>;
  output: ItemType | null;
  crafting: Recipe | null;
  craftProgress: number;
  fuel: number; // generator: seconds of burn remaining
  // Turret state.
  shots: number;
  cooldown: number;
}

export type EnemyKind = 'grunt' | 'fast' | 'tank' | 'boss';

export interface EnemyDef {
  kind: EnemyKind;
  hp: number;
  speed: number; // px/s
  reward: number;
  damage: number; // lives lost on leak
  radius: number; // px, for rendering + splash
}

export interface Enemy {
  id: number;
  kind: EnemyKind;
  hp: number;
  maxHp: number;
  speed: number;
  reward: number;
  damage: number;
  radius: number;
  /** Distance travelled along the path polyline, in px. */
  dist: number;
}

export interface SpawnEntry {
  kind: EnemyKind;
  at: number; // seconds after wave start
}

export type TileKind = 'empty' | 'path' | 'ore';

export interface Tile {
  kind: TileKind;
  ore?: ItemType;
}

export interface MapDef {
  width: number; // tiles
  height: number;
  tiles: Tile[]; // row-major, y * width + x
  /** Waypoints in tile coords; enemies walk the polyline through tile centers. */
  waypoints: { x: number; y: number }[];
}

/** Transient visual effects; the sim appends, the renderer draws and ages them. */
export interface Effect {
  kind: 'beam' | 'blast' | 'death';
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  r?: number;
  t: number; // remaining seconds
  max: number;
}

export type Phase = 'build' | 'combat' | 'gameover';

export const DIRS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];
