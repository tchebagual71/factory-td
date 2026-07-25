import { describe, expect, it } from 'vitest';
import { Dir } from '../types';
import { beltRun } from './beltPaint';

describe('beltRun', () => {
  it('leaves no hole when a fast drag skips several tiles', () => {
    const run = beltRun({ x: 2, y: 5 }, { x: 6, y: 5 }, 0);
    expect(run.map((s) => s.x)).toEqual([3, 4, 5, 6]);
    expect(run.every((s) => s.y === 5)).toBe(true);
  });

  it('faces every belt at the cell that follows it', () => {
    for (const [dir, to] of [
      [0, { x: 5, y: 2 }],
      [1, { x: 2, y: 5 }],
      [2, { x: -1, y: 2 }],
      [3, { x: 2, y: -1 }],
    ] as [Dir, { x: number; y: number }][]) {
      const run = beltRun({ x: 2, y: 2 }, to, 0);
      expect(run.length).toBeGreaterThan(0);
      expect(run.every((s) => s.dir === dir), `heading ${dir}`).toBe(true);
    }
  });

  it('turns the corner: the run changes facing where the drag does', () => {
    // right 3 then down 2 — the belts that go down must actually point down
    const run = beltRun({ x: 0, y: 0 }, { x: 3, y: 2 }, 0);
    expect(run[run.length - 1]).toEqual({ x: 3, y: 2, dir: 1 });
    expect(run.some((s) => s.dir === 0)).toBe(true);
    expect(run.some((s) => s.dir === 1)).toBe(true);
  });

  it('always walks a connected, single-tile-per-step path to the target', () => {
    const from = { x: 4, y: 9 };
    for (const to of [{ x: 12, y: 3 }, { x: 0, y: 17 }, { x: 4, y: 1 }, { x: 20, y: 9 }]) {
      const run = beltRun(from, to, 0);
      let prev = { x: from.x, y: from.y };
      for (const s of run) {
        expect(Math.abs(s.x - prev.x) + Math.abs(s.y - prev.y), `${JSON.stringify(s)}`).toBe(1);
        prev = { x: s.x, y: s.y };
      }
      expect(prev).toEqual(to);
    }
  });

  it('lays an L with exactly one corner, never a staircase', () => {
    const turns = (run: { dir: Dir }[]) => run.filter((s, i) => i > 0 && s.dir !== run[i - 1].dir).length;
    expect(turns(beltRun({ x: 0, y: 0 }, { x: 5, y: 4 }, 0))).toBe(1);
    expect(turns(beltRun({ x: 9, y: 9 }, { x: 2, y: 1 }, 1))).toBe(1);
    expect(turns(beltRun({ x: 0, y: 0 }, { x: 6, y: 0 }, 0))).toBe(0);
  });

  it('keeps a straight run straight: the drag continues along the axis it is already on', () => {
    expect(beltRun({ x: 0, y: 0 }, { x: 2, y: 2 }, 0)[0].dir).toBe(0); // running east
    expect(beltRun({ x: 0, y: 0 }, { x: 2, y: 2 }, 1)[0].dir).toBe(1); // running south
  });

  it('is empty when the drag has not left the cell it started in', () => {
    expect(beltRun({ x: 7, y: 7 }, { x: 7, y: 7 }, 0)).toEqual([]);
  });
});
