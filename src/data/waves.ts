export type WaveKind = 'normal' | 'swift' | 'boss';

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
 * Wave rhythm: every 5th is a boss wave (few, slow, tanky, 5-life leaks),
 * every 3rd otherwise is a swift wave (fast, fragile, numerous).
 */
export function waveDef(n: number): WaveDef {
  const baseHp = Math.round(25 * Math.pow(1.22, n - 1));
  const baseCount = 4 + 2 * n;
  if (n % 5 === 0) {
    return {
      kind: 'boss',
      count: Math.max(2, Math.floor(baseCount / 3)),
      hp: baseHp * 5,
      speed: Math.min(90, 38 + n),
      interval: 1.8,
      bounty: (5 + n) * 5,
      leak: 5,
    };
  }
  if (n % 3 === 0) {
    return {
      kind: 'swift',
      count: Math.round(baseCount * 1.4),
      hp: Math.max(8, Math.round(baseHp * 0.55)),
      speed: Math.min(175, 78 + 2.5 * n),
      interval: Math.max(0.25, 0.55 - 0.015 * n),
      bounty: Math.max(3, Math.floor((5 + n) * 0.6)),
      leak: 1,
    };
  }
  return {
    kind: 'normal',
    count: baseCount,
    hp: baseHp,
    speed: Math.min(130, 52 + 2 * n),
    interval: Math.max(0.35, 0.95 - 0.02 * n),
    bounty: 5 + n,
    leak: 1,
  };
}

export const WAVE_KIND_LABEL: Record<WaveKind, string> = {
  normal: 'raider',
  swift: 'SWIFT',
  boss: 'BOSS',
};

export function waveClearBonus(n: number): number {
  return 30 + 10 * n;
}
