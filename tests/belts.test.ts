import { describe, expect, it } from 'vitest';
import { step, richGame } from './helpers';

describe('belts', () => {
  it('moves an item from one belt to the next', () => {
    const game = richGame();
    const a = game.placeBuilding('belt', 2, 5, 1)!; // east
    const b = game.placeBuilding('belt', 3, 5, 1)!;
    a.item = 'iron-plate';

    step(game, 1.5);
    expect(a.item).toBeNull();
    expect(b.item).toBe('iron-plate');
  });

  it('holds the item at the end of an unconnected belt', () => {
    const game = richGame();
    const a = game.placeBuilding('belt', 2, 5, 1)!;
    a.item = 'coal';

    step(game, 3);
    expect(a.item).toBe('coal');
    expect(a.progress).toBe(1);
  });

  it('does not transfer onto an occupied belt', () => {
    const game = richGame();
    const a = game.placeBuilding('belt', 2, 5, 1)!;
    const b = game.placeBuilding('belt', 3, 5, 1)!;
    b.item = 'coal';
    b.progress = 1; // b is itself blocked (nothing ahead)
    a.item = 'iron-ore';

    step(game, 3);
    expect(a.item).toBe('iron-ore');
    expect(b.item).toBe('coal');
  });

  it('delivers ammo into a turret input buffer', () => {
    const game = richGame();
    const belt = game.placeBuilding('belt', 2, 5, 1)!;
    const turret = game.placeBuilding('turret', 3, 5, 0)!;
    belt.item = 'ammo';

    step(game, 1.5);
    expect(belt.item).toBeNull();
    expect(turret.input.ammo).toBe(1);
  });

  it('rejects items the target machine does not accept', () => {
    const game = richGame();
    const belt = game.placeBuilding('belt', 2, 5, 1)!;
    game.placeBuilding('turret', 3, 5, 0);
    belt.item = 'iron-plate'; // turrets only take ammo

    step(game, 2);
    expect(belt.item).toBe('iron-plate');
  });
});
