import Phaser from 'phaser';
import { GAME_W, GRID_H, GRID_W, IS_TOUCH, PLAYFIELD_H, TILE } from '../config';
import {
  BUILD_INFO,
  costOf,
  effStats,
  fedRequired,
  isMachine,
  isSupport,
  isTower,
  MAX_MK,
  nextTier,
  pathOf,
  TOWERS,
  TowerStats,
  UPGRADE_TREE,
  UpgradeTier,
} from '../data/buildings';
import {
  activeMap,
  computePathCells,
  pathWaypoints,
  PROSPECT_SIZE,
  prospectCost,
  prospectKind,
  RESERVES,
  setActiveMap,
} from '../data/map';
import { cardById, draw, DrawContext, grantAmount } from '../data/research';
import { clearSave, pushBest, pushSave } from '../services/cloud';
import { GameState } from '../state/GameState';
import { clearLocal, consumePendingLoad, consumePendingMap, saveLocal } from '../state/persistence';
import { progress } from '../state/progress';
import { captureRun, SaveV1 } from '../state/serialize';
import { CombatSystem } from '../systems/CombatSystem';
import { ConveyorSystem } from '../systems/ConveyorSystem';
import { GridSystem, minedResource } from '../systems/GridSystem';
import { LogisticsSystem } from '../systems/LogisticsSystem';
import { ProductionSystem } from '../systems/ProductionSystem';
import { WaveSystem } from '../systems/WaveSystem';
import { Building, BuildingType, Dir, PathId } from '../types';
import { beltRun } from '../systems/beltPaint';
import { BELT_FRAME_KEYS } from './BootScene';
import { topStrip } from './hudLayout';
import { sfx } from '../utils/sfx';

/** Concurrent floating-text objects allowed before new ones are dropped. */
const MAX_FLOATERS = 24;

/** Recycled particle emitters. Enough that overlapping puffs never visibly cut each other short. */
const BURST_POOL = 10;

/** Shared scrolling-chevron animation played by every belt. */
const BELT_ANIM = 'belt-run';

/** Upgrade-panel geometry. Authored small; scaled up bodily for fingers. */
const PANEL_W = 258;
const PANEL_SCALE = IS_TOUCH ? 1.4 : 1;

/** Phaser spells its digit keys out; letters are themselves. */
const DIGIT_KEYS = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'];

function phaserKeyName(hotkey: string): string {
  return /^[0-9]$/.test(hotkey) ? DIGIT_KEYS[Number(hotkey)] : hotkey.toUpperCase();
}

/** Mk-pip / float-text tint per specialization path. */
const PATH_COLORS: Record<PathId, number> = {
  sniper: 0x6bd4ff,
  gatling: 0xffe066,
  siege: 0xff9f43,
  flak: 0xb18cff,
  railgun: 0x7cf7c4,
  volley: 0xff7ad9,
  cryostasis: 0x9fd8ff,
  blizzard: 0xe0f2ff,
};

export class GameScene extends Phaser.Scene {
  private grid!: GridSystem;
  private conveyor!: ConveyorSystem;
  private production!: ProductionSystem;
  private waveSystem!: WaveSystem;
  private combat!: CombatSystem;
  private logistics!: LogisticsSystem;

  private selected: BuildingType | null = null;
  private buildDir: Dir = 0;
  /** touch sell mode: with no build selected, tapping a building refunds it */
  private sellMode = false;
  /** survey mode: the next click on clear ground buys a prospected patch there */
  private surveyMode = false;
  private surveyGhost!: Phaser.GameObjects.Graphics;
  /** a costly building right-clicked once, awaiting the confirming second click */
  private sellArmed: Building | null = null;
  private sellArmedAt = 0;
  /** long-press bookkeeping — the touch stand-in for right-click-to-sell */
  private pressAt = 0;
  private pressX = 0;
  private pressY = 0;
  private saveDirty = false;
  private saveTimer = 0;
  /** false while create() is mid-flight — reset()/applySnapshot() event bursts must not autosave a half-built scene */
  private ready = false;
  private ghost!: Phaser.GameObjects.Image;
  private rangeCircle!: Phaser.GameObjects.Arc;
  /** deposits live on their own layer: they thin out, run dry, and get added by prospecting */
  private oreLayer!: Phaser.GameObjects.Graphics;
  private depositsDirty = false;
  private depositsTimer = 0;
  /** live floating-text objects, so a 100-kill wave can't flood the frame */
  private floaters = 0;
  /** recycled particle emitters — see `burst` */
  private bursts: Phaser.GameObjects.Particles.ParticleEmitter[] = [];
  private burstIdx = 0;

  /** last cell painted in the current belt drag — fast drags interpolate from here */
  private paintCell: { x: number; y: number } | null = null;
  /** cells laid down in this stroke; only these may be re-aimed as the drag turns a corner */
  private paintStroke = new Set<string>();

  private selTower: Building | null = null;
  private selRing!: Phaser.GameObjects.Rectangle;
  private panel!: Phaser.GameObjects.Container;
  private panelBg!: Phaser.GameObjects.Rectangle;
  private panelTitle!: Phaser.GameObjects.Text;
  private panelInfo!: Phaser.GameObjects.Text;
  private panelBtnA!: Phaser.GameObjects.Rectangle;
  private panelBtnAText!: Phaser.GameObjects.Text;
  private panelBtnB!: Phaser.GameObjects.Rectangle;
  private panelBtnBText!: Phaser.GameObjects.Text;
  /** live magazine readout; -1 forces the first paint */
  private panelMag!: Phaser.GameObjects.Text;
  private panelMagShown = -1;

  constructor() {
    super('game');
  }

  create(): void {
    this.ready = false;
    this.saveDirty = false;
    this.floaters = 0; // restart wipes the tweens, so their onComplete never decrements
    this.bursts = []; // and it destroys the pooled emitters — never reuse the dead ones
    this.burstIdx = 0;
    GameState.reset();

    // The layout has to be chosen before anything reads the board: a resumed
    // run brings its own map, a fresh one uses whatever the menu picked.
    const pending = consumePendingLoad();
    setActiveMap(pending?.map ?? consumePendingMap());

    this.grid = new GridSystem();
    this.conveyor = new ConveyorSystem(this, this.grid);
    this.production = new ProductionSystem(this, this.grid, this.conveyor);
    this.waveSystem = new WaveSystem(this);
    this.combat = new CombatSystem(this, this.grid, this.waveSystem);
    this.logistics = new LogisticsSystem(this, this.grid);

    // Animations live on the game-wide manager, so this survives scene restarts
    // and must only ever be registered once.
    if (!this.anims.exists(BELT_ANIM)) {
      this.anims.create({
        key: BELT_ANIM,
        frames: BELT_FRAME_KEYS.map((key) => ({ key })),
        frameRate: 8,
        repeat: -1,
      });
    }

    this.drawTerrain();
    this.oreLayer = this.add.graphics().setDepth(0);
    this.production.onDepleted = (x, y) => this.onTileDepleted(x, y);

    this.ghost = this.add.image(0, 0, 'belt').setAlpha(0).setDepth(10);
    this.rangeCircle = this.add
      .circle(0, 0, TOWERS.tower.range, 0xffe066, 0.07)
      .setStrokeStyle(1.5, 0xffe066, 0.6)
      .setVisible(false)
      .setDepth(10);

    this.surveyGhost = this.add.graphics().setDepth(11);
    this.selRing = this.add
      .rectangle(0, 0, TILE + 4, TILE + 4)
      .setStrokeStyle(2, 0xffe066)
      .setFillStyle(0, 0)
      .setVisible(false)
      .setDepth(9);

    this.createUpgradePanel();
    this.setupInput();

    if (pending) {
      this.applySave(pending);
    } else {
      // achievement unlock perks apply to fresh runs only (capped ≤ $100 by test)
      const bonus = progress.startBonus();
      if (bonus > 0) {
        GameState.addMoney(bonus);
        this.floatText(640, 200, `+$${bonus} veteran bonus`, '#ffe066');
      }
    }

    // Scene events from the UI (off first — create() re-runs on restart)
    GameState.events.off('ui:select').on('ui:select', (t: BuildingType) => this.select(t));
    GameState.events.off('ui:startwave').on('ui:startwave', () => this.waveSystem.start());
    GameState.events.off('ui:menu').on('ui:menu', () => this.exitToMenu());
    GameState.events.off('ui:prospect').on('ui:prospect', () => this.toggleSurveyMode());
    GameState.events.off('ui:rotate').on('ui:rotate', () => this.rotateBuildDir());
    GameState.events.off('ui:sellmode').on('ui:sellmode', () => this.toggleSellMode());
    GameState.events.off('ui:pickcard').on('ui:pickcard', (id: string) => this.onPickCard(id));
    GameState.events.off('levelup').on('levelup', () => this.offerCards());
    // Targeted off/on (other scenes listen to these events too; stable refs survive restarts)
    GameState.events.off('phase', this.onPhaseSave).on('phase', this.onPhaseSave);
    GameState.events.off('gameover', this.onGameOverClear).on('gameover', this.onGameOverClear);
    window.removeEventListener('beforeunload', this.onBeforeUnload);
    window.addEventListener('beforeunload', this.onBeforeUnload);
    this.events.once('shutdown', () => window.removeEventListener('beforeunload', this.onBeforeUnload));

    // Hangs off the status strip rather than a fixed y: on a phone the strip is
    // taller, and a centred five-line block ran straight through it.
    const hint = this.add
      .text(
        640,
        topStrip(GAME_W, IS_TOUCH).h + 30,
        'MINERS on ore → belt ore into a PRESS. Ammo feeds GUNS — and every deeper machine runs on it\nFORGE: 2 ammo → shell (CANNONS)  ·  ASSEMBLER: 2 ammo + 1 crystal → piercing (LANCERS)\nCHILLER: 1 ammo → 2 coolant, the cheapest line in the game (CRYO fields slow a choke point)\nTowers start pre-loaded but run dry fast — keep the supply chains flowing!\n' +
          (IS_TOUCH
            ? 'The build bar is split LOGISTICS · PRODUCTION · GUNS — tap [?] up top for the full reference at any time'
            : 'The build bar is split LOGISTICS · PRODUCTION · GUNS — [SPACE] sends the wave · [L] logistics · [?] or [H] for help'),
        { fontFamily: 'monospace', fontSize: '14px', color: '#cdd6e4', align: 'center', stroke: '#000', strokeThickness: 4 },
      )
      .setOrigin(0.5, 0)
      .setDepth(30);
    this.tweens.add({ targets: hint, alpha: 0, delay: 14000, duration: 1500, onComplete: () => hint.destroy() });
    // let the HUD's rotate button show the facing this run starts on
    this.sellMode = false;
    this.surveyMode = false;
    this.sellArmed = null;
    GameState.events.emit('builddir', this.buildDir);
    GameState.events.emit('sellmode', false);
    GameState.events.emit('surveymode', false);
    this.ready = true;
  }

  update(_t: number, deltaMs: number): void {
    if (GameState.gameOver) return;
    if (GameState.frozen) {
      // Pause still lets you plan and build; a frozen ghost would just lie
      // about where the next click lands. (A pending card draw freezes too.)
      this.updateGhost();
      return;
    }
    if (this.saveDirty && GameState.phase === 'build') {
      this.saveTimer -= deltaMs / 1000; // real time, not game-speed scaled
      if (this.saveTimer <= 0) {
        this.saveDirty = false;
        this.saveRun();
      }
    }
    const dt = Math.min(deltaMs / 1000, 0.05) * GameState.speed;
    this.waveSystem.update(dt);
    this.conveyor.update(dt);
    this.production.update(dt);
    this.combat.update(dt);
    this.logistics.update(dt); // observes the settled tick — must run last
    this.updateGhost();

    // Deposits thin out continuously; repaint on a slow cadence (or at once
    // when a tile dies / a survey lands) rather than every frame.
    this.depositsTimer -= dt;
    if (this.depositsDirty || this.depositsTimer <= 0) {
      this.depositsDirty = false;
      this.depositsTimer = 1;
      this.drawDeposits();
    }

    const st = this.selTower;
    if (st && this.panel.visible && isTower(st.type)) {
      // Magazine and lifetime deliveries both tick while belts run, so this is
      // repainted only when one of them actually moves.
      const stamp = st.ammo * 100000 + st.fed;
      if (stamp !== this.panelMagShown) {
        this.panelMagShown = stamp;
        const cap = TOWERS[st.type].ammoCap;
        const needFed = fedRequired(st.type, st.mk + 1);
        const magPart = `MAG ${st.ammo}/${cap}`;
        if (needFed > 0 && st.mk < MAX_MK) {
          const short = st.fed < needFed;
          this.panelMag
            .setText(`${magPart}   FED ${Math.min(st.fed, needFed)}/${needFed}`)
            .setColor(short ? '#ff9f43' : '#5ef078');
        } else {
          this.panelMag.setText(magPart).setColor(st.ammo >= cap ? '#5ef078' : '#ffd75e');
        }
      }
      if (st.mk === 2) {
        const [pa, pb] = UPGRADE_TREE[st.type].paths;
        this.tintAfford(this.panelBtnA, this.panelBtnAText, st, pa.tiers[0]);
        this.tintAfford(this.panelBtnB, this.panelBtnBText, st, pb.tiers[0]);
      } else {
        const tier = nextTier(st.type, st.mk, st.path);
        if (tier) this.tintAfford(this.panelBtnA, this.panelBtnAText, st, tier);
      }
    }
  }

  private tintAfford(btn: Phaser.GameObjects.Rectangle, label: Phaser.GameObjects.Text, b: Building, tier: UpgradeTier): void {
    const needFed = isTower(b.type) ? fedRequired(b.type, b.mk + 1) : 0;
    const can = GameState.money >= tier.money && b.ammo >= tier.ammo && b.fed >= needFed;
    btn.setFillStyle(can ? 0x2e7d4f : 0x3a3f52);
    label.setColor(can ? '#ffffff' : '#8892a6');
  }

  // ---------- juice helpers (used by systems) ----------

  /**
   * Floating bounty/status text. Capped: a late swift wave is 100+ kills in
   * forty seconds, and every one of these is a fresh canvas texture. Past the
   * cap the numbers are an unreadable pile anyway, so dropping them costs the
   * player nothing and keeps the frame rate honest.
   */
  floatText(x: number, y: number, msg: string, color: string): void {
    if (this.floaters >= MAX_FLOATERS) return;
    this.floaters += 1;
    const t = this.add
      .text(x, y, msg, { fontFamily: 'monospace', fontSize: '14px', fontStyle: 'bold', color, stroke: '#000', strokeThickness: 3 })
      .setOrigin(0.5)
      .setDepth(30);
    this.tweens.add({
      targets: t,
      y: y - 30,
      alpha: 0,
      duration: 850,
      ease: 'Cubic.out',
      onComplete: () => {
        this.floaters -= 1;
        t.destroy();
      },
    });
  }

  bigText(msg: string): void {
    const t = this.add
      .text(640, 260, msg, { fontFamily: 'monospace', fontSize: '32px', fontStyle: 'bold', color: '#ffe066', stroke: '#000', strokeThickness: 6 })
      .setOrigin(0.5)
      .setScale(0.3)
      .setDepth(30);
    this.tweens.add({ targets: t, scale: 1, duration: 250, ease: 'Back.out' });
    this.tweens.add({ targets: t, alpha: 0, y: 210, delay: 1300, duration: 600, onComplete: () => t.destroy() });
  }

  /**
   * Particle puff. Emitters are pooled and recycled round-robin: this fires on
   * every kill, every splash and every lance hit, and building one emitter (plus
   * a 500ms destroy timer) per event meant a hundred-kill swift wave allocated a
   * hundred emitters and a hundred timers in about forty seconds.
   *
   * Particles already in flight from a previous use keep their own lifespan, so
   * reusing an emitter mid-puff is harmless.
   */
  burst(x: number, y: number, tint: number, count: number): void {
    if (this.bursts.length < BURST_POOL) {
      this.bursts.push(
        this.add
          .particles(0, 0, 'px', {
            speed: { min: 40, max: 170 },
            lifespan: { min: 150, max: 450 },
            scale: { start: 1.2, end: 0 },
            emitting: false,
          })
          .setDepth(25),
      );
    }
    const e = this.bursts[this.burstIdx];
    this.burstIdx = (this.burstIdx + 1) % BURST_POOL;
    e.setPosition(x, y);
    e.setParticleTint(tint);
    e.explode(count);
  }

  // ---------- tower upgrades ----------

  private createUpgradePanel(): void {
    // Laid out at a fixed size and then scaled as a whole on touch: 22px-tall
    // buttons are a comfortable click and an impossible tap, and Phaser
    // transforms container children's hit areas along with their art, so the
    // targets grow with the panel.
    const s = PANEL_SCALE;
    const strip = topStrip(GAME_W, IS_TOUCH);
    this.panel = this.add
      .container(GAME_W - 8 - PANEL_W * s, strip.stats.y + strip.h + 8)
      .setScale(s)
      .setDepth(40)
      .setVisible(false);
    const bg = this.add.rectangle(0, 0, PANEL_W, 136, 0x141625, 0.94).setOrigin(0).setStrokeStyle(2, 0x2b3040);
    this.panelBg = bg;
    this.panelTitle = this.add.text(10, 7, '', { fontFamily: 'monospace', fontSize: '13px', fontStyle: 'bold', color: '#ffe066' });
    this.panelInfo = this.add.text(10, 37, '', { fontFamily: 'monospace', fontSize: '10px', color: '#cdd6e4', lineSpacing: 2 });
    // Two fixed button slots: A alone for linear tiers, A+B at the Mk3 branch.
    // Buttons sit below the 4-line branch info (ends ~y85).
    this.panelBtnA = this.add
      .rectangle(10, 108, 114, 22, 0x2e7d4f)
      .setOrigin(0)
      .setStrokeStyle(1, 0x5ef078)
      .setInteractive({ useHandCursor: true });
    this.panelBtnA.on('pointerdown', () => this.tryUpgrade(0));
    this.panelBtnAText = this.add
      .text(67, 119, 'UPGRADE [U]', { fontFamily: 'monospace', fontSize: '10px', fontStyle: 'bold', color: '#ffffff' })
      .setOrigin(0.5);
    this.panelBtnB = this.add
      .rectangle(134, 108, 114, 22, 0x2e7d4f)
      .setOrigin(0)
      .setStrokeStyle(1, 0x5ef078)
      .setInteractive({ useHandCursor: true });
    this.panelBtnB.on('pointerdown', () => this.tryUpgrade(1));
    this.panelBtnBText = this.add
      .text(191, 119, '', { fontFamily: 'monospace', fontSize: '10px', fontStyle: 'bold', color: '#ffffff' })
      .setOrigin(0.5);
    // Every tier is paid partly in a *full* magazine and gated on lifetime
    // deliveries, so "how full am I / how much have I been fed?" is the question
    // the panel has to answer — without it a greyed-out button is a mystery.
    // Own row: combined with the title it would overrun the panel.
    this.panelMag = this.add
      .text(10, 22, '', { fontFamily: 'monospace', fontSize: '11px', fontStyle: 'bold', color: '#cdd6e4' });
    this.panel.add([
      bg,
      this.panelTitle,
      this.panelMag,
      this.panelInfo,
      this.panelBtnA,
      this.panelBtnAText,
      this.panelBtnB,
      this.panelBtnBText,
    ]);
  }

  private selectTower(b: Building | null): void {
    this.selTower = b;
    this.panelMagShown = -1; // a different tower may share an ammo count but not a cap
    if (b) {
      this.selRing.setPosition(b.x * TILE + TILE / 2, b.y * TILE + TILE / 2).setVisible(true);
    } else {
      this.selRing.setVisible(false);
    }
    this.refreshPanel();
  }

  private refreshPanel(): void {
    const b = this.selTower;
    if (!b || !isTower(b.type)) {
      this.panel.setVisible(false);
      return;
    }
    const cur = effStats(b.type, b.mk, b.path, GameState.mods);
    const LABELS: Record<string, string> = { cannon: 'CANNON', lancer: 'LANCER', cryo: 'CRYO FIELD' };
    const label = LABELS[b.type] ?? 'GUN TOWER';
    const pathName = b.path ? ` · ${pathOf(b.type, b.path).name}` : '';
    this.panel.setVisible(true);
    this.panelTitle.setText(`${label} Mk${b.mk}${pathName}`);

    const showA = (text: string) => {
      this.panelBtnA.setVisible(true);
      this.panelBtnAText.setVisible(true).setText(text);
    };
    const showB = (text: string) => {
      this.panelBtnB.setVisible(true);
      this.panelBtnBText.setVisible(true).setText(text);
    };
    this.panelBtnB.setVisible(false);
    this.panelBtnBText.setVisible(false);

    // Support towers have no damage to quote — their headline stat is the slow
    const support = isSupport(b.type);
    const brief = (s: TowerStats) =>
      support
        ? `SLOW ${Math.round((1 - s.slowFactor) * 100)}% RNG ${s.range} ${s.slowDur.toFixed(1)}s`
        : `DMG ${s.damage} RNG ${s.range} ROF ${s.fireRate.toFixed(1)}`;

    if (b.mk === 2) {
      // The branch: choose a specialization
      const [pa, pb] = UPGRADE_TREE[b.type].paths;
      this.panelInfo.setText(
        `${pa.name}: ${brief(effStats(b.type, 3, pa.id, GameState.mods))}\n  $${pa.tiers[0].money} + full mag (${pa.tiers[0].ammo})\n` +
          `${pb.name}: ${brief(effStats(b.type, 3, pb.id, GameState.mods))}\n  $${pb.tiers[0].money} + full mag (${pb.tiers[0].ammo})`,
      );
      showA(`${pa.name} [U]`);
      showB(`${pb.name} [I]`);
      return;
    }

    const tier = nextTier(b.type, b.mk, b.path);
    if (tier) {
      const next = effStats(b.type, b.mk + 1, b.path ?? UPGRADE_TREE[b.type].paths[0].id, GameState.mods);
      const nextStats = b.mk === 1 ? effStats(b.type, 2, null, GameState.mods) : next;
      const delta = support
        ? `SLOW ${Math.round((1 - cur.slowFactor) * 100)}%→${Math.round((1 - nextStats.slowFactor) * 100)}% · RNG ${cur.range}→${nextStats.range}\nHOLD ${cur.slowDur.toFixed(1)}→${nextStats.slowDur.toFixed(1)}s · PULSE ${cur.fireRate.toFixed(1)}→${nextStats.fireRate.toFixed(1)}/s`
        : `DMG ${cur.damage}→${nextStats.damage} · RNG ${cur.range}→${nextStats.range}\nROF ${cur.fireRate.toFixed(1)}→${nextStats.fireRate.toFixed(1)}/s`;
      this.panelInfo.setText(`${delta}\nCost: $${tier.money} + full magazine (${tier.ammo} ${cur.ammoType})`);
      showA('UPGRADE [U]');
    } else {
      this.panelInfo.setText(`${brief(cur)}\nMAXED`);
      this.panelBtnA.setVisible(false);
      this.panelBtnAText.setVisible(false);
    }
  }

  private tryUpgrade(choice: 0 | 1 = 0): void {
    const b = this.selTower;
    if (!b || !isTower(b.type) || GameState.gameOver || GameState.awaitingCard) return;
    let tier: UpgradeTier | null;
    let newPath: PathId | null = null;
    if (b.mk === 2) {
      const p = UPGRADE_TREE[b.type].paths[choice];
      tier = p.tiers[0];
      newPath = p.id;
    } else {
      if (choice === 1) return; // [I] only picks the second path at the branch
      tier = nextTier(b.type, b.mk, b.path);
    }
    if (!tier) return;
    const cx = b.x * TILE + TILE / 2;
    const cy = b.y * TILE + TILE / 2;
    const needFed = fedRequired(b.type, b.mk + 1);
    if (b.fed < needFed) {
      sfx.error();
      this.floatText(cx, cy - 12, `Delivered ${b.fed}/${needFed} rounds`, '#ff9f43');
      return;
    }
    if (b.ammo < tier.ammo) {
      sfx.error();
      this.floatText(cx, cy - 12, 'Need a full magazine!', '#ff5555');
      return;
    }
    if (!GameState.spend(tier.money)) {
      sfx.error();
      this.floatText(cx, cy - 12, `Need $${tier.money}`, '#ff5555');
      return;
    }
    b.ammo -= tier.ammo;
    b.mk += 1;
    if (newPath) b.path = newPath;
    b.invested += tier.money;
    const pipColor = b.path ? PATH_COLORS[b.path] : 0xffe066;
    this.addMkPip(b, b.mk);
    progress.record('upgradesBought');
    this.requestSave();
    if (b.mk === MAX_MK) progress.record('maxedTowers');
    this.burst(cx, cy, pipColor, 20);
    this.floatText(cx, cy - 16, newPath ? `${pathOf(b.type, newPath).name}!` : `Mk${b.mk}!`, '#ffe066');
    this.cameras.main.shake(80, 0.002);
    sfx.waveClear();
    this.refreshPanel();
  }

  // ---------- research: the level-up draw ----------

  /**
   * What the run currently contains, so the draw never offers an upgrade with
   * nothing to improve (no "+1 pierce" before a lancer exists).
   */
  private drawContext(): DrawContext {
    const towers: Record<string, number> = {};
    let machines = 0;
    let miners = 0;
    let belts = 0;
    for (const b of this.grid.buildings) {
      if (isTower(b.type)) towers[b.type] = (towers[b.type] ?? 0) + 1;
      else if (isMachine(b.type)) machines += 1;
      else if (b.type === 'miner') miners += 1;
      else if (b.type === 'belt') belts += 1;
    }
    return { towers, machines, miners, belts, taken: GameState.taken };
  }

  /**
   * Present the next pending level's choice. The sim stays frozen until the
   * queue drains — and if the pool is genuinely exhausted we unfreeze rather
   * than showing an empty draw.
   */
  private offerCards(): void {
    if (GameState.gameOver || GameState.pendingLevels <= 0) {
      GameState.finishDraw();
      return;
    }
    const cards = draw(this.drawContext(), () => Phaser.Math.RND.frac(), 3);
    if (cards.length === 0) {
      GameState.finishDraw();
      return;
    }
    GameState.events.emit('cards', cards, GameState.researchLevel);
  }

  private onPickCard(id: string): void {
    const card = cardById(id);
    if (!card) return;
    if (card.instant === 'life') GameState.gainLives(1);
    else if (card.instant === 'cash') GameState.addMoney(grantAmount(GameState.wave));
    GameState.takeCard(id);
    progress.record('researchTaken');

    this.bigText(card.name);
    this.burst(640, 300, 0x7cf7c4, 26);
    this.cameras.main.shake(90, 0.002);
    sfx.waveClear();
    this.requestSave();

    if (GameState.pendingLevels > 0) this.offerCards();
    else GameState.finishDraw();
  }

  // ---------- save / restore ----------

  /** Save on every return to build phase (the wave-clear checkpoint); start a fresh logistics window on every send. */
  private onPhaseSave = (): void => {
    if (GameState.phase === 'wave') {
      this.logistics.resetWindow();
      return;
    }
    if (this.ready && !GameState.gameOver) this.saveRun();
  };

  /** The run is over: clear the slot (lifetime stats/achievements persist separately). */
  private onGameOverClear = (): void => {
    this.saveDirty = false;
    clearLocal();
    progress.recordMax('bestWave', GameState.wave); // listener-order independent
    void clearSave();
    void pushBest(progress.stats.bestWave);
  };

  private onBeforeUnload = (): void => {
    if (this.ready && !GameState.gameOver && GameState.phase === 'build') this.saveRun();
  };

  private saveRun(): void {
    const save = captureRun(this.grid.buildings, this.conveyor.items, GameState, {
      patches: this.grid.revealed.map(({ patch, kind }) => ({ ...patch, k: kind })),
      tiles: this.grid.changedTiles(),
      map: activeMap().id,
    });
    saveLocal(save);
    // best-effort cloud mirror for signed-in players — never blocks gameplay
    void pushSave(save);
    void pushBest(progress.stats.bestWave);
  }

  /** Debounce build-phase edits (drag-painting belts fires many per second). */
  private requestSave(): void {
    this.saveDirty = true;
    this.saveTimer = 1.0;
  }

  /** Back to the title screen; flushes a final save first when the run is alive. UIScene sleeps so its listeners stay singular. */
  private exitToMenu(): void {
    if (this.ready && !GameState.gameOver && GameState.phase === 'build') this.saveRun();
    this.saveDirty = false;
    this.scene.sleep('ui');
    this.scene.start('menu');
  }

  private applySave(save: SaveV1): void {
    GameState.applySnapshot(save);
    // Terrain first: buildings are validated against the restored map, and a
    // miner on a tile that ran dry mid-run must come back as a dead miner.
    for (const p of save.patches ?? []) this.grid.addPatch({ x: p.x, y: p.y, w: p.w, h: p.h }, p.k);
    for (const t of save.tiles ?? []) this.grid.setReserves(t.x, t.y, t.n);
    this.depositsDirty = true;

    for (const sb of save.buildings) {
      if (!this.grid.canRestore(sb.x, sb.y)) continue; // stale save vs map change — skip
      const b = this.placeBuilding(sb.t, sb.x, sb.y, sb.d);
      b.mk = sb.mk ?? 1;
      b.path = sb.path ?? null;
      if (sb.ammo !== undefined) b.ammo = sb.ammo;
      b.fed = sb.fed ?? 0;
      b.timer = sb.timer ?? 0;
      b.crafting = sb.crafting ?? false;
      b.inputs = { ...(sb.in ?? {}) };
      b.outputBuf = sb.outBuf ?? 0;
      b.outIdx = sb.outIdx ?? 0;
      b.invested = sb.inv;
      for (let mk = 2; mk <= b.mk; mk++) this.addMkPip(b, mk);
    }
    for (const si of save.items) {
      this.conveyor.restoreItem(si.t, si.cx, si.cy, si.px, si.py, si.a ?? 1);
    }
  }

  // ---------- input & placement ----------

  private setupInput(): void {
    this.input.mouse?.disableContextMenu();
    const kb = this.input.keyboard!;
    kb.removeAllListeners();
    // Bound straight off BUILD_INFO so the keys can never drift from the badges
    // drawn on the palette slots. The number row is the factory, ZXCV the guns
    // — the same split the palette draws, so the category tells you where to reach.
    for (const info of BUILD_INFO) {
      kb.on(`keydown-${phaserKeyName(info.hotkey)}`, () => this.select(info.type));
    }
    kb.on('keydown-U', () => this.tryUpgrade(0));
    kb.on('keydown-I', () => this.tryUpgrade(1));
    // Factorio's rule: R turns whatever is under the cursor, or the thing you
    // are about to build when the cursor is over bare ground.
    kb.on('keydown-R', () => {
      const p = this.input.activePointer;
      const b = p.y < PLAYFIELD_H ? this.grid.cellAt(Math.floor(p.x / TILE), Math.floor(p.y / TILE))?.building : null;
      if (b && !isTower(b.type) && !this.selected) this.rotateBuilding(b);
      else this.rotateBuildDir();
    });
    kb.on('keydown-ESC', () => {
      if (this.surveyMode) this.toggleSurveyMode();
      else this.select(null);
    });
    kb.on('keydown-SPACE', () => this.waveSystem.start());
    kb.on('keydown-F', () => GameState.cycleSpeed());
    kb.on('keydown-P', () => GameState.togglePause());
    kb.on('keydown-L', () => GameState.toggleOverlay());

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      // Phaser fires GameObject handlers first and then this scene-level one
      // regardless, so without this guard clicking UPGRADE would immediately
      // deselect the tower underneath and shut the panel it lives in.
      if (p.y >= PLAYFIELD_H || this.overPanel(p.x, p.y)) return;
      this.pressAt = this.time.now;
      this.pressX = p.x;
      this.pressY = p.y;
      const tx = Math.floor(p.x / TILE);
      const ty = Math.floor(p.y / TILE);
      if (p.rightButtonDown()) {
        const b = this.grid.cellAt(tx, ty)?.building;
        if (b) this.requestSell(b);
        else this.select(null);
        return;
      }
      if (this.surveyMode) {
        this.placeSurvey(tx, ty);
        return;
      }
      if (this.sellMode) {
        const b = this.grid.cellAt(tx, ty)?.building;
        if (b) this.requestSell(b);
        else sfx.error();
        return;
      }
      if (this.selected) {
        if (this.selected === 'belt') this.startStroke(tx, ty);
        else this.tryPlace(this.selected, tx, ty, false);
      } else {
        const b = this.grid.cellAt(tx, ty)?.building;
        // Towers open their upgrade panel; everything else turns. Re-aiming a
        // belt or a machine used to mean selling it and building it again.
        if (b && !isTower(b.type)) this.rotateBuilding(b);
        else this.selectTower(b ?? null);
      }
    });

    // Long-press is the touch stand-in for right-click-to-sell. Only while
    // nothing is selected for building, so holding after painting a belt can
    // never refund the belt you just laid down.
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      this.endStroke();
      if (p.y >= PLAYFIELD_H || this.selected || this.sellMode || this.overPanel(p.x, p.y)) return;
      const held = this.time.now - this.pressAt;
      const moved = Math.hypot(p.x - this.pressX, p.y - this.pressY);
      if (held < 450 || moved > 12) return;
      const b = this.grid.cellAt(Math.floor(p.x / TILE), Math.floor(p.y / TILE))?.building;
      if (b) this.requestSell(b);
    });

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      // drag-paint belts (touch drags report no button, so accept either)
      if (this.selected === 'belt' && p.isDown && !p.rightButtonDown() && p.y < PLAYFIELD_H) {
        this.paintBeltTo(Math.floor(p.x / TILE), Math.floor(p.y / TILE));
      }
    });
  }

  /** Is this canvas point over the open upgrade panel? */
  private overPanel(x: number, y: number): boolean {
    return this.panel.visible && Phaser.Geom.Rectangle.Contains(this.panelBg.getBounds(), x, y);
  }

  // ---------- belt drag-painting ----------

  private startStroke(tx: number, ty: number): void {
    this.paintStroke.clear();
    this.paintCell = null;
    this.paintBeltTo(tx, ty);
  }

  private endStroke(): void {
    this.paintCell = null;
    this.paintStroke.clear();
  }

  /**
   * Lay belt from the last painted cell to this one. Two things make a drag
   * feel like a conveyor rather than a stamp:
   *  - every cell in between is filled, so a fast flick never leaves a hole;
   *  - each belt points at the next cell, and the cell being left is re-aimed
   *    to match, so a stroke that turns a corner lays a working corner instead
   *    of a row of belts all facing the direction you started in.
   * Only belts from this stroke are re-aimed — dragging across the factory can
   * never silently re-plumb an existing line.
   */
  private paintBeltTo(tx: number, ty: number): void {
    if (!this.grid.inBounds(tx, ty)) return;
    if (!this.paintCell) {
      if (this.tryPlace('belt', tx, ty, true, this.buildDir)) this.paintStroke.add(`${tx},${ty}`);
      this.paintCell = { x: tx, y: ty };
      return;
    }
    let prev = this.paintCell;
    for (const step of beltRun(prev, { x: tx, y: ty }, this.buildDir)) {
      this.aimBelt(prev.x, prev.y, step.dir); // the cell we're leaving must feed the one we're entering
      if (this.tryPlace('belt', step.x, step.y, true, step.dir)) this.paintStroke.add(`${step.x},${step.y}`);
      prev = step;
      this.paintCell = step;
      this.buildDir = step.dir;
    }
    GameState.events.emit('builddir', this.buildDir);
  }

  /** Re-aim a belt this stroke laid down. Anything else is left alone. */
  private aimBelt(x: number, y: number, dir: Dir): void {
    const b = this.grid.cellAt(x, y)?.building;
    if (!b || b.type !== 'belt' || b.dir === dir || !this.paintStroke.has(`${x},${y}`)) return;
    b.dir = dir;
    b.sprite.setRotation((dir * Math.PI) / 2);
    this.requestSave();
  }

  private rotateBuildDir(): void {
    this.buildDir = ((this.buildDir + 1) % 4) as Dir;
    GameState.events.emit('builddir', this.buildDir);
    sfx.place();
  }

  /** Touch-only sell mode: no right button, so selling gets an explicit mode. */
  private toggleSellMode(): void {
    this.sellMode = !this.sellMode;
    if (this.sellMode) {
      this.select(null);
      if (this.surveyMode) {
        this.surveyMode = false;
        this.surveyGhost.clear();
        GameState.events.emit('surveymode', false);
      }
    }
    GameState.events.emit('sellmode', this.sellMode);
  }

  private select(type: BuildingType | null): void {
    // The card draw owns the keyboard while it is up: "1" picks a card, and
    // must not also select a belt behind the modal. (Pointer input is already
    // swallowed by the modal's dim.)
    if (GameState.awaitingCard) return;
    // Choosing the armed slot again cancels it. On touch there is no ESC and no
    // right-click, so without this a player who taps BELT is stuck in belt mode.
    if (type !== null && type === this.selected) type = null;
    this.selected = type;
    GameState.events.emit('selected', type);
    if (type && this.surveyMode) {
      this.surveyMode = false;
      this.surveyGhost.clear();
      GameState.events.emit('surveymode', false);
    }
    if (type) {
      // building and selling are mutually exclusive modes
      if (this.sellMode) {
        this.sellMode = false;
        GameState.events.emit('sellmode', false);
      }
      this.ghost.setTexture(type);
      this.selectTower(null);
    }
  }

  /** Construction half of placement (sprite, barrel, ammo bar, grid entry) — no cost/validity checks or juice. Restore reuses it. */
  private placeBuilding(type: BuildingType, tx: number, ty: number, dir: Dir): Building {
    const cx = tx * TILE + TILE / 2;
    const cy = ty * TILE + TILE / 2;
    const tower = isTower(type);
    const flat = type === 'belt' || type === 'splitter' || type === 'tunnel';
    // The lab has no output, so it has no facing to show — leave it upright
    // however the build cursor happened to be rotated.
    const facing = type !== 'lab';
    const depth = flat ? 1 : 3;
    // Belts are Sprites so they can run the scrolling chevron loop; everything
    // else stays a plain Image. All belts share one animation, and starting them
    // at a random frame keeps a long run from looking like a marching band.
    const sprite =
      type === 'belt'
        ? this.add.sprite(cx, cy, 'belt').setDepth(depth).play({ key: BELT_ANIM, startFrame: Phaser.Math.Between(0, BELT_FRAME_KEYS.length - 1) })
        : this.add.image(cx, cy, type).setDepth(depth);
    if (!tower && facing) sprite.setRotation((dir * Math.PI) / 2);

    const b: Building = {
      type,
      x: tx,
      y: ty,
      dir,
      sprite,
      item: null,
      outIdx: 0,
      timer: 0,
      crafting: false,
      inputs: {},
      outputBuf: 0,
      ammo: tower ? TOWERS[type].startAmmo : 0,
      fed: 0,
      cooldown: 0,
      mk: 1,
      path: null,
      invested: costOf(type),
      stalled: false,
      utilBusy: 0,
      utilBlocked: 0,
      utilTotal: 0,
    };
    // Machines and towers stand proud of the ground; belts stay flush with it.
    if (!flat) b.shadow = this.add.ellipse(cx + 2, cy + 12, 26, 9, 0x000000, 0.28).setDepth(depth - 1);
    if (tower) {
      const BAR_COLOR: Record<string, number> = { cannon: 0xff9f43, lancer: 0x6bd4ff, cryo: 0x9fd8ff };
      const BARREL: Record<string, string> = { cannon: 'barrel-cannon', lancer: 'barrel-lancer' };
      // The cryo emitter has no barrel — it pulses in every direction at once
      if (BARREL[type] || type === 'tower') {
        b.barrel = this.add.image(cx, cy, BARREL[type] ?? 'barrel').setOrigin(0.15, 0.5).setDepth(4);
      }
      b.ammoBar = this.add.rectangle(cx - 12, cy + 15, 24, 3, BAR_COLOR[type] ?? 0xffe066).setOrigin(0, 0.5).setDepth(6);
    }
    this.grid.place(b);
    return b;
  }

  private addMkPip(b: Building, mkLevel: number): void {
    const cx = b.x * TILE + TILE / 2;
    const cy = b.y * TILE + TILE / 2;
    const color = mkLevel >= 3 && b.path ? PATH_COLORS[b.path] : 0xffe066;
    b.mkPips = b.mkPips ?? [];
    b.mkPips.push(
      this.add.rectangle(cx - 12 + (mkLevel - 2) * 8, cy - 15, 5, 5, color).setDepth(6).setStrokeStyle(1, 0xb8962e),
    );
  }

  /** Returns the new building, or null if the spot or the wallet said no. */
  private tryPlace(type: BuildingType, tx: number, ty: number, silent: boolean, dir: Dir = this.buildDir): Building | null {
    if (GameState.gameOver) return null;
    if (!this.grid.canPlace(type, tx, ty)) {
      if (!silent) sfx.error();
      return null;
    }
    if (!GameState.spend(costOf(type))) {
      if (!silent) {
        sfx.error();
        this.floatText(tx * TILE + 16, ty * TILE + 8, 'Need $' + costOf(type), '#ff5555');
      }
      return null;
    }

    const b = this.placeBuilding(type, tx, ty, dir);
    b.sprite.setScale(0.5);
    this.tweens.add({ targets: b.sprite, scale: 1, duration: 130, ease: 'Back.out' });
    sfx.place();
    if (type === 'tunnel') progress.record('tunnelsBuilt');
    this.requestSave();
    return b;
  }

  /** Turn a placed belt/machine 90°. Free and reversible — four clicks is a full circle. */
  private rotateBuilding(b: Building): void {
    b.dir = ((b.dir + 1) % 4) as Dir;
    b.sprite.setRotation((b.dir * Math.PI) / 2);
    this.tweens.add({ targets: b.sprite, scale: 1.12, duration: 70, yoyo: true });
    sfx.place();
    this.requestSave();
  }

  /** Above this, selling asks twice — a stray right-click should not vaporise a Mk4 tower. */
  private static readonly SELL_CONFIRM_OVER = 150;
  private static readonly SELL_CONFIRM_MS = 2500;

  /**
   * Cheap things (belts, tunnels) sell on the first click so clearing a bad run
   * stays fast; anything expensive has to be clicked twice, because the refund
   * is only half and there is no undo.
   */
  private requestSell(b: Building): void {
    if (b.invested <= GameScene.SELL_CONFIRM_OVER) {
      this.sell(b);
      return;
    }
    const armed = this.sellArmed === b && this.time.now - this.sellArmedAt < GameScene.SELL_CONFIRM_MS;
    if (armed) {
      this.sellArmed = null;
      this.sell(b);
      return;
    }
    this.sellArmed = b;
    this.sellArmedAt = this.time.now;
    sfx.error();
    this.floatText(b.x * TILE + 16, b.y * TILE + 4, `Again to sell · +$${Math.floor(b.invested / 2)}`, '#ff9f43');
  }

  private sell(b: Building): void {
    if (this.sellArmed === b) this.sellArmed = null;
    const refund = Math.floor(b.invested / 2);
    if (b.item) this.conveyor.destroyItem(b.item);
    // A recoil or pulse tween outliving its target would keep writing to a dead
    // object every frame.
    this.tweens.killTweensOf(b.sprite);
    if (b.barrel) this.tweens.killTweensOf(b.barrel);
    b.sprite.destroy();
    b.shadow?.destroy();
    b.barrel?.destroy();
    b.ammoBar?.destroy();
    b.mkPips?.forEach((p) => p.destroy());
    if (this.selTower === b) this.selectTower(null);
    this.grid.remove(b);
    GameState.addMoney(refund, false); // recycled capital, not wave income
    this.floatText(b.x * TILE + 16, b.y * TILE + 8, `+$${refund}`, '#9aa7bd');
    this.burst(b.x * TILE + 16, b.y * TILE + 16, 0x9aa7bd, 8);
    sfx.sell();
    this.requestSave();
  }

  private updateGhost(): void {
    const p = this.input.activePointer;
    const tx = Math.floor(p.x / TILE);
    const ty = Math.floor(p.y / TILE);

    // Survey mode owns the cursor: show the footprint you are about to buy.
    if (this.surveyMode) {
      this.ghost.setAlpha(0);
      this.rangeCircle.setVisible(false);
      const g = this.surveyGhost.clear();
      if (p.y >= PLAYFIELD_H) return;
      const s = this.surveyOrigin(tx, ty);
      const ok = this.grid.isClearArea(s.x, s.y, s.w, s.h);
      g.fillStyle(ok ? 0x5ef078 : 0xff5555, 0.18);
      g.fillRect(s.x * TILE, s.y * TILE, s.w * TILE, s.h * TILE);
      g.lineStyle(2, ok ? 0x5ef078 : 0xff5555, 0.9);
      g.strokeRect(s.x * TILE, s.y * TILE, s.w * TILE, s.h * TILE);
      return;
    }

    if (!this.selected || p.y >= PLAYFIELD_H) {
      this.ghost.setAlpha(0);
      // show range of an existing tower under the cursor
      const hovered = p.y < PLAYFIELD_H ? this.grid.cellAt(tx, ty)?.building : null;
      const show = hovered && isTower(hovered.type) ? hovered : this.selTower;
      if (show && isTower(show.type)) {
        this.rangeCircle
          .setRadius(effStats(show.type, show.mk, show.path, GameState.mods).range)
          .setVisible(true)
          .setPosition(show.x * TILE + TILE / 2, show.y * TILE + TILE / 2);
      } else {
        this.rangeCircle.setVisible(false);
      }
      return;
    }
    const cx = tx * TILE + TILE / 2;
    const cy = ty * TILE + TILE / 2;
    const sel = this.selected;
    const ok = this.grid.canPlace(sel, tx, ty) && GameState.money >= costOf(sel);
    const towerSel = isTower(sel);
    const upright = towerSel || sel === 'lab'; // neither has a facing to preview
    this.ghost
      .setAlpha(0.6)
      .setPosition(cx, cy)
      .setRotation(upright ? 0 : (this.buildDir * Math.PI) / 2)
      .setTint(ok ? 0x88ff88 : 0xff6666);
    if (towerSel) this.rangeCircle.setRadius(TOWERS[sel].range);
    this.rangeCircle.setVisible(towerSel).setPosition(cx, cy);
  }

  // ---------- deposits: depletion & prospecting ----------

  /** A tile just ran dry: repaint it, and make sure the player notices. */
  private onTileDepleted(x: number, y: number): void {
    this.depositsDirty = true;
    const cx = x * TILE + TILE / 2;
    const cy = y * TILE + TILE / 2;
    this.floatText(cx, cy - 10, 'DEPLETED', '#ff9f43');
    this.burst(cx, cy, 0x8a6a4a, 10);
    sfx.error();
    this.requestSave();
  }

  /**
   * Arm/disarm survey mode. Prospecting used to drop the patch on a random
   * clear tile, which meant paying a four-figure sum for ground you might not
   * be able to reach — so the player picks the site now, and the cost is only
   * taken when they commit to one.
   */
  private toggleSurveyMode(): void {
    if (GameState.gameOver) return;
    this.surveyMode = !this.surveyMode;
    if (this.surveyMode) {
      this.select(null);
      if (this.sellMode) this.toggleSellMode();
      const cost = prospectCost(GameState.surveys);
      if (GameState.money < cost) {
        this.surveyMode = false;
        sfx.error();
        this.floatText(640, 300, `Survey costs $${cost}`, '#ff5555');
      }
    }
    this.surveyGhost.clear();
    GameState.events.emit('surveymode', this.surveyMode);
  }

  /** Top-left of the survey footprint for a cursor tile — centered and clamped on-board. */
  private surveyOrigin(tx: number, ty: number): { x: number; y: number; w: number; h: number } {
    const { w, h } = PROSPECT_SIZE[prospectKind(GameState.surveys)];
    return {
      x: Phaser.Math.Clamp(tx - Math.floor((w - 1) / 2), 0, GRID_W - w),
      y: Phaser.Math.Clamp(ty - Math.floor((h - 1) / 2), 0, GRID_H - h),
      w,
      h,
    };
  }

  /** Commit a survey at the cursor. Reveals a fresh patch of the next resource. */
  private placeSurvey(tx: number, ty: number): void {
    if (GameState.gameOver) return;
    const kind = prospectKind(GameState.surveys);
    const cost = prospectCost(GameState.surveys);
    const spot = this.surveyOrigin(tx, ty);
    const { w, h } = spot;

    if (!this.grid.isClearArea(spot.x, spot.y, w, h)) {
      sfx.error();
      this.floatText(tx * TILE + 16, ty * TILE, 'Needs clear ground', '#ff5555');
      return;
    }
    if (!GameState.spend(cost)) {
      sfx.error();
      this.floatText(tx * TILE + 16, ty * TILE, `Survey costs $${cost}`, '#ff5555');
      return;
    }

    this.surveyMode = false;
    this.surveyGhost.clear();
    GameState.events.emit('surveymode', false);
    this.grid.addPatch({ x: spot.x, y: spot.y, w, h }, kind);
    GameState.recordSurvey();
    this.depositsDirty = true;

    const cx = spot.x * TILE + (w * TILE) / 2;
    const cy = spot.y * TILE + (h * TILE) / 2;
    this.burst(cx, cy, kind === 'ore' ? 0xff9f43 : 0x6bd4ff, 26);
    this.floatText(cx, cy - 12, `${kind.toUpperCase()} FOUND`, '#5ef078');
    this.cameras.main.shake(120, 0.003);
    sfx.waveClear();
    this.requestSave();
  }

  // ---------- terrain ----------

  /** Ground, path and grid lines — fixed for the whole run, drawn once. */
  private drawTerrain(): void {
    const g = this.add.graphics().setDepth(0);
    const pathCells = computePathCells();
    const onPath = (x: number, y: number) => pathCells.has(`${x},${y}`);

    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const px = x * TILE;
        const py = y * TILE;
        if (onPath(x, y)) {
          g.fillStyle(0xc8a15a);
          g.fillRect(px, py, TILE, TILE);
          g.fillStyle(0xb08c4a);
          g.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
          continue;
        }
        g.fillStyle((x + y) % 2 === 0 ? 0x2f4f43 : 0x2b4a3f);
        g.fillRect(px, py, TILE, TILE);
        // deterministic speckle so the ground reads as terrain, not graph paper
        const h = (x * 73856093) ^ (y * 19349663);
        const n = (h >>> 3) % 7;
        if (n < 3) {
          g.fillStyle(n === 0 ? 0x36594c : 0x27423a, 0.55);
          const sx = px + 4 + ((h >>> 7) % 20);
          const sy = py + 4 + ((h >>> 11) % 20);
          g.fillRect(sx, sy, n === 0 ? 3 : 2, 2);
        }
      }
    }

    // A raised kerb wherever grass meets the road: the strongest single cue
    // that the path is a place you cannot build.
    g.fillStyle(0x8a6a34, 0.85);
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        if (!onPath(x, y)) continue;
        const px = x * TILE;
        const py = y * TILE;
        if (!onPath(x, y - 1)) g.fillRect(px, py, TILE, 3);
        if (!onPath(x, y + 1)) g.fillRect(px, py + TILE - 3, TILE, 3);
        if (!onPath(x - 1, y)) g.fillRect(px, py, 3, TILE);
        if (!onPath(x + 1, y)) g.fillRect(px + TILE - 3, py, 3, TILE);
      }
    }

    this.drawPathArrows(g);

    // subtle grid lines, grass only — they just add noise on top of the road
    g.lineStyle(1, 0xffffff, 0.035);
    for (let x = 0; x <= GRID_W; x++) g.lineBetween(x * TILE, 0, x * TILE, PLAYFIELD_H);
    for (let y = 0; y <= GRID_H; y++) g.lineBetween(0, y * TILE, GRID_W * TILE, y * TILE);

    // spawn & exit markers
    const route = pathWaypoints();
    const first = route[0];
    const last = route[route.length - 1];
    g.fillStyle(0x3d1f5c, 1);
    g.fillRect(0, first.y * TILE, TILE / 2, TILE);
    g.fillStyle(0x8f1f1f, 1);
    g.fillRect(GRID_W * TILE - TILE / 2, last.y * TILE, TILE / 2, TILE);

    this.drawVignette();
  }

  /**
   * Chevrons down the middle of the road. They cost nothing to draw and answer
   * the first question a new player has on an unfamiliar map: which way do they
   * come from, and where are they headed?
   */
  private drawPathArrows(g: Phaser.GameObjects.Graphics): void {
    const route = pathWaypoints();
    for (let i = 0; i < route.length - 1; i++) {
      const ax = route[i].x * TILE + TILE / 2;
      const ay = route[i].y * TILE + TILE / 2;
      const bx = route[i + 1].x * TILE + TILE / 2;
      const by = route[i + 1].y * TILE + TILE / 2;
      const len = Math.hypot(bx - ax, by - ay);
      if (len === 0) continue;
      const ux = (bx - ax) / len;
      const uy = (by - ay) / len;
      const nx = -uy; // unit normal, for the chevron's shoulders
      const ny = ux;

      for (let d = 20; d < len; d += 44) {
        const cx = ax + ux * d;
        const cy = ay + uy * d;
        if (cx < -TILE || cx > GRID_W * TILE + TILE || cy < -TILE || cy > PLAYFIELD_H + TILE) continue;
        g.fillStyle(0xdcb877, 0.5);
        g.fillTriangle(
          cx + ux * 7,
          cy + uy * 7,
          cx - ux * 3 + nx * 6,
          cy - uy * 3 + ny * 6,
          cx - ux * 3 - nx * 6,
          cy - uy * 3 - ny * 6,
        );
      }
    }
  }

  /**
   * Soft darkening at the playfield edges so the board reads as lit from the
   * centre. Sits just above the ground and below everything that moves — an
   * enemy walking in at the left edge must not be dimmed.
   */
  private drawVignette(): void {
    const g = this.add.graphics().setDepth(2);
    const bands = 7;
    for (let i = 0; i < bands; i++) {
      g.lineStyle(4, 0x000000, 0.05 * (bands - i));
      g.strokeRect(i * 4 + 2, i * 4 + 2, GAME_W - i * 8 - 4, PLAYFIELD_H - i * 8 - 4);
    }
  }

  /**
   * Deposits are a separate layer because they change during a run: tiles thin
   * out as they are mined, vanish when exhausted, and prospecting adds new
   * ones. Redrawn only when something actually changed.
   */
  private drawDeposits(): void {
    const g = this.oreLayer.clear();
    this.grid.forEachCell((cell, x, y) => {
      const res = minedResource(cell.kind);
      if (!res) return;
      const px = x * TILE;
      const py = y * TILE;
      // Richness fades as the tile empties — a thinning patch is visible before it dies
      const rich = Phaser.Math.Clamp(cell.reserves / RESERVES[res], 0.15, 1);

      if (res === 'ore') {
        g.fillStyle(0x24382f);
        g.fillRect(px, py, TILE, TILE);
        g.fillStyle(0xb35c1e, rich);
        g.fillCircle(px + 9, py + 11, 4);
        g.fillCircle(px + 22, py + 20, 5);
        if (rich > 0.5) g.fillCircle(px + 13, py + 24, 3);
        g.fillStyle(0xff9f43, rich);
        g.fillCircle(px + 9, py + 11, 2);
        g.fillCircle(px + 22, py + 20, 2.5);
      } else {
        // crystal: cool blue shards on darker rock, unmistakable against the warm ore
        g.fillStyle(0x1f2c3a);
        g.fillRect(px, py, TILE, TILE);
        g.fillStyle(0x2f7f9e, rich);
        g.fillTriangle(px + 10, py + 24, px + 15, py + 6, px + 20, py + 24);
        if (rich > 0.5) g.fillTriangle(px + 20, py + 26, px + 24, py + 13, px + 28, py + 26);
        g.fillStyle(0x6bd4ff, rich);
        g.fillTriangle(px + 13, py + 23, px + 15, py + 9, px + 17, py + 23);
        g.fillStyle(0xc9f0ff, rich);
        g.fillCircle(px + 15, py + 13, 1.5);
      }
    });
  }
}
