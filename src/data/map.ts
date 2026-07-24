import { TILE, GRID_W, GRID_H } from '../config';

/**
 * The fixed enemy route, Bloons-style: axis-aligned waypoints in tile coords.
 * First and last points sit off-grid so enemies walk in from / out of the screen edge.
 */
export const PATH_WAYPOINTS: { x: number; y: number }[] = [
  { x: -1, y: 10 },
  { x: 5, y: 10 },
  { x: 5, y: 3 },
  { x: 13, y: 3 },
  { x: 13, y: 16 },
  { x: 21, y: 16 },
  { x: 21, y: 3 },
  { x: 29, y: 3 },
  { x: 29, y: 16 },
  { x: 35, y: 16 },
  { x: 35, y: 9 },
  { x: 40, y: 9 },
];

/** Same route in pixel coords (tile centers) for enemy movement. */
export const PATH_PX = PATH_WAYPOINTS.map((w) => ({
  x: w.x * TILE + TILE / 2,
  y: w.y * TILE + TILE / 2,
}));

export interface Patch {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Ore deposits: rectangles of mineable tiles. Miners may only be placed on these. */
export const ORE_PATCHES: Patch[] = [
  { x: 1, y: 14, w: 3, h: 4 },
  { x: 9, y: 7, w: 3, h: 3 },
  { x: 17, y: 8, w: 3, h: 3 },
  { x: 24, y: 8, w: 3, h: 3 },
  { x: 36, y: 1, w: 3, h: 3 },
];

/**
 * Crystal deposits: the scarce tier-2 resource. Deliberately small, few, and
 * tucked in pockets away from the ore patches — a piercing line has to belt
 * two raw inputs from opposite corners, which is the mid-game ratio puzzle.
 */
export const CRYSTAL_PATCHES: Patch[] = [
  { x: 7, y: 13, w: 2, h: 2 },
  { x: 15, y: 5, w: 2, h: 2 },
  { x: 23, y: 13, w: 2, h: 2 },
  { x: 32, y: 4, w: 2, h: 2 },
];

export function inPatch(patches: readonly Patch[], x: number, y: number): boolean {
  return patches.some((p) => x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h);
}

/** Set of "x,y" keys for every tile the path crosses (unbuildable). */
export function computePathCells(): Set<string> {
  const cells = new Set<string>();
  for (let i = 0; i < PATH_WAYPOINTS.length - 1; i++) {
    const a = PATH_WAYPOINTS[i];
    const b = PATH_WAYPOINTS[i + 1];
    const sx = Math.sign(b.x - a.x);
    const sy = Math.sign(b.y - a.y);
    let { x, y } = a;
    while (x !== b.x || y !== b.y) {
      if (x >= 0 && x < GRID_W && y >= 0 && y < GRID_H) cells.add(`${x},${y}`);
      x += sx;
      y += sy;
    }
    if (b.x >= 0 && b.x < GRID_W && b.y >= 0 && b.y < GRID_H) cells.add(`${b.x},${b.y}`);
  }
  return cells;
}
