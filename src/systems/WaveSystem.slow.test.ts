import { beforeEach, describe, expect, it } from 'vitest';
import { effStats } from '../data/buildings';
import { GameState } from '../state/GameState';
import { makeScene, makeSprite } from '../test/helpers';
import { Enemy } from '../types';
import { WaveSystem } from './WaveSystem';

/**
 * Coolant slow rules. The cryo tower's whole value is that overlapping fields
 * cooperate and a weak pulse can never undo a strong one.
 */
let wave: WaveSystem;

function makeEnemy(overrides: Partial<Enemy> = {}): Enemy {
  return {
    kind: 'normal',
    x: 0,
    y: 0,
    hp: 100,
    maxHp: 100,
    speed: 60,
    slow: 0,
    slowFactor: 1,
    wp: 0,
    traveled: 0,
    bounty: 5,
    leak: 1,
    dead: false,
    sprite: makeSprite() as unknown as Enemy['sprite'],
    hpBar: makeSprite() as unknown as Enemy['hpBar'],
    hpBarW: 22,
    hpBarY: 16,
    ...overrides,
  };
}

beforeEach(() => {
  GameState.reset();
  wave = new WaveSystem(makeScene() as never);
});

describe('chill', () => {
  it('applies the slow and its duration to a fresh enemy', () => {
    const e = makeEnemy();
    wave.chill(e, 0.55, 2.5);
    expect(e.slowFactor).toBe(0.55);
    expect(e.slow).toBe(2.5);
  });

  it('lets a deeper slow override a shallower one', () => {
    const e = makeEnemy();
    wave.chill(e, 0.8, 2);
    wave.chill(e, 0.4, 2);
    expect(e.slowFactor).toBe(0.4);
  });

  it('never lets a weak pulse undo a strong one already running', () => {
    const e = makeEnemy();
    wave.chill(e, 0.3, 3);
    wave.chill(e, 0.9, 3);
    expect(e.slowFactor).toBe(0.3);
  });

  it('refreshes the timer with the longer of the two durations', () => {
    const e = makeEnemy();
    wave.chill(e, 0.5, 4);
    wave.chill(e, 0.5, 2); // equal depth, shorter — must not cut the freeze short
    expect(e.slow).toBe(4);
  });

  it('re-chills a lapsed enemy at whatever the new pulse offers', () => {
    const e = makeEnemy({ slow: 0, slowFactor: 1 });
    wave.chill(e, 0.9, 1);
    expect(e.slowFactor).toBe(0.9);
  });
});

describe('cryo stats feed the slow', () => {
  it('an upgraded cryo field slows harder and longer than a fresh one', () => {
    const base = effStats('cryo', 1);
    const maxed = effStats('cryo', 4, 'cryostasis');
    const e1 = makeEnemy();
    const e2 = makeEnemy();

    wave.chill(e1, base.slowFactor, base.slowDur);
    wave.chill(e2, maxed.slowFactor, maxed.slowDur);

    expect(e2.slowFactor).toBeLessThan(e1.slowFactor);
    expect(e2.slow).toBeGreaterThan(e1.slow);
    expect(e2.slowFactor).toBeGreaterThan(0); // still walking, never frozen solid
  });
});
