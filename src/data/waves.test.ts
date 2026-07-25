import { describe, expect, it } from 'vitest';
import {
  baseBounty,
  baseHp,
  earlySendBonus,
  EARLY_GROWTH,
  EARLY_SEND_WINDOW,
  HP_TAPER_AT,
  LATE_GROWTH,
  resistMult,
  waveClearBonus,
  waveDef,
  WaveKind,
} from './waves';

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
  it('normal hp follows 25 * 1.22^(n-1) up to the taper', () => {
    expect(waveDef(1).hp).toBe(25);
    expect(waveDef(7).hp).toBe(Math.round(25 * Math.pow(1.22, 6)));
    // the early ramp is the whole first act — it must not have moved
    for (const n of [1, 2, 4, 7, 11, 13, 17]) {
      expect(baseHp(n), `wave ${n}`).toBe(Math.round(25 * Math.pow(EARLY_GROWTH, n - 1)));
    }
  });

  it('eases to the late growth rate past the taper, and never faster', () => {
    // the ratio *into* wave T+1 is still the early rate; T+2 is the first tapered step
    expect(baseHp(HP_TAPER_AT + 1) / baseHp(HP_TAPER_AT)).toBeCloseTo(EARLY_GROWTH, 2);
    expect(baseHp(HP_TAPER_AT + 2) / baseHp(HP_TAPER_AT + 1)).toBeCloseTo(LATE_GROWTH, 2);
    for (let n = HP_TAPER_AT + 1; n < 45; n++) {
      const g = baseHp(n + 1) / baseHp(n);
      expect(g, `growth at wave ${n}`).toBeLessThan(EARLY_GROWTH);
      expect(g).toBeGreaterThan(1); // still always harder than the wave before
    }
  });

  it('keeps the mid-game where it was — the taper is a late-game fix', () => {
    // wave 20 must stay within a whisker of the original 25 * 1.22^19 curve
    expect(baseHp(20) / (25 * Math.pow(1.22, 19))).toBeGreaterThan(0.85);
  });

  it('pays a bounty that tracks HP once the flat rate stops covering the ammo', () => {
    // early waves keep the original flat rate...
    for (const n of [1, 5, 10]) expect(baseBounty(n)).toBe(5 + n);
    // ...and past that, money per point of enemy HP stops collapsing
    const perHp = (n: number) => baseBounty(n) / baseHp(n);
    expect(perHp(30)).toBeGreaterThan(perHp(20) * 0.9);
    expect(perHp(40)).toBeGreaterThan(perHp(30) * 0.9);
  });

  it('scales income fast enough to keep buying against the HP curve', () => {
    // the failure this replaces: threat grew ~12x per 10 waves, income ~3x
    const income = (n: number) => waveDef(n).count * waveDef(n).bounty + waveClearBonus(n);
    const threat = (n: number) => waveDef(n).count * waveDef(n).hp;
    expect(income(30) / income(20)).toBeGreaterThan((threat(30) / threat(20)) * 0.7);
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
    expect(boss.hp).toBe(baseHp(5) * 5);
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

  it('piercing rounds punch straight through armor — the crystal line pays off', () => {
    expect(resistMult('armored', 'piercing')).toBe(1);
  });

  it('everything else takes full damage', () => {
    for (const kind of ['normal', 'swift', 'boss'] as const) {
      for (const ammo of ['ammo', 'shell', 'piercing'] as const) {
        expect(resistMult(kind, ammo)).toBe(1);
      }
    }
  });
});

describe('earlySendBonus', () => {
  it('pays most for an instant send and decays to nothing across the window', () => {
    expect(earlySendBonus(5, 0)).toBeGreaterThan(0);
    expect(earlySendBonus(5, EARLY_SEND_WINDOW / 2)).toBeLessThan(earlySendBonus(5, 0));
    expect(earlySendBonus(5, EARLY_SEND_WINDOW)).toBe(0);
    expect(earlySendBonus(5, EARLY_SEND_WINDOW * 10)).toBe(0);
  });

  it('never decreases as the build clock runs — the bonus only ever shrinks', () => {
    let prev = Infinity;
    for (let s = 0; s <= EARLY_SEND_WINDOW + 5; s += 1) {
      const b = earlySendBonus(12, s);
      expect(b).toBeLessThanOrEqual(prev);
      expect(b).toBeGreaterThanOrEqual(0);
      prev = b;
    }
  });

  it('stays a bonus, never a substitute for clearing the wave', () => {
    for (const n of [1, 5, 20, 50]) {
      expect(earlySendBonus(n, 0)).toBeLessThan(waveClearBonus(n));
    }
  });

  it('scales with wave number so late rushes stay worth it', () => {
    expect(earlySendBonus(20, 0)).toBeGreaterThan(earlySendBonus(2, 0));
  });

  it('treats a negative clock (clock reset races) as an instant send, never as a penalty', () => {
    expect(earlySendBonus(5, -3)).toBe(earlySendBonus(5, 0));
  });
});

describe('waveClearBonus', () => {
  it('stays near the original flat curve for the opening waves', () => {
    expect(waveClearBonus(1)).toBeGreaterThanOrEqual(35);
    expect(waveClearBonus(1)).toBeLessThanOrEqual(45);
    expect(waveClearBonus(5)).toBeGreaterThanOrEqual(70);
    expect(waveClearBonus(5)).toBeLessThanOrEqual(95);
  });

  it('grows with the wave it rewards, so a late clear is still worth something', () => {
    for (let n = 1; n < 40; n++) {
      expect(waveClearBonus(n + 1), `wave ${n}`).toBeGreaterThan(waveClearBonus(n));
    }
    // by the late game the bonus has to be a real fraction of a wave's cost
    expect(waveClearBonus(30)).toBeGreaterThan(waveClearBonus(10) * 5);
  });
});
