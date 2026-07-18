import { describe, expect, it } from 'vitest';
import { step, richGame, testMap, setOre, addPower } from './helpers';

describe('production', () => {
  it('miner extracts the ore under it onto the belt it faces', () => {
    const map = testMap();
    setOre(map, 2, 5, 'iron-ore');
    const game = richGame(map);
    addPower(game);
    game.placeBuilding('miner', 2, 5, 1);
    const belt = game.placeBuilding('belt', 3, 5, 1)!;

    step(game, 2);
    expect(belt.item).toBe('iron-ore');
  });

  it('miner only places on ore tiles', () => {
    const game = richGame();
    expect(game.placeBuilding('miner', 2, 5, 1)).toBeNull();
  });

  it('smelter turns iron ore into iron plate', () => {
    const game = richGame();
    addPower(game);
    const smelter = game.placeBuilding('smelter', 2, 5, 1)!;
    const belt = game.placeBuilding('belt', 3, 5, 1)!;
    smelter.input['iron-ore'] = 1;

    step(game, 3);
    expect(belt.item).toBe('iron-plate');
    expect(smelter.input['iron-ore']).toBe(0);
  });

  it('smelter turns copper ore into copper plate', () => {
    const game = richGame();
    addPower(game);
    const smelter = game.placeBuilding('smelter', 2, 5, 1)!;
    smelter.input['copper-ore'] = 1;

    step(game, 3);
    expect(smelter.output).toBe('copper-plate'); // no belt in front, so it holds the plate
  });

  it('ammo assembler consumes one iron and one copper plate per ammo', () => {
    const game = richGame();
    addPower(game);
    const asm = game.placeBuilding('assembler-ammo', 2, 5, 1)!;
    const belt = game.placeBuilding('belt', 3, 5, 1)!;
    asm.input['iron-plate'] = 2;
    asm.input['copper-plate'] = 1;

    step(game, 4);
    expect(belt.item).toBe('ammo');
    expect(asm.input['iron-plate']).toBe(1);
    expect(asm.input['copper-plate']).toBe(0);
  });

  it('assembler stalls without full ingredients', () => {
    const game = richGame();
    addPower(game);
    const asm = game.placeBuilding('assembler-ammo', 2, 5, 1)!;
    asm.input['iron-plate'] = 3; // no copper

    step(game, 5);
    expect(asm.output).toBeNull();
    expect(asm.input['iron-plate']).toBe(3);
  });

  it('machines can push directly into adjacent machines', () => {
    const map = testMap();
    setOre(map, 2, 5, 'iron-ore');
    const game = richGame(map);
    addPower(game);
    game.placeBuilding('miner', 2, 5, 1);
    const smelter = game.placeBuilding('smelter', 3, 5, 1)!;

    step(game, 6);
    expect(smelter.output === 'iron-plate' || (smelter.input['iron-ore'] ?? 0) > 0 || smelter.crafting !== null).toBe(
      true,
    );
  });
});
