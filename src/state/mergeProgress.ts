/**
 * Pure conflict-resolution rules for local ↔ cloud sync. No I/O here —
 * `services/cloud.ts` applies these decisions. Strategy: run saves are
 * last-write-wins on timestamp, achievements are a set union (an unlock is
 * never lost), best wave is a max.
 */

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
