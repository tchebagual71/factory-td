import { describe, expect, it } from 'vitest';
import * as combo from './combo';
import {
  COMBO_MAX_PITCH,
  COMBO_MILESTONES,
  COMBO_WINDOW_MS,
  breakCombo,
  comboColor,
  comboExpired,
  comboMilestone,
  comboNow,
  comboPitch,
  comboTier,
  emptyCombo,
  registerKill,
} from './combo';

describe('kill streak', () => {
  it('counts kills inside the window', () => {
    let s = emptyCombo();
    s = registerKill(s, 1000);
    s = registerKill(s, 2000);
    s = registerKill(s, 3000);
    expect(s.count).toBe(3);
  });

  it('restarts once the window lapses', () => {
    let s = emptyCombo();
    s = registerKill(s, 1000);
    s = registerKill(s, 1000 + COMBO_WINDOW_MS + 1);
    expect(s.count).toBe(1);
  });

  it('treats a kill exactly on the window edge as continuing', () => {
    let s = registerKill(emptyCombo(), 1000);
    s = registerKill(s, 1000 + COMBO_WINDOW_MS);
    expect(s.count).toBe(2);
  });

  it('remembers the best streak across a break', () => {
    let s = emptyCombo();
    for (let i = 0; i < 7; i++) s = registerKill(s, i * 100);
    s = breakCombo(s);
    expect(s.count).toBe(0);
    expect(s.best).toBe(7);
    // and a later, shorter streak does not lower it
    s = registerKill(s, 9999);
    expect(s.best).toBe(7);
  });

  it('reports expiry only for a live streak', () => {
    const fresh = registerKill(emptyCombo(), 1000);
    expect(comboExpired(fresh, 1000 + COMBO_WINDOW_MS)).toBe(false);
    expect(comboExpired(fresh, 1000 + COMBO_WINDOW_MS + 1)).toBe(true);
    // a broken streak is not "expired", it is simply absent
    expect(comboExpired(breakCombo(fresh), 1e9)).toBe(false);
  });

  it('stays quiet until the streak is worth mentioning, then climbs', () => {
    expect(comboTier(1)).toBe(0);
    expect(comboTier(4)).toBe(0);
    expect(comboTier(5)).toBe(1);
    let prev = 0;
    for (const m of COMBO_MILESTONES) {
      const t = comboTier(m.at);
      expect(t, `tier at ${m.at}`).toBeGreaterThan(prev);
      prev = t;
    }
  });

  it('fires each milestone exactly once, on the kill that reaches it', () => {
    for (const m of COMBO_MILESTONES) {
      expect(comboMilestone(m.at)).toBe(m.label);
      expect(comboMilestone(m.at - 1)).toBeNull();
      expect(comboMilestone(m.at + 1)).toBeNull();
    }
  });

  it('keeps milestones sparse and widening, so none is wallpaper', () => {
    const gaps = COMBO_MILESTONES.slice(1).map((m, i) => m.at - COMBO_MILESTONES[i].at);
    expect(gaps).toEqual([...gaps].sort((a, b) => a - b));
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(10);
  });

  it('raises the pitch monotonically but never past the cap', () => {
    expect(comboPitch(1)).toBe(1);
    let prev = 0;
    for (const n of [1, 5, 20, 60, 200, 5000]) {
      const p = comboPitch(n);
      expect(p).toBeGreaterThanOrEqual(prev);
      expect(p, `pitch at ${n}`).toBeLessThanOrEqual(COMBO_MAX_PITCH);
      prev = p;
    }
    expect(comboPitch(100000)).toBe(COMBO_MAX_PITCH);
  });

  /**
   * Kills are stamped in WaveSystem (GameScene's clock) and expiry is noticed
   * by the meter in UIScene. Those are different Phaser clocks — GameScene is
   * restarted on REBUILD while UIScene only sleeps — so the streak must carry
   * its own clock or every streak looks stale after one restart.
   */
  it('uses one monotonic clock, not a per-scene one', () => {
    const a = comboNow();
    const b = comboNow();
    expect(b).toBeGreaterThanOrEqual(a);
    expect(Number.isFinite(a)).toBe(true);
  });

  it('has a colour for every tier it can produce', () => {
    for (const n of [0, 1, 5, 10, 25, 50, 100, 200, 9999]) {
      expect(comboColor(n), `colour at ${n}`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  /**
   * The load-bearing constraint. Throughput is the economy: if a streak ever
   * pays out, combat skill starts funding the factory and the whole premise
   * (and the income-vs-threat invariants in waves.test.ts) goes soft.
   */
  it('never pays money — the streak buys spectacle only', () => {
    // The state a streak carries is exactly a counter, a record and a clock.
    // Nothing here can be spent, so no caller can start paying it out without
    // adding a field and failing this.
    let s = emptyCombo();
    for (let i = 0; i < 120; i++) s = registerKill(s, i * 100);
    expect(Object.keys(s).sort()).toEqual(['best', 'count', 'last']);

    // and the module exposes no payout helper to reach for
    for (const name of Object.keys(combo)) {
      expect(name.toLowerCase(), `${name} looks like a payout`).not.toMatch(/money|bounty|income|reward|payout/);
    }
  });
});
