import { describe, expect, it } from 'vitest';
import { TILE } from '../src/core/config';
import { buildPathGeometry, createMap, pointAlongPath } from '../src/core/map';

describe('map', () => {
  it('marks every waypoint segment as path tiles', () => {
    const map = createMap();
    for (const w of map.waypoints) {
      expect(map.tiles[w.y * map.width + w.x].kind).toBe('path');
    }
  });

  it('path tiles form a contiguous walk (each consecutive waypoint pair is axis-aligned)', () => {
    const map = createMap();
    for (let i = 0; i < map.waypoints.length - 1; i++) {
      const a = map.waypoints[i];
      const b = map.waypoints[i + 1];
      expect(a.x === b.x || a.y === b.y).toBe(true);
    }
  });

  it('never places ore on the path', () => {
    const map = createMap();
    for (const t of map.tiles) {
      if (t.kind === 'ore') expect(t.ore).toBeDefined();
      expect(t.kind === 'path' && (t as { ore?: string }).ore).toBeFalsy();
    }
  });

  it('has all three ore types available', () => {
    const map = createMap();
    const ores = new Set(map.tiles.filter((t) => t.kind === 'ore').map((t) => t.ore));
    expect(ores).toContain('iron-ore');
    expect(ores).toContain('copper-ore');
    expect(ores).toContain('coal');
  });

  it('computes path geometry and interpolates positions', () => {
    const map = createMap();
    const geo = buildPathGeometry(map);
    expect(geo.totalLength).toBeGreaterThan(20 * TILE);

    const start = pointAlongPath(geo, 0);
    expect(start.x).toBeCloseTo((map.waypoints[0].x + 0.5) * TILE);

    const past = pointAlongPath(geo, geo.totalLength + 999);
    const last = map.waypoints[map.waypoints.length - 1];
    expect(past.x).toBeCloseTo((last.x + 0.5) * TILE);
    expect(past.y).toBeCloseTo((last.y + 0.5) * TILE);
  });
});
