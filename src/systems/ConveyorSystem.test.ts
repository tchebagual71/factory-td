import { beforeEach, describe, expect, it } from 'vitest';
import { MACHINES, TOWERS } from '../data/buildings';
import { addItem, makeScene, placeBuilding } from '../test/helpers';
import { Building } from '../types';
import { ConveyorSystem } from './ConveyorSystem';
import { GridSystem } from './GridSystem';

// All coordinates below sit on open grass rows (y 17-19, x 5-30) away from
// the enemy path and ore patches. dt of one 60fps frame; items placed at
// their cell center resolve a transfer on the first update.
const DT = 1 / 60;

let grid: GridSystem;
let conv: ConveyorSystem;

beforeEach(() => {
  grid = new GridSystem();
  conv = new ConveyorSystem(makeScene(), grid);
});

describe('belt movement', () => {
  it('hands the item to the next belt in its direction', () => {
    const a = placeBuilding(grid, 'belt', 6, 18, 0); // east
    const b = placeBuilding(grid, 'belt', 7, 18, 0);
    const it = addItem(conv, a, 'ore');
    conv.update(DT);
    expect(a.item).toBeNull();
    expect(b.item).toBe(it);
    expect(it.cx).toBe(7);
  });

  it('holds the item when the next cell is occupied', () => {
    const a = placeBuilding(grid, 'belt', 6, 18, 0);
    const b = placeBuilding(grid, 'belt', 7, 18, 0);
    addItem(conv, b, 'ore');
    const waiting = addItem(conv, a, 'ore');
    conv.update(DT);
    expect(a.item).toBe(waiting);
    expect(waiting.cx).toBe(6);
  });

  it('holds the item when facing empty ground', () => {
    const a = placeBuilding(grid, 'belt', 6, 18, 0);
    const it = addItem(conv, a, 'ore');
    conv.update(DT);
    expect(a.item).toBe(it);
    expect(it.cx).toBe(6);
  });
});

describe('splitter round-robin', () => {
  let splitter: Building;
  let straight: Building;
  let left: Building;
  let right: Building;

  beforeEach(() => {
    splitter = placeBuilding(grid, 'splitter', 7, 18, 0); // facing east
    straight = placeBuilding(grid, 'belt', 8, 18, 0);
    left = placeBuilding(grid, 'belt', 7, 17, 3); // north of an east-facing splitter
    right = placeBuilding(grid, 'belt', 7, 19, 1); // south
  });

  function dispatchOnce(): Building | null {
    const it = addItem(conv, splitter, 'ore');
    conv.update(DT);
    for (const out of [straight, left, right]) {
      if (out.item === it) {
        out.item = null;
        conv.destroyItem(it);
        return out;
      }
    }
    return null;
  }

  it('cycles straight, left, right', () => {
    expect(dispatchOnce()).toBe(straight);
    expect(dispatchOnce()).toBe(left);
    expect(dispatchOnce()).toBe(right);
    expect(dispatchOnce()).toBe(straight);
  });

  it('skips blocked outputs without losing its place in the rotation', () => {
    addItem(conv, straight, 'ore'); // block the straight output
    expect(dispatchOnce()).toBe(left);
    expect(dispatchOnce()).toBe(right);
  });
});

describe('tunnels', () => {
  it('dives to the next same-facing tunnel within reach', () => {
    const entrance = placeBuilding(grid, 'tunnel', 10, 18, 0);
    const exit = placeBuilding(grid, 'tunnel', 13, 18, 0);
    const it = addItem(conv, entrance, 'ammo');
    conv.update(DT);
    expect(entrance.item).toBeNull();
    expect(exit.item).toBe(it);
    expect(it.cx).toBe(13);
    expect((it.sprite as unknown as { alpha: number }).alpha).toBeCloseTo(0.35);
  });

  it('waits at the entrance while the paired exit is occupied', () => {
    const entrance = placeBuilding(grid, 'tunnel', 10, 18, 0);
    const exit = placeBuilding(grid, 'tunnel', 13, 18, 0);
    placeBuilding(grid, 'belt', 11, 18, 0); // tempting belt fallback — must not be taken
    addItem(conv, exit, 'ammo');
    const waiting = addItem(conv, entrance, 'ammo');
    conv.update(DT);
    expect(entrance.item).toBe(waiting);
    expect(waiting.cx).toBe(10);
  });

  it('ignores tunnels facing another way and out-of-reach tunnels', () => {
    const entrance = placeBuilding(grid, 'tunnel', 10, 18, 0);
    placeBuilding(grid, 'tunnel', 12, 18, 1); // wrong facing
    placeBuilding(grid, 'tunnel', 15, 18, 0); // 5 tiles away — beyond reach 4
    const onward = placeBuilding(grid, 'belt', 11, 18, 0);
    const it = addItem(conv, entrance, 'ammo');
    conv.update(DT);
    expect(onward.item).toBe(it); // degraded to plain belt behavior
    expect(it.cx).toBe(11);
  });
});

describe('machine and tower intake', () => {
  it('feeds ore into a press until its input buffer is full', () => {
    const belt = placeBuilding(grid, 'belt', 7, 18, 0);
    const press = placeBuilding(grid, 'press', 8, 18, 0);
    addItem(conv, belt, 'ore');
    conv.update(DT);
    expect(press.inputs.ore).toBe(1);
    expect(conv.items).toHaveLength(0); // consumed, not moved

    press.inputs.ore = MACHINES.press.inputCap;
    const stuck = addItem(conv, belt, 'ore');
    conv.update(DT);
    expect(belt.item).toBe(stuck);
    expect(press.inputs.ore).toBe(MACHINES.press.inputCap);
  });

  it('refuses items no recipe of that machine calls for — they stay on the belt', () => {
    const belt = placeBuilding(grid, 'belt', 7, 18, 0);
    const press = placeBuilding(grid, 'press', 8, 18, 0);
    // the press eats raw ore only; its own output must never flow back in
    const ammo = addItem(conv, belt, 'ammo');
    conv.update(DT);
    expect(belt.item).toBe(ammo);
    expect(press.inputs.ammo ?? 0).toBe(0);
  });

  it('feeds a downstream machine its manufactured input — the chain past the press runs on ammo', () => {
    const belt = placeBuilding(grid, 'belt', 7, 18, 0);
    const forge = placeBuilding(grid, 'forge', 8, 18, 0);
    addItem(conv, belt, 'ammo');
    conv.update(DT);
    expect(forge.inputs.ammo).toBe(1);
    expect(conv.items).toHaveLength(0);

    // raw ore is no longer a forge input and must be left alone
    const ore = addItem(conv, belt, 'ore');
    conv.update(DT);
    expect(belt.item).toBe(ore);
    expect(forge.inputs.ore ?? 0).toBe(0);
  });

  it('feeds an assembler both inputs into separate buffers', () => {
    const belt = placeBuilding(grid, 'belt', 7, 18, 0);
    const asm = placeBuilding(grid, 'assembler', 8, 18, 0);
    addItem(conv, belt, 'ammo');
    conv.update(DT);
    addItem(conv, belt, 'crystal');
    conv.update(DT);
    expect(asm.inputs.ammo).toBe(1);
    expect(asm.inputs.crystal).toBe(1);
    expect(conv.items).toHaveLength(0);

    asm.inputs.crystal = MACHINES.assembler.inputCap;
    const stuck = addItem(conv, belt, 'crystal');
    conv.update(DT);
    expect(belt.item).toBe(stuck); // crystal buffer full — the ammo buffer must not absorb it
    expect(asm.inputs.ammo).toBe(1);
  });

  it('refuses crystal at machines whose recipe does not call for it', () => {
    const belt = placeBuilding(grid, 'belt', 7, 18, 0);
    const press = placeBuilding(grid, 'press', 8, 18, 0);
    const crystal = addItem(conv, belt, 'crystal');
    conv.update(DT);
    expect(belt.item).toBe(crystal);
    expect(press.inputs.ore ?? 0).toBe(0);
    expect(press.inputs.crystal ?? 0).toBe(0);
  });

  it('loads cryo towers with coolant, and never lets coolant into a gun', () => {
    const belt = placeBuilding(grid, 'belt', 7, 18, 0);
    const cryo = placeBuilding(grid, 'cryo', 8, 18, 0);
    addItem(conv, belt, 'coolant');
    conv.update(DT);
    expect(cryo.ammo).toBe(1);

    const gunBelt = placeBuilding(grid, 'belt', 7, 17, 0);
    const gun = placeBuilding(grid, 'tower', 8, 17, 0);
    const coolant = addItem(conv, gunBelt, 'coolant');
    conv.update(DT);
    expect(gunBelt.item).toBe(coolant);
    expect(gun.ammo).toBe(0);
  });

  it('records every delivered round against the tower, but not rounds it refused', () => {
    const belt = placeBuilding(grid, 'belt', 7, 18, 0);
    const gun = placeBuilding(grid, 'tower', 8, 18, 0);
    addItem(conv, belt, 'ammo');
    conv.update(DT);
    addItem(conv, belt, 'ammo');
    conv.update(DT);
    expect(gun.ammo).toBe(2);
    expect(gun.fed).toBe(2);

    // wrong caliber is turned away and must not count as service
    const shell = addItem(conv, belt, 'shell');
    conv.update(DT);
    expect(belt.item).toBe(shell);
    expect(gun.fed).toBe(2);

    // nor does a delivery a full magazine cannot take
    gun.ammo = TOWERS.tower.ammoCap;
    const overflow = addItem(conv, belt, 'ammo');
    conv.update(DT);
    expect(belt.item).toBe(overflow);
    expect(gun.fed).toBe(2);
  });

  it('loads lancers with piercing rounds only', () => {
    const belt = placeBuilding(grid, 'belt', 7, 18, 0);
    const lancer = placeBuilding(grid, 'lancer', 8, 18, 0);
    const shell = addItem(conv, belt, 'shell'); // wrong caliber
    conv.update(DT);
    expect(belt.item).toBe(shell);
    expect(lancer.ammo).toBe(0);
    conv.destroyItem(shell);
    belt.item = null;

    addItem(conv, belt, 'piercing');
    conv.update(DT);
    expect(lancer.ammo).toBe(1);
  });

  it('loads towers with their own ammo type only, up to the magazine cap', () => {
    const belt = placeBuilding(grid, 'belt', 7, 18, 0);
    const tower = placeBuilding(grid, 'tower', 8, 18, 0);
    addItem(conv, belt, 'ammo');
    conv.update(DT);
    expect(tower.ammo).toBe(1);

    const shell = addItem(conv, belt, 'shell'); // wrong caliber
    conv.update(DT);
    expect(belt.item).toBe(shell);
    expect(tower.ammo).toBe(1);
    conv.destroyItem(shell);
    belt.item = null;

    tower.ammo = TOWERS.tower.ammoCap;
    const overflow = addItem(conv, belt, 'ammo');
    conv.update(DT);
    expect(belt.item).toBe(overflow);
    expect(tower.ammo).toBe(TOWERS.tower.ammoCap);
  });
});

describe('spawnFrom (machine output)', () => {
  it('places a fresh item on the faced belt and reports blockage honestly', () => {
    placeBuilding(grid, 'miner', 5, 18, 0);
    const belt = placeBuilding(grid, 'belt', 6, 18, 0);
    expect(conv.spawnFrom(5, 18, 0, 'ore')).toBe(true);
    expect(belt.item?.type).toBe('ore');
    expect(conv.items).toHaveLength(1);
    expect(conv.spawnFrom(5, 18, 0, 'ore')).toBe(false); // belt occupied
    expect(conv.spawnFrom(5, 17, 0, 'ore')).toBe(false); // no belt there
  });
});
