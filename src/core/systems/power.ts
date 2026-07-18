import { BUILDING_DEFS, FUEL_SECONDS_PER_COAL, POWER_PER_GENERATOR } from '../config';
import type { Game } from '../game';

export interface PowerState {
  supply: number;
  demand: number;
  /** 0..1 multiplier applied to every machine's work speed. */
  satisfaction: number;
}

/**
 * Single global grid. Generators refuel from their coal buffer and burn while
 * they have fuel; machines run at supply/demand speed when underpowered.
 */
export function computePower(game: Game, dt: number): PowerState {
  let supply = 0;
  let demand = 0;
  for (const b of game.buildings) {
    if (b.kind === 'generator') {
      if (b.fuel <= 0 && (b.input.coal ?? 0) > 0) {
        b.input.coal = (b.input.coal ?? 0) - 1;
        b.fuel = FUEL_SECONDS_PER_COAL;
      }
      if (b.fuel > 0) {
        b.fuel -= dt;
        supply += POWER_PER_GENERATOR;
      }
    } else {
      demand += BUILDING_DEFS[b.kind].power;
    }
  }
  const satisfaction = demand === 0 ? 1 : Math.min(1, supply / demand);
  return { supply, demand, satisfaction };
}
