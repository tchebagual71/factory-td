import { beforeEach, describe, expect, it } from 'vitest';
import { effStats } from '../data/buildings';
import { GameState } from '../state/GameState';
import { makeScene, MockSprite, makeSprite } from '../test/helpers';
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
    flash: 0,
    flashTint: 0,
    tinted: 0,
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

/**
 * The hit flash is the "wrong ammo" tell — a resisted hit flashes steel instead
 * of white. It used to be a `delayedCall` per landed bullet; the update loop now
 * owns the sprite's colour and resolves flash-over-frost-over-nothing in one
 * decision per frame.
 */
describe('hit flash', () => {
  const spriteOf = (e: Enemy) => e.sprite as unknown as MockSprite;

  function liveEnemy(overrides: Partial<Enemy> = {}): Enemy {
    const e = makeEnemy({ hp: 10000, maxHp: 10000, ...overrides });
    wave.start(); // gives the system a wave definition so update() runs
    wave.enemies.push(e);
    return e;
  }

  it('flashes white on a clean hit and clears itself without a timer', () => {
    const e = liveEnemy();
    wave.hit(e, 5);
    wave.update(0.01);
    expect(spriteOf(e).tint).toBe(0xffffff);
    expect(spriteOf(e).tintFill).toBe(true);

    wave.update(0.2); // well past the flash
    expect(spriteOf(e).tint).toBeNull();
  });

  it('flashes steel-gray when the round is resisted', () => {
    const e = liveEnemy({ kind: 'armored' });
    wave.hit(e, 5, 'ammo'); // bullets bounce off armour
    wave.update(0.01);
    expect(spriteOf(e).tint).not.toBe(0xffffff);
    expect(spriteOf(e).tintFill).toBe(true);
  });

  it('does not flash steel when the ammo actually counters the armour', () => {
    const e = liveEnemy({ kind: 'armored' });
    wave.hit(e, 5, 'shell');
    wave.update(0.01);
    expect(spriteOf(e).tint).toBe(0xffffff);
  });

  it('shows the flash over a frost tint, then falls back to frost', () => {
    const e = liveEnemy();
    wave.chill(e, 0.5, 5);
    wave.update(0.01);
    const frost = spriteOf(e).tint;
    expect(frost).not.toBeNull();
    expect(spriteOf(e).tintFill).toBe(false);

    wave.hit(e, 5);
    wave.update(0.01);
    expect(spriteOf(e).tintFill, 'a hit on a chilled enemy must still read as a hit').toBe(true);

    wave.update(0.2);
    expect(spriteOf(e).tint, 'and the frost comes back once the flash lapses').toBe(frost);
    expect(spriteOf(e).tintFill).toBe(false);
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
