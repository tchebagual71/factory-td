import { breakCombo, comboColor, comboMilestone, comboNow, comboPitch, comboTier, registerKill } from '../data/combo';
import { pathPx } from '../data/map';
import {
  bossPurgesSlow,
  BOSS_SHIELD_RADIUS,
  BOSS_SLOW_PURGE_SECONDS,
  bossShieldMult,
  earlySendBonus,
  resistMult,
  waveClearBonus,
  waveDef,
  WaveDef,
  WaveSquad,
} from '../data/waves';
import { cloneTally, emptyTally, GameState } from '../state/GameState';
import { progress } from '../state/progress';
import { Enemy, ItemType } from '../types';
import { HAPTIC, haptic } from '../utils/feel';
import { sfx } from '../utils/sfx';
import type { GameScene } from '../scenes/GameScene';

/**
 * Frost overlay on a chilled enemy. Deliberately near-white rather than a
 * saturated blue — swift enemies are teal, and the two must never be confused
 * at a glance.
 */
const FROST_TINT = 0xe8f6ff;

/** How long a hit flash stays on an enemy. Game seconds, so it shortens at ×3 like everything else. */
const FLASH_SECONDS = 0.05;

/**
 * Ceiling on spawns drained in a single tick. dt is already clamped to 50ms, and
 * the tightest interval in `waves.ts` is far above that, so this never binds in
 * normal play — it exists so a pathological frame cannot dump a whole wave at
 * the entrance at once.
 */
const MAX_SPAWNS_PER_TICK = 4;

/** Spawns waves, walks enemies along the fixed path, handles kills and leaks. */
export class WaveSystem {
  enemies: Enemy[] = [];
  /** the active map's route in pixels, snapshotted at construction (hot loop — don't rebuild per frame) */
  private path = pathPx();
  private def: WaveDef | null = null;
  private toSpawn = 0;
  private spawnTimer = 0;
  private squadIndex = 0;
  private squadSpawned = 0;
  /** something died this frame, so the enemy list needs compacting */
  private reap = false;
  /**
   * Live bosses, resolved once per tick instead of once per hit.
   *
   * `hit()` needs the nearest boss to apply the escort shield, and it is one of
   * the hottest paths in the game — a lance resolves several hits in a single
   * tick against a column. Scanning the whole enemy list inside it made damage
   * resolution O(enemies²) per frame on exactly the waves that are already the
   * heaviest, undoing the frame-cost pass in roadmap item 26. Bosses are few, so
   * this list stays short.
   */
  private bosses: Enemy[] = [];
  /**
   * Enemy count at the last rebuild. Deriving staleness from the roster itself
   * rather than from a flag callers must remember to set: a flag was silently
   * wrong for anything that touched `enemies` outside the spawn path, which is
   * a trap for tests and for any future caller.
   */
  private bossesAt = -1;

  constructor(private scene: GameScene) {}

  start(): void {
    if (GameState.phase !== 'build' || GameState.gameOver || GameState.frozen) return;
    this.def = waveDef(GameState.wave);
    this.toSpawn = this.def.count;
    this.spawnTimer = 0;
    this.squadIndex = 0;
    this.squadSpawned = 0;
    // Bank the early-send bonus before setPhase resets the build clock
    const early = earlySendBonus(GameState.wave, GameState.buildElapsed);
    GameState.tally = emptyTally();
    GameState.tally.magStart = this.scene.magazineTotal();
    GameState.setPhase('wave');
    const composition = this.def.squads.map((squad) => squad.kind.toUpperCase()).join(' + ');
    const mechanics = this.def.kind === 'boss' ? ' · SHIELD · PURGE' : '';
    this.scene.bigText(`WAVE ${GameState.wave} — ${composition}${mechanics}`);
    if (early > 0) {
      GameState.addMoney(early);
      progress.record('moneyEarned', early);
      this.scene.floatText(640, 300, `EARLY SEND  +$${early}`, '#5ef078');
    }
    // Where they are actually coming in, for a player whose view is parked on
    // the far end of the factory. No-ops when the entrance is already on screen.
    const entry = pathPx()[0];
    if (entry) this.scene.edgeAlert(entry.x, entry.y, 'WAVE IN', '#ffe066');
    sfx.waveStart();
    if (this.def.kind === 'boss') haptic(HAPTIC.boss);
  }

  update(dt: number): void {
    if (GameState.phase === 'build') {
      GameState.buildElapsed += dt;
      return;
    }
    if (GameState.phase !== 'wave' || !this.def) return;

    if (this.toSpawn > 0) {
      // Carry the overshoot (`+= interval`, never `= interval`) and drain more
      // than one spawn in a tick when the frame was long. Assigning the interval
      // quantised spawning to render frames: at ×3 speed dt approaches the 50ms
      // clamp, so a phone and a desktop produced measurably different waves.
      this.spawnTimer -= dt;
      let guard = MAX_SPAWNS_PER_TICK;
      while (this.toSpawn > 0 && this.spawnTimer <= 0 && guard-- > 0) {
        const squad = this.def.squads[this.squadIndex];
        if (!squad) {
          this.toSpawn = 0;
          break;
        }
        this.spawn(squad);
        this.toSpawn -= 1;
        this.spawnTimer += squad.spacing;
        this.squadSpawned += 1;
        if (this.squadSpawned >= squad.count) {
          this.squadIndex += 1;
          this.squadSpawned = 0;
        }
      }
      // Hit the guard on a pathological frame: drop the backlog rather than
      // banking debt that would burst-spawn on every subsequent tick.
      if (this.spawnTimer < 0) this.spawnTimer = 0;
    }

    for (const e of this.enemies) {
      if (e.dead) continue;
      if (e.kind === 'boss') {
        e.bossPurge = (e.bossPurge ?? 0) + dt;
        if (e.bossPurge >= BOSS_SLOW_PURGE_SECONDS) {
          const purged = bossPurgesSlow(e.kind, e.slow, e.bossPurge);
          e.bossPurge %= BOSS_SLOW_PURGE_SECONDS;
          if (purged) {
            e.slow = 0;
            e.slowFactor = 1;
            this.scene.floatText(e.x, e.y - 28, 'SLOW PURGED', '#d7b8ff');
            this.scene.burst(e.x, e.y, 0xa879ff, 18);
          }
        }
      }
      if (e.slow > 0) {
        e.slow -= dt;
        if (e.slow <= 0) e.slowFactor = 1;
      }
      // One tint decision per frame, in priority order. The hit flash used to be
      // undone by a `delayedCall` per hit — a fresh timer object for every bullet
      // that landed — and a frosted enemy repainted over it on the very next
      // frame, so the "wrong ammo" tell barely showed on anything chilled.
      if (e.flash > 0) e.flash -= dt;
      const want = e.flash > 0 ? e.flashTint : e.slow > 0 ? FROST_TINT : 0;
      if (want !== e.tinted) {
        e.tinted = want;
        if (want === 0) e.sprite.clearTint();
        else if (want === FROST_TINT) e.sprite.setTint(FROST_TINT);
        else e.sprite.setTintFill(want);
      }
      const fromX = e.x;
      const fromY = e.y;
      this.move(e, dt);
      e.sprite.setPosition(e.x, e.y);
      e.aura?.setPosition(e.x, e.y);
      // Face the way it is walking. Sprites are drawn nose-East, so this is the
      // raw heading; a stationary frame keeps the previous angle.
      if (e.x !== fromX || e.y !== fromY) e.sprite.setRotation(Math.atan2(e.y - fromY, e.x - fromX));
      e.hpBar.setPosition(e.x - e.hpBarW / 2, e.y - e.hpBarY);
      e.hpBar.scaleX = Math.max(0, e.hp / e.maxHp);
      e.hpBar.fillColor = e.hp / e.maxHp > 0.5 ? 0x5ef078 : e.hp / e.maxHp > 0.25 ? 0xffd75e : 0xff5555;
    }
    // Only rebuild the list on a frame where something actually died — this ran
    // every frame of every wave and allocated an array each time.
    if (this.reap) {
      this.reap = false;
      this.enemies = this.enemies.filter((e) => !e.dead);
    }

    if (this.toSpawn === 0 && this.enemies.length === 0 && !GameState.gameOver) {
      this.completeWave();
    }
  }

  /**
   * Live bosses, rebuilt only when the roster size changed. Deaths within a tick
   * do not change the length until the reap, which is why the caller still skips
   * `dead` — that keeps a boss killed earlier this frame from shielding anything.
   */
  private liveBosses(): Enemy[] {
    if (this.enemies.length !== this.bossesAt) {
      this.bossesAt = this.enemies.length;
      this.bosses = this.enemies.filter((b) => b.kind === 'boss');
    }
    return this.bosses;
  }

  /** Apply damage (scaled by kind resistances); handles death, bounty, and juice. Returns true on kill. */
  hit(e: Enemy, dmg: number, source: ItemType = 'ammo'): boolean {
    if (e.dead) return false;
    let nearestBossDistance: number | null = null;
    if (e.kind !== 'boss') {
      for (const other of this.liveBosses()) {
        // A boss killed earlier in this same tick is still in the cached list;
        // it must stop shielding its escorts immediately, not next frame.
        if (other.dead) continue;
        const distance = Math.hypot(other.x - e.x, other.y - e.y);
        if (nearestBossDistance === null || distance < nearestBossDistance) nearestBossDistance = distance;
      }
    }
    const resistance = resistMult(e.kind, source);
    const shield = bossShieldMult(e.kind, nearestBossDistance);
    const mult = resistance * shield;
    e.hp -= Math.max(1, Math.round(dmg * mult));
    sfx.hit();
    // resisted hits flash steel-gray instead of white — the "wrong ammo" tell.
    // Purple means the aura absorbed part of the hit; steel-gray remains the
    // "wrong ammo" tell. The update loop owns the sprite's colour.
    e.flashTint = shield < 1 ? 0xb991ff : resistance < 1 ? 0x7a8494 : 0xffffff;
    e.flash = FLASH_SECONDS;
    if (e.hp <= 0) {
      this.kill(e);
      return true;
    }
    return false;
  }

  private kill(e: Enemy): void {
    e.dead = true;
    this.reap = true;
    GameState.addMoney(e.bounty);
    GameState.tally.kills += 1;
    GameState.runKills += 1;
    progress.record('kills');
    if (e.kind === 'armored') progress.record('killsArmored');
    else if (e.kind === 'swift') progress.record('killsSwift');
    else if (e.kind === 'boss') progress.record('killsBoss');
    progress.record('moneyEarned', e.bounty);

    // Kill streak: escalates the feedback, pays nothing. See `data/combo.ts` —
    // throughput stays the economy, this just makes a good wave *feel* good.
    const combo = registerKill(GameState.combo, comboNow());
    GameState.combo = combo;
    GameState.events.emit('combo', combo);
    const tier = comboTier(combo.count);

    this.scene.floatText(e.x, e.y - 10, `+$${e.bounty}`, tier > 0 ? comboColor(combo.count) : '#ffe066');
    this.scene.burst(e.x, e.y, 0xff5555, e.leak > 1 ? 26 : 12);
    if (e.leak > 1) this.scene.shake(150, 0.005);
    const milestone = comboMilestone(combo.count);
    if (milestone) {
      this.scene.bigText(`${combo.count}× ${milestone}`);
      this.scene.shake(120, 0.003);
    }
    sfx.coin(comboPitch(combo.count));
    e.sprite.destroy();
    e.hpBar.destroy();
    e.aura?.destroy();
  }

  private leak(e: Enemy): void {
    e.dead = true;
    this.reap = true;
    GameState.tally.leaked += 1;
    // A leak ends the streak. That is what ties the meter to the factory rather
    // than to aim: the only way to keep it alive is to keep every tower fed.
    GameState.combo = breakCombo(GameState.combo);
    GameState.events.emit('combo', GameState.combo);
    GameState.loseLives(e.leak);
    this.scene.floatText(e.x - 20, e.y, `-${e.leak}♥`, '#ff5555');
    // That float is drawn at the exit, which on a phone is often off screen —
    // leaving a silently draining lives counter as the only evidence. This
    // points at it from the edge, and no-ops when the exit is already in view.
    this.scene.edgeAlert(e.x, e.y, `LEAK -${e.leak}♥`, '#ff5555');
    this.scene.shake(180, 0.006);
    this.scene.flash(150, 120, 20, 20);
    sfx.leak();
    haptic(HAPTIC.leak);
    e.sprite.destroy();
    e.hpBar.destroy();
    e.aura?.destroy();
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

  private spawn(def: WaveSquad): void {
    const p = this.path[0];
    const texture =
      def.kind === 'boss' ? 'boss' : def.kind === 'swift' ? 'swift' : def.kind === 'armored' ? 'armored' : 'enemy';
    const barW = def.kind === 'boss' ? 28 : def.kind === 'swift' ? 16 : 22;
    const barY = def.kind === 'boss' ? 21 : 16;
    const sprite = this.scene.add.image(p.x, p.y, texture).setDepth(5);
    const hpBar = this.scene.add.rectangle(p.x - barW / 2, p.y - barY, barW, 3, 0x5ef078).setOrigin(0, 0.5).setDepth(6);
    const aura =
      def.kind === 'boss'
        ? this.scene.add
            .circle(p.x, p.y, BOSS_SHIELD_RADIUS, 0x7655cc, 0.1)
            .setStrokeStyle(2, 0xb991ff, 0.8)
            .setDepth(4)
        : undefined;
    this.enemies.push({
      kind: def.kind,
      x: p.x,
      y: p.y,
      hp: def.hp,
      maxHp: def.hp,
      speed: def.speed,
      slow: 0,
      slowFactor: 1,
      flash: 0,
      flashTint: 0,
      tinted: 0,
      bossPurge: def.kind === 'boss' ? 0 : undefined,
      wp: 0,
      traveled: 0,
      bounty: def.bounty,
      leak: def.leak,
      dead: false,
      sprite,
      hpBar,
      hpBarW: barW,
      hpBarY: barY,
      aura,
    });
  }

  private completeWave(): void {
    const bonus = Math.round(waveClearBonus(GameState.wave) * GameState.mods.clearCash);
    GameState.addMoney(bonus);
    // Counts up rather than arriving complete — the most repeated reward in the
    // game deserves a moment. See `GameScene.bigCount`.
    this.scene.bigCount(`WAVE ${GameState.wave} CLEAR  `, bonus);
    sfx.waveClear();
    progress.record('wavesCleared');
    progress.record('moneyEarned', bonus);
    // Flawless: the wave ended with nothing having got past the guns.
    if (GameState.tally.leaked === 0) progress.record('flawlessWaves');
    progress.recordMax('bestStreak', GameState.combo.best);
    GameState.tally.magEnd = this.scene.magazineTotal();
    // Card first, so it reports the wave that just ended, not the next one
    GameState.events.emit('wavesummary', GameState.wave, cloneTally(GameState.tally));
    GameState.nextWave();
    progress.recordMax('bestWave', GameState.wave);
    progress.flush(); // wave boundary: settle the throttled stat writes with the save
    GameState.setPhase('build');
    this.def = null;
    if (GameState.auto) {
      this.scene.time.delayedCall(2200, () => {
        if (GameState.auto && !GameState.gameOver) this.start();
      });
    }
  }
}
