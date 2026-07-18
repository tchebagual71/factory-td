import { BUILDING_DEFS, MINE_TIME, SMELT_RECIPES } from '../config';
import type { Game } from '../game';
import { DIRS, type Building, type ItemType, type Recipe } from '../types';
import { tryInsert } from './transfer';

/**
 * Miners, smelters and assemblers: consume inputs, work at power-satisfaction
 * speed, hold one finished item in `output` until the facing tile takes it.
 * Machines can push directly into other machines as well as belts.
 */
export function updateMachines(game: Game, dt: number): void {
  const speed = game.power.satisfaction;
  for (const b of game.buildings) {
    switch (b.kind) {
      case 'miner':
        updateMiner(game, b, dt * speed);
        break;
      case 'smelter':
        updateCrafter(b, pickSmeltRecipe(b), dt * speed);
        break;
      case 'assembler-ammo':
      case 'assembler-shell':
        updateCrafter(b, BUILDING_DEFS[b.kind].recipe!, dt * speed);
        break;
      default:
        continue;
    }
    pushOutput(game, b);
  }
}

function updateMiner(game: Game, b: Building, workDt: number): void {
  const tile = game.tileAt(b.x, b.y);
  if (tile.kind !== 'ore' || !tile.ore) return;
  if (b.output !== null) return;
  b.craftProgress += workDt / MINE_TIME;
  if (b.craftProgress >= 1) {
    b.craftProgress = 0;
    b.output = tile.ore;
  }
}

function pickSmeltRecipe(b: Building): Recipe | null {
  for (const [ore, r] of Object.entries(SMELT_RECIPES)) {
    if ((b.input[ore as ItemType] ?? 0) >= 1) {
      return { inputs: { [ore]: 1 }, output: r.output, time: r.time };
    }
  }
  return null;
}

function updateCrafter(b: Building, recipe: Recipe | null, workDt: number): void {
  if (b.crafting === null) {
    if (recipe === null || b.output !== null) return;
    if (!hasInputs(b, recipe)) return;
    for (const [item, n] of Object.entries(recipe.inputs)) {
      b.input[item as ItemType] = (b.input[item as ItemType] ?? 0) - n;
    }
    b.crafting = recipe;
    b.craftProgress = 0;
  }
  b.craftProgress += workDt / b.crafting.time;
  if (b.craftProgress >= 1 && b.output === null) {
    b.output = b.crafting.output;
    b.crafting = null;
    b.craftProgress = 0;
  }
}

function hasInputs(b: Building, recipe: Recipe): boolean {
  return Object.entries(recipe.inputs).every(([item, n]) => (b.input[item as ItemType] ?? 0) >= n);
}

function pushOutput(game: Game, b: Building): void {
  if (b.output === null) return;
  const d = DIRS[b.dir];
  if (tryInsert(game, b.x + d.x, b.y + d.y, b.output)) {
    b.output = null;
  }
}
