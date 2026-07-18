import { describe, expect, it } from 'vitest';
import { BUILDING_DEFS, SIM_DT } from '../src/core/config';
import { damageEnemy, updateTurrets } from '../src/core/systems/combat';
import { spawnEnemy } from '../src/core/systems/enemies';
import { richGame } from './helpers';

describe('combat', () => {
  it('turret shoots the enemy furthest along the path within range', () => {
    const game = richGame();
    game.wave = 1;
    game.placeBuilding('turret', 2, 1, 0); // path runs along y=0
    const behind = spawnEnemy(game, 'grunt');
    const ahead = spawnEnemy(game, 'grunt');
    behind.dist = 40;
    ahead.dist = 80;

    updateTurrets(game, SIM_DT);
    expect(ahead.hp).toBe(ahead.maxHp - BUILDING_DEFS.turret.turret!.damage);
    expect(behind.hp).toBe(behind.maxHp);
  });

  it('firing consumes shots and reloads from the ammo buffer', () => {
    const game = richGame();
    game.wave = 1;
    const turret = game.placeBuilding('turret', 2, 1, 0)!;
    turret.shots = 1;
    turret.input.ammo = 1;
    spawnEnemy(game, 'grunt').dist = 64;

    updateTurrets(game, SIM_DT); // fires the loaded shot
    expect(turret.shots).toBe(0);

    turret.cooldown = 0;
    updateTurrets(game, SIM_DT); // reloads from buffer, then fires
    expect(turret.input.ammo).toBe(0);
    expect(turret.shots).toBe(BUILDING_DEFS.turret.turret!.shotsPerItem - 1);
  });

  it('does not fire without ammo', () => {
    const game = richGame();
    game.wave = 1;
    const turret = game.placeBuilding('turret', 2, 1, 0)!;
    turret.shots = 0;
    const e = spawnEnemy(game, 'grunt');
    e.dist = 64;

    updateTurrets(game, SIM_DT);
    expect(e.hp).toBe(e.maxHp);
  });

  it('does not fire at enemies out of range', () => {
    const game = richGame();
    game.wave = 1;
    const turret = game.placeBuilding('turret', 2, 5, 0)!; // ~4.5 tiles from path
    const e = spawnEnemy(game, 'grunt');
    e.dist = 64;

    updateTurrets(game, SIM_DT);
    expect(e.hp).toBe(e.maxHp);
    expect(turret.shots).toBe(15);
  });

  it('cannon splash hits clustered enemies', () => {
    const game = richGame();
    game.wave = 1;
    game.placeBuilding('cannon', 2, 1, 0);
    const a = spawnEnemy(game, 'grunt');
    const b = spawnEnemy(game, 'grunt');
    a.dist = 70;
    b.dist = 80; // ~10px apart, well within splash

    updateTurrets(game, SIM_DT);
    const dmg = BUILDING_DEFS.cannon.turret!.damage;
    expect(a.hp).toBe(a.maxHp - dmg);
    expect(b.hp).toBe(b.maxHp - dmg);
  });

  it('killing an enemy pays its reward and removes it', () => {
    const game = richGame();
    game.wave = 1;
    const e = spawnEnemy(game, 'grunt');
    const before = game.money;
    damageEnemy(game, e, e.hp);

    expect(game.enemies).toHaveLength(0);
    expect(game.money).toBe(before + e.reward);
  });
});
