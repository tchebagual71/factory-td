import { describe, expect, it } from 'vitest';
import { emptyStats, Stats } from '../data/achievements';
import {
  LifetimeProgress,
  CUMULATIVE_STATS,
  HIGH_WATER_STATS,
  mergeAchievements,
  mergeBest,
  mergeLifetimeProgress,
  mergeStats,
  mergeWorkshop,
  newerRun,
  validateLifetimeProgress,
  WorkshopProgress,
} from './mergeProgress';

function stats(values: Partial<Stats> = {}): Stats {
  return { ...emptyStats(), ...values };
}

function lifetime(workshop: WorkshopProgress, values: Partial<Stats> = {}): LifetimeProgress {
  return { v: 1, workshop, stats: stats(values) };
}

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

describe('mergeWorkshop', () => {
  it('takes the max node level — never the sum', () => {
    const local = { scrap: 10, owned: { belt_tuning: 2, rifling: 1 } };
    const cloud = { scrap: 20, owned: { belt_tuning: 2, rifling: 2 } };

    const merged = mergeWorkshop(local, cloud);

    // Two devices reporting level 2 still means the player bought level 2
    // once. A summing merge would incorrectly cap belt_tuning at free level 3.
    expect(merged.owned).toEqual({ belt_tuning: 2, rifling: 2 });
  });

  it('max-merges scrap so replaying the same snapshot never pays twice', () => {
    const local = { scrap: 80, owned: {} };
    const cloud = { scrap: 120, owned: {} };
    const once = mergeWorkshop(local, cloud);
    const twice = mergeWorkshop(once, cloud);

    expect(once.scrap).toBe(120);
    expect(twice).toEqual(once);
  });

  it('is commutative and idempotent', () => {
    const a = { scrap: 70, owned: { belt_tuning: 1, rifling: 2 } };
    const b = { scrap: 90, owned: { belt_tuning: 3, tungsten_bits: 1 } };

    expect(mergeWorkshop(a, b)).toEqual(mergeWorkshop(b, a));
    expect(mergeWorkshop(a, a)).toEqual(a);
  });

  it('never loses an existing bare local wallet or owned level', () => {
    const oldLocalSave = { scrap: 140, owned: { seed_capital: 2 } };
    const emptyCloud = { scrap: 0, owned: {} };

    expect(mergeWorkshop(oldLocalSave, emptyCloud)).toEqual(oldLocalSave);
  });
});

describe('mergeStats', () => {
  it('classifies every lifetime stat explicitly', () => {
    expect([...HIGH_WATER_STATS, ...CUMULATIVE_STATS].sort()).toEqual(Object.keys(emptyStats()).sort());
  });

  it('takes max for every high-water mark', () => {
    const local = stats({ bestWave: 14, bestStreak: 40, bestResearchLevel: 3, biggestFactory: 22 });
    const cloud = stats({ bestWave: 20, bestStreak: 35, bestResearchLevel: 5, biggestFactory: 18 });

    expect(mergeStats(local, cloud)).toMatchObject({
      bestWave: 20,
      bestStreak: 40,
      bestResearchLevel: 5,
      biggestFactory: 22,
    });
  });

  it('max-merges cumulative snapshots rather than replaying them by sum', () => {
    const local = stats({ kills: 100, moneyEarned: 900 });
    const cloud = stats({ kills: 100, moneyEarned: 1200 });
    const once = mergeStats(local, cloud);

    expect(once.kills).toBe(100);
    expect(once.moneyEarned).toBe(1200);
    expect(mergeStats(once, cloud)).toEqual(once);
    expect(mergeStats(local, cloud)).toEqual(mergeStats(cloud, local));
  });
});

describe('validateLifetimeProgress', () => {
  it('drops unknown node ids and clamps known levels to their node max', () => {
    const value = validateLifetimeProgress({
      v: 1,
      workshop: {
        scrap: 45,
        owned: { belt_tuning: 999, rifling: 1, cloud_invented_this: 99 },
      },
      stats: { kills: 12 },
    });

    expect(value?.workshop.owned).toEqual({ belt_tuning: 3, rifling: 1 });
    expect(value?.stats).toEqual(stats({ kills: 12 }));
  });

  it('rejects negative and non-integer known values', () => {
    const base = {
      v: 1,
      workshop: { scrap: 10, owned: { belt_tuning: 1 } },
      stats: { kills: 3 },
    };

    expect(validateLifetimeProgress({ ...base, workshop: { ...base.workshop, scrap: -1 } })).toBeNull();
    expect(validateLifetimeProgress({ ...base, workshop: { ...base.workshop, owned: { belt_tuning: 1.5 } } })).toBeNull();
    expect(validateLifetimeProgress({ ...base, stats: { kills: -1 } })).toBeNull();
    expect(validateLifetimeProgress({ ...base, stats: { kills: 2.5 } })).toBeNull();
  });
});

describe('mergeLifetimeProgress', () => {
  it('leaves local progress exactly untouched when cloud is absent or offline', () => {
    const local = lifetime(
      { scrap: 73, owned: { belt_tuning: 2, seed_capital: 1 } },
      { kills: 90, bestWave: 12 },
    );

    expect(mergeLifetimeProgress(local, null)).toBe(local);
  });

  it('is idempotent and commutative when both snapshots exist', () => {
    const a = lifetime({ scrap: 30, owned: { belt_tuning: 1 } }, { kills: 40, bestWave: 8 });
    const b = lifetime({ scrap: 50, owned: { belt_tuning: 2 } }, { kills: 35, bestWave: 11 });
    const once = mergeLifetimeProgress(a, b);

    expect(mergeLifetimeProgress(once, b)).toEqual(once);
    expect(mergeLifetimeProgress(a, b)).toEqual(mergeLifetimeProgress(b, a));
  });
});
