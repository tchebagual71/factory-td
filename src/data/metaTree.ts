/**
 * The Workshop: permanent, between-runs progression bought with ⚙ SCRAP.
 *
 * Pure — no storage, no Phaser (`state/meta.ts` owns persistence, MenuScene
 * owns the screen), so the whole economy can be modelled in tests.
 *
 * ## Why a perk tree and not skins
 *
 * Skins are dopamine with no strategy, and this game's pillar is that
 * throughput *is* the economy. So the tree mostly buys **logistics and
 * production**: a Workshop-heavy player starts with a factory that scales
 * faster, not a tower that hits harder. Defense nodes exist but are the
 * weakest in the tree on purpose — combat power is what the *in-run* research
 * draw and the Mk tree already sell.
 *
 * ## Why it is capped, and hard
 *
 * Meta progression that compounds without a ceiling eventually deletes the
 * difficulty curve, and this game's curve is load-bearing (see "The difficulty
 * curve" in CLAUDE.md — the throughput wall at wave ~33 is deliberate). Every
 * node has a `max`, `metaTree.test.ts` pins the fully-bought totals, and the
 * combined start-money ceiling is checked against the achievements' own cap so
 * the two systems can never quietly add up to a trivial opening.
 */

import { Mods } from './mods';

export type MetaCategory = 'logistics' | 'production' | 'defense' | 'economy';

export interface MetaCategoryDef {
  id: MetaCategory;
  name: string;
  /** hex for Phaser fills */
  color: number;
  /** the same colour as a CSS string, for Text */
  css: string;
}

/** Mirrors BUILD_CATEGORIES' colours so the Workshop reads as the same game. */
export const META_CATEGORIES: MetaCategoryDef[] = [
  { id: 'logistics', name: 'LOGISTICS', color: 0x4a90d9, css: '#6bd4ff' },
  { id: 'production', name: 'PRODUCTION', color: 0xd98c3a, css: '#ff9f43' },
  { id: 'defense', name: 'DEFENSE', color: 0xc0504d, css: '#ff6b6b' },
  { id: 'economy', name: 'ECONOMY', color: 0xc9a227, css: '#ffe066' },
];

export interface MetaNode {
  id: string;
  name: string;
  /** what one level does, in the player's terms */
  desc: string;
  cat: MetaCategory;
  /** levels available; cost rises per level via `nodeCost` */
  max: number;
  /** scrap for the first level; each subsequent level doubles */
  base: number;
}

/**
 * Cost of the *next* level. Doubling is steep on purpose: the first level of
 * everything is affordable early (which is where the dopamine is), and maxing
 * one line is a real trade against broadening.
 */
export function nodeCost(node: MetaNode, ownedLevels: number): number {
  return node.base * 2 ** ownedLevels;
}

/** Total scrap to take a node from nothing to `levels`. */
export function nodeTotal(node: MetaNode, levels: number): number {
  let sum = 0;
  for (let i = 0; i < levels; i++) sum += nodeCost(node, i);
  return sum;
}

export const META_NODES: MetaNode[] = [
  // ---- logistics: move more, sooner ----
  { id: 'belt_tuning', name: 'Belt Tuning', desc: '+8% belt speed', cat: 'logistics', max: 3, base: 40 },
  { id: 'jam_clearing', name: 'Jam Clearing', desc: '+6% belt speed', cat: 'logistics', max: 2, base: 70 },
  // ---- production: the backbone the whole game is about ----
  { id: 'tungsten_bits', name: 'Tungsten Bits', desc: '+8% miner speed', cat: 'production', max: 3, base: 50 },
  { id: 'hardened_dies', name: 'Hardened Dies', desc: '+8% machine speed', cat: 'production', max: 3, base: 50 },
  // ---- defense: deliberately the thinnest branch ----
  { id: 'preloaded_mags', name: 'Preloaded Mags', desc: '+4 rounds in every tower you place', cat: 'defense', max: 3, base: 40 },
  { id: 'rifling', name: 'Rifling', desc: '+5% tower damage', cat: 'defense', max: 2, base: 120 },
  // ---- economy: a faster opening, not a bigger wallet forever ----
  { id: 'seed_capital', name: 'Seed Capital', desc: '+$60 starting money', cat: 'economy', max: 3, base: 30 },
  { id: 'contingency', name: 'Contingency', desc: '+2 starting lives', cat: 'economy', max: 2, base: 80 },
  { id: 'prospector', name: 'Prospector', desc: '−15% survey cost', cat: 'economy', max: 2, base: 60 },
  { id: 'salvage_rights', name: 'Salvage Rights', desc: '+8% wave-clear payout', cat: 'economy', max: 2, base: 100 },
];

const BY_ID = new Map(META_NODES.map((n) => [n.id, n]));

export function metaNode(id: string): MetaNode | undefined {
  return BY_ID.get(id);
}

/** Levels bought per node id. Anything absent is level 0. */
export type MetaOwned = Record<string, number>;

/**
 * Everything the Workshop grants a fresh run.
 *
 * `mods` is a partial `Mods` folded into the run's bag *before* research picks
 * are applied, so the two stack multiplicatively rather than one clobbering
 * the other.
 */
export interface MetaEffects {
  startMoney: number;
  startLives: number;
  /** extra rounds a freshly placed tower carries */
  startAmmo: number;
  /** 0..1 fraction off the survey price */
  surveyDiscount: number;
  mods: Partial<Mods>;
}

export function emptyEffects(): MetaEffects {
  return { startMoney: 0, startLives: 0, startAmmo: 0, surveyDiscount: 0, mods: {} };
}

/** Levels actually owned for a node, clamped to its max — a tampered store can't overstack. */
export function levelsOf(owned: MetaOwned, node: MetaNode): number {
  const raw = owned[node.id];
  if (!Number.isFinite(raw) || !raw || raw < 0) return 0;
  return Math.min(node.max, Math.floor(raw));
}

/**
 * Rebuild the whole effect bag from owned levels — never applied
 * incrementally, exactly like `modsFrom` for research. That is what makes a
 * tampered or partially-written store harmless: the clamp in `levelsOf` is the
 * only place a bound has to hold.
 */
export function effectsFrom(owned: MetaOwned): MetaEffects {
  const e = emptyEffects();
  const mult = (key: keyof Mods, per: number, n: number) => {
    if (n > 0) e.mods[key] = (e.mods[key] ?? 1) * (1 + per) ** n;
  };
  for (const node of META_NODES) {
    const n = levelsOf(owned, node);
    if (n === 0) continue;
    switch (node.id) {
      case 'belt_tuning': mult('beltSpeed', 0.08, n); break;
      case 'jam_clearing': mult('beltSpeed', 0.06, n); break;
      case 'tungsten_bits': mult('minerSpeed', 0.08, n); break;
      case 'hardened_dies': mult('craftSpeed', 0.08, n); break;
      case 'rifling': mult('damage', 0.05, n); break;
      case 'salvage_rights': mult('clearCash', 0.08, n); break;
      case 'preloaded_mags': e.startAmmo += 4 * n; break;
      case 'seed_capital': e.startMoney += 60 * n; break;
      case 'contingency': e.startLives += 2 * n; break;
      case 'prospector': e.surveyDiscount = Math.min(0.5, e.surveyDiscount + 0.15 * n); break;
    }
  }
  return e;
}

/** Scrap needed to own every level of everything. */
export function fullTreeCost(): number {
  return META_NODES.reduce((sum, n) => sum + nodeTotal(n, n.max), 0);
}

// ---------- earning ----------

/** What a finished run pays out. Kept separate from `WaveTally` — this is the whole run. */
export interface RunResult {
  /** the wave the player reached (1-based; wave 1 death pays the floor) */
  wave: number;
  kills: number;
  /** longest kill streak of the run */
  bestStreak: number;
  /** true when this run beat the player's previous best wave */
  newBest: boolean;
}

/** Scrap per wave survived — the dominant term, because depth is the thing to reward. */
export const SCRAP_PER_WAVE = 5;
/** One scrap per this many kills, so a wide factory that grinds also pays. */
export const KILLS_PER_SCRAP = 10;
/** Flat bonus for a new personal best — the "one more run" nudge. */
export const SCRAP_NEW_BEST = 25;

/**
 * Payout for a finished run. Deliberately generous and legible (a wave is
 * worth a round number) rather than a tuned curve — the player should be able
 * to feel "one more wave was worth it" without arithmetic.
 *
 * Every run pays *something*, including a wave-1 wipe: a meta currency that
 * can pay zero teaches players that a bad run was wasted time.
 */
export function scrapEarned(r: RunResult): number {
  const waves = Math.max(0, Math.floor(r.wave) - 1);
  const streak = Math.max(0, Math.floor(r.bestStreak));
  return (
    SCRAP_PER_WAVE * waves +
    Math.floor(Math.max(0, r.kills) / KILLS_PER_SCRAP) +
    Math.floor(streak / 2) +
    (r.newBest ? SCRAP_NEW_BEST : 0) +
    // the floor: even a wipe on wave 1 buys progress toward the first node
    1
  );
}
