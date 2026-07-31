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
  | 'skewers'
  | 'tunnelsBuilt'
  /** research cards taken across all runs */
  | 'researchTaken'
  // ---- added with the Workshop batch ----
  /** longest kill streak ever reached (high-water) */
  | 'bestStreak'
  /** buildings sold */
  | 'sold'
  /** sold a building and rebuilt the same type on the same tile — the "wait, no" move */
  | 'rebuilds'
  /** belts placed */
  | 'beltsBuilt'
  /** waves cleared without a single leak */
  | 'flawlessWaves'
  /** resource tiles mined until they reverted to grass */
  | 'patchesDrained'
  /** surveys commissioned */
  | 'surveysBought'
  /** highest research level reached in a run (high-water) */
  | 'bestResearchLevel'
  /** towers that ran dry mid-wave — a badge of dishonour, and a real teaching moment */
  | 'starvedTowers'
  /** buildings standing at once (high-water) */
  | 'biggestFactory';

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
    skewers: 0,
    tunnelsBuilt: 0,
    researchTaken: 0,
    bestStreak: 0,
    sold: 0,
    rebuilds: 0,
    beltsBuilt: 0,
    flawlessWaves: 0,
    patchesDrained: 0,
    surveysBought: 0,
    bestResearchLevel: 0,
    starvedTowers: 0,
    biggestFactory: 0,
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
  { id: 'shish_kebab', name: 'Shish Kebab', desc: 'Skewer 3+ enemies with a single lance, 15 times', stat: 'skewers', goal: 15 },
  { id: 'tunnel_rat', name: 'Tunnel Rat', desc: 'Build 10 tunnels', stat: 'tunnelsBuilt', goal: 10 },
  { id: 'tycoon', name: 'Tycoon', desc: 'Earn $10,000 across all runs', stat: 'moneyEarned', goal: 10000 },

  // ---------------------------------------------------------------------
  // The Workshop batch. These reward *playing like a factory engineer* —
  // rebuilding, scaling, running clean — rather than just accumulating kills,
  // which is what the original fifteen all measured. Perks stay modest: the
  // combined start-money ceiling is pinned by `metaTree.test.ts`.
  // ---------------------------------------------------------------------

  // -- the streak ladder (data/combo.ts) --
  { id: 'on_a_roll', name: 'On A Roll', desc: 'Reach a 10-kill streak', stat: 'bestStreak', goal: 10 },
  { id: 'assembly_line', name: 'Assembly Line', desc: 'Reach a 25-kill streak', stat: 'bestStreak', goal: 25 },
  {
    id: 'mass_production', name: 'Mass Production', desc: 'Reach a 50-kill streak', stat: 'bestStreak', goal: 50,
    unlock: { kind: 'badge', label: 'Streak badge' },
  },

  // -- the fun ones --
  {
    id: 'measure_twice', name: 'Measure Twice', desc: 'Sell a building and rebuild the same thing on the same tile',
    stat: 'rebuilds', goal: 1,
  },
  { id: 'second_guesser', name: 'Second Guesser', desc: 'Do it 25 more times. We all do it', stat: 'rebuilds', goal: 26 },
  { id: 'demolition', name: 'Demolition Day', desc: 'Sell 100 buildings', stat: 'sold', goal: 100 },
  { id: 'spaghetti', name: 'Spaghetti Junction', desc: 'Lay 500 belts', stat: 'beltsBuilt', goal: 500 },
  {
    id: 'not_a_drop', name: 'Not A Drop', desc: 'Clear 10 waves without leaking a single enemy',
    stat: 'flawlessWaves', goal: 10,
    // A badge, not money: the Workshop's Seed Capital is now where starting
    // money is bought, and two systems quietly granting the same thing is
    // exactly how a difficulty curve erodes. The $100 achievement cap holds.
    unlock: { kind: 'badge', label: 'Flawless badge' },
  },
  { id: 'strip_mine', name: 'Strip Mine', desc: 'Mine 10 deposits completely dry', stat: 'patchesDrained', goal: 10 },
  { id: 'wildcatter', name: 'Wildcatter', desc: 'Commission 15 surveys', stat: 'surveysBought', goal: 15 },
  { id: 'white_coats', name: 'White Coats', desc: 'Reach research level 10 in one run', stat: 'bestResearchLevel', goal: 10 },
  { id: 'sprawl', name: 'Urban Sprawl', desc: 'Have 120 buildings standing at once', stat: 'biggestFactory', goal: 120 },
  {
    id: 'logistics_problem', name: 'A Logistics Problem', desc: 'Let 50 towers run dry mid-wave. The factory is the bottleneck',
    stat: 'starvedTowers', goal: 50,
  },
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
