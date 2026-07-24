import { describe, expect, it } from 'vitest';
import { GRID_H, GRID_W } from '../config';
import { MINER, minerCycle, TOWERS } from './buildings';
import {
  activeMap,
  computePathCells,
  DEFAULT_MAP_ID,
  inPatch,
  MapDef,
  MAPS,
  Patch,
  PROSPECT_SIZE,
  prospectCost,
  prospectKind,
  RESERVES,
  setActiveMap,
} from './map';

const area = (ps: readonly Patch[]) => ps.reduce((n, p) => n + p.w * p.h, 0);

// Every layout has to satisfy the same contract — a broken map is a broken run,
// and these are cheap enough to check for all of them.
describe.each(MAPS.map((m): [string, MapDef] => [m.name, m]))('map: %s', (_name, map) => {
  const cells = computePathCells(map.waypoints);

  it('has an axis-aligned route with no diagonal or zero-length legs', () => {
    for (let i = 0; i < map.waypoints.length - 1; i++) {
      const a = map.waypoints[i];
      const b = map.waypoints[i + 1];
      expect(a.x === b.x || a.y === b.y, `leg ${i} is diagonal`).toBe(true);
      expect(a.x !== b.x || a.y !== b.y, `leg ${i} is zero-length`).toBe(true);
    }
  });

  it('enters and exits off-grid so enemies walk in from the screen edge', () => {
    expect(map.waypoints[0].x).toBeLessThan(0);
    expect(map.waypoints[map.waypoints.length - 1].x).toBeGreaterThanOrEqual(GRID_W);
  });

  it('marks only in-bounds tiles as path', () => {
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

  it('keeps every deposit on the board and off the path', () => {
    for (const [label, patches] of [
      ['ore', map.ore],
      ['crystal', map.crystal],
    ] as const) {
      expect(patches.length, `${label} patches`).toBeGreaterThan(0);
      for (const p of patches) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.x + p.w).toBeLessThanOrEqual(GRID_W);
        expect(p.y + p.h).toBeLessThanOrEqual(GRID_H);
        for (let y = p.y; y < p.y + p.h; y++) {
          for (let x = p.x; x < p.x + p.w; x++) {
            expect(cells.has(`${x},${y}`), `${label} tile ${x},${y} is on the path`).toBe(false);
          }
        }
      }
    }
  });

  it('never puts crystal on an ore tile — a miner mines exactly one resource', () => {
    for (const p of map.crystal) {
      for (let y = p.y; y < p.y + p.h; y++) {
        for (let x = p.x; x < p.x + p.w; x++) {
          expect(inPatch(map.ore, x, y), `tile ${x},${y} is both ore and crystal`).toBe(false);
        }
      }
    }
  });

  it('keeps crystal genuinely scarce next to ore', () => {
    expect(area(map.crystal)).toBeGreaterThan(0);
    expect(area(map.crystal)).toBeLessThan(area(map.ore) / 2);
  });
});

describe('the map roster', () => {
  it('offers several distinct, uniquely identified layouts', () => {
    expect(MAPS.length).toBeGreaterThanOrEqual(3);
    const ids = MAPS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    const routes = MAPS.map((m) => JSON.stringify(m.waypoints));
    expect(new Set(routes).size).toBe(routes.length);
    for (const m of MAPS) {
      expect(m.name.length).toBeGreaterThan(0);
      expect(m.blurb.length).toBeGreaterThan(0);
    }
  });

  it('selects by id and falls back to the default for anything unknown', () => {
    expect(setActiveMap('switchback').id).toBe('switchback');
    expect(activeMap().id).toBe('switchback');
    expect(setActiveMap('no-such-map').id).toBe(DEFAULT_MAP_ID);
    expect(setActiveMap(undefined).id).toBe(DEFAULT_MAP_ID);
  });

  it('gives ore and crystal tiles a comparable working life under one miner', () => {
    // ore mines faster but holds more, so neither resource dies first by accident
    const oreLife = RESERVES.ore * MINER.cycle;
    const crystalLife = RESERVES.crystal * minerCycle('crystal');
    expect(crystalLife / oreLife).toBeGreaterThan(0.7);
    expect(crystalLife / oreLife).toBeLessThan(1.4);
  });
});

describe('prospecting', () => {
  it('alternates the resource so both lines can be resupplied', () => {
    expect(prospectKind(0)).toBe('ore');
    expect(prospectKind(1)).toBe('crystal');
    expect(prospectKind(2)).toBe('ore');
  });

  it('charges strictly more for every survey', () => {
    let prev = 0;
    for (let n = 0; n < 8; n++) {
      const cost = prospectCost(n);
      expect(cost).toBeGreaterThan(prev);
      expect(Number.isInteger(cost)).toBe(true);
      prev = cost;
    }
  });

  it('prices the first survey above a tower, so it is a real decision', () => {
    expect(prospectCost(0)).toBeGreaterThan(TOWERS.tower.cost);
  });

  it('reveals patches that fit on the board', () => {
    for (const kind of ['ore', 'crystal'] as const) {
      expect(PROSPECT_SIZE[kind].w).toBeGreaterThan(0);
      expect(PROSPECT_SIZE[kind].h).toBeGreaterThan(0);
      expect(PROSPECT_SIZE[kind].w).toBeLessThan(GRID_W);
      expect(PROSPECT_SIZE[kind].h).toBeLessThan(GRID_H);
    }
  });
});
