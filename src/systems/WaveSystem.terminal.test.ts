import { beforeEach, describe, expect, it } from 'vitest';
import { pathPx } from '../data/map';
import { GameState } from '../state/GameState';
import { makeScene, MockSprite, makeSprite } from '../test/helpers';
import { Enemy } from '../types';
import { WaveSystem } from './WaveSystem';

function makeEnemy(overrides: Partial<Enemy> = {}): Enemy {
  const path = pathPx();
  const end = path[path.length - 1];
  return {
    kind: 'normal',
    x: end.x,
    y: end.y,
    hp: 100,
    maxHp: 100,
    speed: 60,
    slow: 0,
    slowFactor: 1,
    flash: 0,
    flashTint: 0,
    tinted: 0,
    wp: path.length - 1,
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

describe('WaveSystem terminal transitions', () => {
  let wave: WaveSystem;

  beforeEach(() => {
    GameState.reset();
    const scene = makeScene() as unknown as Record<string, unknown>;
    scene.shake = () => undefined;
    scene.flash = () => undefined;
    wave = new WaveSystem(scene as never);
  });

  it('stops processing later enemies after a lethal leak', () => {
    GameState.lives = 1;
    wave.start();
    const first = makeEnemy();
    const second = makeEnemy();
    wave.enemies.push(first, second);

    wave.update(0.01);

    expect(GameState.gameOver).toBe(true);
    expect(GameState.tally.leaked).toBe(1);
    expect(second.dead).toBe(false);
    expect((second.sprite as unknown as MockSprite).destroyed).toBe(false);
  });
});
