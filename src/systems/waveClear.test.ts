import { beforeEach, describe, expect, it } from 'vitest';
import { waveClearBonus } from '../data/waves';
import { GameState } from '../state/GameState';
import { makeScene } from '../test/helpers';
import { WaveSystem } from './WaveSystem';

/**
 * The wave-clear payoff.
 *
 * The banner now *counts* the bonus up rather than printing it complete (see
 * `GameScene.bigCount`), which introduces a way for the game to lie: the number
 * on screen is rendered from an argument, so it could drift from the number
 * actually banked. This pins them together at the real call site.
 *
 * It also exists because the previous suite never drove a wave to completion —
 * `makeScene` had no `bigCount` at all and every test still passed, which meant
 * the clear path was uncovered.
 */
describe('wave clear payoff', () => {
  let scene: { bigCountCalls: [string, number][] };
  let wave: WaveSystem;

  beforeEach(() => {
    GameState.reset();
    const s = makeScene();
    scene = s as unknown as typeof scene;
    wave = new WaveSystem(s as never);
  });

  /** Drive a whole wave: send it, kill everything that spawns, let it settle. */
  const clearOneWave = (): number => {
    const before = GameState.money;
    wave.start();
    for (let i = 0; i < 4000 && GameState.phase === 'wave'; i++) {
      wave.update(0.05);
      for (const e of wave.enemies) if (!e.dead) wave.hit(e, 1e9);
      wave.update(0.05);
    }
    return GameState.money - before;
  };

  it('actually reaches wave completion (the path was previously untested)', () => {
    clearOneWave();
    expect(GameState.phase).toBe('build');
    expect(scene.bigCountCalls.length).toBeGreaterThan(0);
  });

  it('counts up exactly what it banked', () => {
    clearOneWave();
    const [, shown] = scene.bigCountCalls[scene.bigCountCalls.length - 1];
    // Bounties are also paid during the wave, so compare the banner against the
    // clear bonus itself rather than the whole delta.
    expect(shown).toBe(Math.round(waveClearBonus(1) * GameState.mods.clearCash));
    expect(Number.isInteger(shown)).toBe(true);
    expect(shown).toBeGreaterThan(0);
  });

  it('names the wave it just cleared', () => {
    clearOneWave();
    const [prefix] = scene.bigCountCalls[scene.bigCountCalls.length - 1];
    expect(prefix).toContain('WAVE 1');
    expect(prefix).toContain('CLEAR');
    // the amount is the counter's job, so the prefix must not also carry one
    expect(prefix).not.toMatch(/\$\d/);
  });
});
