import { describe, expect, it } from 'vitest';
import * as rarityModule from './rarity';
import { RARE_WEIGHT, RARITY, Rarity, cardRarity, rarityStyle, sortForReveal } from './rarity';
import { CARDS, ResearchCard, cardById } from './research';

const byId = (id: string): ResearchCard => {
  const card = cardById(id);
  if (!card) throw new Error(`no such card: ${id}`);
  return card;
};

describe('rarity is derived from the card data', () => {
  it('classifies every shipped card', () => {
    for (const card of CARDS) {
      expect(RARITY[cardRarity(card)], card.id).toBeDefined();
    }
  });

  /**
   * The load-bearing rule. Keystones carry the *highest* weight in the pool
   * (18) because you may only ever take one, so any rarity derived from weight
   * alone ranks the game's best cards as its most ordinary.
   */
  it('treats the un-stackable keystones as the rarest, despite their high weight', () => {
    const keystones = CARDS.filter((c) => cardRarity(c) === 'keystone');
    expect(keystones.map((c) => c.id).sort()).toEqual(
      CARDS.filter((c) => c.max === 1).map((c) => c.id).sort(),
    );
    expect(keystones.length).toBeGreaterThan(0);
    // Every one of them out-weighs the RARE_WEIGHT cut, which is exactly the
    // trap this ordering exists to avoid.
    for (const c of keystones) expect(c.weight).toBeGreaterThan(RARE_WEIGHT);
  });

  it('reads a low weight on a stacking card as rare', () => {
    expect(cardRarity(byId('peer_review'))).toBe('rare');
    expect(cardRarity(byId('sabot_rounds'))).toBe('rare');
    expect(cardRarity(byId('calibrated_barrels'))).toBe('common');
    expect(cardRarity(byId('continuous_flow'))).toBe('keystone');
  });

  it('splits the pool into all three tiers rather than collapsing it', () => {
    const tiers = new Set(CARDS.map(cardRarity));
    expect([...tiers].sort()).toEqual(['common', 'keystone', 'rare']);
  });
});

describe('the rarity ladder escalates', () => {
  const order: Rarity[] = ['common', 'rare', 'keystone'];

  it('ranks, thickens and lengthens its sting monotonically', () => {
    for (let i = 1; i < order.length; i += 1) {
      const lo = RARITY[order[i - 1]];
      const hi = RARITY[order[i]];
      expect(hi.rank).toBeGreaterThan(lo.rank);
      expect(hi.stroke).toBeGreaterThanOrEqual(lo.stroke);
      expect(hi.notes.length).toBeGreaterThan(lo.notes.length);
    }
  });

  it('gives every tier an ascending arpeggio and a spoken label', () => {
    for (const tier of order) {
      const s = RARITY[tier];
      expect(s.label).toMatch(/^[A-Z]+$/); // readable without colour — item 37
      expect(s.css).toBe(`#${s.hex.toString(16).padStart(6, '0')}`);
      for (let i = 1; i < s.notes.length; i += 1) {
        expect(s.notes[i]).toBeGreaterThan(s.notes[i - 1]);
      }
    }
  });

  it('exposes the same style through the card helper', () => {
    expect(rarityStyle(byId('continuous_flow'))).toBe(RARITY.keystone);
  });
});

describe('reveal order', () => {
  it('deals the best card last without dropping or inventing one', () => {
    const hand = [byId('continuous_flow'), byId('calibrated_barrels'), byId('peer_review')];
    const dealt = sortForReveal(hand);
    expect(dealt.map((c) => c.id)).toEqual(['calibrated_barrels', 'peer_review', 'continuous_flow']);
    expect(dealt).toHaveLength(hand.length);
    expect(new Set(dealt)).toEqual(new Set(hand));
  });

  it('is stable within a tier, so the seeded draw still decides ties', () => {
    const hand = [byId('autoloaders'), byId('calibrated_barrels'), byId('tooling')];
    expect(sortForReveal(hand).map((c) => c.id)).toEqual(hand.map((c) => c.id));
  });

  it('does not mutate the hand it was given', () => {
    const hand = [byId('continuous_flow'), byId('calibrated_barrels')];
    const before = hand.map((c) => c.id);
    sortForReveal(hand);
    expect(hand.map((c) => c.id)).toEqual(before);
  });

  it('handles an empty or single-card deal', () => {
    expect(sortForReveal([])).toEqual([]);
    expect(sortForReveal([byId('optics')]).map((c) => c.id)).toEqual(['optics']);
  });
});

/**
 * The same contract `combo.test.ts` pins on the kill streak: the feedback layer
 * is allowed to be loud and is never allowed to pay. Rarity must stay a
 * presentation concern, or it becomes a second economy inside the draw.
 */
describe('rarity buys spectacle only', () => {
  it('exports nothing payout-shaped', () => {
    for (const name of Object.keys(rarityModule)) {
      expect(name).not.toMatch(/money|cash|bounty|payout|reward|scrap|bonus|income/i);
    }
    // and no style carries a value the sim could spend
    for (const style of Object.values(RARITY)) {
      expect(Object.keys(style).sort()).toEqual(
        ['css', 'hex', 'label', 'notes', 'rank', 'stroke'],
      );
    }
  });

  it('never changes what a card does or how often it is offered', () => {
    const snapshot = CARDS.map((c) => `${c.id}:${c.weight}:${c.max}`);
    CARDS.forEach(cardRarity);
    sortForReveal(CARDS);
    expect(CARDS.map((c) => `${c.id}:${c.weight}:${c.max}`)).toEqual(snapshot);
  });
});
