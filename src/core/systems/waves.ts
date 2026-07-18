import { waveClearBonus, waveComposition } from '../config';
import type { Game } from '../game';
import { spawnEnemy } from './enemies';

/**
 * While in combat: release due spawns, and when the queue is drained and the
 * field is clear, pay the wave bonus and return to the build phase.
 */
export function updateWaves(game: Game, dt: number): void {
  if (game.waveTimer === 0 && game.spawnQueue.length === 0 && game.enemies.length === 0) {
    game.spawnQueue = waveComposition(game.wave);
    game.say(`Wave ${game.wave} incoming!`);
  }
  game.waveTimer += dt;

  while (game.spawnQueue.length > 0 && game.spawnQueue[0].at <= game.waveTimer) {
    spawnEnemy(game, game.spawnQueue.shift()!.kind);
  }

  if (game.spawnQueue.length === 0 && game.enemies.length === 0) {
    const bonus = waveClearBonus(game.wave);
    game.money += bonus;
    game.phase = 'build';
    game.waveTimer = 0;
    game.say(`Wave ${game.wave} cleared! +$${bonus}`);
  }
}
