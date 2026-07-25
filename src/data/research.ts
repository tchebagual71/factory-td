import { ItemType } from '../types';
import { emptyMods, Mods } from './mods';

/**
 * Research: the Lab eats finished goods and pays them back as permanent
 * run-scoped upgrades, chosen one-of-three on each level.
 *
 * The tension this exists to create recurs every single wave — a round sent to
 * the Lab is a round that did not reach a gun — which is why raw ore is
 * deliberately worthless here. Research must always cost you defence.
 *
 * Pure module: no Phaser, no services, no storage. The draw takes an RNG so it
 * can be tested deterministically.
 */

/** Research paid per item delivered to a lab. Raw resources are not accepted at all. */
export const RESEARCH_VALUE: Partial<Record<ItemType, number>> = {
  ammo: 4,
  coolant: 3,
  shell: 10,
  piercing: 16,
};

export function labAccepts(item: ItemType): boolean {
  return RESEARCH_VALUE[item] !== undefined;
}

/**
 * Research needed to go from `level - 1` to `level`.
 *
 * This is the single dial that sets how often the level-up draw interrupts
 * play. Reaching level 15 costs ~1,200 research total, i.e. about 300 rounds of
 * ammo routed to a Lab — one modest dedicated press line over a mid-length run.
 */
export function researchForLevel(level: number): number {
  return Math.round(25 * Math.pow(1.15, Math.max(1, level) - 1));
}

/** What the run currently looks like — cards use this to avoid offering dead upgrades. */
export interface DrawContext {
  /** how many of each tower kind are standing */
  towers: Record<string, number>;
  /** crafting machines standing (miners excluded) */
  machines: number;
  miners: number;
  belts: number;
  /** how many times each card has already been taken */
  taken: Record<string, number>;
}

export interface ResearchCard {
  id: string;
  name: string;
  desc: string;
  /** relative likelihood of being offered */
  weight: number;
  /** how many times this card may be taken across a run */
  max: number;
  /** offered only when the run has something for it to improve */
  needs?: (ctx: DrawContext) => boolean;
  /** folded into the run's Mods, once per stack. Omitted by one-shot cards. */
  apply?: (m: Mods) => void;
  /** immediate, un-stackable effect resolved at pick time (never re-applied on load) */
  instant?: 'life' | 'cash';
}

const hasTower = (kind: string) => (ctx: DrawContext) => (ctx.towers[kind] ?? 0) > 0;
const hasAnyTower = (ctx: DrawContext) => Object.values(ctx.towers).some((n) => n > 0);

export const CARDS: ResearchCard[] = [
  {
    id: 'calibrated_barrels',
    name: 'CALIBRATED BARRELS',
    desc: '+15% tower damage',
    weight: 10,
    max: 6,
    needs: hasAnyTower,
    apply: (m) => (m.damage *= 1.15),
  },
  {
    id: 'autoloaders',
    name: 'AUTOLOADERS',
    desc: '+12% fire rate',
    weight: 10,
    max: 6,
    needs: hasAnyTower,
    apply: (m) => (m.fireRate *= 1.12),
  },
  {
    id: 'optics',
    name: 'OPTICS',
    desc: '+10% tower range',
    weight: 7,
    max: 4,
    needs: hasAnyTower,
    apply: (m) => (m.range *= 1.1),
  },
  {
    id: 'greased_belts',
    name: 'GREASED BELTS',
    desc: '+20% belt speed — the whole factory moves faster',
    weight: 8,
    max: 4,
    apply: (m) => (m.beltSpeed *= 1.2),
  },
  {
    id: 'hardened_drills',
    name: 'HARDENED DRILLS',
    desc: '+18% mining speed',
    weight: 8,
    max: 4,
    needs: (ctx) => ctx.miners > 0,
    apply: (m) => (m.minerSpeed *= 1.18),
  },
  {
    id: 'tooling',
    name: 'TOOLING',
    desc: '+15% machine crafting speed',
    weight: 9,
    max: 5,
    needs: (ctx) => ctx.machines > 0,
    apply: (m) => (m.craftSpeed *= 1.15),
  },
  {
    id: 'sabot_rounds',
    name: 'SABOT ROUNDS',
    desc: 'Lances skewer +1 enemy',
    weight: 6,
    max: 3,
    needs: hasTower('lancer'),
    apply: (m) => (m.pierce += 1),
  },
  {
    id: 'deep_freeze',
    name: 'DEEP FREEZE',
    desc: 'Cryo fields chill 12% harder',
    weight: 6,
    max: 4,
    needs: hasTower('cryo'),
    apply: (m) => (m.slow *= 0.88),
  },
  {
    id: 'war_bonds',
    name: 'WAR BONDS',
    desc: '+25% wave clear payout',
    weight: 7,
    max: 4,
    apply: (m) => (m.clearCash *= 1.25),
  },
  {
    id: 'peer_review',
    name: 'PEER REVIEW',
    desc: '+25% research from everything you deliver',
    weight: 5,
    max: 3,
    apply: (m) => (m.researchValue *= 1.25),
  },
  {
    id: 'reinforcements',
    name: 'REINFORCEMENTS',
    desc: '+1 life, right now',
    weight: 5,
    max: 99,
    instant: 'life',
  },
  {
    id: 'grant_funding',
    name: 'GRANT FUNDING',
    desc: 'An immediate cash injection',
    weight: 6,
    max: 99,
    instant: 'cash',
  },
];

/** Cash paid by the GRANT FUNDING card, scaled so it stays relevant late. */
export function grantAmount(wave: number): number {
  return 150 + 40 * wave;
}

export function cardById(id: string): ResearchCard | undefined {
  return CARDS.find((c) => c.id === id);
}

/** Rebuild a run's modifiers from the cards it has taken. Order-independent by construction. */
export function modsFrom(taken: Record<string, number>): Mods {
  const m = emptyMods();
  for (const card of CARDS) {
    if (!card.apply) continue;
    const n = Math.max(0, Math.min(taken[card.id] ?? 0, card.max));
    for (let i = 0; i < n; i++) card.apply(m);
  }
  return m;
}

/** Cards that could still be offered: not maxed out, and relevant to this run. */
export function offerable(ctx: DrawContext): ResearchCard[] {
  return CARDS.filter((c) => (ctx.taken[c.id] ?? 0) < c.max && (!c.needs || c.needs(ctx)));
}

/**
 * Pick `n` distinct cards, weighted. `rng` returns [0,1) — injected so the draw
 * is deterministic under test.
 *
 * Returns fewer than `n` only when the pool genuinely has fewer left, which the
 * caller must handle rather than showing an empty choice.
 */
export function draw(ctx: DrawContext, rng: () => number, n = 3): ResearchCard[] {
  const pool = offerable(ctx);
  const picked: ResearchCard[] = [];
  while (picked.length < n && pool.length > 0) {
    const total = pool.reduce((sum, c) => sum + c.weight, 0);
    let roll = rng() * total;
    let idx = pool.length - 1; // guards against float drift putting roll past the end
    for (let i = 0; i < pool.length; i++) {
      roll -= pool[i].weight;
      if (roll < 0) {
        idx = i;
        break;
      }
    }
    picked.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return picked;
}
