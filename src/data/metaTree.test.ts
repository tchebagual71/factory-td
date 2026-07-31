import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, startMoneyBonus } from './achievements';
import { START_LIVES, START_MONEY } from '../config';
import {
  META_CATEGORIES,
  META_NODES,
  MetaOwned,
  SCRAP_NEW_BEST,
  SCRAP_PER_WAVE,
  effectsFrom,
  fullTreeCost,
  levelsOf,
  metaNode,
  nodeCost,
  nodeTotal,
  scrapEarned,
} from './metaTree';

/** Everything, fully bought — the worst case every cap has to survive. */
const MAXED: MetaOwned = Object.fromEntries(META_NODES.map((n) => [n.id, n.max]));

describe('workshop tree shape', () => {
  it('files every node under a real category', () => {
    for (const n of META_NODES) {
      expect(META_CATEGORIES.some((c) => c.id === n.cat), `${n.id} has no category`).toBe(true);
    }
  });

  it('gives every category at least one node, so no header is ever empty', () => {
    for (const c of META_CATEGORIES) {
      expect(META_NODES.some((n) => n.cat === c.id), `${c.id} is empty`).toBe(true);
    }
  });

  it('uses unique ids', () => {
    const ids = META_NODES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(metaNode('belt_tuning')?.name).toBe('Belt Tuning');
    expect(metaNode('nope')).toBeUndefined();
  });

  it('makes every node buyable and finite', () => {
    for (const n of META_NODES) {
      expect(n.max, `${n.id} max`).toBeGreaterThan(0);
      expect(n.base, `${n.id} base cost`).toBeGreaterThan(0);
      expect(n.desc.length, `${n.id} desc`).toBeGreaterThan(0);
    }
  });
});

describe('costs', () => {
  it('doubles each level, so maxing one line trades against broadening', () => {
    const n = META_NODES[0];
    expect(nodeCost(n, 0)).toBe(n.base);
    expect(nodeCost(n, 1)).toBe(n.base * 2);
    expect(nodeCost(n, 2)).toBe(n.base * 4);
  });

  it('totals the ladder correctly', () => {
    const n = { id: 'x', name: 'x', desc: 'x', cat: 'economy' as const, max: 3, base: 10 };
    expect(nodeTotal(n, 0)).toBe(0);
    expect(nodeTotal(n, 1)).toBe(10);
    expect(nodeTotal(n, 3)).toBe(70); // 10 + 20 + 40
  });
});

describe('effects', () => {
  it('is a no-op when nothing is owned', () => {
    const e = effectsFrom({});
    expect(e).toEqual({ startMoney: 0, startLives: 0, startAmmo: 0, surveyDiscount: 0, mods: {} });
  });

  it('clamps a tampered store to each node`s max', () => {
    const cheat: MetaOwned = Object.fromEntries(META_NODES.map((n) => [n.id, 9999]));
    expect(effectsFrom(cheat)).toEqual(effectsFrom(MAXED));
    for (const n of META_NODES) expect(levelsOf(cheat, n)).toBe(n.max);
  });

  it('ignores junk levels rather than producing NaN', () => {
    const junk = { seed_capital: NaN, contingency: -3, prospector: 1.7 } as unknown as MetaOwned;
    const e = effectsFrom(junk);
    expect(Number.isFinite(e.startMoney)).toBe(true);
    expect(e.startMoney).toBe(0);
    expect(e.startLives).toBe(0);
    expect(e.surveyDiscount).toBeCloseTo(0.15); // 1.7 floors to one level
  });

  it('stacks multiplicatively within a node', () => {
    // belt_tuning is +8% per level, three levels
    const e = effectsFrom({ belt_tuning: 3 });
    expect(e.mods.beltSpeed).toBeCloseTo(1.08 ** 3);
  });

  it('stacks two nodes that touch the same mod', () => {
    const e = effectsFrom({ belt_tuning: 3, jam_clearing: 2 });
    expect(e.mods.beltSpeed).toBeCloseTo(1.08 ** 3 * 1.06 ** 2);
  });

  /**
   * The load-bearing test. The difficulty curve (the throughput wall at wave
   * ~33) is deliberate, and unbounded meta progression is exactly what deletes
   * it. If a node is added or retuned past these ceilings, that is a decision
   * to be made on purpose, not by accident.
   */
  it('caps what a fully-bought Workshop can do', () => {
    const e = effectsFrom(MAXED);
    expect(e.mods.beltSpeed ?? 1).toBeLessThanOrEqual(1.45);
    expect(e.mods.minerSpeed ?? 1).toBeLessThanOrEqual(1.3);
    expect(e.mods.craftSpeed ?? 1).toBeLessThanOrEqual(1.3);
    // combat is the thinnest branch on purpose — research and the Mk tree sell that
    expect(e.mods.damage ?? 1).toBeLessThanOrEqual(1.12);
    expect(e.mods.clearCash ?? 1).toBeLessThanOrEqual(1.2);
    expect(e.surveyDiscount).toBeLessThanOrEqual(0.5);
    expect(e.startAmmo).toBeLessThanOrEqual(12);
    expect(e.startLives).toBeLessThanOrEqual(4);
    expect(e.startMoney).toBeLessThanOrEqual(200);
  });

  it('keeps the opening from being trivial once achievements are added on top', () => {
    const everyAchievement = new Set(ACHIEVEMENTS.map((a) => a.id));
    const opening = START_MONEY + effectsFrom(MAXED).startMoney + startMoneyBonus(everyAchievement);
    // a maxed account opens richer, but not so rich that wave 1 builds itself
    expect(opening).toBeLessThanOrEqual(START_MONEY * 2);
    expect(START_LIVES + effectsFrom(MAXED).startLives).toBeLessThanOrEqual(START_LIVES + 4);
  });

  it('leaves defense the weakest branch, by design', () => {
    const spend = (cat: string) =>
      META_NODES.filter((n) => n.cat === cat).reduce((s, n) => s + nodeTotal(n, n.max), 0);
    // the factory branches together must outweigh what you can spend on guns
    expect(spend('logistics') + spend('production')).toBeGreaterThan(spend('defense'));
  });
});

describe('scrap payout', () => {
  it('pays something even for a wave-1 wipe', () => {
    expect(scrapEarned({ wave: 1, kills: 0, bestStreak: 0, newBest: false })).toBeGreaterThan(0);
  });

  it('is dominated by how deep you got', () => {
    const shallow = scrapEarned({ wave: 5, kills: 0, bestStreak: 0, newBest: false });
    const deep = scrapEarned({ wave: 25, kills: 0, bestStreak: 0, newBest: false });
    expect(deep - shallow).toBe(SCRAP_PER_WAVE * 20);
  });

  it('rises monotonically with every input', () => {
    const base = { wave: 10, kills: 100, bestStreak: 10, newBest: false };
    expect(scrapEarned({ ...base, wave: 11 })).toBeGreaterThan(scrapEarned(base));
    expect(scrapEarned({ ...base, kills: 200 })).toBeGreaterThan(scrapEarned(base));
    expect(scrapEarned({ ...base, bestStreak: 40 })).toBeGreaterThan(scrapEarned(base));
    expect(scrapEarned({ ...base, newBest: true })).toBe(scrapEarned(base) + SCRAP_NEW_BEST);
  });

  it('never returns a fraction or a negative, whatever it is handed', () => {
    for (const r of [
      { wave: -5, kills: -100, bestStreak: -3, newBest: false },
      { wave: 0, kills: 0, bestStreak: 0, newBest: false },
      { wave: 7.6, kills: 33, bestStreak: 9, newBest: true },
    ]) {
      const s = scrapEarned(r);
      expect(Number.isInteger(s), `${JSON.stringify(r)} → ${s}`).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
    }
  });

  /**
   * Pacing: the whole tree should be a long-term goal, not a weekend and not a
   * second job. A "good" run is roughly wave 15 with ~250 kills.
   */
  it('takes a sane number of good runs to max the tree', () => {
    const good = scrapEarned({ wave: 15, kills: 250, bestStreak: 20, newBest: false });
    const runs = fullTreeCost() / good;
    expect(runs).toBeGreaterThan(10);
    expect(runs).toBeLessThan(60);
  });

  it('buys the first node of something inside a couple of runs', () => {
    const firstRun = scrapEarned({ wave: 8, kills: 90, bestStreak: 8, newBest: true });
    const cheapest = Math.min(...META_NODES.map((n) => n.base));
    expect(firstRun).toBeGreaterThanOrEqual(cheapest);
  });
});
