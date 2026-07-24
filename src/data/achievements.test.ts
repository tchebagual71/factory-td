import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, emptyStats, newlyUnlocked, startMoneyBonus } from './achievements';

describe('achievement definitions', () => {
  it('ids are unique and match the DB CHECK pattern ^[a-z0-9_]{1,40}$', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9_]{1,40}$/);
    }
  });

  it('every goal is positive and every stat key exists in emptyStats', () => {
    const stats = emptyStats();
    for (const a of ACHIEVEMENTS) {
      expect(a.goal).toBeGreaterThan(0);
      expect(stats[a.stat]).toBe(0);
    }
  });

  it('total starting-money bonus stays ≤ $100 so the economy invariant survives', () => {
    const all = new Set(ACHIEVEMENTS.map((a) => a.id));
    expect(startMoneyBonus(all)).toBeLessThanOrEqual(100);
    expect(startMoneyBonus(all)).toBeGreaterThan(0);
    expect(startMoneyBonus(new Set())).toBe(0);
  });
});

describe('newlyUnlocked', () => {
  it('returns nothing on fresh stats', () => {
    expect(newlyUnlocked(new Set(), emptyStats())).toEqual([]);
  });

  it('unlocks exactly the achievements whose goal is met', () => {
    const stats = { ...emptyStats(), kills: 1 };
    const fresh = newlyUnlocked(new Set(), stats);
    expect(fresh.map((a) => a.id)).toEqual(['first_blood']);
  });

  it('is idempotent — already-unlocked ids are never returned again', () => {
    const stats = { ...emptyStats(), kills: 999999, bestWave: 99 };
    const first = newlyUnlocked(new Set(), stats);
    const prev = new Set(first.map((a) => a.id));
    expect(newlyUnlocked(prev, stats)).toEqual([]);
  });

  it('never mutates its inputs', () => {
    const stats = { ...emptyStats(), kills: 5 };
    const prev = new Set<string>();
    const statsBefore = JSON.stringify(stats);
    newlyUnlocked(prev, stats);
    expect(JSON.stringify(stats)).toBe(statsBefore);
    expect(prev.size).toBe(0);
  });
});
