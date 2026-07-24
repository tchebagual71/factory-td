/**
 * Achievement definitions + pure unlock logic. Lifetime stats are tracked in
 * `state/progress.ts`; this module stays pure (no Phaser, no storage) so it
 * runs under vitest. IDs must match the DB CHECK `^[a-z0-9_]{1,40}$` — they
 * sync to Supabase when the player is signed in.
 */

export type StatKey =
  | 'kills'
  | 'killsArmored'
  | 'killsSwift'
  | 'killsBoss'
  | 'wavesCleared'
  | 'bestWave'
  | 'upgradesBought'
  | 'maxedTowers'
  | 'moneyEarned'
  | 'multiKills'
  | 'tunnelsBuilt';

export type Stats = Record<StatKey, number>;

export function emptyStats(): Stats {
  return {
    kills: 0,
    killsArmored: 0,
    killsSwift: 0,
    killsBoss: 0,
    wavesCleared: 0,
    bestWave: 0,
    upgradesBought: 0,
    maxedTowers: 0,
    moneyEarned: 0,
    multiKills: 0,
    tunnelsBuilt: 0,
  };
}

/** Persistent perk granted by an achievement. Badges are cosmetic. */
export interface UnlockEffect {
  kind: 'startMoney' | 'badge';
  amount?: number;
  label: string;
}

export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  stat: StatKey;
  goal: number;
  unlock?: UnlockEffect;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_blood', name: 'First Blood', desc: 'Destroy your first enemy', stat: 'kills', goal: 1 },
  { id: 'exterminator', name: 'Exterminator', desc: 'Destroy 500 enemies', stat: 'kills', goal: 500 },
  { id: 'boss_slayer', name: 'Boss Slayer', desc: 'Take down a boss', stat: 'killsBoss', goal: 1 },
  {
    id: 'boss_collector', name: 'Boss Collector', desc: 'Take down 10 bosses', stat: 'killsBoss', goal: 10,
    unlock: { kind: 'startMoney', amount: 50, label: '+$50 starting money' },
  },
  { id: 'armor_cracker', name: 'Armor Cracker', desc: 'Destroy 100 armored enemies', stat: 'killsArmored', goal: 100 },
  { id: 'swift_justice', name: 'Swift Justice', desc: 'Destroy 150 swift enemies', stat: 'killsSwift', goal: 150 },
  {
    id: 'wave_10', name: 'Getting Started', desc: 'Reach wave 10', stat: 'bestWave', goal: 10,
    unlock: { kind: 'startMoney', amount: 25, label: '+$25 starting money' },
  },
  {
    id: 'wave_20', name: 'Line Holder', desc: 'Reach wave 20', stat: 'bestWave', goal: 20,
    unlock: { kind: 'startMoney', amount: 25, label: '+$25 starting money' },
  },
  {
    id: 'wave_30', name: 'Factory Veteran', desc: 'Reach wave 30', stat: 'bestWave', goal: 30,
    unlock: { kind: 'badge', label: 'Veteran badge' },
  },
  { id: 'gearhead', name: 'Gearhead', desc: 'Buy 10 tower upgrades', stat: 'upgradesBought', goal: 10 },
  {
    id: 'specialist', name: 'Specialist', desc: 'Fully upgrade a tower to Mk4', stat: 'maxedTowers', goal: 1,
    unlock: { kind: 'badge', label: 'Specialist badge' },
  },
  { id: 'multi_master', name: 'Cluster Bomber', desc: 'Land 25 multi-kills (3+ with one shell)', stat: 'multiKills', goal: 25 },
  { id: 'tunnel_rat', name: 'Tunnel Rat', desc: 'Build 10 tunnels', stat: 'tunnelsBuilt', goal: 10 },
  { id: 'tycoon', name: 'Tycoon', desc: 'Earn $10,000 across all runs', stat: 'moneyEarned', goal: 10000 },
];

/** Achievements newly satisfied by `stats` that are not already in `prev`. Pure. */
export function newlyUnlocked(prev: ReadonlySet<string>, stats: Stats): AchievementDef[] {
  return ACHIEVEMENTS.filter((a) => !prev.has(a.id) && stats[a.stat] >= a.goal);
}

/** Total starting-money bonus from unlocked achievements (applied at run start from Batch 4 on). */
export function startMoneyBonus(unlocked: ReadonlySet<string>): number {
  let sum = 0;
  for (const a of ACHIEVEMENTS) {
    if (a.unlock?.kind === 'startMoney' && unlocked.has(a.id)) sum += a.unlock.amount ?? 0;
  }
  return sum;
}
