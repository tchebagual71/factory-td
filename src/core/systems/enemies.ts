import { ENEMY_DEFS, waveHpMultiplier } from '../config';
import type { Game } from '../game';
import { pointAlongPath } from '../map';
import type { Enemy, EnemyKind } from '../types';

let nextEnemyId = 1;

export function spawnEnemy(game: Game, kind: EnemyKind): Enemy {
  const def = ENEMY_DEFS[kind];
  const hp = Math.round(def.hp * waveHpMultiplier(game.wave));
  const e: Enemy = {
    id: nextEnemyId++,
    kind,
    hp,
    maxHp: hp,
    speed: def.speed,
    reward: def.reward,
    damage: def.damage,
    radius: def.radius,
    dist: 0,
  };
  game.enemies.push(e);
  return e;
}

export function enemyPos(game: Game, e: Enemy): { x: number; y: number } {
  return pointAlongPath(game.path, e.dist);
}

/** March enemies along the path; those reaching the end leak and cost lives. */
export function updateEnemies(game: Game, dt: number): void {
  const end = game.path.totalLength;
  for (let i = game.enemies.length - 1; i >= 0; i--) {
    const e = game.enemies[i];
    e.dist += e.speed * dt;
    if (e.dist >= end) {
      game.enemies.splice(i, 1);
      game.lives -= e.damage;
      game.say(`${ENEMY_DEFS[e.kind].kind} leaked! -${e.damage} lives`);
    }
  }
}
