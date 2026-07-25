import { beforeEach, describe, expect, it } from 'vitest';
import { MACHINES, TOWERS } from '../data/buildings';
import { GameState } from '../state/GameState';
import { addItem, makeScene, placeBuilding } from '../test/helpers';
import { ConveyorSystem } from './ConveyorSystem';
import { GridSystem } from './GridSystem';
import { LogisticsSystem } from './LogisticsSystem';

// Overlay telemetry only accumulates while a wave is in progress; the numbers
// it reports always describe the last fight. Coordinates sit on open grass.
let grid: GridSystem;
let conv: ConveyorSystem;
let logi: LogisticsSystem;

beforeEach(() => {
  GameState.reset();
  grid = new GridSystem();
  const scene = makeScene();
  conv = new ConveyorSystem(scene, grid);
  logi = new LogisticsSystem(scene, grid);
  GameState.setPhase('wave');
});

describe('measurement window', () => {
  it('only accumulates during a wave', () => {
    const tower = placeBuilding(grid, 'tower', 7, 18, 0);
    GameState.setPhase('build');
    logi.update(5);
    expect(tower.utilTotal).toBe(0);

    GameState.setPhase('wave');
    logi.update(5);
    expect(tower.utilTotal).toBe(5);
  });

  it('resets every counter when the next wave is sent', () => {
    const tower = placeBuilding(grid, 'tower', 7, 18, 0);
    tower.ammo = TOWERS.tower.ammoCap;
    logi.update(3);
    expect(tower.utilBusy).toBe(3);

    logi.resetWindow();
    expect(tower.utilBusy).toBe(0);
    expect(tower.utilTotal).toBe(0);
  });
});

describe('tower ammo uptime', () => {
  it('counts armed time as busy and dry time as blocked', () => {
    const tower = placeBuilding(grid, 'tower', 7, 18, 0);
    tower.ammo = 2;
    logi.update(3);
    tower.ammo = 0;
    logi.update(1);

    expect(tower.utilBusy).toBe(3);
    expect(tower.utilBlocked).toBe(1);
    expect(tower.utilBusy / tower.utilTotal).toBeCloseTo(0.75);
  });
});

describe('belt throughput', () => {
  it('counts carried time, and jams separately', () => {
    const belt = placeBuilding(grid, 'belt', 7, 18, 0); // faces empty ground
    addItem(conv, belt, 'ore');
    conv.update(1 / 60);
    expect(belt.stalled).toBe(true); // nowhere to hand off
    logi.update(2);

    expect(belt.utilBusy).toBe(2);
    expect(belt.utilBlocked).toBe(2);
  });

  it('leaves an empty belt idle rather than reporting a stale jam', () => {
    const belt = placeBuilding(grid, 'belt', 7, 18, 0);
    belt.stalled = true; // left over from when it last held something
    logi.update(2);

    expect(belt.utilBusy).toBe(0);
    expect(belt.utilBlocked).toBe(0);
    expect(belt.utilTotal).toBe(2);
  });

  it('does not count a moving belt as jammed', () => {
    const a = placeBuilding(grid, 'belt', 7, 18, 0);
    placeBuilding(grid, 'belt', 8, 18, 0);
    addItem(conv, a, 'ore');
    conv.update(1 / 60);
    expect(a.stalled).toBe(false);
  });
});

describe('producer stalls', () => {
  it('marks a machine starved of inputs as blocked, not busy', () => {
    const press = placeBuilding(grid, 'press', 7, 18, 0);
    press.stalled = true; // ProductionSystem's verdict: no ore
    logi.update(2);
    expect(press.utilBlocked).toBe(2);
    expect(press.utilBusy).toBe(0);
  });

  it('counts a crafting machine as busy even mid-cycle', () => {
    const asm = placeBuilding(grid, 'assembler', 7, 18, 0);
    asm.crafting = true;
    asm.inputs.ammo = MACHINES.assembler.inputs.ammo!;
    logi.update(2);
    expect(asm.utilBusy).toBe(2);
    expect(asm.utilBlocked).toBe(0);
  });
});
