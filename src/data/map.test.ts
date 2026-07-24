import { describe, expect, it } from 'vitest';
import { GRID_H, GRID_W } from '../config';
import { computePathCells, ORE_PATCHES, PATH_WAYPOINTS } from './map';

describe('path waypoints', () => {
  it('are axis-aligned (each leg changes x or y, never both)', () => {
    for (let i = 0; i < PATH_WAYPOINTS.length - 1; i++) {
      const a = PATH_WAYPOINTS[i];
      const b = PATH_WAYPOINTS[i + 1];
      const straight = a.x === b.x || a.y === b.y;
      expect(straight, `leg ${i} is diagonal`).toBe(true);
      expect(a.x !== b.x || a.y !== b.y, `leg ${i} is zero-length`).toBe(true);
    }
  });

  it('enter and exit off-grid so enemies walk in from the screen edge', () => {
    expect(PATH_WAYPOINTS[0].x).toBeLessThan(0);
    expect(PATH_WAYPOINTS[PATH_WAYPOINTS.length - 1].x).toBeGreaterThanOrEqual(GRID_W);
  });
});

describe('computePathCells', () => {
  const cells = computePathCells();

  it('marks every in-bounds tile the route crosses and nothing off-grid', () => {
    expect(cells.has('0,10')).toBe(true); // entry leg
    expect(cells.has('5,10')).toBe(true); // first corner
    expect(cells.has('13,3')).toBe(true);
    expect(cells.has('-1,10')).toBe(false);
    for (const key of cells) {
      const [x, y] = key.split(',').map(Number);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(GRID_W);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(GRID_H);
    }
  });

  it('forms a connected route (every cell touches another path cell)', () => {
    for (const key of cells) {
      const [x, y] = key.split(',').map(Number);
      const neighbors = [`${x + 1},${y}`, `${x - 1},${y}`, `${x},${y + 1}`, `${x},${y - 1}`];
      const connected = neighbors.some((n) => cells.has(n)) || x === 0 || x === GRID_W - 1;
      expect(connected, `path cell ${key} is isolated`).toBe(true);
    }
  });
});

describe('ore patches', () => {
  it('sit fully on the grid and never overlap the enemy path', () => {
    const path = computePathCells();
    for (const p of ORE_PATCHES) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.x + p.w).toBeLessThanOrEqual(GRID_W);
      expect(p.y + p.h).toBeLessThanOrEqual(GRID_H);
      for (let y = p.y; y < p.y + p.h; y++) {
        for (let x = p.x; x < p.x + p.w; x++) {
          expect(path.has(`${x},${y}`), `ore tile ${x},${y} is on the path`).toBe(false);
        }
      }
    }
  });
});
