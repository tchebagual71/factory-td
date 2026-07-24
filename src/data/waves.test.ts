import { describe, expect, it } from 'vitest';
import { resistMult, waveClearBonus, waveDef, WaveKind } from './waves';

describe('waveDef rhythm', () => {
  it('follows boss > swift > armored precedence for waves 1-20', () => {
    const expected: WaveKind[] = [
      'normal', 'normal', 'swift', 'normal', 'boss',
      'swift', 'normal', 'armored', 'swift', 'boss',
      'normal', 'swift', 'normal', 'armored', 'boss',
      'armored', 'normal', 'swift', 'normal', 'boss',
    ];
    expect(expected.map((_, i) => waveDef(i + 1).kind)).toEqual(expected);
  });

  it('never produces armored before wave 6', () => {
    for (let n = 1; n <= 5; n++) expect(waveDef(n).kind).not.toBe('armored');
  });
});

describe('waveDef scaling', () => {
  it('normal hp follows 25 * 1.22^(n-1)', () => {
    expect(waveDef(1).hp).toBe(25);
    expect(waveDef(7).hp).toBe(Math.round(25 * Math.pow(1.22, 6)));
  });

  it('normal count is 4 + 2n', () => {
    expect(waveDef(1).count).toBe(6);
    expect(waveDef(11).count).toBe(26);
  });

  it('hp grows monotonically across consecutive normal waves', () => {
    // 1, 2 then 7, 11, 13 etc are normal; compare pairs of normal waves
    const normals = [1, 2, 4, 7, 11, 13, 17, 19].map((n) => waveDef(n).hp);
    for (let i = 1; i < normals.length; i++) expect(normals[i]).toBeGreaterThan(normals[i - 1]);
  });

  it('boss waves are few, tanky, and cost 5 lives per leak', () => {
    const boss = waveDef(5);
    const baseHp = Math.round(25 * Math.pow(1.22, 4));
    expect(boss.hp).toBe(baseHp * 5);
    expect(boss.count).toBe(Math.max(2, Math.floor((4 + 2 * 5) / 3)));
    expect(boss.leak).toBe(5);
  });

  it('swift waves are faster and more fragile than same-wave normals would be', () => {
    const swift = waveDef(6);
    const normalSpeed = Math.min(130, 52 + 2 * 6);
    expect(swift.kind).toBe('swift');
    expect(swift.speed).toBeGreaterThan(normalSpeed);
    expect(swift.hp).toBeLessThan(Math.round(25 * Math.pow(1.22, 5)));
  });

  it('armored waves cost 2 lives per leak', () => {
    expect(waveDef(8).leak).toBe(2);
  });

  it('respects speed caps and interval floors deep into the run', () => {
    for (const n of [40, 41, 42, 43, 44, 45]) {
      const w = waveDef(n);
      expect(w.speed).toBeLessThanOrEqual(175);
      expect(w.interval).toBeGreaterThanOrEqual(0.25);
      expect(w.count).toBeGreaterThan(0);
      expect(w.bounty).toBeGreaterThan(0);
    }
  });
});

describe('resistMult', () => {
  it('armored enemies take quarter damage from bullets only', () => {
    expect(resistMult('armored', 'ammo')).toBe(0.25);
    expect(resistMult('armored', 'shell')).toBe(1);
  });

  it('everything else takes full damage', () => {
    for (const kind of ['normal', 'swift', 'boss'] as const) {
      expect(resistMult(kind, 'ammo')).toBe(1);
      expect(resistMult(kind, 'shell')).toBe(1);
    }
  });
});

describe('waveClearBonus', () => {
  it('scales linearly with wave number', () => {
    expect(waveClearBonus(1)).toBe(40);
    expect(waveClearBonus(10)).toBe(130);
  });
});
