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

/** Ore deposits: rectangles of mineable tiles. Miners may only be placed on these. */
export const ORE_PATCHES: { x: number; y: number; w: number; h: number }[] = [
  { x: 1, y: 14, w: 3, h: 4 },
  { x: 9, y: 7, w: 3, h: 3 },
  { x: 17, y: 8, w: 3, h: 3 },
  { x: 24, y: 8, w: 3, h: 3 },
  { x: 36, y: 1, w: 3, h: 3 },
];

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
