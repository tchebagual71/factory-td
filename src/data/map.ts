import { TILE, GRID_W, GRID_H } from '../config';

export interface Patch {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * One playable layout: a fixed enemy route plus the deposits around it. Routes
 * are axis-aligned waypoints in tile coords; the first and last points sit
 * off-grid (left edge in, right edge out) so enemies walk on and off screen.
 *
 * Layouts differ in the shape of the *land*, not the rules: a route with long
 * straight legs rewards lancers, one with tight switchbacks rewards choke-point
 * cryo fields, and how far the crystal sits from the ore sets how much belt a
 * piercing line costs.
 */
export interface MapDef {
  id: string;
  name: string;
  /** one-line pitch shown on the map picker */
  blurb: string;
  waypoints: { x: number; y: number }[];
  ore: Patch[];
  crystal: Patch[];
}

export const MAPS: MapDef[] = [
  {
    id: 'serpentine',
    name: 'SERPENTINE',
    blurb: 'Long vertical runs · ore close to the line',
    waypoints: [
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
    ],
    ore: [
      { x: 1, y: 14, w: 3, h: 4 },
      { x: 9, y: 7, w: 3, h: 3 },
      { x: 17, y: 8, w: 3, h: 3 },
      { x: 24, y: 8, w: 3, h: 3 },
      { x: 36, y: 1, w: 3, h: 3 },
    ],
    crystal: [
      { x: 7, y: 13, w: 2, h: 2 },
      { x: 15, y: 5, w: 2, h: 2 },
      { x: 23, y: 13, w: 2, h: 2 },
      { x: 32, y: 4, w: 2, h: 2 },
    ],
  },
  {
    id: 'horseshoe',
    name: 'HORSESHOE',
    blurb: 'Wide open bays · big builds, long belts',
    waypoints: [
      { x: -1, y: 2 },
      { x: 8, y: 2 },
      { x: 8, y: 17 },
      { x: 18, y: 17 },
      { x: 18, y: 7 },
      { x: 26, y: 7 },
      { x: 26, y: 17 },
      { x: 34, y: 17 },
      { x: 34, y: 2 },
      { x: 40, y: 2 },
    ],
    ore: [
      { x: 2, y: 6, w: 3, h: 3 },
      { x: 11, y: 5, w: 3, h: 3 },
      { x: 20, y: 11, w: 3, h: 3 },
      { x: 28, y: 9, w: 3, h: 3 },
      { x: 36, y: 6, w: 3, h: 3 },
    ],
    crystal: [
      { x: 5, y: 12, w: 2, h: 2 },
      { x: 14, y: 13, w: 2, h: 2 },
      { x: 21, y: 3, w: 2, h: 2 },
      { x: 30, y: 14, w: 2, h: 2 },
    ],
  },
  {
    id: 'switchback',
    name: 'SWITCHBACK',
    blurb: 'Five tight hairpins · a cryo field covers three legs',
    waypoints: [
      { x: -1, y: 17 },
      { x: 4, y: 17 },
      { x: 4, y: 5 },
      { x: 11, y: 5 },
      { x: 11, y: 14 },
      { x: 18, y: 14 },
      { x: 18, y: 5 },
      { x: 25, y: 5 },
      { x: 25, y: 14 },
      { x: 32, y: 14 },
      { x: 32, y: 5 },
      { x: 40, y: 5 },
    ],
    ore: [
      { x: 1, y: 1, w: 3, h: 3 },
      { x: 6, y: 8, w: 3, h: 3 },
      { x: 13, y: 8, w: 3, h: 3 },
      { x: 20, y: 8, w: 3, h: 3 },
      { x: 27, y: 8, w: 3, h: 3 },
      { x: 34, y: 9, w: 3, h: 3 },
    ],
    crystal: [
      { x: 7, y: 16, w: 2, h: 2 },
      { x: 15, y: 2, w: 2, h: 2 },
      { x: 22, y: 16, w: 2, h: 2 },
      { x: 29, y: 2, w: 2, h: 2 },
    ],
  },
];

export const DEFAULT_MAP_ID = MAPS[0].id;

/**
 * The layout this run is being played on. Module-level because every system
 * reads the same board; `GameScene.create()` sets it before building the grid,
 * and it round-trips through the save so a resumed run lands on its own map.
 */
let active: MapDef = MAPS[0];

export function activeMap(): MapDef {
  return active;
}

export function setActiveMap(id: string | undefined): MapDef {
  active = MAPS.find((m) => m.id === id) ?? MAPS[0];
  return active;
}

export function pathWaypoints(): { x: number; y: number }[] {
  return active.waypoints;
}

/** The active route in pixel coords (tile centers) for enemy movement. */
export function pathPx(): { x: number; y: number }[] {
  return active.waypoints.map((w) => ({ x: w.x * TILE + TILE / 2, y: w.y * TILE + TILE / 2 }));
}

export function orePatches(): Patch[] {
  return active.ore;
}

export function crystalPatches(): Patch[] {
  return active.crystal;
}

export function inPatch(patches: readonly Patch[], x: number, y: number): boolean {
  return patches.some((p) => x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h);
}

/**
 * Units in a single tile. Tuned so an ore tile and a crystal tile last about
 * the same wall-clock time under one miner (ore mines faster but holds more),
 * roughly three minutes each — long enough to forget about, short enough that
 * a maxed-out factory has to be re-engineered rather than left alone.
 */
export const RESERVES: Record<'ore' | 'crystal', number> = { ore: 120, crystal: 70 };

/** Prospecting reveals one new patch at a time, alternating the resource. */
export const PROSPECT_SIZE: Record<'ore' | 'crystal', { w: number; h: number }> = {
  ore: { w: 3, h: 3 },
  crystal: { w: 2, h: 2 },
};

export function prospectKind(surveys: number): 'ore' | 'crystal' {
  return surveys % 2 === 0 ? 'ore' : 'crystal';
}

/** Each survey costs half again as much as the last — late patches are a real investment. */
export function prospectCost(surveys: number): number {
  return Math.round(250 * Math.pow(1.5, surveys));
}

/** Set of "x,y" keys for every tile the given route crosses (unbuildable). */
export function computePathCells(waypoints: { x: number; y: number }[] = active.waypoints): Set<string> {
  const cells = new Set<string>();
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
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
