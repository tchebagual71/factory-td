import { describe, expect, it } from 'vitest';
import { GridSystem, minedResource } from './GridSystem';
import { makeBuilding } from '../test/helpers';

// Known map coordinates: (7,18) is open grass, (5,10) is a path corner,
// (2,15) is inside the first ore patch (x1-3, y14-17), (7,13) is inside the
// first crystal patch (x7-8, y13-14).
describe('GridSystem placement rules', () => {
  it('allows belts on grass but never on the enemy path', () => {
    const grid = new GridSystem();
    expect(grid.canPlace('belt', 7, 18)).toBe(true);
    expect(grid.canPlace('belt', 5, 10)).toBe(false);
    expect(grid.cellAt(5, 10)?.kind).toBe('path');
  });

  it('restricts miners to resource tiles, ore or crystal', () => {
    const grid = new GridSystem();
    expect(grid.cellAt(2, 15)?.kind).toBe('ore');
    expect(grid.cellAt(7, 13)?.kind).toBe('crystal');
    expect(grid.canPlace('miner', 2, 15)).toBe(true);
    expect(grid.canPlace('miner', 7, 13)).toBe(true);
    expect(grid.canPlace('miner', 7, 18)).toBe(false); // plain grass
    expect(grid.canPlace('tower', 2, 15)).toBe(true); // non-miners may sit on resources
    expect(grid.canPlace('assembler', 7, 13)).toBe(true);
  });

  it('maps each resource cell kind to the item its miner digs', () => {
    expect(minedResource('ore')).toBe('ore');
    expect(minedResource('crystal')).toBe('crystal');
    expect(minedResource('grass')).toBeNull();
    expect(minedResource('path')).toBeNull();
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
