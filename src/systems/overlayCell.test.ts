import { describe, expect, it } from 'vitest';
import { Building, BuildingType } from '../types';
import { overlayCell, uptimeOf } from './LogisticsSystem';

/**
 * `overlayCell` is the one place that decides what the [L] overlay *means*.
 * Both renderers consume it — the flat view paints it with a Graphics, the
 * isometric one lays it on the ground as decals — so a rule that lives only in
 * one of them is a rule the other player never sees.
 */

function make(type: BuildingType, over: Partial<Building> = {}): Building {
  return {
    type,
    x: 0,
    y: 0,
    dir: 0,
    sprite: null as never,
    item: null,
    outIdx: 0,
    timer: 0,
    crafting: false,
    inputs: {},
    outputBuf: 0,
    ammo: 0,
    fed: 0,
    cooldown: 0,
    mk: 1,
    path: null,
    invested: 0,
    stalled: false,
    utilBusy: 0,
    utilBlocked: 0,
    utilTotal: 0,
    ...over,
  };
}

describe('uptimeOf', () => {
  it('is zero before any window has been measured, not NaN', () => {
    expect(uptimeOf(make('belt'))).toBe(0);
  });

  it('is the busy share of the window', () => {
    expect(uptimeOf(make('belt', { utilBusy: 3, utilTotal: 4 }))).toBeCloseTo(0.75);
  });
});

describe('carriers', () => {
  it('shades a belt by how much of the window it carried something', () => {
    const idle = overlayCell(make('belt', { utilBusy: 0, utilTotal: 10 }), 0);
    const busy = overlayCell(make('belt', { utilBusy: 10, utilTotal: 10 }), 0);
    expect(idle.fill!.alpha).toBeLessThan(busy.fill!.alpha);
    expect(busy.fill!.color).toBe(0x5ef078);
  });

  it('flags a jam red — an item sitting on a belt that cannot move', () => {
    const jammed = overlayCell(make('belt', { item: {} as never, stalled: true }), 0);
    expect(jammed.fill!.color).toBe(0xff5555);
  });

  it('does not call an empty stalled belt a jam: nothing is stuck on it', () => {
    const empty = overlayCell(make('belt', { item: null, stalled: true }), 0);
    expect(empty.fill!.color).toBe(0x5ef078);
  });

  it('treats splitters and tunnels as carriers too', () => {
    for (const t of ['splitter', 'tunnel'] as const) expect(overlayCell(make(t), 0).fill).toBeDefined();
  });
});

describe('producers', () => {
  it('outlines a healthy machine green and a starved one amber', () => {
    expect(overlayCell(make('press'), 0).stroke!.color).toBe(0x5ef078);
    expect(overlayCell(make('press', { stalled: true }), 0).stroke!.color).toBe(0xff9f43);
  });

  it('pulses only the starved ones, so they are findable at a glance', () => {
    const lo = overlayCell(make('miner', { stalled: true }), -1).stroke!.alpha;
    const hi = overlayCell(make('miner', { stalled: true }), 1).stroke!.alpha;
    expect(hi).toBeGreaterThan(lo);
    // A healthy machine holds still whatever the oscillator is doing.
    expect(overlayCell(make('miner'), -1).stroke!.alpha).toBe(overlayCell(make('miner'), 1).stroke!.alpha);
  });

  it('never asks for an alpha outside 0–1', () => {
    for (const pulse of [-1, -0.5, 0, 0.5, 1]) {
      for (const stalled of [true, false]) {
        const a = overlayCell(make('forge', { stalled }), pulse).stroke!.alpha;
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('towers', () => {
  it('reads "—" rather than a false 0% before any data exists', () => {
    const fresh = overlayCell(make('tower', { utilTotal: 0 }), 0);
    expect(fresh.label).toBe('—');
  });

  it('reports uptime as a percentage once measured', () => {
    expect(overlayCell(make('tower', { utilBusy: 9, utilTotal: 10 }), 0).label).toBe('90%');
  });

  it('outlines a dry tower red — the failure the overlay exists to expose', () => {
    expect(overlayCell(make('tower', { ammo: 0 }), 0).stroke!.color).toBe(0xff5555);
    expect(overlayCell(make('tower', { ammo: 5 }), 0).stroke!.color).toBe(0x5ef078);
  });

  it('reports the magazine separately from uptime, so "90% but empty now" shows', () => {
    const b = make('tower', { ammo: 0, utilBusy: 9, utilTotal: 10 });
    const cell = overlayCell(b, 0);
    expect(cell.label).toBe('90%');
    expect(cell.mag).toBe(0);
  });

  it('keeps the magazine fraction within 0–1 for every tower type', () => {
    for (const t of ['tower', 'cannon', 'lancer', 'cryo'] as const) {
      const cell = overlayCell(make(t, { ammo: 1 }), 0);
      expect(cell.mag).toBeGreaterThan(0);
      expect(cell.mag).toBeLessThanOrEqual(1);
    }
  });
});

describe('everything else', () => {
  it('gives the lab nothing to draw rather than mis-reporting it', () => {
    // The lab is neither a carrier, a producer nor a gun: it consumes and
    // vanishes goods, so it has no throughput reading to give.
    expect(overlayCell(make('lab'), 0)).toEqual({});
  });
});
