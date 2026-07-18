import { BUILDING_DEFS, MACHINE_INPUT_CAP, SMELT_RECIPES } from '../config';
import type { Game } from '../game';
import type { Building, ItemType } from '../types';

/** Would this building take one `item` right now (as belt cargo or machine input)? */
export function accepts(b: Building, item: ItemType): boolean {
  switch (b.kind) {
    case 'belt':
      return b.item === null;
    case 'generator':
      return item === 'coal' && (b.input.coal ?? 0) < MACHINE_INPUT_CAP;
    case 'smelter':
      return item in SMELT_RECIPES && (b.input[item] ?? 0) < MACHINE_INPUT_CAP;
    case 'assembler-ammo':
    case 'assembler-shell': {
      const recipe = BUILDING_DEFS[b.kind].recipe!;
      return item in recipe.inputs && (b.input[item] ?? 0) < MACHINE_INPUT_CAP;
    }
    case 'turret':
    case 'cannon':
      return item === BUILDING_DEFS[b.kind].turret!.ammo && (b.input[item] ?? 0) < MACHINE_INPUT_CAP;
    case 'miner':
      return false;
  }
}

/** Try to hand one `item` to whatever occupies tile (x, y). */
export function tryInsert(game: Game, x: number, y: number, item: ItemType): boolean {
  const b = game.buildingAt(x, y);
  if (!b || !accepts(b, item)) return false;
  if (b.kind === 'belt') {
    b.item = item;
    b.progress = 0;
  } else {
    b.input[item] = (b.input[item] ?? 0) + 1;
  }
  return true;
}
