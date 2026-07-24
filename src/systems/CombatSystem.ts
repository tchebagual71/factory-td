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

/** Homing round: flies at one enemy and resolves on contact (guns, cannons). */
interface HomingBullet {
  kind: 'homing';
  sprite: Phaser.GameObjects.Image;
  target: Enemy;
  stats: TowerStats;
}

/**
 * Lance: locks its heading at fire time and keeps flying, skewering every
 * enemy it passes through until it has spent its pierce budget or run out of
 * range. On a single-file path a well-aimed lance takes the whole column.
 */
interface LanceBullet {
  kind: 'lance';
  sprite: Phaser.GameObjects.Image;
  stats: TowerStats;
  vx: number;
  vy: number;
  /** px still to travel before the lance dissipates */
  left: number;
  hitsLeft: number;
  hit: Set<Enemy>;
  kills: number;
}

type Bullet = HomingBullet | LanceBullet;

/** How close a lance must pass to an enemy to skewer it. */
const LANCE_HIT_RADIUS = 14;

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
      const texture = stats.pierce > 0 ? 'lance' : stats.splash > 0 ? 'cannonball' : 'bullet';
      const sprite = this.scene.add
        .image(cx + Math.cos(angle) * 14, cy + Math.sin(angle) * 14, texture)
        .setRotation(angle)
        .setDepth(7);
      if (stats.pierce > 0) {
        this.bullets.push({
          kind: 'lance',
          sprite,
          stats,
          vx: Math.cos(angle),
          vy: Math.sin(angle),
          left: stats.range * 1.6, // overshoot the target so it keeps skewering down the line
          hitsLeft: stats.pierce,
          hit: new Set(),
          kills: 0,
        });
      } else {
        this.bullets.push({ kind: 'homing', sprite, target: best, stats });
      }
      this.scene.tweens.add({ targets: b.sprite, scale: 1.08, duration: 50, yoyo: true });
      sfx.shoot();
    }

    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const bl = this.bullets[i];
      const step = bl.stats.bulletSpeed * dt;
      const spent = bl.kind === 'lance' ? this.advanceLance(bl, step) : this.advanceHoming(bl, step);
      if (spent) {
        bl.sprite.destroy();
        this.bullets.splice(i, 1);
      }
    }
  }

  /** Returns true once the round is spent and should be removed. */
  private advanceHoming(bl: HomingBullet, step: number): boolean {
    const t = bl.target;
    const dx = t.x - bl.sprite.x;
    const dy = t.y - bl.sprite.y;
    const d = Math.hypot(dx, dy);
    if (d <= Math.max(step, 10)) {
      this.impact(bl, t.x, t.y);
      return true;
    }
    bl.sprite.x += (dx / d) * step;
    bl.sprite.y += (dy / d) * step;
    bl.sprite.setRotation(Math.atan2(dy, dx));
    return false;
  }

  private advanceLance(bl: LanceBullet, step: number): boolean {
    const travel = Math.min(step, bl.left);
    const x0 = bl.sprite.x;
    const y0 = bl.sprite.y;
    bl.sprite.x += bl.vx * travel;
    bl.sprite.y += bl.vy * travel;
    bl.left -= travel;

    // Swept test against the whole segment flown this tick — at ×3 speed a lance
    // covers >100px per frame and would otherwise skip straight past enemies.
    // Nearest-first so a limited pierce budget is spent on the front of the column.
    const struck: { e: Enemy; along: number }[] = [];
    for (const e of this.wave.enemies) {
      if (e.dead || bl.hit.has(e)) continue;
      const along = travel > 0 ? Phaser.Math.Clamp(((e.x - x0) * bl.vx + (e.y - y0) * bl.vy) / travel, 0, 1) : 0;
      const px = x0 + bl.vx * travel * along;
      const py = y0 + bl.vy * travel * along;
      if (Phaser.Math.Distance.Between(px, py, e.x, e.y) <= LANCE_HIT_RADIUS) struck.push({ e, along });
    }
    struck.sort((a, b) => a.along - b.along);
    for (const { e } of struck) {
      bl.hit.add(e);
      bl.hitsLeft -= 1;
      if (this.wave.hit(e, bl.stats.damage, bl.stats.ammoType)) bl.kills += 1;
      this.scene.burst(e.x, e.y, 0x6bd4ff, 5);
      if (bl.hitsLeft <= 0) break;
    }

    if (bl.hitsLeft > 0 && bl.left > 0) return false;
    if (bl.kills >= 3) {
      const bonus = bl.kills * 3;
      GameState.addMoney(bonus);
      progress.record('skewers');
      this.scene.floatText(bl.sprite.x, bl.sprite.y - 24, `SKEWER ×${bl.kills}  +$${bonus}`, '#6bd4ff');
      this.scene.cameras.main.shake(70, 0.002);
    }
    return true;
  }

  private impact(bl: HomingBullet, ix: number, iy: number): void {
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
