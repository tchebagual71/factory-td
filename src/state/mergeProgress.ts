/**
 * Pure conflict-resolution rules for local ↔ cloud sync. No I/O here —
 * `services/cloud.ts` applies these decisions. Strategy: run saves are
 * last-write-wins on timestamp, achievements are a set union (an unlock is
 * never lost), while durable counters form a max-merge lattice.
 */

import { emptyStats, StatKey, Stats } from '../data/achievements';
import { levelsOf, MetaOwned, META_NODES } from '../data/metaTree';

export type RunChoice = 'local' | 'cloud' | 'none';

/** Which run save wins. Timestamps are epoch ms; null = that side has no save. */
export function newerRun(localSavedAt: number | null, cloudSavedAt: number | null): RunChoice {
  if (localSavedAt === null && cloudSavedAt === null) return 'none';
  if (localSavedAt === null) return 'cloud';
  if (cloudSavedAt === null) return 'local';
  return cloudSavedAt > localSavedAt ? 'cloud' : 'local';
}

export interface AchievementMerge {
  union: Set<string>;
  /** unlocked locally but missing from the cloud → push */
  toPush: string[];
  /** unlocked in the cloud but missing locally → absorb */
  toAbsorb: string[];
}

export function mergeAchievements(local: ReadonlySet<string>, cloud: ReadonlySet<string>): AchievementMerge {
  const union = new Set<string>([...local, ...cloud]);
  return {
    union,
    toPush: [...local].filter((id) => !cloud.has(id)),
    toAbsorb: [...cloud].filter((id) => !local.has(id)),
  };
}

export function mergeBest(a: number, b: number): number {
  return Math.max(a, b, 0);
}

export interface WorkshopProgress {
  /** unspent scrap */
  scrap: number;
  owned: MetaOwned;
}

export interface LifetimeProgress {
  v: 1;
  workshop: WorkshopProgress;
  stats: Stats;
}

/**
 * The wallet is max, not sum. Sum pays the same run again every time an old
 * snapshot is merged. A lifetime-earned/spent ledger would avoid that only for
 * events recorded after its introduction: today's bare wallet cannot tell us
 * which old awards two devices share. Max is migration-safe and repeat-safe,
 * at the acknowledged cost of losing the smaller concurrent unspent gain.
 *
 * Node levels are also max, but for a different reason: the same level bought
 * on two phones is one purchase. Summing would hand out levels for owning two
 * devices, and would reach a cap faster on every repeated merge.
 */
export function mergeWorkshop(local: WorkshopProgress, cloud: WorkshopProgress): WorkshopProgress {
  const owned: MetaOwned = {};
  for (const node of META_NODES) {
    const level = Math.max(levelsOf(local.owned, node), levelsOf(cloud.owned, node));
    if (level > 0) owned[node.id] = level;
  }
  return { scrap: Math.max(local.scrap, cloud.scrap, 0), owned };
}

/** Values that describe one record, not a total across many events. */
export const HIGH_WATER_STATS = [
  'bestWave',
  'bestStreak',
  'bestResearchLevel',
  'biggestFactory',
] as const satisfies readonly StatKey[];

/**
 * These are totals, but still merge by max. Summing would be lossless only if
 * every increment had a stable event id; snapshots do not, so a second sync of
 * the same run would count it twice. Max deliberately favours replay safety
 * over preserving two devices' concurrent unsynced increments.
 */
export const CUMULATIVE_STATS = [
  'kills',
  'killsArmored',
  'killsSwift',
  'killsBoss',
  'wavesCleared',
  'upgradesBought',
  'maxedTowers',
  'moneyEarned',
  'multiKills',
  'skewers',
  'tunnelsBuilt',
  'researchTaken',
  'sold',
  'rebuilds',
  'beltsBuilt',
  'flawlessWaves',
  'patchesDrained',
  'surveysBought',
  'starvedTowers',
] as const satisfies readonly StatKey[];

export function mergeStats(local: Stats, cloud: Stats): Stats {
  const merged = emptyStats();
  for (const stat of HIGH_WATER_STATS) merged[stat] = Math.max(local[stat], cloud[stat]);
  for (const stat of CUMULATIVE_STATS) merged[stat] = Math.max(local[stat], cloud[stat]);
  return merged;
}

/** Missing cloud is not an empty profile: offline must leave local untouched. */
export function mergeLifetimeProgress(local: LifetimeProgress, cloud: LifetimeProgress | null): LifetimeProgress {
  if (cloud === null) return local;
  return {
    v: 1,
    workshop: mergeWorkshop(local.workshop, cloud.workshop),
    stats: mergeStats(local.stats, cloud.stats),
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function counter(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

/**
 * Cloud JSON is hostile input, just like a run save. Known negative or
 * fractional values reject the document; unknown node ids are ignored; known
 * levels are capped by the tree so a hand-edited profile cannot overstack.
 * Missing stat keys read as zero so adding a future counter does not invalidate
 * every v1 document already stored.
 */
export function validateLifetimeProgress(value: unknown): LifetimeProgress | null {
  const root = record(value);
  const workshop = record(root?.workshop);
  const rawOwned = record(workshop?.owned);
  const rawStats = record(root?.stats);
  if (root?.v !== 1 || !workshop || !rawOwned || !rawStats || !counter(workshop.scrap)) return null;

  const owned: MetaOwned = {};
  for (const node of META_NODES) {
    const raw = rawOwned[node.id];
    if (raw === undefined) continue;
    if (!counter(raw)) return null;
    const level = Math.min(raw, node.max);
    if (level > 0) owned[node.id] = level;
  }

  const stats = emptyStats();
  for (const stat of [...HIGH_WATER_STATS, ...CUMULATIVE_STATS]) {
    const raw = rawStats[stat];
    if (raw === undefined) continue;
    if (!counter(raw)) return null;
    stats[stat] = raw;
  }

  return { v: 1, workshop: { scrap: workshop.scrap, owned }, stats };
}
