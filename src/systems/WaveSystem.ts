import { pathPx } from '../data/map';
import { earlySendBonus, resistMult, waveClearBonus, waveDef, WaveDef } from '../data/waves';
import { cloneTally, emptyTally, GameState } from '../state/GameState';
import { progress } from '../state/progress';
import { Enemy, ItemType } from '../types';
import { sfx } from '../utils/sfx';
import type { GameScene } from '../scenes/GameScene';

/**
 * Frost overlay on a chilled enemy. Deliberately near-white rather than a
 * saturated blue — swift enemies are teal, and the two must never be confused
 * at a glance.
 */
const FROST_TINT = 0xe8f6ff;

/** Spawns waves, walks enemies along the fixed path, handles kills and leaks. */
export class WaveSystem {
  enemies: Enemy[] = [];
  /** the active map's route in pixels, snapshotted at construction (hot loop — don't rebuild per frame) */
  private path = pathPx();
  private def: WaveDef | null = null;
  private toSpawn = 0;
  private spawnTimer = 0;

  constructor(private scene: GameScene) {}

  start(): void {
    if (GameState.phase !== 'build' || GameState.gameOver || GameState.frozen) return;
    this.def = waveDef(GameState.wave);
    this.toSpawn = this.def.count;
    this.spawnTimer = 0;
    // Bank the early-send bonus before setPhase resets the build clock
    const early = earlySendBonus(GameState.wave, GameState.buildElapsed);
    GameState.tally = emptyTally();
    GameState.setPhase('wave');
    const suffix = this.def.kind === 'normal' ? '' : ` — ${this.def.kind.toUpperCase()}`;
    this.scene.bigText(`WAVE ${GameState.wave}${suffix}`);
    if (early > 0) {
      GameState.addMoney(early);
      progress.record('moneyEarned', early);
      this.scene.floatText(640, 300, `EARLY SEND  +$${early}`, '#5ef078');
    }
    sfx.waveStart();
  }

  update(dt: number): void {
    if (GameState.phase === 'build') {
      GameState.buildElapsed += dt;
      return;
    }
    if (GameState.phase !== 'wave' || !this.def) return;

    if (this.toSpawn > 0) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawn(this.def);
        this.toSpawn -= 1;
        this.spawnTimer = this.def.interval;
      }
    }

    for (const e of this.enemies) {
      if (e.dead) continue;
      if (e.slow > 0) {
        e.slow -= dt;
        // frosted tint, reapplied each frame because hit() flashes over it
        if (e.slow > 0) e.sprite.setTint(FROST_TINT);
        else {
          e.slowFactor = 1;
          e.sprite.clearTint();
        }
      }
      const fromX = e.x;
      const fromY = e.y;
      this.move(e, dt);
      e.sprite.setPosition(e.x, e.y);
      // Face the way it is walking. Sprites are drawn nose-East, so this is the
      // raw heading; a stationary frame keeps the previous angle.
      if (e.x !== fromX || e.y !== fromY) e.sprite.setRotation(Math.atan2(e.y - fromY, e.x - fromX));
      e.hpBar.setPosition(e.x - e.hpBarW / 2, e.y - e.hpBarY);
      e.hpBar.scaleX = Math.max(0, e.hp / e.maxHp);
      e.hpBar.fillColor = e.hp / e.maxHp > 0.5 ? 0x5ef078 : e.hp / e.maxHp > 0.25 ? 0xffd75e : 0xff5555;
    }
    this.enemies = this.enemies.filter((e) => !e.dead);

    if (this.toSpawn === 0 && this.enemies.length === 0 && !GameState.gameOver) {
      this.completeWave();
    }
  }

  /** Apply damage (scaled by kind resistances); handles death, bounty, and juice. Returns true on kill. */
  hit(e: Enemy, dmg: number, source: ItemType = 'ammo'): boolean {
    if (e.dead) return false;
    const mult = resistMult(e.kind, source);
    e.hp -= Math.max(1, Math.round(dmg * mult));
    sfx.hit();
    // resisted hits flash steel-gray instead of white — the "wrong ammo" tell
    e.sprite.setTintFill(mult < 1 ? 0x7a8494 : 0xffffff);
    this.scene.time.delayedCall(45, () => {
      if (!e.dead) e.sprite.clearTint();
    });
    if (e.hp <= 0) {
      this.kill(e);
      return true;
    }
    return false;
  }

  private kill(e: Enemy): void {
    e.dead = true;
    GameState.addMoney(e.bounty);
    GameState.tally.kills += 1;
    progress.record('kills');
    if (e.kind === 'armored') progress.record('killsArmored');
    else if (e.kind === 'swift') progress.record('killsSwift');
    else if (e.kind === 'boss') progress.record('killsBoss');
    progress.record('moneyEarned', e.bounty);
    this.scene.floatText(e.x, e.y - 10, `+$${e.bounty}`, '#ffe066');
    this.scene.burst(e.x, e.y, 0xff5555, e.leak > 1 ? 26 : 12);
    if (e.leak > 1) this.scene.cameras.main.shake(150, 0.005);
    sfx.coin();
    e.sprite.destroy();
    e.hpBar.destroy();
  }

  private leak(e: Enemy): void {
    e.dead = true;
    GameState.tally.leaked += 1;
    GameState.loseLives(e.leak);
    this.scene.floatText(e.x - 20, e.y, `-${e.leak}♥`, '#ff5555');
    this.scene.cameras.main.shake(180, 0.006);
    this.scene.cameras.main.flash(150, 120, 20, 20);
    sfx.leak();
    e.sprite.destroy();
    e.hpBar.destroy();
  }

  /**
   * Chill an enemy. A weaker slow never overwrites a stronger one; equal or
   * deeper slows refresh the timer — overlapping cryo fields cooperate.
   */
  chill(e: Enemy, factor: number, duration: number): void {
    if (e.slow > 0 && factor > e.slowFactor) return;
    e.slowFactor = factor;
    e.slow = Math.max(e.slow, duration);
  }

  private move(e: Enemy, dt: number): void {
    let remaining = e.speed * (e.slow > 0 ? e.slowFactor : 1) * dt;
    while (remaining > 0 && !e.dead) {
      const target = this.path[e.wp + 1];
      if (!target) {
        this.leak(e);
        return;
      }
      const dx = target.x - e.x;
      const dy = target.y - e.y;
      const d = Math.hypot(dx, dy);
      if (d <= remaining) {
        e.x = target.x;
        e.y = target.y;
        e.traveled += d;
        e.wp += 1;
        remaining -= d;
        if (e.wp >= this.path.length - 1) {
          this.leak(e);
          return;
        }
      } else {
        e.x += (dx / d) * remaining;
        e.y += (dy / d) * remaining;
        e.traveled += remaining;
        remaining = 0;
      }
    }
  }

  private spawn(def: WaveDef): void {
    const p = this.path[0];
    const texture =
      def.kind === 'boss' ? 'boss' : def.kind === 'swift' ? 'swift' : def.kind === 'armored' ? 'armored' : 'enemy';
    const barW = def.kind === 'boss' ? 28 : def.kind === 'swift' ? 16 : 22;
    const barY = def.kind === 'boss' ? 21 : 16;
    const sprite = this.scene.add.image(p.x, p.y, texture).setDepth(5);
    const hpBar = this.scene.add.rectangle(p.x - barW / 2, p.y - barY, barW, 3, 0x5ef078).setOrigin(0, 0.5).setDepth(6);
    this.enemies.push({
      kind: def.kind,
      x: p.x,
      y: p.y,
      hp: def.hp,
      maxHp: def.hp,
      speed: def.speed,
      slow: 0,
      slowFactor: 1,
      wp: 0,
      traveled: 0,
      bounty: def.bounty,
      leak: def.leak,
      dead: false,
      sprite,
      hpBar,
      hpBarW: barW,
      hpBarY: barY,
    });
  }

  private completeWave(): void {
    const bonus = Math.round(waveClearBonus(GameState.wave) * GameState.mods.clearCash);
    GameState.addMoney(bonus);
    this.scene.bigText(`WAVE ${GameState.wave} CLEAR  +$${bonus}`);
    sfx.waveClear();
    progress.record('wavesCleared');
    progress.record('moneyEarned', bonus);
    // Card first, so it reports the wave that just ended, not the next one
    GameState.events.emit('wavesummary', GameState.wave, cloneTally(GameState.tally));
    GameState.nextWave();
    progress.recordMax('bestWave', GameState.wave);
    GameState.setPhase('build');
    this.def = null;
    if (GameState.auto) {
      this.scene.time.delayedCall(2200, () => {
        if (GameState.auto && !GameState.gameOver) this.start();
      });
    }
  }
}
