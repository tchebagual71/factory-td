import { Game } from '../src/core/game';
import { SIM_DT } from '../src/core/config';
import type { ItemType, MapDef, Tile } from '../src/core/types';

/**
 * 12x12 map with a straight path along y=0 (west to east) and everything else
 * empty. Tests stamp ore where they need it via `setOre`.
 */
export function testMap(): MapDef {
  const width = 12;
  const height = 12;
  const tiles: Tile[] = Array.from({ length: width * height }, () => ({ kind: 'empty' as const }));
  for (let x = 0; x < width; x++) tiles[x] = { kind: 'path' };
  return {
    width,
    height,
    tiles,
    waypoints: [
      { x: 0, y: 0 },
      { x: width - 1, y: 0 },
    ],
  };
}

export function setOre(map: MapDef, x: number, y: number, ore: ItemType): void {
  map.tiles[y * map.width + x] = { kind: 'ore', ore };
}

export function richGame(map: MapDef = testMap()): Game {
  const game = new Game(map);
  game.money = 100_000;
  return game;
}

/** Advance the sim by `seconds` in fixed steps. */
export function step(game: Game, seconds: number): void {
  const ticks = Math.round(seconds / SIM_DT);
  for (let i = 0; i < ticks; i++) game.update(SIM_DT);
}

/** Place a fueled generator well away from the path so machines have power. */
export function addPower(game: Game, coal = 50): void {
  const gen = game.placeBuilding('generator', 10, 10, 0);
  if (!gen) throw new Error('failed to place test generator');
  gen.input.coal = coal;
}
