import { describe, expect, it } from 'vitest';
import { ItemType } from '../types';
import { emptyMods } from './mods';
import {
  CARDS,
  cardById,
  DrawContext,
  draw,
  grantAmount,
  labAccepts,
  modsFrom,
  offerable,
  RESEARCH_VALUE,
  researchForLevel,
} from './research';

/** Deterministic RNG so a draw can be asserted rather than sampled. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function ctx(over: Partial<DrawContext> = {}): DrawContext {
  return { towers: { tower: 2, cannon: 1 }, machines: 3, miners: 4, belts: 20, taken: {}, ...over };
}

describe('lab intake', () => {
  it('accepts manufactured goods only — research must always cost you ammo', () => {
    for (const made of ['ammo', 'shell', 'piercing', 'coolant'] as ItemType[]) {
      expect(labAccepts(made), `${made} should be accepted`).toBe(true);
    }
    for (const raw of ['ore', 'crystal'] as ItemType[]) {
      expect(labAccepts(raw), `${raw} must be refused`).toBe(false);
    }
  });

  it('pays more for deeper goods than for the ammo they were made from', () => {
    expect(RESEARCH_VALUE.shell!).toBeGreaterThan(RESEARCH_VALUE.ammo!);
    expect(RESEARCH_VALUE.piercing!).toBeGreaterThan(RESEARCH_VALUE.shell!);
  });
});

describe('researchForLevel', () => {
  it('rises with every level and never asks for nothing', () => {
    let prev = 0;
    for (let n = 1; n <= 40; n++) {
      const need = researchForLevel(n);
      expect(need).toBeGreaterThan(prev);
      prev = need;
    }
  });

  it('keeps the first few levels quick, so a new Lab pays off visibly', () => {
    // ~2 magazines of ammo at 4 research each
    expect(researchForLevel(1)).toBeLessThanOrEqual(40);
  });

  it('clamps a nonsense level rather than returning NaN', () => {
    expect(researchForLevel(0)).toBe(researchForLevel(1));
    expect(researchForLevel(-5)).toBe(researchForLevel(1));
  });
});

describe('card pool', () => {
  it('has unique ids that match the achievement/DB id shape', () => {
    const ids = CARDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9_]{1,40}$/);
  });

  it('every card either modifies the run or resolves instantly, never neither', () => {
    for (const c of CARDS) {
      expect(Boolean(c.apply) || Boolean(c.instant), `${c.id} does nothing`).toBe(true);
      expect(c.weight).toBeGreaterThan(0);
      expect(c.max).toBeGreaterThan(0);
    }
  });

  it('never offers an upgrade with nothing to improve', () => {
    const bare = offerable(ctx({ towers: {}, machines: 0, miners: 0 }));
    for (const c of bare) {
      expect(c.id, 'needs a lancer').not.toBe('sabot_rounds');
      expect(c.id, 'needs a cryo field').not.toBe('deep_freeze');
      expect(c.id, 'needs a miner').not.toBe('hardened_drills');
      expect(c.id, 'needs a machine').not.toBe('tooling');
    }
    // ...but a run with those buildings can see them
    expect(offerable(ctx({ towers: { lancer: 1 } })).map((c) => c.id)).toContain('sabot_rounds');
  });

  it('drops a card once it is maxed out', () => {
    const card = CARDS.find((c) => c.id === 'optics')!;
    const taken = { optics: card.max };
    expect(offerable(ctx({ taken })).map((c) => c.id)).not.toContain('optics');
  });
});

describe('draw', () => {
  it('returns the requested number of distinct cards', () => {
    const picked = draw(ctx(), seeded(7), 3);
    expect(picked).toHaveLength(3);
    expect(new Set(picked.map((c) => c.id)).size).toBe(3);
  });

  it('is deterministic for a given rng', () => {
    const a = draw(ctx(), seeded(42), 3).map((c) => c.id);
    const b = draw(ctx(), seeded(42), 3).map((c) => c.id);
    expect(a).toEqual(b);
  });

  it('returns what is left rather than repeating when the pool runs dry', () => {
    // max out everything except the two that need nothing built
    const taken: Record<string, number> = {};
    for (const c of CARDS) taken[c.id] = c.max;
    delete taken.war_bonds;
    const picked = draw(ctx({ taken }), seeded(3), 3);
    expect(picked.map((c) => c.id)).toEqual(['war_bonds']);
  });

  it('returns nothing when every card is exhausted — the caller must not show an empty draw', () => {
    const taken: Record<string, number> = {};
    for (const c of CARDS) taken[c.id] = c.max;
    expect(draw(ctx({ taken }), seeded(9), 3)).toEqual([]);
  });

  it('only ever offers cards the context allows', () => {
    const context = ctx({ towers: {}, machines: 0, miners: 0 });
    for (let seed = 1; seed < 40; seed++) {
      for (const c of draw(context, seeded(seed), 3)) {
        expect(c.needs?.(context) ?? true, `${c.id} offered without its prerequisite`).toBe(true);
      }
    }
  });
});

describe('modsFrom', () => {
  it('an untaken run is a no-op', () => {
    expect(modsFrom({})).toEqual(emptyMods());
  });

  it('stacks a card the number of times it was taken', () => {
    const once = modsFrom({ calibrated_barrels: 1 }).damage;
    const thrice = modsFrom({ calibrated_barrels: 3 }).damage;
    expect(thrice).toBeCloseTo(once ** 3, 5);
  });

  it('is order-independent — it is rebuilt from counts, not applied incrementally', () => {
    const a = modsFrom({ calibrated_barrels: 2, autoloaders: 1 });
    const b = modsFrom({ autoloaders: 1, calibrated_barrels: 2 });
    expect(a).toEqual(b);
  });

  it('clamps past a card’s max, so a tampered save cannot stack it forever', () => {
    const card = cardById('calibrated_barrels')!;
    expect(modsFrom({ calibrated_barrels: 999 })).toEqual(modsFrom({ calibrated_barrels: card.max }));
  });

  it('ignores ids that no longer exist', () => {
    expect(modsFrom({ removed_card_from_an_old_save: 5 })).toEqual(emptyMods());
  });

  it('deepens the cryo slow rather than weakening it', () => {
    expect(modsFrom({ deep_freeze: 2 }).slow).toBeLessThan(1);
  });

  it('leaves instant cards out of the modifiers entirely', () => {
    expect(modsFrom({ reinforcements: 4, grant_funding: 3 })).toEqual(emptyMods());
  });
});

describe('grantAmount', () => {
  it('scales with the wave so a late grant is still worth taking', () => {
    expect(grantAmount(30)).toBeGreaterThan(grantAmount(5) * 2);
  });
});
