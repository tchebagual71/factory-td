/**
 * Card rarity — the slot-machine read on the research draw.
 *
 * The level-up draw is this game's Vampire Survivors moment: the run stops, the
 * screen clears, and you are handed a choice you earned. But every card was
 * presented identically, so a draw containing a run-defining keystone looked
 * exactly like a draw of three flat multipliers. The *pull* had no tell.
 *
 * ## Rarity is derived, never authored
 *
 * There is no `rarity:` field on `ResearchCard`, deliberately. A hand-authored
 * one is a second source of truth that drifts the moment someone tunes a weight
 * or a cap and forgets the label — the same failure `RESEARCH_VALUE` had before
 * item 34 derived it. Both signals already exist in the card data:
 *
 * - **`max === 1`** uniquely identifies the six mutually-exclusive "changes how
 *   it works" keystones added in item 34a. They are the only cards that alter a
 *   rule rather than scale a coefficient, and they can never be stacked — which
 *   is exactly what "this is the pull" means.
 * - **a low `weight`** is what the pool itself already says is scarce.
 *
 * Note the keystones carry the *highest* weight (18) on purpose: they are common
 * to *offer* precisely because you may only ever take one. So rarity is not
 * `1/weight`, and reading it that way would rank the game's best cards as its
 * most ordinary. `max` is checked first for that reason.
 *
 * ## It buys spectacle only
 *
 * Rarity changes colour, reveal order and a sting. It does not touch `draw()`,
 * the weights, or what a card does — the odds a player faces are exactly the
 * odds they faced before. This is the same contract `data/combo.ts` keeps: the
 * feedback layer is allowed to be loud and is never allowed to pay.
 */

import { ResearchCard } from './research';

export type Rarity = 'common' | 'rare' | 'keystone';

/**
 * Weight at or below which a *stacking* card reads as scarce.
 *
 * 6 splits the stackable pool where the authored weights already cluster:
 * PEER REVIEW / SABOT ROUNDS / DEEP FREEZE / REINFORCEMENTS / GRANT FUNDING sit
 * at 5–6, everything else at 7–10.
 */
export const RARE_WEIGHT = 6;

export function cardRarity(card: ResearchCard): Rarity {
  // Checked before weight: keystones are deliberately high-weight (see above).
  if (card.max === 1) return 'keystone';
  return card.weight <= RARE_WEIGHT ? 'rare' : 'common';
}

export interface RarityStyle {
  /** Word on the card. Short — it sits in a corner badge, not a sentence. */
  label: string;
  hex: number;
  css: string;
  /** Frame stroke weight; heavier reads as more valuable at a glance. */
  stroke: number;
  /** 0..2. Reveal order, dwell, and how much spectacle the tier earns. */
  rank: number;
  /**
   * Ascending reveal sting, in Hz. Longer *and* higher for rarer cards, so the
   * deal is audible before it is read — the arcade tell that something good
   * landed. Same escalation shape as the kill streak's pitch ramp.
   */
  notes: readonly number[];
}

const hexCss = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;

const style = (
  label: string,
  hex: number,
  stroke: number,
  rank: number,
  notes: readonly number[],
): RarityStyle => ({ label, hex, css: hexCss(hex), stroke, rank, notes });

/**
 * Steel → teal → gold. Gold-is-best is the one colour ladder that needs no
 * legend, and the tier is also spelled out in words on the badge, so the read
 * never depends on colour alone (item 37).
 */
export const RARITY: Record<Rarity, RarityStyle> = {
  common: style('STANDARD', 0x9fb4c7, 2, 0, [523, 659]),
  rare: style('RARE', 0x70e1c1, 3, 1, [523, 659, 784]),
  keystone: style('KEYSTONE', 0xffc043, 4, 2, [523, 659, 784, 1047]),
};

export function rarityStyle(card: ResearchCard): RarityStyle {
  return RARITY[cardRarity(card)];
}

/**
 * Display order for a deal: ordinary cards first, the best one last.
 *
 * Purely presentational — `draw()` already chose *which* cards; this chooses
 * only the order they are dealt in, so the seeded draw is untouched and the
 * hotkey bound to each slot follows the card drawn there. Landing the keystone
 * last gives the reveal somewhere to build to instead of spending its best beat
 * first, which is the whole reason a chest opens one item at a time.
 *
 * Stable, so two cards of one tier keep the order the draw produced.
 */
export function sortForReveal<T extends ResearchCard>(cards: readonly T[]): T[] {
  return cards
    .map((card, i) => ({ card, i, rank: RARITY[cardRarity(card)].rank }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((e) => e.card);
}
