import { describe, expect, it } from 'vitest';
import {
  BUILD_INFO,
  costOf,
  effStats,
  MACHINES,
  MAX_MK,
  MINER,
  TOWERS,
  UPGRADES,
} from './buildings';

describe('effStats', () => {
  it('mk1 equals base stats', () => {
    for (const type of ['tower', 'cannon'] as const) {
      expect(effStats(type, 1)).toEqual(TOWERS[type]);
    }
  });

  it('each mark strictly improves damage, range, and fire rate', () => {
    for (const type of ['tower', 'cannon'] as const) {
      for (let mk = 2; mk <= MAX_MK; mk++) {
        const prev = effStats(type, mk - 1);
        const cur = effStats(type, mk);
        expect(cur.damage).toBeGreaterThan(prev.damage);
        expect(cur.range).toBeGreaterThan(prev.range);
        expect(cur.fireRate).toBeGreaterThan(prev.fireRate);
      }
    }
  });

  it('leaves magazine size and ammo type unchanged across marks', () => {
    const mk3 = effStats('tower', 3);
    expect(mk3.ammoCap).toBe(TOWERS.tower.ammoCap);
    expect(mk3.ammoType).toBe(TOWERS.tower.ammoType);
  });

  it('clamps marks above MAX_MK instead of reading past the multiplier tables', () => {
    expect(effStats('cannon', 99)).toEqual(effStats('cannon', MAX_MK));
  });

  it('never mutates TOWERS (combat must read effective stats, not patched bases)', () => {
    const before = JSON.stringify(TOWERS);
    effStats('tower', 3);
    effStats('cannon', 2);
    expect(JSON.stringify(TOWERS)).toBe(before);
  });
});

describe('upgrade costs', () => {
  it('every tier demands the tower’s full loaded magazine — the factory arms the upgrade', () => {
    for (const type of ['tower', 'cannon'] as const) {
      expect(UPGRADES[type]).toHaveLength(MAX_MK - 1);
      for (const tier of UPGRADES[type]) {
        expect(tier.ammo).toBe(TOWERS[type].ammoCap);
        expect(tier.money).toBeGreaterThan(0);
      }
    }
  });
});

describe('build costs', () => {
  it('costOf matches the stat tables for every palette entry', () => {
    for (const info of BUILD_INFO) {
      expect(costOf(info.type)).toBe(info.cost);
      expect(info.cost).toBeGreaterThan(0);
    }
  });
});

describe('economy invariants (CLAUDE.md balance intent)', () => {
  it('one miner+press line sustains roughly half a continuously-firing gun tower', () => {
    // Line throughput is miner-limited: ore/sec into a press that needs 1 ore per ammo.
    const oreRate = 1 / MINER.cycle;
    const pressRate = 1 / MACHINES.press.cycle;
    const ammoRate = Math.min(oreRate, pressRate / MACHINES.press.oreIn);
    const gunDemand = effStats('tower', 1).fireRate;
    const ratio = ammoRate / gunDemand;
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(0.7);
  });

  it('shells cost twice the ore of bullets', () => {
    expect(MACHINES.forge.oreIn).toBe(2 * MACHINES.press.oreIn);
  });
});
