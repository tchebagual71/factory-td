import { describe, expect, it } from 'vitest';
import { START_LIVES, waveClearBonus, waveComposition, waveHpMultiplier } from '../src/core/config';
import { damageEnemy } from '../src/core/systems/combat';
import { step, richGame } from './helpers';

describe('wave composition', () => {
  it('grows with wave number', () => {
    expect(waveComposition(5).length).toBeGreaterThan(waveComposition(1).length);
  });

  it('introduces fast enemies at wave 3 and tanks at wave 5', () => {
    expect(waveComposition(2).some((s) => s.kind === 'fast')).toBe(false);
    expect(waveComposition(3).some((s) => s.kind === 'fast')).toBe(true);
    expect(waveComposition(4).some((s) => s.kind === 'tank')).toBe(false);
    expect(waveComposition(5).some((s) => s.kind === 'tank')).toBe(true);
  });

  it('sends a boss every 8th wave', () => {
    expect(waveComposition(8).some((s) => s.kind === 'boss')).toBe(true);
    expect(waveComposition(9).some((s) => s.kind === 'boss')).toBe(false);
  });

  it('scales enemy hp with wave number', () => {
    expect(waveHpMultiplier(1)).toBe(1);
    expect(waveHpMultiplier(10)).toBeGreaterThan(2);
  });
});

describe('wave lifecycle', () => {
  it('spawns enemies after the wave starts', () => {
    const game = richGame();
    expect(game.startWave()).toBe(true);
    expect(game.phase).toBe('combat');
    step(game, 1);
    expect(game.enemies.length).toBeGreaterThan(0);
  });

  it('cannot start a wave during combat', () => {
    const game = richGame();
    game.startWave();
    expect(game.startWave()).toBe(false);
    expect(game.wave).toBe(1);
  });

  it('returns to build phase with a bonus once the wave is cleared', () => {
    const game = richGame();
    game.startWave();
    const before = game.money;

    // Slaughter everything as it spawns until the queue drains.
    for (let i = 0; i < 60 * 40 && game.phase === 'combat'; i++) {
      step(game, 1 / 60);
      for (const e of [...game.enemies]) damageEnemy(game, e, e.hp);
    }

    expect(game.phase).toBe('build');
    expect(game.money).toBeGreaterThanOrEqual(before + waveClearBonus(1));
  });

  it('leaked enemies cost lives', () => {
    const game = richGame();
    game.startWave();
    step(game, 10); // 12-tile path, grunts at 60 px/s leak in ~6.4s
    expect(game.lives).toBeLessThan(START_LIVES);
  });

  it('reaching zero lives ends the game', () => {
    const game = richGame();
    game.lives = 1;
    game.startWave();
    step(game, 15);
    expect(game.phase).toBe('gameover');
  });
});
