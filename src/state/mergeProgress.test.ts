import { describe, expect, it } from 'vitest';
import { mergeAchievements, mergeBest, newerRun } from './mergeProgress';

describe('newerRun (last-write-wins)', () => {
  it('picks the only side that has a save', () => {
    expect(newerRun(null, null)).toBe('none');
    expect(newerRun(100, null)).toBe('local');
    expect(newerRun(null, 100)).toBe('cloud');
  });

  it('picks the newer timestamp, local winning ties', () => {
    expect(newerRun(200, 100)).toBe('local');
    expect(newerRun(100, 200)).toBe('cloud');
    expect(newerRun(150, 150)).toBe('local');
  });
});

describe('mergeAchievements (set union — never lose an unlock)', () => {
  it('splits into push/absorb correctly', () => {
    const m = mergeAchievements(new Set(['a', 'b']), new Set(['b', 'c']));
    expect([...m.union].sort()).toEqual(['a', 'b', 'c']);
    expect(m.toPush).toEqual(['a']);
    expect(m.toAbsorb).toEqual(['c']);
  });

  it('handles empty sides', () => {
    expect(mergeAchievements(new Set(), new Set()).union.size).toBe(0);
    expect(mergeAchievements(new Set(['x']), new Set()).toPush).toEqual(['x']);
    expect(mergeAchievements(new Set(), new Set(['y'])).toAbsorb).toEqual(['y']);
  });
});

describe('mergeBest', () => {
  it('is a floor-zero max', () => {
    expect(mergeBest(5, 9)).toBe(9);
    expect(mergeBest(9, 5)).toBe(9);
    expect(mergeBest(-3, -8)).toBe(0);
  });
});
