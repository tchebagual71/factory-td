import { describe, expect, it } from 'vitest';
import { GridSystem } from './GridSystem';
import { makeBuilding } from '../test/helpers';

// Known map coordinates: (7,18) is open grass, (5,10) is a path corner,
// (2,15) is inside the first ore patch (x1-3, y14-17).
describe('GridSystem placement rules', () => {
  it('allows belts on grass but never on the enemy path', () => {
    const grid = new GridSystem();
    expect(grid.canPlace('belt', 7, 18)).toBe(true);
    expect(grid.canPlace('belt', 5, 10)).toBe(false);
    expect(grid.cellAt(5, 10)?.kind).toBe('path');
  });

  it('restricts miners to ore tiles', () => {
    const grid = new GridSystem();
    expect(grid.cellAt(2, 15)?.kind).toBe('ore');
    expect(grid.canPlace('miner', 2, 15)).toBe(true);
    expect(grid.canPlace('miner', 7, 18)).toBe(false);
    expect(grid.canPlace('tower', 2, 15)).toBe(true); // non-miners may sit on ore
  });

  it('rejects occupied cells until the building is removed', () => {
    const grid = new GridSystem();
    const b = makeBuilding('belt', 7, 18);
    grid.place(b);
    expect(grid.canPlace('belt', 7, 18)).toBe(false);
    expect(grid.buildings).toContain(b);
    grid.remove(b);
    expect(grid.canPlace('belt', 7, 18)).toBe(true);
    expect(grid.buildings).not.toContain(b);
  });

  it('rejects out-of-bounds coordinates', () => {
    const grid = new GridSystem();
    expect(grid.canPlace('belt', -1, 0)).toBe(false);
    expect(grid.canPlace('belt', 40, 19)).toBe(false);
    expect(grid.cellAt(0, 20)).toBeNull();
  });
});
