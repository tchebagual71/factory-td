import Phaser from 'phaser';
import { BOARD_H, BOARD_W, GAME_H, GAME_W, GRID_H, GRID_W, IS_TOUCH, MAX_DT, PLAYFIELD_H, TILE } from '../config';
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
import { meta } from '../state/meta';
import { clearLocal, consumePendingLoad, consumePendingMap, saveLocal } from '../state/persistence';
import { progress } from '../state/progress';
import { captureRun, SaveV1 } from '../state/serialize';
import { CombatSystem } from '../systems/CombatSystem';
import { ConveyorSystem } from '../systems/ConveyorSystem';
import { GridSystem, minedResource } from '../systems/GridSystem';
import { LogisticsSystem } from '../systems/LogisticsSystem';
import { ProductionSystem } from '../systems/ProductionSystem';
import { WaveSystem } from '../systems/WaveSystem';
import { Building, BuildingType, Dir, ItemType, PathId } from '../types';
import { beltRun } from '../systems/beltPaint';
import { BELT_FRAME_KEYS } from './BootScene';
import {
  BoardCam,
  boardToScreen,
  clampCam,
  clampZoom,
  defaultCam,
  isDefault,
  panBy,
  screenToBoard,
  zoomAbout,
} from './boardCam';
import { inspectorLayout, overlayHit, overlayZones, stripHit, topStrip } from './hudLayout';
import type { BoardOverlayVisibility } from './overlayPresentation';
import { isHudObject } from './hudObjects';
import { binding, GameAction, phaserKeyName } from './keymap';
import { coachMessage } from './coach';
import { sfx } from '../utils/sfx';
import type { IsoView } from '../iso/IsoView';
import { renderMode, setRenderMode } from '../state/renderMode';

/** Concurrent floating-text objects allowed before new ones are dropped. */
const MAX_FLOATERS = 24;

/** Recycled particle emitters. Enough that overlapping puffs never visibly cut each other short. */
const BURST_POOL = 10;

/** Shared scrolling-chevron animation played by every belt. */
const BELT_ANIM = 'belt-run';

/** How long a press must be held to read as sell-instead-of-tap. */
const LONG_PRESS_MS = 450;

/**
 * How far a press must travel before it starts dragging the board. Comfortably
 * below the 12px the tap classifier already forgives, so a gesture can never be
 * both a pan and a tap.
 */
const PAN_SLOP = 8;

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

/** Tap order is a visible contract: the player learns it by cycling in place. */
const SORTER_FILTERS: readonly (ItemType | null)[] = [
  null,
  'ore',
  'crystal',
  'ammo',
  'shell',
  'piercing',
  'coolant',
];

/** The same material colours the item textures use, so the filter reads at a glance. */
const SORTER_FILTER_COLOR: Record<ItemType, number> = {
  ore: 0xb35c1e,
  crystal: 0x2f7f9e,
  ammo: 0xb8962e,
  shell: 0xa85a1e,
  piercing: 0x6bd4ff,
  coolant: 0x9fd8ff,
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
  /** The most recent sale, so rebuilding the same thing on the same tile is detectable. */
  private lastSold: { type: BuildingType; x: number; y: number } | null = null;
  private sellArmed: Building | null = null;
  private sellArmedAt = 0;
  /** long-press bookkeeping — the touch stand-in for right-click-to-sell */
  private pressAt = 0;
  private pressX = 0;
  private pressY = 0;
  /**
   * Tile a press landed on while nothing was selected, held until pointerup
   * decides whether the gesture was a tap, a long-press, or a drag. Nothing on
   * the board may be mutated before that decision.
   */
  private pendingTap: { tx: number; ty: number } | null = null;
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

  /**
   * The isometric renderer, when the player has asked for it. Null in flat
   * mode, and null for one extra beat after that while its (code-split) module
   * loads — every read of it is guarded, and the 2D game is fully playable
   * throughout, so there is nothing to wait on.
   */
  private iso: IsoView | null = null;
  /** guards against a second load being kicked off while the first is in flight */
  private isoLoading = false;

  /** Top-strip geometry — the panel hangs off it, and the board ignores clicks on it. */
  private strip = topStrip(GAME_W, IS_TOUCH);

  /**
   * Board zoom/pan, shared by both renderers. A view setting, never part of a
   * save: it is a per-device comfort control like `ftd:view`, and restoring a
   * run zoomed into a corner would be baffling.
   */
  private cam: BoardCam = defaultCam();
  /** Camera the HUD-ish GameScene objects draw on — never zoomed. */
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  /** Live pinch: the two pointers' spread and midpoint at the last sample. */
  private pinch: { dist: number; mx: number; my: number } | null = null;
  /** Middle-button (or two-finger) pan anchor, in canvas px. */
  private panFrom: { x: number; y: number } | null = null;
  /**
   * Last sample of a one-finger board drag, once it has travelled far enough to
   * be a pan rather than a shaky tap. Separate from `pressX/pressY`, which stay
   * pinned to where the press began so `pointerup` can still measure the total
   * travel and classify the gesture.
   */
  private dragPan: { x: number; y: number } | null = null;

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
  /** Mirrors the panel lifecycle into UIScene's overlay priority. */
  private inspectorOpen = false;
  /** UIScene publishes the live card state; invisible cards must never eat board input. */
  private boardOverlay: BoardOverlayVisibility = { objective: false, coach: false, inspector: false };

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
    // UIScene sleeps across a rebuild, but this scene instance retains fields.
    // Clear the old armed slot before either save hydration or coach emission.
    this.selected = null;
    GameState.events.emit('selected', null);
    // Freeze the score to beat before a single wave clear can move it. Must sit
    // after reset() (which zeroes it) and before applySave().
    GameState.bestWaveAtStart = progress.stats.bestWave;

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
    // Before setupInput so the classifier has already sorted everything built
    // above onto the right camera.
    this.cam = defaultCam();
    this.setupCameras();
    // Set here rather than only on an iso toggle: a flat run that never touches
    // the 3D view still zooms, and the overlay's labels have to follow it.
    this.logistics.project = (x, y) => this.project(x, y);
    this.applyCam();
    this.setupInput();

    if (pending) {
      // A restored run already banked whatever it was granted at the start;
      // re-applying the money and lives here would pay it out a second time.
      // The *mods* still have to be reinstated, since those are never saved.
      GameState.applyMeta({ ...meta.effects(), startMoney: 0, startLives: 0 });
      this.applySave(pending);
    } else {
      // achievement unlock perks apply to fresh runs only (capped ≤ $100 by test)
      const bonus = progress.startBonus();
      if (bonus > 0) {
        GameState.addMoney(bonus);
        this.floatText(640, 200, `+$${bonus} veteran bonus`, '#ffe066');
      }
      // Workshop grants, capped by `metaTree.test.ts` (see "The Workshop")
      const m = meta.effects();
      GameState.applyMeta(m);
      if (m.startMoney > 0 || m.startLives > 0) {
        const parts = [m.startMoney > 0 ? `+$${m.startMoney}` : '', m.startLives > 0 ? `+${m.startLives}♥` : '']
          .filter(Boolean)
          .join('  ');
        this.floatText(640, 230, `${parts} workshop`, '#7cf7c4');
      }
    }

    // Scene events from the UI (off first — create() re-runs on restart)
    GameState.events.off('ui:select').on('ui:select', (t: BuildingType) => this.select(t));
    GameState.events.off('ui:startwave').on('ui:startwave', () => this.waveSystem.start());
    GameState.events.off('ui:menu').on('ui:menu', () => this.exitToMenu());
    GameState.events.off('ui:prospect').on('ui:prospect', () => this.toggleSurveyMode());
    GameState.events.off('ui:rotate').on('ui:rotate', () => this.rotateBuildDir());
    GameState.events.off('ui:sellmode').on('ui:sellmode', () => this.toggleSellMode());
    GameState.events.off('ui:view').on('ui:view', () => this.toggleIso());
    GameState.events.off('ui:pickcard').on('ui:pickcard', (id: string) => this.onPickCard(id));
    GameState.events.off('towerfed').on('towerfed', () => this.emitCoach());
    GameState.events.off('boardoverlay').on('boardoverlay', (visible: BoardOverlayVisibility) => {
      this.boardOverlay = visible;
    });
    this.inspectorOpen = false;
    this.boardOverlay = { objective: false, coach: false, inspector: false };
    GameState.events.emit('inspector', false);
    GameState.events.emit('coachreset');
    GameState.events.emit('boardoverlayrequest');
    GameState.events.off('levelup').on('levelup', () => this.offerCards());
    // Targeted off/on (other scenes listen to these events too; stable refs survive restarts)
    GameState.events.off('phase', this.onPhaseSave).on('phase', this.onPhaseSave);
    GameState.events.off('gameover', this.onGameOverClear).on('gameover', this.onGameOverClear);
    window.removeEventListener('beforeunload', this.onBeforeUnload);
    window.addEventListener('beforeunload', this.onBeforeUnload);
    this.events.once('shutdown', () => {
      window.removeEventListener('beforeunload', this.onBeforeUnload);
      // The 3D canvas is a DOM sibling of Phaser's, so it outlives the scene
      // unless we take it down with us.
      this.disableIso();
    });

    // Built last so it masks a fully populated scene in one pass, restored
    // buildings and all.
    if (renderMode() === 'iso') void this.enableIso();

    // let the HUD's rotate button show the facing this run starts on
    this.sellMode = false;
    this.surveyMode = false;
    this.sellArmed = null;
    GameState.events.emit('builddir', this.buildDir);
    GameState.events.emit('sellmode', false);
    GameState.events.emit('surveymode', false);
    this.ready = true;
    this.emitCoach();
  }

  update(_t: number, deltaMs: number): void {
    if (GameState.gameOver) {
      this.iso?.render(this);
      return;
    }
    if (GameState.frozen) {
      // Pause still lets you plan and build; a frozen ghost would just lie
      // about where the next click lands. (A pending card draw freezes too.)
      this.updateGhost();
      this.iso?.render(this);
      return;
    }
    if (this.saveDirty && GameState.phase === 'build') {
      this.saveTimer -= deltaMs / 1000; // real time, not game-speed scaled
      if (this.saveTimer <= 0) {
        this.saveDirty = false;
        this.saveRun();
      }
    }
    const dt = Math.min(deltaMs / 1000, MAX_DT) * GameState.speed;
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
      this.iso?.syncTerrain(); // the 3D ground thins out on the same cadence
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

    // Last, so the isometric view mirrors a settled frame — exactly the rule
    // LogisticsSystem follows for the same reason.
    this.iso?.render(this);
  }

  // ---------- the isometric view ----------

  /**
   * Swap the playfield between the flat and isometric renderers. The simulation
   * is untouched either way: the 3D view mirrors GameScene's own display list,
   * so a run can be switched mid-wave and nothing skips a beat.
   *
   * Three.js is a heavy dependency for a player who never asks for 3D, so it is
   * imported dynamically and Vite splits it into its own chunk.
   */
  private async enableIso(): Promise<void> {
    if (this.iso || this.isoLoading) return;
    this.isoLoading = true;
    try {
      const { IsoView } = await import('../iso/IsoView');
      // The scene can be torn down while the chunk is in flight.
      if (!this.scene.isActive() || this.iso) return;
      const view = new IsoView(this.game, this.grid);
      view.setSources(() => this.waveSystem.enemies);
      view.attach(this);
      this.iso = view;
      // Same projection GameScene uses, so the overlay's labels can never sit
      // somewhere the floating bounties don't.
      this.logistics.project = (x, y) => this.project(x, y);
      this.depositsDirty = true;
      // Carry the shared zoom/pan into the renderer that just took over. Both
      // views are built from `this.cam`, so a toggle must never be a way to
      // leave the camera state and what is on screen disagreeing.
      this.applyCam();
    } catch (err) {
      console.warn('[factory-td] isometric view unavailable, staying flat', err);
      setRenderMode('2d');
      // Correct the HUD chip: toggleIso flipped it optimistically before the
      // chunk had even landed, and we are not going to 3D after all.
      GameState.events.emit('view', '2d');
      this.floatText(640, 240, '3D UNAVAILABLE', '#ff8b8b');
    } finally {
      this.isoLoading = false;
    }
  }

  private disableIso(): void {
    if (!this.iso) return;
    this.iso.detach(this);
    this.iso.destroy();
    this.iso = null;
    this.logistics.project = (x, y) => this.project(x, y);
    this.applyCam(); // hand the zoom back to the flat camera

  }

  private toggleIso(): void {
    if (this.iso) {
      this.disableIso();
      setRenderMode('2d');
      this.floatText(640, 240, '2D VIEW', '#cdd6e4');
    } else {
      setRenderMode('iso');
      this.floatText(640, 240, '3D ISOMETRIC', '#7cf7c4');
      void this.enableIso();
    }
    // The HUD chip mirrors the renderer rather than tracking it independently,
    // so a failed WebGL init that falls back to flat can't leave it reading 3D.
    GameState.events.emit('view', renderMode());
    sfx.place();
  }

  /**
   * The grid cell under a point in canvas/design pixels. In flat mode that is
   * the tile the point sits in; in isometric it is an exact inverse of the
   * projection onto the ground plane. Every placement, rotation, sale and ghost
   * goes through here, so the two views can never disagree about what the
   * player is pointing at.
   */
  private tileAt(px: number, py: number): { tx: number; ty: number } {
    const b = this.boardAt(px, py);
    return { tx: Math.floor(b.x / TILE), ty: Math.floor(b.y / TILE) };
  }

  /**
   * Board px under a canvas point, in whichever renderer is live and at
   * whatever zoom. The single place screen→board is decided, so picking can
   * never drift from drawing (`project` is its exact inverse).
   */
  private boardAt(px: number, py: number): { x: number; y: number } {
    if (this.iso) return this.iso.boardAt(px, py);
    return screenToBoard(this.cam, px, py, GAME_W, PLAYFIELD_H);
  }

  /**
   * The inverse of `tileAt`: a board position → where it lands on the canvas.
   *
   * Phaser Text is never mirrored into 3D — it keeps rendering on the
   * transparent canvas above, which is what makes the HUD, the wave banner and
   * every floating bounty work unchanged. The cost is that anything anchored to
   * a *place on the board* has to be projected on the way in, or it will sit at
   * flat coordinates over an isometric world.
   */
  project = (x: number, y: number): { x: number; y: number } => {
    // Flat mode is no longer the identity: the world camera zooms and pans
    // while HUD Text does not, so anything anchored to the board has to be
    // brought into screen space here or a floating bounty would land nowhere
    // near the kill that earned it.
    return this.iso ? this.iso.project(x, y) : boardToScreen(this.cam, x, y, GAME_W, PLAYFIELD_H);
  };

  private tintAfford(btn: Phaser.GameObjects.Rectangle, label: Phaser.GameObjects.Text, b: Building, tier: UpgradeTier): void {
    const needFed = isTower(b.type) ? fedRequired(b.type, b.mk + 1) : 0;
    const can = GameState.money >= tier.money && b.ammo >= tier.ammo && b.fed >= needFed;
    btn.setFillStyle(can ? 0x2e7d4f : 0x3a3f52);
    label.setColor(can ? '#ffffff' : '#8892a6');
  }

  // ---------- juice helpers (used by systems) ----------

  /**
   * Rounds currently loaded across every tower on the board. Sampled at the
   * start and end of a wave so the report can say what the fight cost the
   * magazines — the one figure that distinguishes "the factory kept up" from
   * "I had a stockpile and just spent it".
   */
  magazineTotal(): number {
    let n = 0;
    for (const b of this.grid.buildings) if (isTower(b.type)) n += b.ammo;
    return n;
  }

  /**
   * Floating bounty/status text. Capped: a late swift wave is 100+ kills in
   * forty seconds, and every one of these is a fresh canvas texture. Past the
   * cap the numbers are an unreadable pile anyway, so dropping them costs the
   * player nothing and keeps the frame rate honest.
   */
  floatText(bx: number, by: number, msg: string, color: string): void {
    if (this.floaters >= MAX_FLOATERS) return;
    this.floaters += 1;
    // Callers give a place on the board; the drift upwards from there is screen
    // space in both views, which is exactly what a floating number should do.
    const { x, y } = this.project(bx, by);
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

  /**
   * A banner across the middle of the board viewport. Screen space, not board
   * space (Text is HUD — see `hudObjects`), so it is placed as a fraction of
   * the viewport rather than at a literal 260px: the viewport is shorter than
   * the board on a phone, and a fixed offset landed it on the build bar.
   */
  bigText(msg: string): void {
    const y = Math.round(PLAYFIELD_H * 0.41);
    const t = this.add
      .text(GAME_W / 2, y, msg, { fontFamily: 'monospace', fontSize: '32px', fontStyle: 'bold', color: '#ffe066', stroke: '#000', strokeThickness: 6 })
      .setOrigin(0.5)
      .setScale(0.3)
      .setDepth(30);
    this.tweens.add({ targets: t, scale: 1, duration: 250, ease: 'Back.out' });
    this.tweens.add({ targets: t, alpha: 0, y: y - 50, delay: 1300, duration: 600, onComplete: () => t.destroy() });
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
    const layout = inspectorLayout(IS_TOUCH);
    const s = layout.scale;
    const zone = overlayZones(GAME_W, PLAYFIELD_H, this.strip.stats.y + this.strip.h, IS_TOUCH).inspector;
    this.panel = this.add
      .container(zone.x, zone.y)
      .setScale(s)
      .setDepth(40)
      .setVisible(false);
    const bg = this.add.rectangle(0, 0, layout.panel.w, layout.panel.h, 0x141625, 0.94).setOrigin(0).setStrokeStyle(2, 0x2b3040);
    this.panelBg = bg;
    this.panelTitle = this.add.text(10, 7, '', { fontFamily: 'monospace', fontSize: IS_TOUCH ? '20px' : '13px', fontStyle: 'bold', color: '#ffe066' });
    this.panelInfo = this.add.text(10, IS_TOUCH ? 66 : 37, '', { fontFamily: 'monospace', fontSize: IS_TOUCH ? '16px' : '10px', color: '#cdd6e4', lineSpacing: IS_TOUCH ? 4 : 2 });
    // Two fixed button slots: A alone for linear tiers, A+B at the Mk3 branch.
    // Buttons sit below the 4-line branch info (ends ~y85).
    this.panelBtnA = this.add
      .rectangle(layout.buttonA.x, layout.buttonA.y, layout.buttonA.w, layout.buttonA.h, 0x2e7d4f)
      .setOrigin(0)
      .setStrokeStyle(1, 0x5ef078)
      .setInteractive({ useHandCursor: true });
    this.panelBtnA.on('pointerdown', () => this.tryUpgrade(0));
    this.panelBtnAText = this.add
      .text(layout.buttonA.x + layout.buttonA.w / 2, layout.buttonA.y + layout.buttonA.h / 2, 'UPGRADE [U]', { fontFamily: 'monospace', fontSize: IS_TOUCH ? '18px' : '10px', fontStyle: 'bold', color: '#ffffff' })
      .setOrigin(0.5);
    this.panelBtnB = this.add
      .rectangle(layout.buttonB.x, layout.buttonB.y, layout.buttonB.w, layout.buttonB.h, 0x2e7d4f)
      .setOrigin(0)
      .setStrokeStyle(1, 0x5ef078)
      .setInteractive({ useHandCursor: true });
    this.panelBtnB.on('pointerdown', () => this.tryUpgrade(1));
    this.panelBtnBText = this.add
      .text(layout.buttonB.x + layout.buttonB.w / 2, layout.buttonB.y + layout.buttonB.h / 2, '', { fontFamily: 'monospace', fontSize: IS_TOUCH ? '18px' : '10px', fontStyle: 'bold', color: '#ffffff' })
      .setOrigin(0.5);
    // Every tier is paid partly in a *full* magazine and gated on lifetime
    // deliveries, so "how full am I / how much have I been fed?" is the question
    // the panel has to answer — without it a greyed-out button is a mystery.
    // Own row: combined with the title it would overrun the panel.
    this.panelMag = this.add
      .text(10, IS_TOUCH ? 38 : 22, '', { fontFamily: 'monospace', fontSize: IS_TOUCH ? '16px' : '11px', fontStyle: 'bold', color: '#cdd6e4' });
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
      this.setPanelVisible(false);
      return;
    }
    const cur = effStats(b.type, b.mk, b.path, GameState.mods);
    const LABELS: Record<string, string> = { cannon: 'CANNON', lancer: 'LANCER', cryo: 'CRYO FIELD' };
    const label = LABELS[b.type] ?? 'GUN TOWER';
    const pathName = b.path ? ` · ${pathOf(b.type, b.path).name}` : '';
    this.setPanelVisible(true);
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

  private setPanelVisible(visible: boolean): void {
    this.panel.setVisible(visible);
    if (this.inspectorOpen === visible) return;
    this.inspectorOpen = visible;
    GameState.events.emit('inspector', visible);
  }

  private tryUpgrade(choice: 0 | 1 = 0): void {
    const b = this.selTower;
    if (!b || !isTower(b.type) || GameState.gameOver || GameState.awaitingCard || GameState.modalOpen) return;
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
    else if (card.instant === 'cash') {
      const grant = grantAmount(GameState.wave);
      GameState.addMoney(grant);
      progress.record('moneyEarned', grant); // research payouts are earned income, same as a bounty
    }
    GameState.takeCard(id);
    progress.record('researchTaken');
    progress.recordMax('bestResearchLevel', GameState.researchLevel);

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
    progress.flush();
    void clearSave();
    void pushBest(progress.stats.bestWave);
  };

  private onBeforeUnload = (): void => {
    if (this.ready && !GameState.gameOver && GameState.phase === 'build') this.saveRun();
    progress.flush();
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
    progress.flush(); // the menu reads lifetime stats — they must be on disk first
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
      b.filter = sb.filter ?? null;
      b.invested = sb.inv;
      this.paintSorterFilter(b);
      for (let mk = 2; mk <= b.mk; mk++) this.addMkPip(b, mk);
    }
    for (const si of save.items) {
      this.conveyor.restoreItem(si.t, si.cx, si.cy, si.px, si.py, si.a ?? 1);
    }
    this.emitCoach();
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
    // Global shortcuts come off `keymap.ts` for the same reason the palette's
    // do: a hand-written `keydown-` string is how the view toggle silently
    // ended up sharing `V` with the cryo tower. `keymap.test.ts` fails if any
    // key is ever claimed twice.
    const on = (action: GameAction, fn: () => void) => kb.on(`keydown-${binding(action).key}`, fn);

    on('upgradeA', () => this.tryUpgrade(0));
    on('upgradeB', () => this.tryUpgrade(1));
    on('rotate', () => {
      const p = this.input.activePointer;
      this.rotateAt(p.x, p.y, 1);
    });

    on('zoomIn', () => this.zoomAt(1.25, GAME_W / 2, PLAYFIELD_H / 2));
    on('zoomOut', () => this.zoomAt(1 / 1.25, GAME_W / 2, PLAYFIELD_H / 2));
    on('zoomReset', () => this.resetCam());

    // Wheel zooms; Shift-wheel turns the same thing R turns (and turns *back*,
    // which R cannot). Ignored over the HUD so spinning the wheel while reading
    // the build bar does nothing.
    //
    // Rotate used to be the *unmodified* wheel. On a trackpad an ordinary
    // two-finger scroll is a wheel event, so drifting over the factory silently
    // re-plumbed live belts with no click and no undo. Destructive edits do not
    // belong on the gesture a laptop emits by accident.
    this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (dy === 0 || p.y >= PLAYFIELD_H || this.overHud(p.x, p.y)) return;
      const e = p.event as WheelEvent | undefined;
      if (e?.shiftKey) this.rotateAt(p.x, p.y, dy > 0 ? 1 : -1);
      else this.zoomAt(dy > 0 ? 1 / 1.15 : 1.15, p.x, p.y);
    });
    on('cancel', () => {
      if (this.surveyMode) this.toggleSurveyMode();
      else this.select(null);
    });
    on('sendWave', () => this.waveSystem.start());
    on('speed', () => GameState.cycleSpeed());
    on('pause', () => GameState.togglePause());
    on('overlay', () => GameState.toggleOverlay());
    on('view', () => this.toggleIso());

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      // Phaser fires GameObject handlers first and then this scene-level one
      // regardless, so without this guard clicking UPGRADE would immediately
      // deselect the tower underneath and shut the panel it lives in.
      if (p.y >= PLAYFIELD_H || this.overHud(p.x, p.y)) return;
      this.pressAt = this.time.now;
      this.pressX = p.x;
      this.pressY = p.y;
      this.pendingTap = null; // a pointerup we never saw must not act on the next press
      this.dragPan = null;
      const { tx, ty } = this.tileAt(p.x, p.y);
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
        // Deliberately does NOT act yet. This gesture is not classified until
        // pointerup: the same press becomes a tap (rotate / open the panel) or
        // a long-press (sell). Acting here meant a long-press on an assembler
        // rotated it *and then* offered to sell it — cancel the sale and the
        // production line stayed silently re-aimed.
        this.pendingTap = { tx, ty };
      }
    });

    /**
     * Where the gesture that started on the board is classified. A press with
     * nothing selected is ambiguous until it ends: released quickly it is a tap
     * (turn a belt/machine, or open a tower's panel), held it is the touch
     * stand-in for right-click-to-sell, and dragged it was a pan and means
     * nothing at all.
     *
     * Only ever runs while nothing is selected for building, so holding after
     * painting a belt can never refund the belt you just laid down.
     */
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      this.endStroke();
      const tap = this.pendingTap;
      this.pendingTap = null;
      this.dragPan = null;
      if (!tap || p.y >= PLAYFIELD_H || this.selected || this.sellMode || this.overHud(p.x, p.y)) return;

      const held = this.time.now - this.pressAt;
      const moved = Math.hypot(p.x - this.pressX, p.y - this.pressY);
      if (moved > 12) return; // the finger travelled: a pan, not a tap
      const b = this.grid.cellAt(tap.tx, tap.ty)?.building;

      if (held >= LONG_PRESS_MS) {
        if (b) this.requestSell(b);
        return;
      }
      // Sorters spend their tap on configuration; R and Shift+wheel still go
      // through rotateAt, so changing the guaranteed line never also re-aims it.
      // Towers open their panel; every other building turns as before.
      if (b?.type === 'sorter') this.cycleSorterFilter(b);
      else if (b && !isTower(b.type)) this.rotateBuilding(b);
      else this.selectTower(b ?? null);
    });

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      // A live pinch or pan owns the board; painting during one would lay a
      // trail of belts across everything the gesture passes over.
      if (this.updateGesture()) return;
      if (this.panFrom && p.middleButtonDown()) {
        this.panScreen(p.x - this.panFrom.x, p.y - this.panFrom.y);
        this.panFrom = { x: p.x, y: p.y };
        return;
      }
      // Drag the board with one finger when nothing is armed. `pendingTap` is
      // set exactly in that case, and `pointerup` already discards a press that
      // travelled — so this is the gesture the classifier was always calling a
      // pan, finally doing something. It matters now that the board viewport is
      // shorter than the board on a phone: two-finger pinch was the *only* way
      // to reach the rows off screen, which is not a control you can expect a
      // player to find before they need it.
      if (this.pendingTap && p.isDown && !p.rightButtonDown() && p.y < PLAYFIELD_H) {
        if (this.dragPan) {
          this.panScreen(p.x - this.dragPan.x, p.y - this.dragPan.y);
          this.dragPan = { x: p.x, y: p.y };
        } else if (Math.hypot(p.x - this.pressX, p.y - this.pressY) > PAN_SLOP) {
          // Start from here, not from the press: the slop is what protects a tap.
          this.dragPan = { x: p.x, y: p.y };
        }
        return;
      }
      // drag-paint belts (touch drags report no button, so accept either)
      if (this.selected === 'belt' && p.isDown && !p.rightButtonDown() && p.y < PLAYFIELD_H) {
        const t = this.tileAt(p.x, p.y);
        this.paintBeltTo(t.tx, t.ty);
      }
    });

    // Middle-drag pans, the way it does in every map and every editor.
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.middleButtonDown()) this.panFrom = { x: p.x, y: p.y };
    });
    this.input.on('pointerup', () => {
      this.panFrom = null;
    });
  }

  /** Is this canvas point over the open upgrade panel? */
  private overPanel(x: number, y: number): boolean {
    return this.panel.visible && Phaser.Geom.Rectangle.Contains(this.panelBg.getBounds(), x, y);
  }

  /**
   * Anything the board must not react to, even though it is inside the
   * playfield: the open upgrade panel, and the HUD chips floating over the top
   * of the board. Both are UI drawn above the world, and Phaser delivers the
   * scene-level pointer event regardless of what handled it first.
   */
  private overHud(x: number, y: number): boolean {
    const zones = overlayZones(GAME_W, PLAYFIELD_H, this.strip.stats.y + this.strip.h, IS_TOUCH);
    return this.overPanel(x, y) || stripHit(this.strip, x, y) || overlayHit(zones, x, y, {
      objective: this.boardOverlay.objective,
      coach: this.boardOverlay.coach,
      inspector: this.boardOverlay.inspector,
    });
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

  /**
   * Factorio's rule, shared by `R` and the scroll wheel: turn whatever is under
   * the cursor, or the thing you are about to build when the cursor is over
   * bare ground. Towers have no facing, so they are never turned.
   */
  private rotateAt(x: number, y: number, step: number): void {
    const t = this.tileAt(x, y);
    const b = y < PLAYFIELD_H ? this.grid.cellAt(t.tx, t.ty)?.building : null;
    if (b && !isTower(b.type) && !this.selected) this.rotateBuilding(b, step);
    else this.rotateBuildDir(step);
  }

  // ---------- board zoom & pan ----------

  /**
   * Split the scene across two cameras: the world zooms, the HUD does not.
   *
   * Without this, zooming in would also magnify the upgrade panel and throw
   * every floating bounty off screen — they live in GameScene, not UIScene.
   * The world/HUD rule is shared with the isometric mask (`hudObjects.ts`) so
   * the two can never classify an object differently.
   *
   * The world camera is clipped to the playfield so a zoomed board cannot
   * spill over the build bar.
   */
  private setupCameras(): void {
    const main = this.cameras.main;
    main.setViewport(0, 0, GAME_W, PLAYFIELD_H);
    this.uiCam = this.cameras.add(0, 0, GAME_W, GAME_H, false, 'ui');

    const classify = (obj: Phaser.GameObjects.GameObject) => {
      if (isHudObject(obj)) main.ignore(obj);
      else this.uiCam.ignore(obj);
    };
    for (const obj of this.children.list) classify(obj);
    this.events.on(Phaser.Scenes.Events.ADDED_TO_SCENE, classify);
    this.events.once('shutdown', () => this.events.off(Phaser.Scenes.Events.ADDED_TO_SCENE, classify));
  }

  /** Push the shared camera state into whichever renderer is live. */
  private applyCam(): void {
    if (this.iso) this.iso.setView(this.cam.zoom, this.cam.x, this.cam.y);
    else {
      this.cameras.main.setZoom(this.cam.zoom);
      this.cameras.main.centerOn(this.cam.x, this.cam.y);
    }
    GameState.events.emit('zoom', this.cam.zoom);
  }

  /**
   * Zoom about a fixed screen point, so whatever is under the cursor or the
   * pinch midpoint stays there. In isometric the pan is solved in one step:
   * panning translates the board under a fixed pixel by exactly the pan delta
   * (pinned in `isoMath.test.ts`), so no iteration is needed.
   */
  private zoomAt(factor: number, sx: number, sy: number): void {
    if (this.iso) {
      const before = this.iso.boardAt(sx, sy);
      const zoom = clampZoom(this.cam.zoom * factor);
      this.cam = clampCam({ zoom, x: this.cam.x, y: this.cam.y }, GAME_W, PLAYFIELD_H);
      this.iso.setView(this.cam.zoom, this.cam.x, this.cam.y);
      const after = this.iso.boardAt(sx, sy);
      this.cam = clampCam(
        { zoom: this.cam.zoom, x: this.cam.x + (before.x - after.x), y: this.cam.y + (before.y - after.y) },
        GAME_W,
        PLAYFIELD_H,
      );
    } else {
      this.cam = zoomAbout(this.cam, factor, sx, sy, GAME_W, PLAYFIELD_H);
    }
    this.applyCam();
  }

  /**
   * Two-finger pinch-zoom and pan — the gesture every phone user already knows,
   * and the reason this feature exists at all: at zoom 1 a 32px tile is about
   * 15 css px on a phone in landscape, roughly a third of a fingertip.
   *
   * Returns true while a gesture owns the board, so the caller knows to skip
   * belt painting. `main.ts` raises `activePointers` to 2 for this; the first
   * pointer's in-flight stroke is abandoned the moment a second finger lands,
   * which is what keeps the original "a second finger must never start a rival
   * stroke" guarantee intact.
   */
  private updateGesture(): boolean {
    const [a, b] = this.input.manager.pointers.filter((p) => p.isDown && p.y < PLAYFIELD_H);
    if (!a || !b) {
      this.pinch = null;
      return false;
    }
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    if (this.pinch) {
      // Pan by the midpoint's travel and zoom by the spread's ratio, both in
      // the same frame — that combination is what makes a pinch feel direct.
      this.panScreen(mx - this.pinch.mx, my - this.pinch.my);
      if (this.pinch.dist > 8 && dist > 8) this.zoomAt(dist / this.pinch.dist, mx, my);
    } else {
      // A gesture just began: throw away whatever the first finger was drawing.
      this.endStroke();
    }
    // The pinch owns the board now. Dropping the one-finger anchor stops the
    // board jumping by the pinch's whole travel when the second finger lifts.
    this.dragPan = null;
    this.pinch = { dist, mx, my };
    return true;
  }

  private panScreen(dx: number, dy: number): void {
    this.cam = panBy(this.cam, dx, dy, GAME_W, PLAYFIELD_H);
    this.applyCam();
  }

  private resetCam(): void {
    if (isDefault(this.cam)) return;
    this.cam = defaultCam();
    this.applyCam();
    this.floatText(GAME_W / 2, 240, 'VIEW RESET', '#cdd6e4');
  }

  /** `step` of -1 turns anticlockwise — the scroll wheel's other direction. */
  private rotateBuildDir(step = 1): void {
    this.buildDir = (((this.buildDir + step) % 4) + 4) % 4 as Dir;
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
    // A modal owns the keyboard while it is up: during a card draw "1" picks a
    // card and must not also select a belt behind it, and a build hotkey pressed
    // while the help reference is open would leave a building armed the moment
    // it closed. (Pointer input is already swallowed by the modal's dim.)
    if (GameState.awaitingCard || GameState.modalOpen) return;
    // Choosing the armed slot again cancels it. On touch there is no ESC and no
    // right-click, so without this a player who taps BELT is stuck in belt mode.
    if (type !== null && type === this.selected) type = null;
    this.selected = type;
    GameState.events.emit('selected', type);
    this.emitCoach();
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
    const flat = type === 'belt' || type === 'splitter' || type === 'sorter' || type === 'tunnel';
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
      filter: null,
      timer: 0,
      crafting: false,
      inputs: {},
      outputBuf: 0,
      // Preloaded Mags never overfills the magazine — a tower that opened above
      // its own cap would read as a broken ammo bar.
      ammo: tower ? Math.min(TOWERS[type].ammoCap, TOWERS[type].startAmmo + GameState.startAmmoBonus) : 0,
      fed: 0,
      cooldown: 0,
      mk: 1,
      path: null,
      invested: costOf(type),
      stalled: false,
      stallReason: null,
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
    if (type === 'belt') progress.record('beltsBuilt');
    // "Sold it, then put the same thing straight back" — the move every
    // factory player makes ten times a run. Only the most recent sale counts,
    // so this can't be farmed by selling a row and rebuilding it later.
    if (this.lastSold && this.lastSold.type === type && this.lastSold.x === tx && this.lastSold.y === ty) {
      this.lastSold = null;
      progress.record('rebuilds');
    }
    progress.recordMax('biggestFactory', this.grid.buildings.length);
    this.requestSave();
    this.emitCoach();
    return b;
  }

  /** Turn a placed belt/machine 90°. Free and reversible — four clicks is a full circle. */
  private rotateBuilding(b: Building, step = 1): void {
    b.dir = (((b.dir + step) % 4) + 4) % 4 as Dir;
    b.sprite.setRotation((b.dir * Math.PI) / 2);
    this.tweens.add({ targets: b.sprite, scale: 1.12, duration: 70, yoyo: true });
    sfx.place();
    this.requestSave();
  }

  /** Advance the one in-world configuration this building owns. */
  private cycleSorterFilter(b: Building): void {
    const current = b.filter ?? null;
    const next = (SORTER_FILTERS.indexOf(current) + 1) % SORTER_FILTERS.length;
    b.filter = SORTER_FILTERS[next];
    // The index means three outputs when unconfigured and two when configured;
    // restarting it makes the first choice predictable after either transition.
    b.outIdx = 0;
    this.paintSorterFilter(b);
    this.tweens.add({ targets: b.sprite, scale: 1.12, duration: 70, yoyo: true });
    sfx.place();
    this.requestSave();
  }

  /** Null keeps the pale procedural art; a real filter wears its item's colour. */
  private paintSorterFilter(b: Building): void {
    if (b.type !== 'sorter') return;
    const filter = b.filter ?? null;
    if (filter) b.sprite.setTint(SORTER_FILTER_COLOR[filter]);
    else b.sprite.clearTint();
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
    // Unjam before you demolish. A single item that no downstream machine will
    // accept parks at the head of a belt forever and backs the whole line up
    // behind it — and the only recovery used to be selling the belt out from
    // under it and rebuilding, which is the factory game equivalent of burning
    // the house down to get rid of a wasp. Only carriers can
    // hold an item at all, so `b.item` is the whole test.
    if (b.item) {
      this.conveyor.destroyItem(b.item);
      b.item = null;
      this.floatText(b.x * TILE + 16, b.y * TILE + 4, 'cleared', '#9aa7bd');
      this.burst(b.x * TILE + 16, b.y * TILE + 16, 0x9aa7bd, 5);
      sfx.sell();
      // Deliberately does not fall through to the sale: the belt survives, and a
      // second click (now that the cell is empty) sells it as it always did.
      this.requestSave();
      return;
    }
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
    progress.record('sold');
    this.lastSold = { type: b.type, x: b.x, y: b.y };
    this.requestSave();
    this.emitCoach();
  }

  /** Refresh onboarding whenever placement facts or the armed build tool changes. */
  private emitCoach(): void {
    GameState.events.emit(
      'coach',
      coachMessage({
        buildings: this.grid.buildings.map((b) => b.type),
        fedDefense: this.grid.buildings.some((b) => isTower(b.type) && b.fed > 0),
        selected: this.selected,
      }),
    );
  }

  private updateGhost(): void {
    const p = this.input.activePointer;
    const { tx, ty } = this.tileAt(p.x, p.y);

    // Survey mode owns the cursor: show the footprint you are about to buy.
    if (this.surveyMode) {
      this.ghost.setAlpha(0);
      this.rangeCircle.setVisible(false);
      const g = this.surveyGhost.clear();
      if (p.y >= PLAYFIELD_H) {
        this.iso?.setSurvey(null);
        return;
      }
      const s = this.surveyOrigin(tx, ty);
      const ok = this.grid.isClearArea(s.x, s.y, s.w, s.h);
      // The footprint is a Graphics fill, which has no 3D counterpart to mirror
      // — the isometric view paints it on the ground itself.
      this.iso?.setSurvey(s, ok);
      g.fillStyle(ok ? 0x5ef078 : 0xff5555, 0.18);
      g.fillRect(s.x * TILE, s.y * TILE, s.w * TILE, s.h * TILE);
      g.lineStyle(2, ok ? 0x5ef078 : 0xff5555, 0.9);
      g.strokeRect(s.x * TILE, s.y * TILE, s.w * TILE, s.h * TILE);
      return;
    }
    this.iso?.setSurvey(null);

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
    progress.record('patchesDrained');
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
      const cost = prospectCost(GameState.surveys, GameState.surveyDiscount);
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
    const cost = prospectCost(GameState.surveys, GameState.surveyDiscount);
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

    progress.record('surveysBought');
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
    for (let x = 0; x <= GRID_W; x++) g.lineBetween(x * TILE, 0, x * TILE, BOARD_H);
    for (let y = 0; y <= GRID_H; y++) g.lineBetween(0, y * TILE, BOARD_W, y * TILE);

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
        if (cx < -TILE || cx > BOARD_W + TILE || cy < -TILE || cy > BOARD_H + TILE) continue;
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
      g.strokeRect(i * 4 + 2, i * 4 + 2, BOARD_W - i * 8 - 4, BOARD_H - i * 8 - 4);
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
