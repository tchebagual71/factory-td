import { describe, expect, it } from 'vitest';
import { RESERVES } from '../data/map';
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

describe('depletion', () => {
  it('spends a tile down to nothing, then turns it back into grass', () => {
    const grid = new GridSystem();
    expect(grid.cellAt(2, 15)?.reserves).toBe(RESERVES.ore);

    for (let i = 0; i < RESERVES.ore - 1; i++) {
      expect(grid.extract(2, 15), `extraction ${i}`).toBe(false);
    }
    expect(grid.extract(2, 15)).toBe(true); // the one that exhausts it
    expect(grid.cellAt(2, 15)?.kind).toBe('grass');
    expect(grid.cellAt(2, 15)?.reserves).toBe(0);
  });

  it('cannot mine an exhausted tile, grass, or the path', () => {
    const grid = new GridSystem();
    grid.setReserves(2, 15, 0);
    expect(grid.extract(2, 15)).toBe(false);
    expect(grid.extract(7, 18)).toBe(false);
    expect(grid.extract(5, 10)).toBe(false);
    expect(grid.canPlace('miner', 2, 15)).toBe(false); // nothing left to dig
  });

  it('still restores a building whose tile ran dry, so it is visible and sellable', () => {
    const grid = new GridSystem();
    grid.setReserves(2, 15, 0);
    expect(grid.canPlace('miner', 2, 15)).toBe(false);
    expect(grid.canRestore(2, 15)).toBe(true);
    expect(grid.canRestore(5, 10)).toBe(false); // the path is never restorable
  });

  it('reports only the tiles that changed', () => {
    const grid = new GridSystem();
    expect(grid.changedTiles()).toHaveLength(0);

    grid.extract(2, 15);
    grid.setReserves(3, 15, 0);
    const changed = grid.changedTiles();
    expect(changed).toContainEqual({ x: 2, y: 15, n: RESERVES.ore - 1 });
    expect(changed).toContainEqual({ x: 3, y: 15, n: 0 });
    expect(changed).toHaveLength(2);
  });
});

describe('prospecting', () => {
  it('turns clear grass into a working deposit', () => {
    const grid = new GridSystem();
    expect(grid.isClearArea(6, 18, 2, 2)).toBe(true);

    grid.addPatch({ x: 6, y: 18, w: 2, h: 2 }, 'crystal');
    expect(grid.cellAt(6, 18)?.kind).toBe('crystal');
    expect(grid.cellAt(7, 19)?.reserves).toBe(RESERVES.crystal);
    expect(grid.canPlace('miner', 6, 18)).toBe(true);
    expect(grid.revealed).toHaveLength(1);
  });

  it('never buries the path, an existing deposit, or a building', () => {
    const grid = new GridSystem();
    const b = makeBuilding('belt', 7, 18);
    grid.place(b);

    expect(grid.isClearArea(4, 10, 3, 3)).toBe(false); // overlaps the path
    expect(grid.isClearArea(1, 14, 2, 2)).toBe(false); // overlaps the ore patch
    expect(grid.isClearArea(7, 18, 2, 2)).toBe(false); // overlaps the belt

    grid.addPatch({ x: 4, y: 9, w: 3, h: 3 }, 'ore');
    expect(grid.cellAt(5, 10)?.kind).toBe('path'); // path tile untouched
  });

  it('counts a mined-out prospected tile as changed state', () => {
    const grid = new GridSystem();
    grid.addPatch({ x: 6, y: 18, w: 2, h: 2 }, 'ore');
    grid.setReserves(6, 18, 0);
    expect(grid.changedTiles()).toContainEqual({ x: 6, y: 18, n: 0 });
  });
});
