import Phaser from 'phaser';

/** Cardinal direction: 0=E, 1=S, 2=W, 3=N. Sprite art points East at rotation 0. */
export type Dir = 0 | 1 | 2 | 3;
export const DX = [1, 0, -1, 0];
export const DY = [0, 1, 0, -1];

/** Raw resources ('ore', 'crystal') and manufactured goods. */
export type ItemType = 'ore' | 'crystal' | 'ammo' | 'shell' | 'piercing' | 'coolant';
export type BuildingType =
  | 'belt'
  | 'splitter'
  | 'tunnel'
  | 'miner'
  | 'press'
  | 'forge'
  | 'assembler'
  | 'chiller'
  | 'tower'
  | 'cannon'
  | 'lancer'
  | 'cryo';

/**
 * Tower specialization path, chosen at the Mk2→Mk3 upgrade. Guns branch
 * sniper/gatling, cannons siege/flak, lancers railgun/volley, cryo
 * cryostasis/blizzard.
 */
export type PathId =
  | 'sniper'
  | 'gatling'
  | 'siege'
  | 'flak'
  | 'railgun'
  | 'volley'
  | 'cryostasis'
  | 'blizzard';

export interface ItemEnt {
  type: ItemType;
  /** belt cell this item currently belongs to */
  cx: number;
  cy: number;
  sprite: Phaser.GameObjects.Image;
}

export interface Building {
  type: BuildingType;
  x: number;
  y: number;
  dir: Dir;
  sprite: Phaser.GameObjects.Image;
  /** belt/splitter: the single item slot */
  item: ItemEnt | null;
  /** splitter: round-robin output index (0=straight, 1=left, 2=right) */
  outIdx: number;
  /** miner/press: crafting timer (seconds) */
  timer: number;
  /** press: currently mid-craft */
  crafting: boolean;
  /** crafting machines: raw ore waiting to be consumed */
  inputOre: number;
  /** crafting machines: raw crystal waiting to be consumed (assembler only) */
  inputCrystal: number;
  /** crafting machines: finished goods waiting for belt space */
  outputBuf: number;
  /** tower: loaded ammo */
  ammo: number;
  /** tower: seconds until next shot allowed */
  cooldown: number;
  /** tower: upgrade mark (1 to MAX_MK) */
  mk: number;
  /** tower: specialization path, null until chosen at the Mk3 branch */
  path: PathId | null;
  /** total money sunk into this building (base cost + upgrades) — sell refunds half */
  invested: number;
  /**
   * Logistics telemetry, runtime only (never serialized). `stalled` is set each
   * tick by whichever system knows why the building can't proceed — a belt whose
   * item has nowhere to go, a machine short an input or with a blocked output, a
   * dry tower. The util counters accumulate during the wave phase and reset when
   * the next wave starts, so the overlay always reads "last wave".
   */
  stalled: boolean;
  utilBusy: number;
  utilBlocked: number;
  utilTotal: number;
  /** ground shadow for buildings that stand proud of the terrain */
  shadow?: Phaser.GameObjects.Ellipse;
  barrel?: Phaser.GameObjects.Image;
  ammoBar?: Phaser.GameObjects.Rectangle;
  mkPips?: Phaser.GameObjects.Rectangle[];
}

export interface Enemy {
  kind: 'normal' | 'swift' | 'armored' | 'boss';
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  speed: number;
  /** seconds of coolant slow remaining; while > 0 the enemy moves at `slowFactor` speed */
  slow: number;
  slowFactor: number;
  /** index of the waypoint the enemy is walking toward */
  wp: number;
  /** total px traveled — targeting priority (furthest along path) */
  traveled: number;
  bounty: number;
  leak: number;
  dead: boolean;
  sprite: Phaser.GameObjects.Image;
  hpBar: Phaser.GameObjects.Rectangle;
  hpBarW: number;
  hpBarY: number;
}
