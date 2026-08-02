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

/**
 * Colour safety for the rarity ladder.
 *
 * Measured against the card fill (`0x1a1830`) and through protanopia /
 * deuteranopia / tritanopia simulation:
 *
 * - contrast is 8.1 / 10.9 / 10.6 : 1 — all past WCAG AAA for normal text;
 * - **keystone is unmistakable**, 127–214 RGB units from the other two under
 *   every colour-vision model. That is the distinction that decides a pick;
 * - **common vs rare is the weak pair**: 65 normally, and only 42 under
 *   deuteranopia, because steel-blue and teal converge there.
 *
 * The last point is *mitigated rather than fixed*, deliberately. Tier is also
 * carried by the badge word and the frame weight, so a player who cannot
 * separate those two hues still reads STANDARD vs RARE — which is why the
 * assertions below pin the **non-colour** channels as the guarantee, and treat
 * hue as an accelerator. Repainting the palette is a live-game aesthetic change
 * that wants a human eye; the measured alternative is in CLAUDE.md.
 */
describe('rarity is legible without relying on hue', () => {
  const CARD_FILL = 0x1a1830;
  const chan = (h: number): [number, number, number] => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
  const toLinear = (c: number): number => {
    const n = c / 255;
    return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (h: number): number => {
    const [r, g, b] = chan(h).map(toLinear);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: number, b: number): number => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const CVD: Record<string, number[][]> = {
    protanopia: [[0.152, 1.053, -0.205], [0.115, 0.786, 0.099], [-0.004, -0.048, 1.052]],
    deuteranopia: [[0.367, 0.861, -0.228], [0.280, 0.673, 0.047], [-0.012, 0.043, 0.969]],
    tritanopia: [[1.256, -0.077, -0.181], [-0.078, 0.931, 0.148], [0.005, 0.691, 0.304]],
  };
  const simulate = (hex: number, m: number[][]): number => {
    const [r, g, b] = chan(hex).map(toLinear);
    const gamma = (v: number): number => {
      const c = Math.min(1, Math.max(0, v));
      return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    };
    const out = m.map((row) => Math.round(gamma(row[0] * r + row[1] * g + row[2] * b) * 255));
    return (out[0] << 16) | (out[1] << 8) | out[2];
  };
  const apart = (a: number, b: number): number => {
    const [x, y] = [chan(a), chan(b)];
    return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
  };

  it('puts every tier past WCAG AAA against the card it is printed on', () => {
    for (const tier of ['common', 'rare', 'keystone'] as const) {
      expect(contrast(RARITY[tier].hex, CARD_FILL), tier).toBeGreaterThanOrEqual(7);
    }
  });

  /** The pick-deciding distinction, and the one that must survive everything. */
  it('keeps the keystone unmistakable under every colour-vision model', () => {
    for (const [name, m] of Object.entries(CVD)) {
      for (const other of ['common', 'rare'] as const) {
        const gold = simulate(RARITY.keystone.hex, m);
        expect(apart(gold, simulate(RARITY[other].hex, m)), `${other} vs keystone, ${name}`)
          .toBeGreaterThan(100);
      }
    }
  });

  /**
   * The actual guarantee. Hue is an accelerator; these are what a player reads
   * when hue fails, so they must differ for *every* pair — not just the ones
   * whose colours happen to be far apart.
   */
  it('separates every tier by word and by frame weight, not only by hue', () => {
    const tiers = ['common', 'rare', 'keystone'] as const;
    const labels = tiers.map((t) => RARITY[t].label);
    const strokes = tiers.map((t) => RARITY[t].stroke);
    expect(new Set(labels).size, 'two tiers share a badge word').toBe(tiers.length);
    expect(new Set(strokes).size, 'two tiers share a frame weight').toBe(tiers.length);
  });

  /** Records the known-weak pair so a palette change is a deliberate decision. */
  it('documents common vs rare as the hue-weak pair', () => {
    const worst = Math.min(
      apart(RARITY.common.hex, RARITY.rare.hex),
      ...Object.values(CVD).map((m) => apart(simulate(RARITY.common.hex, m), simulate(RARITY.rare.hex, m))),
    );
    expect(worst).toBeGreaterThan(35);  // still separable, and the badge carries it
    expect(worst).toBeLessThan(100);    // fails loudly if someone repaints — re-read the note above
  });
});
