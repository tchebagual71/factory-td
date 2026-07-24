import { describe, expect, it } from 'vitest';
import { GRID_W } from '../config';
import { makeBuilding, makeSprite } from '../test/helpers';
import { Building, ItemEnt } from '../types';
import { captureRun, SaveV1, validateSave } from './serialize';

const SNAPSHOT = { money: 320, lives: 17, wave: 8, speed: 2 as const, auto: true };

function towerAt(x: number, y: number): Building {
  const b = makeBuilding('tower', x, y);
  b.mk = 3;
  b.path = 'sniper';
  b.ammo = 11;
  b.invested = 640;
  return b;
}

function itemOn(b: Building, alpha = 1): ItemEnt {
  const sprite = makeSprite(b.x * 32 + 20, b.y * 32 + 16);
  sprite.alpha = alpha;
  const it: ItemEnt = { type: 'ammo', cx: b.x, cy: b.y, sprite: sprite as unknown as ItemEnt['sprite'] };
  b.item = it;
  return it;
}

describe('captureRun → validateSave round trip', () => {
  it('survives JSON with buildings, counters, and items intact', () => {
    const belt = makeBuilding('belt', 5, 5, 1);
    const press = makeBuilding('press', 6, 5);
    press.inputOre = 3;
    press.outputBuf = 1;
    press.crafting = true;
    press.timer = 0.4;
    const tower = towerAt(7, 5);
    const item = itemOn(belt);

    const save = captureRun([belt, press, tower], [item], SNAPSHOT);
    const back = validateSave(JSON.parse(JSON.stringify(save)));
    expect(back).not.toBeNull();
    expect(back!.money).toBe(320);
    expect(back!.wave).toBe(8);
    expect(back!.speed).toBe(2);
    expect(back!.auto).toBe(true);
    expect(back!.buildings).toHaveLength(3);
    const p = back!.buildings[1];
    expect(p).toMatchObject({ t: 'press', inOre: 3, outBuf: 1, crafting: true });
    expect(back!.items[0]).toMatchObject({ t: 'ammo', cx: 5, cy: 5 });
  });

  it('preserves both assembler input buffers and a lancer specialization', () => {
    const asm = makeBuilding('assembler', 9, 9);
    asm.inputOre = 4;
    asm.inputCrystal = 2;
    const lancer = makeBuilding('lancer', 9, 10);
    lancer.mk = 4;
    lancer.path = 'volley';
    lancer.ammo = 6;

    const save = captureRun([asm, lancer], [], SNAPSHOT);
    const back = validateSave(JSON.parse(JSON.stringify(save)))!;
    expect(back).not.toBeNull();
    expect(back.buildings[0]).toMatchObject({ t: 'assembler', inOre: 4, inCry: 2 });
    expect(back.buildings[1]).toMatchObject({ t: 'lancer', mk: 4, path: 'volley', ammo: 6 });
  });

  it('carries prospected patches, spent tiles, and the survey count', () => {
    const terrain = {
      patches: [{ x: 6, y: 18, w: 2, h: 2, k: 'crystal' as const }],
      tiles: [
        { x: 2, y: 15, n: 40 },
        { x: 3, y: 15, n: 0 },
      ],
    };
    const save = captureRun([], [], { ...SNAPSHOT, surveys: 3 }, terrain);
    const back = validateSave(JSON.parse(JSON.stringify(save)))!;
    expect(back).not.toBeNull();
    expect(back.surveys).toBe(3);
    expect(back.patches).toEqual(terrain.patches);
    expect(back.tiles).toEqual(terrain.tiles);
  });

  it('remembers which layout the run is on', () => {
    const save = captureRun([], [], SNAPSHOT, { patches: [], tiles: [], map: 'switchback' });
    const back = validateSave(JSON.parse(JSON.stringify(save)))!;
    expect(back.map).toBe('switchback');
  });

  it('defaults terrain to untouched when the caller has none to report', () => {
    const back = validateSave(JSON.parse(JSON.stringify(captureRun([], [], SNAPSHOT))))!;
    expect(back.patches).toEqual([]);
    expect(back.tiles).toEqual([]);
    expect(back.surveys).toBe(0);
  });

  it('accepts pre-crystal saves — the missing buffer just restores as empty', () => {
    const legacy = { ...captureRun([], [], SNAPSHOT), buildings: [{ t: 'press', x: 4, y: 4, d: 0, inv: 60, inOre: 2 }] };
    const back = validateSave(JSON.parse(JSON.stringify(legacy)))!;
    expect(back).not.toBeNull();
    expect(back.buildings[0].inCry).toBeUndefined();
  });

  it('preserves tower mk and specialization path', () => {
    const save = captureRun([towerAt(3, 3)], [], SNAPSHOT);
    const back = validateSave(JSON.parse(JSON.stringify(save)))!;
    expect(back.buildings[0]).toMatchObject({ t: 'tower', mk: 3, path: 'sniper', ammo: 11, inv: 640 });
  });

  it('preserves tunnel-transit items (alpha < 1) and mid-glide pixel positions', () => {
    const tunnel = makeBuilding('tunnel', 10, 4);
    const it = itemOn(tunnel, 0.35);
    const save = captureRun([tunnel], [it], SNAPSHOT);
    const back = validateSave(JSON.parse(JSON.stringify(save)))!;
    expect(back.items[0].a).toBeCloseTo(0.35);
    expect(back.items[0].px).toBe(10 * 32 + 20);
  });
});

describe('validateSave rejects corrupt input', () => {
  function base(): SaveV1 {
    return captureRun([makeBuilding('belt', 1, 1)], [], SNAPSHOT);
  }

  it.each([
    ['null', null],
    ['a string', 'hi'],
    ['empty object', {}],
    ['wrong version', { ...base(), v: 2 }],
    ['NaN money', { ...base(), money: NaN }],
    ['negative lives', { ...base(), lives: -1 }],
    ['zero wave', { ...base(), wave: 0 }],
    ['bad speed', { ...base(), speed: 5 }],
    ['building out of bounds', { ...base(), buildings: [{ t: 'belt', x: GRID_W, y: 1, d: 0, inv: 5 }] }],
    ['unknown building type', { ...base(), buildings: [{ t: 'nuke', x: 1, y: 1, d: 0, inv: 5 }] }],
    ['mk past MAX_MK', { ...base(), buildings: [{ t: 'tower', x: 1, y: 1, d: 0, inv: 90, mk: 9 }] }],
    ['invalid path id', { ...base(), buildings: [{ t: 'tower', x: 1, y: 1, d: 0, inv: 90, mk: 3, path: 'laser' }] }],
    ['negative crystal buffer', { ...base(), buildings: [{ t: 'assembler', x: 1, y: 1, d: 0, inv: 170, inCry: -1 }] }],
    ['negative survey count', { ...base(), surveys: -1 }],
    ['patch of an unknown resource', { ...base(), patches: [{ x: 1, y: 1, w: 2, h: 2, k: 'gold' }] }],
    ['patch hanging off the board', { ...base(), patches: [{ x: GRID_W - 1, y: 1, w: 3, h: 2, k: 'ore' }] }],
    ['tile reserve beyond any deposit', { ...base(), tiles: [{ x: 1, y: 1, n: 99999 }] }],
    ['tile out of bounds', { ...base(), tiles: [{ x: -1, y: 1, n: 5 }] }],
    ['non-string map id', { ...base(), map: 42 }],
    ['two buildings on one tile', { ...base(), buildings: [{ t: 'belt', x: 1, y: 1, d: 0, inv: 5 }, { t: 'belt', x: 1, y: 1, d: 2, inv: 5 }] }],
    ['unknown item type', { ...base(), items: [{ t: 'gold', cx: 1, cy: 1, px: 0, py: 0 }] }],
    ['item cell out of bounds', { ...base(), items: [{ t: 'ore', cx: -1, cy: 1, px: 0, py: 0 }] }],
    ['NaN item position', { ...base(), items: [{ t: 'ore', cx: 1, cy: 1, px: NaN, py: 0 }] }],
  ])('rejects %s', (_label, raw) => {
    expect(validateSave(raw)).toBeNull();
  });

  it('accepts its own untouched output', () => {
    expect(validateSave(base())).not.toBeNull();
  });
});
