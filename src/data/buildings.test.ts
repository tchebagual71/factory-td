import { describe, expect, it } from 'vitest';
import {
  BUILD_INFO,
  costOf,
  effStats,
  MACHINES,
  MAX_MK,
  MINER,
  nextTier,
  TOWERS,
  UPGRADE_TREE,
  UpgradeTier,
} from './buildings';

const TOWER_TYPES = ['tower', 'cannon'] as const;

/** All purchasable tiers for a type, in buy order along each path: [mk2, path tier1, path tier2]. */
function pathTiers(type: 'tower' | 'cannon'): { pathId: string; tiers: UpgradeTier[] }[] {
  return UPGRADE_TREE[type].paths.map((p) => ({
    pathId: p.id,
    tiers: [UPGRADE_TREE[type].mk2, ...p.tiers],
  }));
}

describe('effStats', () => {
  it('mk1 equals base stats', () => {
    for (const type of TOWER_TYPES) {
      expect(effStats(type, 1)).toEqual(TOWERS[type]);
    }
  });

  it('DPS strictly increases at every mark along every path', () => {
    for (const type of TOWER_TYPES) {
      for (const p of UPGRADE_TREE[type].paths) {
        let prev = effStats(type, 1);
        for (let mk = 2; mk <= MAX_MK; mk++) {
          const cur = effStats(type, mk, p.id);
          expect(cur.damage * cur.fireRate, `${type}/${p.id} mk${mk}`).toBeGreaterThan(prev.damage * prev.fireRate);
          prev = cur;
        }
      }
    }
  });

  it('no stat ever drops below its previous tier along a path', () => {
    for (const type of TOWER_TYPES) {
      for (const p of UPGRADE_TREE[type].paths) {
        let prev = effStats(type, 1);
        for (let mk = 2; mk <= MAX_MK; mk++) {
          const cur = effStats(type, mk, p.id);
          expect(cur.damage).toBeGreaterThanOrEqual(prev.damage);
          expect(cur.range).toBeGreaterThanOrEqual(prev.range);
          expect(cur.fireRate).toBeGreaterThanOrEqual(prev.fireRate);
          expect(cur.splash).toBeGreaterThanOrEqual(prev.splash);
          expect(cur.bulletSpeed).toBeGreaterThanOrEqual(prev.bulletSpeed);
          prev = cur;
        }
      }
    }
  });

  it('paths are differentiated: sniper out-ranges gatling, gatling out-shoots sniper', () => {
    const sniper = effStats('tower', MAX_MK, 'sniper');
    const gatling = effStats('tower', MAX_MK, 'gatling');
    expect(sniper.range).toBeGreaterThan(gatling.range);
    expect(sniper.damage).toBeGreaterThan(gatling.damage);
    expect(gatling.fireRate).toBeGreaterThan(sniper.fireRate);
  });

  it('paths are differentiated: siege out-splashes flak, flak out-shoots siege', () => {
    const siege = effStats('cannon', MAX_MK, 'siege');
    const flak = effStats('cannon', MAX_MK, 'flak');
    expect(siege.splash).toBeGreaterThan(flak.splash);
    expect(siege.damage).toBeGreaterThan(flak.damage);
    expect(flak.fireRate).toBeGreaterThan(siege.fireRate);
  });

  it('ignores path below the Mk3 branch', () => {
    for (const type of TOWER_TYPES) {
      expect(effStats(type, 2, UPGRADE_TREE[type].paths[0].id)).toEqual(effStats(type, 2));
      expect(effStats(type, 1, UPGRADE_TREE[type].paths[1].id)).toEqual(effStats(type, 1));
    }
  });

  it('mk≥3 without a chosen path defensively clamps to Mk2 stats', () => {
    for (const type of TOWER_TYPES) {
      expect(effStats(type, 3, null)).toEqual(effStats(type, 2));
    }
  });

  it('clamps marks above MAX_MK instead of reading past the tier tables', () => {
    expect(effStats('cannon', 99, 'siege')).toEqual(effStats('cannon', MAX_MK, 'siege'));
  });

  it('leaves magazine size and ammo type unchanged across marks', () => {
    const mk4 = effStats('tower', MAX_MK, 'gatling');
    expect(mk4.ammoCap).toBe(TOWERS.tower.ammoCap);
    expect(mk4.ammoType).toBe(TOWERS.tower.ammoType);
  });

  it('never mutates TOWERS (combat must read effective stats, not patched bases)', () => {
    const before = JSON.stringify(TOWERS);
    effStats('tower', 4, 'sniper');
    effStats('cannon', 3, 'flak');
    expect(JSON.stringify(TOWERS)).toBe(before);
  });
});

describe('nextTier', () => {
  it('quotes the shared Mk2 tier from mk1, path tiers after the branch, null at max', () => {
    for (const type of TOWER_TYPES) {
      const tree = UPGRADE_TREE[type];
      expect(nextTier(type, 1, null)).toBe(tree.mk2);
      for (const p of tree.paths) {
        expect(nextTier(type, 2, p.id)).toBe(p.tiers[0]);
        expect(nextTier(type, 3, p.id)).toBe(p.tiers[1]);
      }
      expect(nextTier(type, MAX_MK, tree.paths[0].id)).toBeNull();
      // no path chosen yet at the branch → no tier can be quoted
      expect(nextTier(type, 2, null)).toBeNull();
    }
  });
});

describe('upgrade costs', () => {
  it('every tier demands the tower’s full loaded magazine — the factory arms the upgrade', () => {
    for (const type of TOWER_TYPES) {
      for (const { tiers } of pathTiers(type)) {
        for (const tier of tiers) {
          expect(tier.ammo).toBe(TOWERS[type].ammoCap);
          expect(tier.money).toBeGreaterThan(0);
        }
      }
    }
  });

  it('money cost strictly increases along every path', () => {
    for (const type of TOWER_TYPES) {
      for (const { pathId, tiers } of pathTiers(type)) {
        for (let i = 1; i < tiers.length; i++) {
          expect(tiers[i].money, `${type}/${pathId} tier ${i}`).toBeGreaterThan(tiers[i - 1].money);
        }
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
