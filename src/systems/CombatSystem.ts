import Phaser from 'phaser';
import { TILE } from '../config';
import { effStats, isTower, TOWERS, TowerStats } from '../data/buildings';
import { GameState } from '../state/GameState';
import { progress } from '../state/progress';
import { Enemy } from '../types';
import { sfx } from '../utils/sfx';
import { GridSystem } from './GridSystem';
import { WaveSystem } from './WaveSystem';
import type { GameScene } from '../scenes/GameScene';

interface Bullet {
  sprite: Phaser.GameObjects.Image;
  target: Enemy;
  stats: TowerStats;
}

/** Tower targeting + projectiles. Towers only fire while they have ammo. */
export class CombatSystem {
  private bullets: Bullet[] = [];

  constructor(
    private scene: GameScene,
    private grid: GridSystem,
    private wave: WaveSystem,
  ) {}

  update(dt: number): void {
    for (const b of this.grid.buildings) {
      if (!isTower(b.type)) continue;
      const stats = effStats(b.type, b.mk, b.path);
      const cx = b.x * TILE + TILE / 2;
      const cy = b.y * TILE + TILE / 2;

      b.cooldown -= dt;
      if (b.ammoBar) b.ammoBar.scaleX = b.ammo / TOWERS[b.type].ammoCap;
      const starved = b.ammo <= 0;
      if (starved) {
        b.sprite.setTint(0x8a8a8a);
        b.barrel?.setTint(0x8a8a8a);
      } else {
        b.sprite.clearTint();
        b.barrel?.clearTint();
      }
      if (b.cooldown > 0 || starved) continue;

      // Target the enemy furthest along the path within range
      let best: Enemy | null = null;
      let bestTraveled = -1;
      for (const e of this.wave.enemies) {
        if (e.dead) continue;
        const d = Phaser.Math.Distance.Between(cx, cy, e.x, e.y);
        if (d <= stats.range && e.traveled > bestTraveled) {
          best = e;
          bestTraveled = e.traveled;
        }
      }
      if (!best) continue;

      b.ammo -= 1;
      b.cooldown = 1 / stats.fireRate;
      const angle = Math.atan2(best.y - cy, best.x - cx);
      b.barrel?.setRotation(angle);
      const sprite = this.scene.add
        .image(cx + Math.cos(angle) * 14, cy + Math.sin(angle) * 14, stats.splash > 0 ? 'cannonball' : 'bullet')
        .setRotation(angle)
        .setDepth(7);
      this.bullets.push({ sprite, target: best, stats });
      this.scene.tweens.add({ targets: b.sprite, scale: 1.08, duration: 50, yoyo: true });
      sfx.shoot();
    }

    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const bl = this.bullets[i];
      const t = bl.target;
      const dx = t.x - bl.sprite.x;
      const dy = t.y - bl.sprite.y;
      const d = Math.hypot(dx, dy);
      const step = bl.stats.bulletSpeed * dt;
      if (d <= Math.max(step, 10)) {
        this.impact(bl, t.x, t.y);
        bl.sprite.destroy();
        this.bullets.splice(i, 1);
      } else {
        bl.sprite.x += (dx / d) * step;
        bl.sprite.y += (dy / d) * step;
        bl.sprite.setRotation(Math.atan2(dy, dx));
      }
    }
  }

  private impact(bl: Bullet, ix: number, iy: number): void {
    const { stats, target } = bl;
    if (stats.splash === 0) {
      if (!target.dead) this.wave.hit(target, stats.damage, stats.ammoType);
      this.scene.burst(ix, iy, 0xffe066, 4);
      return;
    }

    // Splash: full damage to the direct target, 60% to everything else in radius
    let kills = 0;
    for (const e of [...this.wave.enemies]) {
      if (e.dead) continue;
      const d = Phaser.Math.Distance.Between(ix, iy, e.x, e.y);
      if (d > stats.splash) continue;
      const dmg = e === target ? stats.damage : Math.round(stats.damage * 0.6);
      if (this.wave.hit(e, dmg, stats.ammoType)) kills += 1;
    }
    this.scene.burst(ix, iy, 0xff9f43, 22);
    this.scene.cameras.main.shake(90, 0.003);
    if (kills >= 3) {
      const bonus = kills * 3;
      GameState.addMoney(bonus);
      progress.record('multiKills');
      this.scene.floatText(ix, iy - 24, `MULTI ×${kills}  +$${bonus}`, '#ff9f43');
    }
  }
}
