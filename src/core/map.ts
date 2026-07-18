import { TILE } from './config';
import type { ItemType, MapDef, Tile } from './types';

/**
 * Builds the polyline (in px, through tile centers) enemies walk, plus its
 * cumulative segment lengths so a scalar distance maps to a position.
 */
export interface PathGeometry {
  points: { x: number; y: number }[]; // px
  segLengths: number[];
  totalLength: number;
}

export function buildPathGeometry(map: MapDef): PathGeometry {
  const points = map.waypoints.map((w) => ({ x: (w.x + 0.5) * TILE, y: (w.y + 0.5) * TILE }));
  const segLengths: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const len = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
    segLengths.push(len);
    total += len;
  }
  return { points, segLengths, totalLength: total };
}

/** Position in px for a distance along the path. Clamped to the ends. */
export function pointAlongPath(geo: PathGeometry, dist: number): { x: number; y: number } {
  if (dist <= 0) return { ...geo.points[0] };
  let d = dist;
  for (let i = 0; i < geo.segLengths.length; i++) {
    if (d <= geo.segLengths[i]) {
      const a = geo.points[i];
      const b = geo.points[i + 1];
      const f = geo.segLengths[i] === 0 ? 0 : d / geo.segLengths[i];
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
    d -= geo.segLengths[i];
  }
  return { ...geo.points[geo.points.length - 1] };
}

interface OrePatch {
  cx: number;
  cy: number;
  r: number;
  ore: ItemType;
}

const WAYPOINTS = [
  { x: 0, y: 3 },
  { x: 9, y: 3 },
  { x: 9, y: 8 },
  { x: 3, y: 8 },
  { x: 3, y: 14 },
  { x: 14, y: 14 },
  { x: 14, y: 5 },
  { x: 20, y: 5 },
  { x: 20, y: 11 },
  { x: 27, y: 11 },
];

const ORE_PATCHES: OrePatch[] = [
  { cx: 3, cy: 1, r: 1.7, ore: 'iron-ore' },
  { cx: 24, cy: 15, r: 1.7, ore: 'iron-ore' },
  { cx: 7, cy: 11, r: 1.4, ore: 'iron-ore' },
  { cx: 11, cy: 1, r: 1.5, ore: 'copper-ore' },
  { cx: 18, cy: 15, r: 1.7, ore: 'copper-ore' },
  { cx: 25, cy: 1, r: 1.8, ore: 'coal' },
  { cx: 1, cy: 16, r: 1.5, ore: 'coal' },
];

/** The standard 28x18 map. Waypoints trace a serpentine left-to-right path. */
export function createMap(): MapDef {
  const width = 28;
  const height = 18;
  const tiles: Tile[] = Array.from({ length: width * height }, () => ({ kind: 'empty' as const }));

  // Stamp path tiles by walking each axis-aligned waypoint segment.
  for (let i = 0; i < WAYPOINTS.length - 1; i++) {
    const a = WAYPOINTS[i];
    const b = WAYPOINTS[i + 1];
    const dx = Math.sign(b.x - a.x);
    const dy = Math.sign(b.y - a.y);
    let { x, y } = a;
    for (;;) {
      tiles[y * width + x] = { kind: 'path' };
      if (x === b.x && y === b.y) break;
      x += dx;
      y += dy;
    }
  }

  // Stamp ore blobs, never over the path.
  for (const p of ORE_PATCHES) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (Math.hypot(x - p.cx, y - p.cy) <= p.r && tiles[y * width + x].kind === 'empty') {
          tiles[y * width + x] = { kind: 'ore', ore: p.ore };
        }
      }
    }
  }

  return { width, height, tiles, waypoints: WAYPOINTS };
}
