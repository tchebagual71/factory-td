import { ItemType } from '../types';

export type WaveKind = 'normal' | 'swift' | 'armored' | 'boss';

export interface WaveSquad {
  kind: WaveKind;
  count: number;
  spacing: number; // seconds between members of this squad
  hp: number;
  speed: number;
  bounty: number;
  leak: number;
  /** Boss escorts are budgeted at their shielded durability, not their raw HP. */
  shieldedByBoss: boolean;
}

export interface WaveDef {
  kind: WaveKind;
  count: number;
  hp: number;
  speed: number;
  interval: number; // seconds between spawns
  bounty: number; // money per kill
  leak: number; // lives lost per leaked enemy
  squads: WaveSquad[];
}

/** Five uniform waves teach the counter table before compositions start asking for two answers at once. */
export const MIXED_WAVES_FROM = 6;

/** A quarter-wave secondary is large enough to demand an answer without erasing the wave's headline identity. */
export const MIXED_SECONDARY_SHARE = 0.25;

/** The shield reaches a little over three tiles, enough to cover a packed squad without protecting the whole lane. */
export const BOSS_SHIELD_RADIUS = 104;

/** A 25% reduction is immediately legible but leaves focused fire useful against an escorted target. */
export const BOSS_SHIELD_DAMAGE_MULT = 0.75;

/** Four seconds lets coolant buy meaningful time while preventing one pulse from pinning a boss indefinitely. */
export const BOSS_SLOW_PURGE_SECONDS = 4;

/** One boss carries ten escort-sized threat shares, keeping the fifth-wave beat centered on a single landmark enemy. */
const BOSS_THREAT_WEIGHT = 10;

/**
 * HP growth. The first {@link HP_TAPER_AT} waves compound at the original
 * 1.22 — that ramp is the whole early-game arc and is deliberately untouched —
 * and after that the curve eases to {@link LATE_GROWTH}.
 *
 * The taper exists because tower damage does not compound forever: the upgrade
 * tree stops at Mk4, so past that point the only way to add DPS is to add
 * production, which is bounded by ore throughput and by how many tiles the map
 * has. Against unbounded 1.22 growth that ceiling was hit around wave 20 and
 * every wave after it was arithmetically unwinnable.
 */
export const HP_TAPER_AT = 18;
export const EARLY_GROWTH = 1.22;
export const LATE_GROWTH = 1.12;

export function baseHp(n: number): number {
  return Math.round(
    25 * Math.pow(EARLY_GROWTH, Math.min(n - 1, HP_TAPER_AT)) * Math.pow(LATE_GROWTH, Math.max(0, n - 1 - HP_TAPER_AT)),
  );
}

/**
 * Kill bounty. Early waves keep the original flat `5 + n`; once enemies get
 * meaty enough that the flat rate stops paying for the ammo spent on them
 * (around wave 13) the bounty tracks HP instead.
 *
 * Without this, income was linear against exponential HP: money per point of
 * enemy HP collapsed ~40x between wave 5 and wave 30, so the factory could
 * never be scaled up to meet what was coming. Money is deliberately generous
 * late — the intended late-game constraint is ore throughput and tile space,
 * not the wallet.
 */
export const BOUNTY_PER_HP = 0.075;

export function baseBounty(n: number): number {
  return Math.max(5 + n, Math.round(baseHp(n) * BOUNTY_PER_HP));
}

/**
 * Wave rhythm: every 5th is a boss wave (few, slow, tanky, 5-life leaks),
 * every 3rd otherwise is a swift wave (fast, fragile, numerous), and from
 * wave 6 the remaining even waves are armored (resist bullets, not shells).
 */
function uniformWaveDef(n: number): Omit<WaveDef, 'squads'> {
  const hp = baseHp(n);
  const bounty = baseBounty(n);
  const baseCount = 4 + 2 * n;
  if (n % 5 === 0) {
    return {
      kind: 'boss',
      count: Math.max(2, Math.floor(baseCount / 3)),
      hp: hp * 5,
      speed: speedFor(n, 'boss'),
      interval: spacingFor(n, 'boss'),
      bounty: bounty * 5,
      leak: 5,
    };
  }
  if (n % 3 === 0) {
    return {
      kind: 'swift',
      count: Math.round(baseCount * 1.4),
      hp: Math.max(8, Math.round(hp * 0.55)),
      speed: speedFor(n, 'swift'),
      interval: spacingFor(n, 'swift'),
      bounty: Math.max(3, Math.floor(bounty * 0.6)),
      leak: 1,
    };
  }
  if (n >= 6 && n % 2 === 0) {
    return {
      kind: 'armored',
      count: Math.max(4, Math.round(baseCount * 0.8)),
      hp: Math.round(hp * 1.35),
      speed: speedFor(n, 'armored'),
      interval: spacingFor(n, 'armored'),
      bounty: Math.round(bounty * 1.5),
      leak: 2,
    };
  }
  return {
    kind: 'normal',
    count: baseCount,
    hp,
    speed: speedFor(n, 'normal'),
    interval: spacingFor(n, 'normal'),
    bounty,
    leak: 1,
  };
}

function speedFor(n: number, kind: WaveKind): number {
  const normal = Math.min(130, 52 + 2 * n);
  if (kind === 'swift') return Math.min(175, 78 + 2.5 * n);
  if (kind === 'armored') return Math.min(110, Math.round(normal * 0.85));
  if (kind === 'boss') return Math.min(90, 38 + n);
  return normal;
}

function spacingFor(n: number, kind: WaveKind): number {
  if (kind === 'swift') return Math.max(0.25, 0.55 - 0.015 * n);
  if (kind === 'armored') return Math.max(0.5, 1.1 - 0.02 * n);
  if (kind === 'boss') return 1.8;
  return Math.max(0.35, 0.95 - 0.02 * n);
}

function leakFor(kind: WaveKind): number {
  if (kind === 'boss') return 5;
  if (kind === 'armored') return 2;
  return 1;
}

/** Reuse the shipped kind HP ratios so a mixed squad still reads as fragile, ordinary, or tanky. */
function threatWeight(kind: WaveKind): number {
  if (kind === 'swift') return 0.55;
  if (kind === 'armored') return 1.35;
  if (kind === 'boss') return BOSS_THREAT_WEIGHT;
  return 1;
}

function secondaryKind(n: number, primary: WaveKind): WaveKind {
  if (primary === 'boss') return n % 10 === 0 ? 'swift' : 'armored';
  if (primary === 'swift') return n >= 12 && n % 2 === 0 ? 'armored' : 'normal';
  if (primary === 'armored') return n % 4 === 0 ? 'swift' : 'normal';
  return n % 4 === 1 ? 'armored' : 'swift';
}

function squadsFor(n: number, def: Omit<WaveDef, 'squads'>): WaveSquad[] {
  if (n < MIXED_WAVES_FROM || def.count < 2) {
    return [{ ...def, spacing: def.interval, shieldedByBoss: false }];
  }

  const secondary = secondaryKind(n, def.kind);
  const secondaryCount =
    def.kind === 'boss' ? def.count - 1 : Math.max(1, Math.round(def.count * MIXED_SECONDARY_SHARE));
  const primaryCount = def.count - secondaryCount;
  const parts = [{ kind: def.kind, count: primaryCount }, { kind: secondary, count: secondaryCount }];
  const weightedCount = parts.reduce((sum, part) => sum + part.count * threatWeight(part.kind), 0);
  const hpPerWeight = (def.count * def.hp) / weightedCount;

  return parts.map((part) => {
    const shieldedByBoss = def.kind === 'boss' && part.kind !== 'boss';
    return {
      kind: part.kind,
      count: part.count,
      spacing: spacingFor(n, part.kind),
      // Shielded escorts pay for the aura out of raw HP. While inside it their
      // effective durability is exactly the threat share allocated here; once
      // they outrun the boss they become deliberately easier, never harder.
      hp: hpPerWeight * threatWeight(part.kind) * (shieldedByBoss ? BOSS_SHIELD_DAMAGE_MULT : 1),
      speed: speedFor(n, part.kind),
      bounty: def.bounty,
      leak: leakFor(part.kind),
      shieldedByBoss,
    };
  });
}

/**
 * Wave rhythm still chooses the headline kind and its old count/HP budget.
 * Squads only redistribute that budget, so callers which model the established
 * curve through the top-level fields continue to read the exact same numbers.
 */
export function waveDef(n: number): WaveDef {
  const def = uniformWaveDef(n);
  return { ...def, squads: squadsFor(n, def) };
}

/** Effective HP after accounting for the boss aura already paid for by escort HP. */
export function waveThreat(def: WaveDef): number {
  return def.squads.reduce(
    (total, squad) => total + (squad.count * squad.hp) / (squad.shieldedByBoss ? BOSS_SHIELD_DAMAGE_MULT : 1),
    0,
  );
}

/** Nearby bosses protect escorts, but never one another; multiple auras do not stack. */
export function bossShieldMult(targetKind: WaveKind, nearestBossDistance: number | null): number {
  if (targetKind === 'boss' || nearestBossDistance === null || nearestBossDistance > BOSS_SHIELD_RADIUS) return 1;
  return BOSS_SHIELD_DAMAGE_MULT;
}

/** Bosses purge an active coolant slow on each four-second mechanic beat. */
export function bossPurgesSlow(kind: WaveKind, slowSeconds: number, secondsSincePurge: number): boolean {
  return kind === 'boss' && slowSeconds > 0 && secondsSincePurge >= BOSS_SLOW_PURGE_SECONDS;
}

export const WAVE_KIND_LABEL: Record<WaveKind, string> = {
  normal: 'raider',
  swift: 'SWIFT',
  armored: 'ARMORED',
  boss: 'BOSS',
};

/**
 * Damage multiplier for a hit of `source` ammo against an enemy kind.
 * Armor stops bullets; shells and piercing rounds go through it.
 */
export function resistMult(kind: WaveKind, source: ItemType): number {
  if (kind === 'armored' && source === 'ammo') return 0.25;
  return 1;
}

/**
 * Clear bonus. The flat part matches the original curve for the first handful
 * of waves; the HP-linked part is what keeps the reward — and the early-send
 * bonus derived from it — meaningful once a single wave costs thousands of
 * rounds to answer.
 */
export function waveClearBonus(n: number): number {
  return Math.round(20 + 6 * n + baseHp(n) * 0.5);
}

/** Build-phase seconds after which sending early pays nothing extra. */
export const EARLY_SEND_WINDOW = 25;

/**
 * Cash for sending the next wave before the factory has idled. Full value at
 * an instant send, decaying linearly to zero across the window — the "one more
 * wave" lever: bank the bonus now or spend the time expanding production.
 */
export function earlySendBonus(n: number, secondsWaited: number): number {
  const left = Math.max(0, 1 - Math.max(0, secondsWaited) / EARLY_SEND_WINDOW);
  return Math.round(waveClearBonus(n) * 0.5 * left);
}
