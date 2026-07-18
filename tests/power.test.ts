import { describe, expect, it } from 'vitest';
import { POWER_PER_GENERATOR } from '../src/core/config';
import { step, richGame, addPower } from './helpers';

describe('power', () => {
  it('reports full satisfaction with no demand', () => {
    const game = richGame();
    step(game, 0.1);
    expect(game.power.satisfaction).toBe(1);
  });

  it('reports zero satisfaction when machines have no generator', () => {
    const game = richGame();
    game.placeBuilding('smelter', 2, 5, 1);
    step(game, 0.1);
    expect(game.power.supply).toBe(0);
    expect(game.power.demand).toBeGreaterThan(0);
    expect(game.power.satisfaction).toBe(0);
  });

  it('generators burn coal to supply power', () => {
    const game = richGame();
    addPower(game, 2);
    game.placeBuilding('smelter', 2, 5, 1);
    step(game, 0.1);
    expect(game.power.supply).toBe(POWER_PER_GENERATOR);
    expect(game.power.satisfaction).toBe(1);
  });

  it('runs out of power when coal is exhausted', () => {
    const game = richGame();
    addPower(game, 1); // one coal = 8s of fuel
    game.placeBuilding('smelter', 2, 5, 1);
    step(game, 10);
    expect(game.power.supply).toBe(0);
    expect(game.power.satisfaction).toBe(0);
  });

  it('scales machine speed by satisfaction when underpowered', () => {
    const game = richGame();
    // 5 smelters demand 20; supply 0 -> no progress at all.
    game.placeBuilding('smelter', 2, 5, 1)!.input['iron-ore'] = 5;
    const s = game.buildingAt(2, 5)!;
    step(game, 5);
    expect(s.output).toBeNull();
    expect(s.craftProgress).toBe(0);
  });
});
