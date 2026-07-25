import { ItemType } from '../types';

export type WaveKind = 'normal' | 'swift' | 'armored' | 'boss';

export interface WaveDef {
  kind: WaveKind;
  count: number;
  hp: number;
  speed: number;
  interval: number; // seconds between spawns
  bounty: number; // money per kill
  leak: number; // lives lost per leaked enemy
}

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
export function waveDef(n: number): WaveDef {
  const hp = baseHp(n);
  const bounty = baseBounty(n);
  const baseCount = 4 + 2 * n;
  if (n % 5 === 0) {
    return {
      kind: 'boss',
      count: Math.max(2, Math.floor(baseCount / 3)),
      hp: hp * 5,
      speed: Math.min(90, 38 + n),
      interval: 1.8,
      bounty: bounty * 5,
      leak: 5,
    };
  }
  if (n % 3 === 0) {
    return {
      kind: 'swift',
      count: Math.round(baseCount * 1.4),
      hp: Math.max(8, Math.round(hp * 0.55)),
      speed: Math.min(175, 78 + 2.5 * n),
      interval: Math.max(0.25, 0.55 - 0.015 * n),
      bounty: Math.max(3, Math.floor(bounty * 0.6)),
      leak: 1,
    };
  }
  if (n >= 6 && n % 2 === 0) {
    return {
      kind: 'armored',
      count: Math.max(4, Math.round(baseCount * 0.8)),
      hp: Math.round(hp * 1.35),
      speed: Math.min(110, Math.round((52 + 2 * n) * 0.85)),
      interval: Math.max(0.5, 1.1 - 0.02 * n),
      bounty: Math.round(bounty * 1.5),
      leak: 2,
    };
  }
  return {
    kind: 'normal',
    count: baseCount,
    hp,
    speed: Math.min(130, 52 + 2 * n),
    interval: Math.max(0.35, 0.95 - 0.02 * n),
    bounty,
    leak: 1,
  };
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
