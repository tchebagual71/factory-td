import { BELT_FRAME_KEYS } from '../scenes/beltFrames';

/**
 * How each 2D texture becomes a solid. Pure data: the renderer looks a sprite's
 * texture key up here and extrudes it, so the 3D view is driven by the same
 * art the 2D game generates rather than by a parallel set of models.
 *
 * Sizes are in board pixels — the same units the simulation moves things in, so
 * a 32px tile is a 32×32 footprint and heights read against it directly.
 */
export type Shape =
  /** flush with the ground: belts, splitters, tunnels */
  | 'slab'
  /** a machine: extruded box with the sprite laid on its lid */
  | 'block'
  /** a tower: cylindrical mount with the sprite on top */
  | 'turret'
  /** a gun barrel: sits on top of its turret and swings with it */
  | 'barrel'
  /** an enemy: a rounded chassis carrying the sprite */
  | 'unit'
  /** an item riding a belt */
  | 'item'
  /** a projectile or muzzle flash — untextured, emissive */
  | 'bolt';

export interface Model {
  shape: Shape;
  /** footprint across the board's x axis */
  w: number;
  /** footprint across the board's y axis */
  d: number;
  /** height above whatever it rests on */
  h: number;
  /** how far off the ground the model's base sits */
  lift: number;
  /** body colour (the sides — the lid wears the sprite) */
  side: number;
  /** 0–1: how much the body glows in its own colour */
  glow: number;
}

/** Grass slab thickness. The enemy road is this much lower than buildable ground. */
export const GROUND_Y = 7;

const def = (shape: Shape, w: number, d: number, h: number, side: number, lift = GROUND_Y, glow = 0): Model => ({
  shape,
  w,
  d,
  h,
  lift,
  side,
  glow,
});

const MODELS: Record<string, Model> = {
  // --- logistics: flush with the ground so a factory reads as plumbing ---
  splitter: def('slab', 32, 32, 5, 0x2b3244),
  tunnel: def('slab', 32, 32, 7, 0x1b2030),

  // --- production: boxes tall enough to throw a shadow and cast a silhouette ---
  miner: def('block', 28, 28, 20, 0x7a4f26),
  press: def('block', 28, 28, 18, 0x39424f),
  forge: def('block', 28, 28, 22, 0x45212c),
  assembler: def('block', 28, 28, 20, 0x27364a),
  chiller: def('block', 28, 28, 19, 0x27373f),
  lab: def('block', 28, 28, 24, 0x2a2840),

  // --- defense: a low mount, and the barrel rides on top of it ---
  tower: def('turret', 28, 28, 13, 0x2b3240),
  cannon: def('turret', 28, 28, 14, 0x392c3d),
  lancer: def('turret', 28, 28, 12, 0x1f3742),
  cryo: def('turret', 28, 28, 12, 0x22323d),
  barrel: def('barrel', 20, 8, 6, 0x1b1f29, GROUND_Y + 13),
  'barrel-cannon': def('barrel', 22, 10, 8, 0x1b1520, GROUND_Y + 14),
  'barrel-lancer': def('barrel', 26, 9, 5, 0x14212a, GROUND_Y + 12),

  // --- enemies: they walk the sunken road, so they sit at y=0, not on the grass ---
  enemy: def('unit', 22, 22, 13, 0x8f1f1f, 0),
  armored: def('unit', 22, 22, 14, 0x59677f, 0),
  swift: def('unit', 18, 18, 10, 0x0f7a70, 0),
  boss: def('unit', 30, 30, 20, 0x5e1f8f, 0),

  // --- items ride a little above the belt lid ---
  'item-ore': def('item', 11, 11, 7, 0xb35c1e, GROUND_Y + 5),
  'item-crystal': def('item', 11, 11, 9, 0x2f7f9e, GROUND_Y + 5, 0.35),
  'item-ammo': def('item', 12, 10, 6, 0xb8962e, GROUND_Y + 5),
  'item-shell': def('item', 13, 11, 7, 0xa85a1e, GROUND_Y + 5),
  'item-piercing': def('item', 14, 10, 6, 0x1f4a5c, GROUND_Y + 5, 0.3),
  'item-coolant': def('item', 12, 10, 7, 0x3d6b7d, GROUND_Y + 5, 0.3),

  // --- projectiles fly at turret height and light themselves ---
  bullet: def('bolt', 10, 4, 4, 0xfff3a0, GROUND_Y + 14, 1),
  cannonball: def('bolt', 9, 9, 9, 0xff9f43, GROUND_Y + 14, 0.7),
  lance: def('bolt', 28, 5, 5, 0x6bd4ff, GROUND_Y + 13, 1),
  muzzle: def('bolt', 14, 10, 6, 0xfff3a0, GROUND_Y + 14, 1),
};

// Every belt animation frame is its own texture key, and the sprite swaps
// between them as the loop plays — so they all need the same solid, and the
// renderer gets the scrolling chevrons on the lid for free.
for (const key of BELT_FRAME_KEYS) MODELS[key] = def('slab', 32, 32, 4, 0x1e2330);

/** The solid for a texture key, or null for something the 3D view doesn't draw. */
export function modelFor(key: string): Model | null {
  return MODELS[key] ?? null;
}

/** Every texture key with a solid. Test/diagnostic use. */
export function modelledKeys(): string[] {
  return Object.keys(MODELS);
}
