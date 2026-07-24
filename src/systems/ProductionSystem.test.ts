import { beforeEach, describe, expect, it } from 'vitest';
import { MACHINES, MINER, minerCycle } from '../data/buildings';
import { makeScene, placeBuilding } from '../test/helpers';
import { ConveyorSystem } from './ConveyorSystem';
import { GridSystem } from './GridSystem';
import { ProductionSystem } from './ProductionSystem';

// Map coordinates used below: (2,15) is ore, (7,13) is crystal, y17-19 is open
// grass. Machines output onto the belt they face (east, dir 0).
let grid: GridSystem;
let conv: ConveyorSystem;
let prod: ProductionSystem;

beforeEach(() => {
  grid = new GridSystem();
  const scene = makeScene();
  conv = new ConveyorSystem(scene, grid);
  prod = new ProductionSystem(scene, grid, conv);
});

describe('miners', () => {
  it('dig whatever the tile under them holds', () => {
    const oreBelt = placeBuilding(grid, 'belt', 3, 15, 0);
    placeBuilding(grid, 'miner', 2, 15, 0);
    const crystalBelt = placeBuilding(grid, 'belt', 9, 13, 0);
    placeBuilding(grid, 'miner', 8, 13, 0);

    prod.update(minerCycle('crystal') + 0.01);
    expect(oreBelt.item?.type).toBe('ore');
    expect(crystalBelt.item?.type).toBe('crystal');
  });

  it('mines crystal on a slower cycle than ore', () => {
    const belt = placeBuilding(grid, 'belt', 9, 13, 0);
    placeBuilding(grid, 'miner', 8, 13, 0);

    prod.update(MINER.cycle + 0.01); // enough for ore, not for crystal
    expect(belt.item).toBeNull();
    prod.update(minerCycle('crystal') - MINER.cycle);
    expect(belt.item?.type).toBe('crystal');
  });
});

describe('assembler (tier-2 recipe)', () => {
  it('waits until BOTH inputs are stocked, then consumes each in recipe amounts', () => {
    const out = placeBuilding(grid, 'belt', 8, 18, 0);
    const asm = placeBuilding(grid, 'assembler', 7, 18, 0);
    const { oreIn, crystalIn, cycle } = MACHINES.assembler;

    asm.inputOre = oreIn;
    prod.update(cycle + 0.01);
    expect(asm.crafting).toBe(false); // no crystal — nothing starts
    expect(out.item).toBeNull();
    expect(asm.inputOre).toBe(oreIn);

    asm.inputCrystal = crystalIn;
    prod.update(0.01);
    expect(asm.crafting).toBe(true);
    expect(asm.inputOre).toBe(0);
    expect(asm.inputCrystal).toBe(0);

    prod.update(cycle);
    expect(asm.outputBuf).toBe(1);
    prod.update(0.01); // finished goods hit the belt on the following tick
    expect(out.item?.type).toBe('piercing');
  });

  it('leaves a press unaffected by crystal it never asked for', () => {
    const out = placeBuilding(grid, 'belt', 8, 18, 0);
    const press = placeBuilding(grid, 'press', 7, 18, 0);
    press.inputOre = MACHINES.press.oreIn;
    press.inputCrystal = 3; // stray stock must not gate or be eaten

    prod.update(MACHINES.press.cycle + 0.02);
    prod.update(0.01);
    expect(out.item?.type).toBe('ammo');
    expect(press.inputCrystal).toBe(3);
  });
});
