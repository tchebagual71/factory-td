import { describe, expect, it } from 'vitest';
import { ItemType } from '../types';
import { MACHINES, MachineType, MINER, RAW_ITEMS, recipeInputs } from './buildings';
import { emptyMods } from './mods';
import {
  CARDS,
  cardById,
  DrawContext,
  draw,
  embodiedValue,
  grantAmount,
  labAccepts,
  modsFrom,
  ORE_VALUE,
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
  return {
    towers: { tower: 2, cannon: 1, lancer: 1, cryo: 1 },
    machines: 3,
    miners: 4,
    belts: 20,
    taken: {},
    ...over,
  };
}

const NEW_CARD_IDS = [
  'continuous_flow',
  'batch_production',
  'feed_the_line',
  'pull_production',
  'heavy_shots',
  'storm_fire',
] as const;

/**
 * Mirrors the Lab call site in `ConveyorSystem`: the exact value, scaled by any
 * research mods, banked *unrounded*.
 *
 * It used to round each delivery to a whole point, and that rounding was itself
 * an exploit — see the PEER REVIEW test below. Research now accumulates as a
 * fraction and only the level thresholds are whole numbers.
 */
function deliveredResearch(item: ItemType, researchMult = 1): number {
  const value = RESEARCH_VALUE[item];
  return value === undefined ? 0 : value * researchMult;
}

/** Every research multiplier a run can actually reach: PEER REVIEW is ×1.25, max 3 stacks. */
const REACHABLE_MULTIPLIERS = [1, 1.25, 1.25 ** 2, 1.25 ** 3];

describe('lab intake', () => {
  it('accepts manufactured goods only — research must always cost you ammo', () => {
    for (const made of ['ammo', 'shell', 'piercing', 'coolant'] as ItemType[]) {
      expect(labAccepts(made), `${made} should be accepted`).toBe(true);
    }
    for (const raw of ['ore', 'crystal'] as ItemType[]) {
      expect(labAccepts(raw), `${raw} must be refused`).toBe(false);
    }
  });

  it('keeps raw embodied value separate from raw Lab payout', () => {
    for (const raw of RAW_ITEMS) {
      expect(RESEARCH_VALUE[raw], `${raw} must have no payout`).toBeUndefined();
      expect(labAccepts(raw), `${raw} must be rejected`).toBe(false);
      expect(deliveredResearch(raw), `${raw} must round to no payout`).toBe(0);
      expect(embodiedValue(raw), `${raw} must contribute after manufacture`).toBeGreaterThan(0);
    }
    expect(embodiedValue('ore')).toBe(ORE_VALUE);
    expect(embodiedValue('crystal')).toBeCloseTo(ORE_VALUE * (MINER.crystalCycle / MINER.cycle), 12);
  });

  it('conserves exact embodied value through every machine recipe', () => {
    for (const type of Object.keys(MACHINES) as MachineType[]) {
      const stats = MACHINES[type];
      const inputValue = recipeInputs(type).reduce(
        (sum, [item, count]) => sum + embodiedValue(item) * count,
        0,
      );
      const outputValue = embodiedValue(stats.output) * stats.outputPer;
      expect(outputValue, `${type} must conserve its inputs`).toBeCloseTo(inputValue, 12);
    }
  });

  /**
   * Conservation holds in exact arithmetic, but the Lab used to round *each
   * delivery* to a whole point — and that rounding reintroduced the very
   * exploit this model exists to kill. Coolant is worth exactly half an ammo,
   * so with one PEER REVIEW stack the old call site paid `round(2.5) × 2 = 6`
   * for laundered coolant against `round(5) = 5` for the ammo itself: a 20%
   * gain for owning one chiller. Research is banked unrounded now, and this
   * pins that at every multiplier a run can actually reach.
   */
  it('cannot be gamed by converting, at any research multiplier a run can reach', () => {
    for (const mult of REACHABLE_MULTIPLIERS) {
      for (const type of Object.keys(MACHINES) as MachineType[]) {
        const stats = MACHINES[type];
        const inputs = recipeInputs(type).reduce(
          (sum, [item, count]) => sum + embodiedValue(item) * mult * count,
          0,
        );
        const outputs = deliveredResearch(stats.output, mult) * stats.outputPer;
        expect(outputs, `${type} creates research at ×${mult}`).toBeLessThanOrEqual(inputs + 1e-9);
      }
    }
  });

  it('specifically: laundering ammo through a chiller never beats labbing it directly', () => {
    for (const mult of REACHABLE_MULTIPLIERS) {
      const direct = deliveredResearch('ammo', mult);
      // one ammo in, `outputPer` coolant out
      const laundered = deliveredResearch('coolant', mult) * MACHINES.chiller.outputPer;
      expect(laundered, `chiller launder at ×${mult}`).toBeLessThanOrEqual(direct + 1e-9);
    }
  });

  it('derives the current exact and whole-item payouts from conserved material value', () => {
    expect(RESEARCH_VALUE.ammo).toBe(4);
    expect(RESEARCH_VALUE.coolant).toBe(2);
    expect(RESEARCH_VALUE.shell).toBe(8);
    expect(RESEARCH_VALUE.piercing).toBeCloseTo(14.933333333333334, 12);
    // Close to the hand-authored 4 / 3 / 10 / 16 these replaced: the designer's
    // instinct was sound, and coolant — the one that was exploitable — is the
    // only value that moves materially.
    expect(deliveredResearch('ammo')).toBe(4);
    expect(deliveredResearch('coolant')).toBe(2);
    expect(deliveredResearch('shell')).toBe(8);
    expect(deliveredResearch('piercing')).toBeCloseTo(14.933333333333334, 12);
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

  it('keeps level 15 at about 300 ammo sacrificed to the Lab', () => {
    // Sum the actual rounded level thresholds, then divide by the same whole
    // ammo payout the simulation awards. This pins cadence at the player-facing
    // boundary instead of relying on the formula's unrounded approximation.
    let total = 0;
    for (let level = 1; level <= 15; level++) total += researchForLevel(level);
    const ammoRounds = Math.ceil(total / deliveredResearch('ammo'));
    expect(total).toBe(1190);
    expect(ammoRounds).toBe(298);
    expect(ammoRounds).toBeGreaterThanOrEqual(240);
    expect(ammoRounds).toBeLessThanOrEqual(360);
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

  it('gives every situational card a satisfiable prerequisite that refuses an empty run', () => {
    const built = ctx();
    const irrelevant: Record<string, DrawContext> = {
      calibrated_barrels: ctx({ towers: { cryo: 1 } }),
      autoloaders: ctx({ towers: {} }),
      optics: ctx({ towers: {} }),
      greased_belts: ctx({ belts: 0 }),
      hardened_drills: ctx({ miners: 0 }),
      tooling: ctx({ machines: 0 }),
      sabot_rounds: ctx({ towers: { tower: 1 } }),
      deep_freeze: ctx({ towers: { tower: 1 } }),
      continuous_flow: ctx({ belts: 0 }),
      batch_production: ctx({ belts: 0 }),
      feed_the_line: ctx({ miners: 0 }),
      pull_production: ctx({ miners: 0 }),
      heavy_shots: ctx({ towers: { cryo: 1 } }),
      storm_fire: ctx({ towers: { cryo: 1 } }),
    };
    const situational = CARDS.filter((c) => c.needs);
    expect(Object.keys(irrelevant).sort()).toEqual(situational.map((c) => c.id).sort());
    for (const card of situational) {
      expect(card.needs!(built), `${card.id} has an impossible prerequisite`).toBe(true);
      expect(card.needs!(irrelevant[card.id]), `${card.id} has nothing relevant to improve`).toBe(false);
    }
  });

  it('weights the one-shot branches strongly enough to survive the repeatable multiplier pool', () => {
    const branchWeight = CARDS.filter((c) => NEW_CARD_IDS.includes(c.id as (typeof NEW_CARD_IDS)[number])).reduce(
      (sum, c) => sum + c.weight,
      0,
    );
    const restWeight = CARDS.filter((c) => !NEW_CARD_IDS.includes(c.id as (typeof NEW_CARD_IDS)[number])).reduce(
      (sum, c) => sum + c.weight,
      0,
    );
    expect(branchWeight).toBeGreaterThan(restWeight);
  });

  it('never offers an upgrade with nothing to improve', () => {
    const bare = offerable(ctx({ towers: {}, machines: 0, miners: 0, belts: 0 }));
    for (const c of bare) {
      expect(c.id, 'needs a lancer').not.toBe('sabot_rounds');
      expect(c.id, 'needs a cryo field').not.toBe('deep_freeze');
      expect(c.id, 'needs a miner').not.toBe('hardened_drills');
      expect(c.id, 'needs a machine').not.toBe('tooling');
      expect(c.id, 'needs a belt').not.toBe('greased_belts');
      expect(NEW_CARD_IDS, `${c.id} is a situational branch`).not.toContain(c.id);
    }
    // ...but a run with those buildings can see them
    expect(offerable(ctx({ towers: { lancer: 1 } })).map((c) => c.id)).toContain('sabot_rounds');
  });

  it('drops a card once it is maxed out', () => {
    const card = CARDS.find((c) => c.id === 'optics')!;
    const taken = { optics: card.max };
    expect(offerable(ctx({ taken })).map((c) => c.id)).not.toContain('optics');
  });

  it('permanently removes the other side of every mutually exclusive branch', () => {
    for (const id of NEW_CARD_IDS) {
      const card = cardById(id)!;
      expect(card.excludes, `${id} must name its opposing branch`).toHaveLength(1);
      const opposite = card.excludes![0];
      expect(cardById(opposite)?.excludes).toContain(id);
      expect(offerable(ctx({ taken: { [id]: 1 } })).map((c) => c.id)).not.toContain(opposite);
    }
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
    const context = ctx({ towers: {}, machines: 0, miners: 0, belts: 0 });
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

  it('keeps every untaken new branch neutral', () => {
    for (const id of NEW_CARD_IDS) expect(modsFrom({ [id]: 0 }), id).toEqual(emptyMods());
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

  it('clamps every new branch at its max', () => {
    for (const id of NEW_CARD_IDS) {
      const card = cardById(id)!;
      expect(modsFrom({ [id]: 999 }), id).toEqual(modsFrom({ [id]: card.max }));
    }
  });

  it('is idempotent for the same saved counts', () => {
    const taken = { continuous_flow: 1, feed_the_line: 1, heavy_shots: 1, optics: 2 };
    const once = modsFrom(taken);
    const twice = modsFrom(taken);
    expect(twice).toEqual(once);
    expect(modsFrom(taken)).toEqual(once);
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
