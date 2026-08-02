import { describe, expect, it } from 'vitest';
import { GRID_W } from '../config';
import { MACHINES } from '../data/buildings';
import { EARLY_SEND_WINDOW, earlySendBonus } from '../data/waves';
import { makeBuilding, makeSprite } from '../test/helpers';
import { Building, ItemEnt } from '../types';
import { captureBuilding, captureRun, SaveV1, validateSave } from './serialize';

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
  it('writes an empty tower magazine explicitly while non-towers omit ammo', () => {
    const tower = towerAt(7, 5);
    tower.ammo = 0;
    const press = makeBuilding('press', 8, 5);

    const save = captureRun([tower, press], [], SNAPSHOT);

    expect(save.buildings[0]).toHaveProperty('ammo', 0);
    expect(save.buildings[1]).not.toHaveProperty('ammo');
  });

  it('clamps the saved build clock to the early-send window', () => {
    expect(captureRun([], [], { ...SNAPSHOT, buildElapsed: 7.5 }).buildElapsed).toBe(7.5);
    expect(captureRun([], [], { ...SNAPSHOT, buildElapsed: EARLY_SEND_WINDOW * 4 }).buildElapsed)
      .toBe(EARLY_SEND_WINDOW);
  });

  it('preserves the early-send entitlement through JSON validation', () => {
    const before = earlySendBonus(SNAPSHOT.wave, 12.5);
    const save = captureRun([], [], { ...SNAPSHOT, buildElapsed: 12.5 });
    const back = validateSave(JSON.parse(JSON.stringify(save)))!;
    expect(earlySendBonus(back.wave, back.buildElapsed ?? 0)).toBe(before);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, EARLY_SEND_WINDOW + 0.001])(
    'rejects invalid buildElapsed %s',
    (buildElapsed) => {
      const raw = { ...captureRun([], [], SNAPSHOT), buildElapsed };
      expect(validateSave(raw)).toBeNull();
    },
  );

  it('survives JSON with buildings, counters, and items intact', () => {
    const belt = makeBuilding('belt', 5, 5, 1);
    const press = makeBuilding('press', 6, 5);
    press.inputs.ore = 3;
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
    expect(p).toMatchObject({ t: 'press', in: { ore: 3 }, outBuf: 1, crafting: true });
    expect(back!.items[0]).toMatchObject({ t: 'ammo', cx: 5, cy: 5 });
  });

  it('preserves both assembler input buffers and a lancer specialization', () => {
    const asm = makeBuilding('assembler', 9, 9);
    asm.inputs.ammo = 4;
    asm.inputs.crystal = 2;
    const lancer = makeBuilding('lancer', 9, 10);
    lancer.mk = 4;
    lancer.path = 'volley';
    lancer.ammo = 6;

    const save = captureRun([asm, lancer], [], SNAPSHOT);
    const back = validateSave(JSON.parse(JSON.stringify(save)))!;
    expect(back).not.toBeNull();
    expect(back.buildings[0]).toMatchObject({ t: 'assembler', in: { ammo: 4, crystal: 2 } });
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

  it('round-trips a configured sorter and the item resting on it', () => {
    const sorter = makeBuilding('sorter', 11, 4);
    sorter.filter = 'crystal';
    const it = itemOn(sorter);
    const save = captureRun([sorter], [it], SNAPSHOT);
    const back = validateSave(JSON.parse(JSON.stringify(save)))!;
    expect(back).not.toBeNull();
    expect(back.buildings[0]).toMatchObject({ t: 'sorter', filter: 'crystal' });
    expect(back.items[0]).toMatchObject({ t: 'ammo', cx: 11, cy: 4 });
  });
});

describe('v1 → v2 migration', () => {
  /** A v1 save as it was actually written, back when machines ate raw ore. */
  function v1(buildings: Record<string, unknown>[]): Record<string, unknown> {
    return {
      v: 1,
      savedAt: Date.now(),
      money: 500,
      lives: 20,
      wave: 6,
      speed: 1,
      auto: false,
      buildings,
      items: [],
    };
  }

  it('still loads a v1 run and stamps it as v2', () => {
    const back = validateSave(v1([{ t: 'belt', x: 3, y: 3, d: 0, inv: 5 }]));
    expect(back).not.toBeNull();
    expect(back!.v).toBe(2);
    expect(back!.wave).toBe(6);
  });

  it('drops machine input buffers, because the new recipes would never consume them', () => {
    // A v1 forge banked raw ore. The v2 forge eats ammo, so carrying that ore
    // across would restore a machine that can never craft again.
    const back = validateSave(
      v1([
        { t: 'forge', x: 4, y: 4, d: 0, inv: 100, inOre: 6 },
        { t: 'assembler', x: 5, y: 4, d: 0, inv: 170, inOre: 4, inCry: 2 },
      ]),
    )!;
    for (const b of back.buildings) {
      expect(b.inOre, `${b.t} kept stale ore`).toBeUndefined();
      expect(b.inCry, `${b.t} kept stale crystal`).toBeUndefined();
      expect(b.in ?? {}).toEqual({});
    }
  });

  it('keeps everything else about the building — a migration must never cost you a structure', () => {
    const back = validateSave(
      v1([{ t: 'tower', x: 7, y: 7, d: 2, inv: 640, mk: 4, path: 'sniper', ammo: 11, inOre: 3 }]),
    )!;
    expect(back.buildings).toHaveLength(1);
    expect(back.buildings[0]).toMatchObject({ t: 'tower', x: 7, y: 7, d: 2, inv: 640, mk: 4, path: 'sniper', ammo: 11 });
  });

  it('still rejects a v1 save that was corrupt to begin with', () => {
    expect(validateSave(v1([{ t: 'nuke', x: 1, y: 1, d: 0, inv: 5 }]))).toBeNull();
    expect(validateSave({ ...v1([]), lives: -3 })).toBeNull();
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
    ['a version from the future', { ...base(), v: 99 }],
    ['a bogus input buffer key', { ...base(), buildings: [{ t: 'press', x: 1, y: 1, d: 0, inv: 60, in: { gold: 2 } }] }],
    ['a negative input buffer', { ...base(), buildings: [{ t: 'press', x: 1, y: 1, d: 0, inv: 60, in: { ore: -1 } }] }],
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

  it('rejects a bogus filter or a filter attached to anything but a sorter', () => {
    const invalid = [
      { t: 'sorter', x: 1, y: 1, d: 0, inv: 25, filter: 'gold' },
      { t: 'belt', x: 1, y: 1, d: 0, inv: 5, filter: 'ore' },
    ];
    for (const building of invalid) {
      expect(validateSave({ ...base(), buildings: [building] })).toBeNull();
    }
  });
});

/**
 * A save is untrusted input: localStorage is hand-editable and cloud JSON can be
 * anything. "Finite and non-negative" was not enough — several shapes passed
 * validation and then crashed or corrupted the board on restore. Each case below
 * is one of those.
 */
describe('validateSave rejects values that would break restoration', () => {
  function base(): SaveV1 {
    return captureRun([makeBuilding('belt', 1, 1)], [], SNAPSHOT);
  }
  const belt = { t: 'belt', x: 1, y: 1, d: 0, inv: 5 };

  it.each([
    // Fractional coordinates are finite and in range but address no cell.
    ['a fractional building x', { ...base(), buildings: [{ ...belt, x: 1.5 }] }],
    ['a fractional building y', { ...base(), buildings: [{ ...belt, y: 3.25 }] }],
    ['a fractional mk', { ...base(), buildings: [{ t: 'tower', x: 1, y: 1, d: 0, inv: 90, mk: 2.5 }] }],
    ['a fractional item cell', { ...base(), items: [{ t: 'ore', cx: 1.5, cy: 1, px: 40, py: 40 }] }],
    ['a fractional tile coordinate', { ...base(), tiles: [{ x: 1.5, y: 1, n: 5 }] }],
    ['a fractional patch size', { ...base(), patches: [{ x: 1, y: 1, w: 2.5, h: 2, k: 'ore' }] }],

    // `pathOf` does a `.find(...)!`: a path from another tower's tree returns
    // undefined and throws the moment stats are resolved.
    ['a cannon carrying a gun path', { ...base(), buildings: [{ t: 'cannon', x: 1, y: 1, d: 0, inv: 140, mk: 3, path: 'sniper' }] }],
    ['a lancer carrying a cryo path', { ...base(), buildings: [{ t: 'lancer', x: 1, y: 1, d: 0, inv: 230, mk: 3, path: 'blizzard' }] }],
    ['a path on something that is not a tower', { ...base(), buildings: [{ t: 'press', x: 1, y: 1, d: 0, inv: 60, path: 'sniper' }] }],
    ['an Mk3 tower with no path chosen', { ...base(), buildings: [{ t: 'tower', x: 1, y: 1, d: 0, inv: 90, mk: 3 }] }],

    // Counters that outrun the thing that holds them.
    ['ammo beyond the magazine', { ...base(), buildings: [{ t: 'tower', x: 1, y: 1, d: 0, inv: 90, ammo: 9999 }] }],
    ['ammo on a belt', { ...base(), buildings: [{ ...belt, ammo: 3 }] }],
    ['an output buffer beyond what a cycle could leave', { ...base(), buildings: [{ t: 'press', x: 1, y: 1, d: 0, inv: 60, outBuf: 999 }] }],
    ['an output buffer on a tower', { ...base(), buildings: [{ t: 'tower', x: 1, y: 1, d: 0, inv: 90, outBuf: 1 }] }],
    ['an input buffer beyond the machine cap', { ...base(), buildings: [{ t: 'press', x: 1, y: 1, d: 0, inv: 60, in: { ore: 999 } }] }],
    ['a splitter output index off the end', { ...base(), buildings: [{ t: 'splitter', x: 1, y: 1, d: 0, inv: 20, outIdx: 7 }] }],
    ['a fractional input buffer', { ...base(), buildings: [{ t: 'press', x: 1, y: 1, d: 0, inv: 60, in: { ore: 1.5 } }] }],

    // The exact failure migrateV1 exists to prevent, reintroduced by hand: a
    // machine holding stock its own recipe will never consume stalls forever.
    ['a press buffering an item it cannot consume', { ...base(), buildings: [{ t: 'press', x: 1, y: 1, d: 0, inv: 60, in: { coolant: 2 } }] }],
    ['a forge buffering raw ore', { ...base(), buildings: [{ t: 'forge', x: 1, y: 1, d: 0, inv: 100, in: { ore: 2 } }] }],

    // Items must sit on something that can actually move them.
    ['an item on an empty cell', { ...base(), items: [{ t: 'ore', cx: 9, cy: 9, px: 300, py: 300 }] }],
    ['an item parked inside a press', { ...base(), buildings: [{ t: 'press', x: 2, y: 2, d: 0, inv: 60 }], items: [{ t: 'ore', cx: 2, cy: 2, px: 80, py: 80 }] }],
    ['two items on one belt cell', { ...base(), items: [{ t: 'ore', cx: 1, cy: 1, px: 40, py: 40 }, { t: 'ammo', cx: 1, cy: 1, px: 40, py: 40 }] }],
    ['an item drawn off the board', { ...base(), items: [{ t: 'ore', cx: 1, cy: 1, px: 99999, py: 40 }] }],

    // Unbounded scalars.
    ['a fractional invested total', { ...base(), buildings: [{ ...belt, inv: 5.5 }] }],
    ['an absurd invested total', { ...base(), buildings: [{ ...belt, inv: 1e15 }] }],
    ['a fractional survey count', { ...base(), surveys: 2.5 }],
    ['a fractional research level', { ...base(), researchLevel: 1.5 }],
    ['an absurd research bank', { ...base(), research: 1e15 }],
    ['a timer beyond any cycle', { ...base(), buildings: [{ t: 'press', x: 1, y: 1, d: 0, inv: 60, timer: 1e9 }] }],
  ])('rejects %s', (_label, raw) => {
    expect(validateSave(raw)).toBeNull();
  });

  it('still accepts a legitimate maxed tower on its own path', () => {
    const t = makeBuilding('cannon', 4, 4);
    t.mk = 4;
    t.path = 'siege';
    t.ammo = 8; // exactly the cannon magazine
    expect(validateSave(JSON.parse(JSON.stringify(captureRun([t], [], SNAPSHOT))))).not.toBeNull();
  });

  /**
   * A chiller's cap is 4 but it produces 2 per cycle, and a cycle may start at
   * 3 — so 5 in the output buffer is a state the sim reaches on its own. The
   * obvious `outBuf <= outputCap` rule would reject it and wipe the run.
   */
  it('accepts an output buffer overfilled by a legitimate multi-output cycle', () => {
    const chiller = makeBuilding('chiller', 4, 4);
    const { outputCap, outputPer } = MACHINES.chiller;
    chiller.outputBuf = outputCap + outputPer - 1;
    expect(outputPer, 'this test is only meaningful while chillers make >1 per cycle').toBeGreaterThan(1);
    expect(validateSave(JSON.parse(JSON.stringify(captureRun([chiller], [], SNAPSHOT))))).not.toBeNull();
  });

  it('still accepts a machine buffered to exactly its cap', () => {
    const asm = makeBuilding('assembler', 4, 4);
    asm.inputs.ammo = 6; // assembler inputCap
    asm.inputs.crystal = 6;
    asm.outputBuf = 2; // outputCap
    expect(validateSave(JSON.parse(JSON.stringify(captureRun([asm], [], SNAPSHOT))))).not.toBeNull();
  });
});

/**
 * Undo-a-sale snapshots through this exact function, which is the whole reason
 * it was split out of `captureRun`. If it ever stops carrying a field, undo
 * silently hands back a *worse* building than the one that was sold — the kind
 * of loss a player would blame on the game rather than report.
 */
describe('captureBuilding', () => {
  it('carries everything that makes a building worth getting back', () => {
    const t = towerAt(4, 4);
    t.fed = 37;
    const sb = captureBuilding(t);
    expect(sb).toMatchObject({ t: 'tower', x: 4, y: 4, mk: 3, path: 'sniper', ammo: 11, fed: 37, inv: 640 });
  });

  it('is the same snapshot the save file stores, field for field', () => {
    const b = makeBuilding('assembler', 7, 3, 2);
    b.inputs = { ammo: 2, crystal: 1 };
    b.outputBuf = 1;
    b.invested = 120;
    const [saved] = captureRun([b], [], SNAPSHOT).buildings;
    expect(captureBuilding(b)).toEqual(saved);
  });

  it('keeps a sorter’s filter, so undo cannot quietly unprotect a line', () => {
    const s = makeBuilding('sorter', 2, 2);
    s.filter = 'shell';
    expect(captureBuilding(s).filter).toBe('shell');
  });
});
