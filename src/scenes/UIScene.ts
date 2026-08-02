import Phaser from 'phaser';
import { GAME_H, GAME_W, IS_TOUCH, PLAYFIELD_H, ROOMY_UI, UI_H } from '../config';
import { AchievementDef } from '../data/achievements';
import { BUILD_CATEGORIES, BUILD_INFO, buildGroupSizes, categoryOf } from '../data/buildings';
import { ComboState, comboColor, comboExpired, comboNow, comboTier } from '../data/combo';
import { activeMap, prospectCost, prospectKind } from '../data/map';
import { ActiveMission, MissionDef, missionDef, missionProgress } from '../data/missions';
import { rarityStyle, sortForReveal } from '../data/rarity';
import { ResearchCard, researchForLevel } from '../data/research';
import { gradeRun } from '../data/score';
import { earlySendBonus, waveDef, WAVE_KIND_LABEL } from '../data/waves';
import { pushAchievements } from '../services/cloud';
import { ammoDeficits, ammoTotal, ammoUndelivered, GameState, WaveTally } from '../state/GameState';
import { meta } from '../state/meta';
import { progress } from '../state/progress';
import { renderMode } from '../state/renderMode';
import { BuildingType } from '../types';
import { isMuted, sfx, toggleMute } from '../utils/sfx';
import { cardDrawLayout, comboAnchor, fitCardCopy, gameOverLayout, hudCardCopyLimits, HudLayout, hudLayout, legendBand, overlayZones, reportCard, slotContent, STRIP } from './hudLayout';
import { overlayPlan } from './overlayPolicy';
import { boardOverlayVisibility, nextMissionId, presentedMissionId, type BoardOverlayVisibility } from './overlayPresentation';
import { OverlayScheduler } from './overlayScheduler';
import type { CoachMessage } from './coach';
import { binding, key } from './keymap';
import { UI_COLOR, UI_FONT, UI_SPACE, controlVisual } from './uiTheme';

const FONT = { fontFamily: UI_FONT.mono };
/** A board short enough that HUD chrome has to earn its pixels. See `overlayZones`. */
const CRAMPED_BOARD = PLAYFIELD_H < 420;

interface ToastNotice {
  name: string;
  desc: string;
}

/** HUD overlay: top-left stat chips, bottom build palette + wave control. */
export class UIScene extends Phaser.Scene {
  private moneyText!: Phaser.GameObjects.Text;
  private livesText!: Phaser.GameObjects.Text;
  private waveText!: Phaser.GameObjects.Text;
  private previewText!: Phaser.GameObjects.Text;
  private waveBtn!: Phaser.GameObjects.Rectangle;
  private waveBtnText!: Phaser.GameObjects.Text;
  private speedBtnText!: Phaser.GameObjects.Text;
  private autoBtn!: Phaser.GameObjects.Rectangle;
  private autoBtnText!: Phaser.GameObjects.Text;
  private paletteFrames = new Map<BuildingType, Phaser.GameObjects.Rectangle>();
  private paletteButtons = new Map<BuildingType, Phaser.GameObjects.Container>();
  /** one reusable status line per slot; selection and affordability only repaint its text */
  private paletteState = new Map<BuildingType, Phaser.GameObjects.Text>();
  /** each slot's category tint, so deselecting restores the right rim colour */
  private slotColor = new Map<BuildingType, number>();
  /** currently armed build type — drives the selection ring and the touch description */
  private selectedType: BuildingType | null = null;
  /** greyed-out state last painted per slot, so an affordability sweep is a no-op when nothing changed */
  private slotAffordable = new Map<BuildingType, boolean>();
  private helpLayer: Phaser.GameObjects.GameObject[] = [];
  /** bottom edge of the status strip — anything that floats over the board hangs off this */
  /** Tab chrome and the shelf each palette slot belongs to — tabbed (touch) bars only. */
  private tabParts: { frame: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text; color: number }[] = [];
  private slotShelf: { container: Phaser.GameObjects.Container; group: number }[] = [];
  private shelf = 0;
  /** Pending auto-hide for the UNDO chip, cancelled if another sale re-arms it. */
  private undoHide?: Phaser.Time.TimerEvent;
  /** Pending fade for the transient zoom readout. */
  private zoomHide?: Phaser.Time.TimerEvent;
  private stripBottom = 38;
  private descText!: Phaser.GameObjects.Text;
  private overlay: Phaser.GameObjects.GameObject[] = [];
  private earlyText!: Phaser.GameObjects.Text;
  private prospectText!: Phaser.GameObjects.Text;
  private mapText!: Phaser.GameObjects.Text;
  private toastQueue: ToastNotice[] = [];
  private toastActive = false;
  private overlayScheduler = new OverlayScheduler();
  private menuConfirm = false;
  private surveyArmed = false;
  private researchBar!: Phaser.GameObjects.Rectangle;
  private researchText!: Phaser.GameObjects.Text;
  private cardLayer: Phaser.GameObjects.GameObject[] = [];
  private cardKeyHandlers: { key: string; handler: () => void }[] = [];
  private summaryCard: Phaser.GameObjects.Container | null = null;
  private comboText!: Phaser.GameObjects.Text;
  /** last streak count painted, so an unchanged streak costs no `setText` */
  private comboShown = 0;
  private missionCard!: {
    container: Phaser.GameObjects.Container;
    frame: Phaser.GameObjects.Rectangle;
    name: Phaser.GameObjects.Text;
    progress: Phaser.GameObjects.Text;
    fill: Phaser.GameObjects.Rectangle;
    extra: Phaser.GameObjects.Text;
  };
  private coachCard!: Phaser.GameObjects.Container;
  private coachStep!: Phaser.GameObjects.Text;
  private coachAction!: Phaser.GameObjects.Text;
  private coachContext = '';
  private toastCard: Phaser.GameObjects.Container | null = null;
  private queuedSummary: { wave: number; tally: WaveTally } | null = null;
  private terminalOpen = false;
  private inspectorOpen = false;
  private coachDismissed = false;
  /** UI-local cursor: rotating the contract card never mutates GameState.missions. */
  private presentedMission: string | null = null;
  private boardOverlay: BoardOverlayVisibility = { objective: false, coach: false, inspector: false };

  constructor() {
    super('ui');
  }

  /**
   * Interactive objects in this top scene hide captured pointer phases from
   * GameScene. Forward those phases after the HUD object handler has run so a
   * second touch can cancel board work without changing the HUD action.
   */
  private setupTouchForwarding(): void {
    this.input.on(
      'pointerdown',
      (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
        if (p.wasTouch && over.length > 0) GameState.events.emit('ui:touchdown', p);
      },
    );
    this.input.on(
      'pointerup',
      (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
        if (p.wasTouch && over.length > 0) GameState.events.emit('ui:touchup', p);
      },
    );
    this.input.on('pointerupoutside', (p: Phaser.Input.Pointer) => {
      if (p.wasTouch) GameState.events.emit('ui:touchupoutside', p);
    });
  }

  create(): void {
    this.setupTouchForwarding();
    // ----- top status strip (pure geometry: see hudLayout.topStrip) -----
    const top = STRIP;
    this.stripBottom = top.stats.y + top.h;
    const chipFont = IS_TOUCH ? UI_FONT.touchPrimary : UI_FONT.desktopPrimary;
    const cellW = Math.floor((top.stats.w - UI_SPACE[1] * 2) / 3);
    const statCells: [string, number][] = [
      ['FUNDS', UI_COLOR.money.hex],
      ['INTEGRITY', UI_COLOR.danger.hex],
      ['WAVE', UI_COLOR.logistics.hex],
    ];

    this.add.rectangle(top.stats.x, top.stats.y, top.stats.w, top.h, UI_COLOR.surface.hex, 0.96).setOrigin(0).setDepth(0);
    statCells.forEach(([label, accent], i) => {
      const x = top.stats.x + UI_SPACE[1] + i * cellW;
      this.add
        .rectangle(x, top.stats.y + 2, cellW - UI_SPACE[0], top.h - UI_SPACE[0], UI_COLOR.surfaceRaised.hex, 0.98)
        .setOrigin(0)
        .setStrokeStyle(1, UI_COLOR.line.hex);
      // The caption is dropped where the board is short: "$450", "♥20" and
      // "Wave 1" already say what they are, and on a phone these three words
      // were three lines of noise across the top of the playfield.
      if (!CRAMPED_BOARD) {
        this.add
          .text(x + UI_SPACE[0], top.stats.y + 4, label, {
            fontFamily: UI_FONT.mono, fontSize: IS_TOUCH ? '8px' : '7px', fontStyle: 'bold', color: UI_COLOR.textMuted.css,
          })
          .setOrigin(0, 0);
      }
      this.add.rectangle(x + UI_SPACE[0], top.stats.y + top.h - 3, cellW - UI_SPACE[2], 1, accent, 0.9).setOrigin(0);
    });
    const valueX = (i: number) => top.stats.x + UI_SPACE[1] + i * cellW + UI_SPACE[0];
    const valueY = CRAMPED_BOARD ? top.stats.y + top.h / 2 + 8 : top.stats.y + top.h - (IS_TOUCH ? 8 : 6);
    this.moneyText = this.add
      .text(valueX(0), valueY, '', { fontFamily: UI_FONT.mono, fontSize: `${chipFont}px`, fontStyle: 'bold', color: UI_COLOR.money.css })
      .setOrigin(0, 1);
    this.livesText = this.add
      .text(valueX(1), valueY, '', { fontFamily: UI_FONT.mono, fontSize: `${chipFont}px`, fontStyle: 'bold', color: UI_COLOR.danger.css })
      .setOrigin(0, 1);
    this.waveText = this.add
      .text(valueX(2), valueY, '', { fontFamily: UI_FONT.mono, fontSize: `${chipFont}px`, fontStyle: 'bold', color: UI_COLOR.text.css })
      .setOrigin(0, 1);
    const cy = top.stats.y + top.h / 2;

    // ----- prospecting -----
    const prospectBtn = this.add
      .rectangle(top.survey.x, top.survey.y, top.survey.w, top.h, UI_COLOR.surface.hex, 0.98)
      .setOrigin(0)
      .setStrokeStyle(2, UI_COLOR.line.hex)
      .setInteractive({ useHandCursor: true });
    this.prospectText = this.add
      .text(top.survey.x + top.survey.w / 2, cy, '', {
        fontFamily: UI_FONT.mono, fontSize: `${IS_TOUCH ? 14 : 12}px`, fontStyle: 'bold', color: UI_COLOR.text.css,
      })
      .setOrigin(0.5);
    prospectBtn.on('pointerover', () => prospectBtn.setFillStyle(controlVisual('hover').fill, 0.98));
    prospectBtn.on('pointerout', () => prospectBtn.setFillStyle(controlVisual('idle').fill, 0.98));
    prospectBtn.on('pointerdown', () => GameState.events.emit('ui:prospect'));
    GameState.events.on('surveys', () => this.refreshStats());
    // Armed survey mode: the button stays lit until a site is picked or cancelled
    GameState.events.on('surveymode', (on: boolean) => {
      this.surveyArmed = on;
      prospectBtn.setStrokeStyle(2, on ? UI_COLOR.action.hex : UI_COLOR.line.hex);
      this.refreshStats();
    });

    // Which layout this run is on. UIScene sleeps rather than stopping, so this
    // is refreshed with the stats instead of being captured once at create().
    this.mapText = this.add
      .text(top.map.x + top.map.w, cy, '', { fontFamily: UI_FONT.mono, fontSize: '11px', fontStyle: 'bold', color: UI_COLOR.textMuted.css })
      .setOrigin(1, 0.5);

    // ----- research chip -----
    // Progress toward the next level-up draw. It only appears once a Lab has
    // actually banked something, so a player who never builds one is not
    // nagged by an empty bar.
    const rr = top.research;
    const researchBox = this.add
      .rectangle(rr.x, rr.y, rr.w, top.h, UI_COLOR.surface.hex, 0.98)
      .setOrigin(0)
      .setStrokeStyle(2, UI_COLOR.line.hex)
      .setVisible(false);
    const barW = rr.w - 6;
    this.researchBar = this.add.rectangle(rr.x + 3, rr.y + top.h - 3, 0, 4, UI_COLOR.research.hex).setOrigin(0, 1).setVisible(false);
    this.researchText = this.add
      .text(rr.x + 6, rr.y + 4, '', { fontFamily: UI_FONT.mono, fontSize: '12px', fontStyle: 'bold', color: UI_COLOR.research.css })
      .setVisible(false);
    GameState.events.on('research', (points: number, level: number) => {
      const need = researchForLevel(level + 1);
      const show = level > 0 || points > 0;
      researchBox.setVisible(show);
      this.researchBar.setVisible(show);
      this.researchText.setVisible(show);
      // Research banks as an exact fraction (see ConveyorSystem); the player is
      // shown whole points, floored so the bar never claims a level is reached
      // a fraction before it is.
      this.researchText.setText(`⚗ RESEARCH  Lv${level}   ${Math.floor(points)}/${need}`);
      this.researchBar.width = Math.round(barW * Phaser.Math.Clamp(points / need, 0, 1));
    });

    // ----- help & mute (right end of the strip) -----
    // Both were previously bare glyphs; on a phone the whole canvas is scaled
    // down to fit, so a 16px label is not a hittable target.
    const help = this.hudButton(top.help.x, top.help.y, top.help.w, top.h, '?', IS_TOUCH ? 22 : 17, () =>
      this.showHelp(),
    );
    help.label.setColor(UI_COLOR.textMuted.css);
    this.input.keyboard?.on(`keydown-${binding('help').key}`, () => this.showHelp());

    const mute = this.hudButton(top.mute.x, top.mute.y, top.mute.w, top.h, '', IS_TOUCH ? 20 : 16, () =>
      applyMute(toggleMute()),
    );
    const applyMute = (m: boolean) => mute.label.setText(m ? '✕' : '♪').setColor(m ? UI_COLOR.textMuted.css : UI_COLOR.action.css);
    applyMute(isMuted());
    this.input.keyboard?.on(`keydown-${binding('mute').key}`, () => applyMute(toggleMute()));

    // 2D ↔ 3D. GameScene owns the renderer, so this only asks. It exists as a
    // chip because the shortcut is keyboard-only and a phone has no keyboard —
    // the 3D board was simply unreachable mid-run on touch.
    const view = this.hudButton(top.view.x, top.view.y, top.view.w, top.h, '', IS_TOUCH ? 15 : 13, () =>
      GameState.events.emit('ui:view'),
    );
    const applyView = (mode: string) =>
      view.label.setText(mode === 'iso' ? '3D' : '2D').setColor(mode === 'iso' ? UI_COLOR.research.css : UI_COLOR.textMuted.css);
    applyView(renderMode());
    GameState.events.on('view', applyView);
    // ESC is the universal "get this off my screen" — GameScene also uses it to
    // clear the build selection, which is the right thing to happen either way.
    this.input.keyboard?.on('keydown-ESC', () => this.closeHelp());

    // ----- pause overlay -----
    const pauseDim = this.add.rectangle(0, 0, GAME_W, PLAYFIELD_H, 0x000000, 0.45).setOrigin(0).setDepth(40).setVisible(false);
    const pauseText = this.add
      .text(GAME_W / 2, PLAYFIELD_H / 2, IS_TOUCH ? 'PAUSED\ntap ▶ to resume' : `PAUSED\n[${key('pause')}] to resume`, { ...FONT, fontSize: '36px', fontStyle: 'bold', color: '#ffe066', align: 'center', stroke: '#000', strokeThickness: 6 })
      .setOrigin(0.5)
      .setDepth(41)
      .setVisible(false);
    GameState.events.on('paused', (p: boolean) => {
      pauseDim.setVisible(p);
      pauseText.setVisible(p);
    });

    // ----- bottom bar -----
    // Three zones, sized from UI_H so a 4:3 tablet spends its extra height on a
    // bigger HUD instead of letterbox bars: palette | touch controls | wave cluster.
    const layout = hudLayout({
      gameW: GAME_W,
      barY: PLAYFIELD_H,
      barH: UI_H,
      roomy: ROOMY_UI,
      touch: IS_TOUCH,
      groups: buildGroupSizes(),
      // Tabs only where the bar is genuinely short of room — a phone. A desktop
      // shows all thirteen at once and always should, and so does a tablet,
      // whose 4:3 screen already spends its surplus height on a roomy bar.
      // Swapping a glance for a tap is a cost, only worth paying to buy back a
      // board that would otherwise be under a third of the screen.
      tabbed: IS_TOUCH && UI_H < 200,
    });

    this.add.rectangle(layout.deck.x, layout.deck.y, layout.deck.w, layout.deck.h, UI_COLOR.surface.hex).setOrigin(0);
    this.add.rectangle(layout.deck.x, layout.deck.y, layout.deck.w, 2, UI_COLOR.lineBright.hex).setOrigin(0);

    // Palette construction shows its contextual hint immediately, so its target
    // has to exist before the slots are created.
    this.buildCoach();
    if (layout.tabs.length > 0) this.buildTabs(layout);
    this.buildPalette(layout);
    // LOGISTICS opens: belts are the first thing anyone places.
    if (layout.tabs.length > 0) this.showShelf(0);
    if (IS_TOUCH) this.buildTouchControls(layout);
    this.buildUndoChip();
    this.buildZoomReadout();
    this.buildWaveCluster(layout);

    // Below the objective card and the toast, not merely below the strip: this
    // is ~860px of centred text and it used to lie straight across the objective
    // card. See `legendY`.
    const band = legendBand(overlayZones(GAME_W, PLAYFIELD_H, top.stats.y + top.h, IS_TOUCH), IS_TOUCH);
    const legend = this.add
      .text(band.x + band.w / 2, band.y, 'LOGISTICS  ·  tower % = ammo uptime last wave  ·  green belts flowing, red jammed  ·  orange rings = starved or backed up', {
        ...FONT, fontSize: '11px', color: '#cdd6e4', backgroundColor: '#000000cc', padding: { x: 8, y: 4 },
        align: 'center', wordWrap: { width: band.w - 16 },
      })
      .setOrigin(0.5, 0)
      .setDepth(30)
      .setVisible(false);
    GameState.events.on('overlay', (on: boolean) => legend.setVisible(on));

    // ----- kill streak meter -----
    // In the gap between the objective card and the achievement toast, not hard
    // against the right edge: the toast zone *is* the right edge, so the old
    // placement put an achievement unlock on top of the streak counter. Hidden
    // below tier 1 (see combo.ts) so ordinary trickle kills never put chrome on
    // screen. See `comboAnchor`.
    const combo = comboAnchor(
      overlayZones(GAME_W, PLAYFIELD_H, top.stats.y + top.h, IS_TOUCH),
      this.stripBottom,
      IS_TOUCH,
    );
    this.comboText = this.add
      .text(combo.x, combo.y, '', {
        ...FONT, fontSize: '20px', fontStyle: 'bold', color: '#ffe066', stroke: '#000', strokeThickness: 4,
      })
      .setOrigin(1, 0)
      .setDepth(30)
      .setVisible(false);
    GameState.events.on('combo', (c: ComboState) => this.refreshCombo(c));

    // Mission cards live under the top-left status strip. Completion toasts use
    // the same lane and briefly cover them, then reveal the replacement card;
    // objective -> payout -> new objective reads as one continuous beat.
    this.buildMissionCards();

    // ----- state listeners -----
    const ev = GameState.events;
    ev.on('money', () => this.refreshStats(true));
    ev.on('lives', () => this.refreshStats());
    ev.on('wave', () => {
      this.refreshStats();
      this.refreshPreview();
    });
    ev.on('phase', () => {
      this.refreshWaveBtn();
      // The report describes the wave you just finished, so sending the next one
      // is exactly the moment it stops being useful — and the moment you want
      // the whole board back.
      if (GameState.phase === 'wave') this.closeReportNow();
    });
    ev.on('selected', (t: BuildingType | null) => this.refreshSelection(t));
    ev.on('coach', (message: CoachMessage) => this.refreshCoach(message));
    ev.on('inspector', (open: boolean) => {
      this.inspectorOpen = open;
      this.applyOverlayPlan();
    });
    ev.on('coachreset', () => {
      this.coachDismissed = false;
      this.applyOverlayPlan();
    });
    ev.on('boardoverlayrequest', () => this.syncBoardOverlay(overlayPlan({ terminal: this.terminalOpen, blocking: this.helpLayer.length > 0 || this.cardLayer.length > 0, report: this.summaryCard !== null, transient: this.toastActive, inspector: this.inspectorOpen }), true));
    ev.on('gameover', () => {
      // A pending draw (or an open help panel) would otherwise sit on top of the
      // game-over buttons and keep the sim frozen with no way out.
      this.terminalOpen = true;
      this.queuedSummary = null;
      this.dismissReport();
      this.clearAllToasts();
      this.clearCards();
      this.closeHelp();
      GameState.finishDraw();
      // Compare against the run-start snapshot, not the live stat: WaveSystem
      // has been bumping bestWave on every clear, so by now it equals the wave
      // we died on and nothing could ever beat it.
      const prevBest = GameState.bestWaveAtStart;
      progress.recordMax('bestWave', GameState.wave);
      const newBest = prevBest > 0 && GameState.wave > prevBest;
      // Bank the run's ⚙ SCRAP before the card is drawn, so the number shown is
      // the number already in the wallet — no "pending" state to get lost if the
      // player closes the tab on the game-over screen.
      const earned = meta.award({
        wave: GameState.wave,
        kills: GameState.runKills,
        bestStreak: GameState.combo.best,
        newBest,
      });
      this.showGameOver(newBest, earned);
    });
    ev.on('achievement', (def: AchievementDef) => {
      this.toastQueue.push({
        name: def.name,
        desc: def.unlock ? `${def.desc} — ${def.unlock.label}` : def.desc,
      });
      this.pumpToasts();
      void pushAchievements([def.id]);
    });
    ev.on('missioncomplete', (def: MissionDef, mission: ActiveMission) => {
      // Payouts bypass WaveTally.income so reports still describe throughput
      // earnings, but the cash genuinely counts toward the lifetime total.
      progress.record('moneyEarned', mission.payout);
      this.toastQueue.push({ name: `MISSION COMPLETE  ${def.name}`, desc: `${def.desc} — +$${mission.payout}` });
      this.pumpToasts();
    });
    ev.on('missions', () => this.refreshMissionCards());
    ev.on('speed', (s: number) => this.speedBtnText.setText(`SPEED ×${s}`).setColor(s > 1 ? UI_COLOR.money.css : UI_COLOR.text.css));
    ev.on('auto', (on: boolean) => {
      this.autoBtnText.setText(on ? 'AUTO ON' : 'AUTO OFF').setColor(on ? UI_COLOR.action.css : UI_COLOR.textMuted.css);
      this.autoBtn.setStrokeStyle(2, on ? UI_COLOR.action.hex : UI_COLOR.line.hex);
    });

    // UIScene sleeps rather than stops, so anything still on screen when the
    // player leaves would be waiting for them when the next run starts.
    ev.on('ui:menu', () => {
      this.closeHelp();
      this.dismissReport();
      this.clearAllToasts();
    });

    ev.on('wavesummary', this.onWaveSummary);
    ev.on('cards', (cards: ResearchCard[], level: number) => this.showCardDraw(cards, level));

    this.refreshStats();
    this.refreshPreview();
    this.refreshWaveBtn();
    this.refreshMissionCards();
    this.applyOverlayPlan();
  }

  /**
   * In-game controls & build reference. The title screen's HOW TO PLAY teaches
   * the loop, but a player who skipped it (or came back to a run three days
   * later) had no way to ask "what does the lancer eat again?" without
   * abandoning the run — and on touch there is no hover tooltip to fall back on.
   */
  private showHelp(): void {
    if (this.helpLayer.length > 0) {
      this.closeHelp();
      return;
    }
    // The game-over overlay owns the screen, and a card draw is a decision the
    // player has to make before anything else happens.
    if (GameState.gameOver || GameState.awaitingCard) return;
    this.dismissReport();
    this.clearActiveToast();
    const W = 940;
    // Height follows the content instead of a guessed constant — the build
    // reference grows by a row whenever a building is added to the palette.
    const refH = BUILD_CATEGORIES.length * 28 + BUILD_INFO.length * 16;
    // The panel is sized to whichever column is taller. 226 was the *controls*
    // column's allowance and had gone stale exactly like the 30px row pitch
    // below it — that column is ~345 now, so the panel was never tall enough to
    // hold it and the last row ran under the CLOSE button.
    const controlsH = 345;
    const H = Math.min(GAME_H - 40, 66 + Math.max(controlsH, refH) + 76);
    const x = GAME_W / 2 - W / 2;
    const y = GAME_H / 2 - H / 2;

    // Freeze the sim. This is a full-screen wall of text, and on touch there is
    // no keyboard to pause with — enemies used to keep marching (and leaking)
    // while the player read the reference. Not a user pause, so `paused` is
    // untouched and closing restores whatever they had chosen.
    GameState.modalOpen = true;
    const dim = this.add.rectangle(0, 0, GAME_W, GAME_H, 0x000000, 0.78).setOrigin(0).setDepth(80).setInteractive();
    dim.on('pointerdown', () => this.closeHelp());
    const panel = this.add
      .rectangle(x, y, W, H, 0x141625, 0.99)
      .setOrigin(0)
      .setStrokeStyle(2, 0x2b3040)
      .setDepth(81)
      .setInteractive(); // swallow clicks so the dim behind never closes the panel
    this.helpLayer.push(dim, panel);

    this.helpLayer.push(
      this.add
        .text(GAME_W / 2, y + 26, 'CONTROLS & BUILDINGS', { ...FONT, fontSize: '20px', fontStyle: 'bold', color: '#ffe066' })
        .setOrigin(0.5)
        .setDepth(82),
    );

    // ----- controls column -----
    const controls: [string, string][] = IS_TOUCH
      ? [
          // two rendered lines max — the rows below sit at a fixed 30px pitch
          ['Move', 'Drag bare ground to pan the board · pinch to zoom out to the whole map and back in.'],
          ['Build', 'Tap a slot, then the board: the building is staged, not bought. Drag to nudge it, ROTATE to aim it, ✓ PLACE (or tap the same tile again) to buy it.'],
          ['Belts', 'Drag across the board to paint a line — corners included. Belts build as you drag; they are not staged.'],
          ['Rotate', 'ROTATE aims the staged building — the green arrow is where its output goes. Tap a placed belt or machine to turn it; its own arrow shows the new facing.'],
          ['Sell', 'SELL, then tap a building — refunds half. Or drag to erase a whole line. Long-press works too. Tap ↶ UNDO to put a sale back. On a belt carrying a stuck item, the first tap clears the item instead.'],
          ['Upgrade', 'Tap a placed tower to open its upgrade panel.'],
          ['Wave', 'SEND WAVE. AUTO sends them back to back; ×1/×2/×3 is game speed.'],
          ['Logistics', 'LOGI shades belts by throughput and shows each tower’s ammo uptime.'],
          ['View', 'The 2D/3D chip up top swaps the flat board for the isometric one.'],
        ]
      : [
          // Every key here is read from `keymap.ts`, so a rebind can never leave
          // this reference quietly lying to the player.
          ['Move', `Drag bare ground or middle-drag to pan · wheel zooms (${key('zoomIn')}/${key('zoomOut')} too) · ${key('zoomReset')} resets the view.`],
          ['Build', `Pick from the three shelves in the bar, or use the hotkeys listed here. ${key('cancel')} cancels.`],
          ['Belts', 'Hold and drag to paint a line; it turns corners with your drag.'],
          ['Rotate', `${key('rotate')} turns whatever is under the cursor, or the pending build on bare ground. Shift+wheel turns it either way.`],
          ['Sell', `Right-click a building — refunds half, and right-drag erases a whole line. Expensive ones ask twice; ${key('undo')} puts the last sale back. On a belt carrying a stuck item, the first right-click clears the item instead.`],
          ['Upgrade', `Click a placed tower, then ${key('upgradeA')} (or ${key('upgradeB')} for the second path at Mk3).`],
          ['Wave', `${key('sendWave')} sends it · ${key('speed')} cycles speed ×1/×2/×3 · ${key('pause')} pauses.`],
          ['Logistics', `${key('overlay')} shades belts by throughput and shows each tower’s ammo uptime · ${key('mute')} mutes.`],
          ['View', `${key('view')} swaps the flat board for the 3D isometric one, as does the 2D/3D chip.`],
        ];
    // The row pitch follows the text Phaser actually rendered, rather than a
    // fixed 30px that assumed "two lines max".
    //
    // That assumption quietly stopped holding: items 41 and 42 added the staged
    // placement, UNDO and unjam-first rules to these strings, and `Sell` reached
    // ~200 characters — five wrapped lines running straight through the three
    // rows beneath it. The left column of the only controls reference in the
    // game was unreadable, on desktop as well as touch, because the pitch never
    // depended on the canvas. Measuring means copy can grow again without
    // silently colliding.
    //
    // The wrap is 366 rather than 320 because the column has room to x + 500
    // (where the build reference starts) and wider lines mean fewer of them.
    let cy = y + 66;
    for (const [head, body] of controls) {
      const label = this.add
        .text(x + 30, cy, head, { ...FONT, fontSize: '12px', fontStyle: 'bold', color: '#6bd4ff' })
        .setDepth(82);
      const text = this.add
        .text(x + 116, cy, body, { ...FONT, fontSize: '11px', color: '#cdd6e4', wordWrap: { width: 366 }, lineSpacing: 2 })
        .setDepth(82);
      this.helpLayer.push(label, text);
      cy += Math.max(24, text.height + 5);
    }

    // ----- build reference, grouped exactly like the palette -----
    let by = y + 66;
    const bx = x + 500;
    for (const cat of BUILD_CATEGORIES) {
      this.helpLayer.push(
        this.add
          .text(bx, by, `${cat.name}  —  ${cat.blurb}`, { ...FONT, fontSize: '12px', fontStyle: 'bold', color: cat.css })
          .setDepth(82),
      );
      by += 18;
      for (const info of BUILD_INFO.filter((b) => b.cat === cat.id)) {
        const key = IS_TOUCH ? '' : `[${info.hotkey}] `;
        this.helpLayer.push(
          this.add
            .text(bx + 10, by, `${key}${info.name}`, { ...FONT, fontSize: '11px', fontStyle: 'bold', color: '#e8edf5' })
            .setDepth(82),
          this.add.text(bx + 120, by, `$${info.cost}`, { ...FONT, fontSize: '11px', color: '#ffe066' }).setDepth(82),
        );
        by += 16;
      }
      by += 10;
    }

    const closeY = y + H - 32;
    const close = this.hudButton(
      GAME_W / 2 - 80,
      closeY - 18,
      160,
      36,
      'CLOSE',
      14,
      () => this.closeHelp(),
      UI_COLOR.action.hex,
      'active',
    );
    close.frame.setDepth(82);
    close.label.setDepth(83).setColor('#ffffff');
    this.helpLayer.push(close.frame, close.label);
    this.applyOverlayPlan();
  }

  private closeHelp(): void {
    this.helpLayer.forEach((o) => o.destroy());
    this.helpLayer = [];
    GameState.modalOpen = false;
    this.restoreLowerOverlays();
  }

  /** Shared HUD button: a frame plus a centered label, with hover feedback. */
  private hudButton(
    x: number,
    y: number,
    w: number,
    h: number,
    text: string,
    fontSize: number,
    onClick: () => void,
    accent = UI_COLOR.action.hex,
    state: 'idle' | 'active' | 'danger' = 'idle',
  ): { frame: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text } {
    const visual = controlVisual(state, accent);
    const frame = this.add
      .rectangle(x, y, w, h, visual.fill)
      .setOrigin(0)
      .setStrokeStyle(2, visual.stroke)
      .setInteractive({ useHandCursor: true });
    const label = this.add
      .text(x + w / 2, y + h / 2, text, { ...FONT, fontSize: `${fontSize}px`, fontStyle: 'bold', color: UI_COLOR.text.css })
      .setOrigin(0.5);
    frame.on('pointerover', () => frame.setFillStyle(controlVisual('hover', accent).fill));
    frame.on('pointerout', () => frame.setFillStyle(visual.fill));
    frame.on('pointerdown', onClick);
    return { frame, label };
  }

  /**
   * Build palette, split into labelled category blocks — LOGISTICS, PRODUCTION
   * and DEFENSE. Guns and factory equipment are bought for opposite reasons, so
   * they read as separate shelves rather than one strip of thirteen lookalikes:
   * each block has a coloured header and its slots carry that colour on the rim.
   *
   * One row of small slots on a 16:9 desktop bar; two rows of big, finger-sized
   * slots whenever the bar is roomy (tablets and touch).
   */
  /**
   * Category tabs: only one shelf's slots are on screen at a time.
   *
   * Built before the slots so the tab strip sits under them in the display
   * list, and wired afterwards via `showShelf`.
   */
  private buildTabs(layout: HudLayout): void {
    layout.tabs.forEach((t, gi) => {
      const cat = BUILD_CATEGORIES[gi];
      const frame = this.add
        .rectangle(t.x, t.y, t.w, t.h, UI_COLOR.surface.hex)
        .setOrigin(0)
        .setStrokeStyle(2, cat.color, 0.45)
        .setInteractive({ useHandCursor: true });
      const label = this.add
        .text(t.x + t.w / 2, t.y + t.h / 2, cat.short, {
          ...FONT, fontSize: '12px', fontStyle: 'bold', color: cat.css,
        })
        .setOrigin(0.5);
      frame.on('pointerdown', () => {
        sfx.place();
        this.showShelf(gi);
      });
      this.tabParts.push({ frame, label, color: cat.color });
    });
  }

  /** Reveal one category's slots and light its tab. */
  private showShelf(index: number): void {
    this.shelf = index;
    this.tabParts.forEach((t, gi) => {
      const on = gi === index;
      t.frame.setFillStyle(on ? UI_COLOR.surfaceRaised.hex : UI_COLOR.surface.hex);
      t.frame.setStrokeStyle(on ? 3 : 2, t.color, on ? 1 : 0.4);
      t.label.setAlpha(on ? 1 : 0.55);
    });
    for (const { container, group } of this.slotShelf) container.setVisible(group === index);
  }

  private buildPalette(layout: HudLayout): void {
    const bh = layout.slots[0].h;
    const inner = slotContent(bh);

    // Category headers: the block label and its colour are the whole point of
    // the grouping, so they are drawn even on the cramped 80px desktop bar.
    layout.groupHeaders.forEach((h, gi) => {
      const cat = BUILD_CATEGORIES[gi];
      const size = h.h >= 15 ? 11 : 9;
      // Fall back to the abbreviation only if the full word genuinely will not
      // fit — a bar reading "LOGI / PRODUCTION / DEFENSE" looks like a bug.
      const fits = cat.name.length * size * 0.62 + 12 <= h.w;
      this.add.rectangle(h.x, h.y, h.w, h.h, UI_COLOR.surfaceRaised.hex, 0.98).setOrigin(0).setStrokeStyle(1, cat.color, 0.5);
      this.add.rectangle(h.x, h.y + h.h - 2, h.w, 2, cat.color, 0.6).setOrigin(0);
      this.add
        .text(h.x + h.w / 2, h.y + h.h / 2, fits ? cat.name : cat.short, {
          ...FONT, fontSize: `${size}px`, fontStyle: 'bold', color: cat.css,
        })
        .setOrigin(0.5);
    });

    BUILD_INFO.forEach((info, i) => {
      const { x, y, w: bw } = layout.slots[i];
      const cat = categoryOf(info.type)!;
      this.slotColor.set(info.type, cat.color);
      const container = this.add.container(x, y);
      this.slotShelf.push({ container, group: BUILD_CATEGORIES.findIndex((c) => c.id === cat.id) });
      const frame = this.add
        .rectangle(0, 0, bw, bh, UI_COLOR.surfaceRaised.hex)
        .setOrigin(0)
        .setStrokeStyle(2, cat.color, 0.45)
        .setInteractive({ useHandCursor: true });
      frame.on('pointerdown', () => GameState.events.emit('ui:select', info.type));
      frame.on('pointerover', () => {
        if (this.selectedType === info.type) {
          frame.setFillStyle(UI_COLOR.surfaceRaised.hex).setStrokeStyle(3, UI_COLOR.money.hex, 1);
        } else {
          const hover = controlVisual('hover', cat.color);
          frame.setFillStyle(hover.fill).setStrokeStyle(2, hover.stroke);
        }
        this.showDesc(info.desc, cat.css);
      });
      frame.on('pointerout', () => {
        const selected = this.selectedType === info.type;
        frame
          .setFillStyle(UI_COLOR.surfaceRaised.hex)
          .setStrokeStyle(selected ? 3 : 2, selected ? UI_COLOR.money.hex : cat.color, selected ? 1 : 0.45);
        this.showHint();
      });
      container.add([
        frame,
        this.add.image(bw / 2, inner.iconY, info.type).setScale(inner.iconScale),
        this.add
          .text(bw / 2, inner.costY, `$${info.cost}`, { ...FONT, fontSize: `${inner.costSize}px`, color: UI_COLOR.money.css })
          .setOrigin(0.5, 0),
      ]);
      if (inner.showName) {
        container.add(
          this.add
            .text(bw / 2, inner.nameY, info.name, { ...FONT, fontSize: `${inner.nameSize}px`, fontStyle: 'bold', color: UI_COLOR.text.css })
            .setOrigin(0.5, 0),
        );
      }
      const state = this.add
        .text(bw / 2, 2, '', { ...FONT, fontSize: bh >= 62 ? '8px' : '7px', fontStyle: 'bold', color: UI_COLOR.warning.css })
        .setOrigin(0.5, 0);
      container.add(state);
      // the hotkey badge is noise on a device with no keyboard
      if (!IS_TOUCH) {
        container.add(this.add.text(4, 3, info.hotkey, { ...FONT, fontSize: '9px', color: UI_COLOR.textMuted.css }));
      }
      this.paletteFrames.set(info.type, frame);
      this.paletteButtons.set(info.type, container);
      this.paletteState.set(info.type, state);
    });

    this.showHint();
  }

  /** The idle line above the palette: what the controls are on this device. */
  private get paletteHint(): string {
    return IS_TOUCH
      ? 'Tap a slot then tap the map · tap the slot again to cancel · ROTATE turns it · SELL then tap to refund 50% · tap a tower to upgrade · [?] help'
      : `Drag paints belts round corners · ${key('rotate')} turns what is under the cursor · right-click sells · click a tower to upgrade · [${key('overlay')}] logistics · [${key('help')}] help`;
  }

  private showDesc(text: string, color = '#cdd6e4'): void {
    // Events can arrive while the HUD is being rebuilt. The next coach refresh
    // will paint the latest text once its target exists.
    if (!this.descText) return;
    this.descText.setText(text).setColor(color);
  }

  /**
   * Fall back to whatever is contextually useful. On touch there is no hover,
   * so a tapped slot keeps its description on screen until another is chosen —
   * otherwise a touch player never sees what a building does at all.
   */
  private showHint(): void {
    const sel = this.selectedType ? BUILD_INFO.find((b) => b.type === this.selectedType) : null;
    if (IS_TOUCH && sel) {
      this.showDesc(sel.desc, categoryOf(sel.type)?.css ?? '#cdd6e4');
      return;
    }
    this.showDesc(this.coachContext || this.paletteHint, '#cdd6e4');
  }

  /**
   * Touch replacements for the affordances that need a keyboard or a right
   * mouse button. Only built on touch devices — a desktop keeps its shortcuts.
   */
  private buildTouchControls(layout: HudLayout): void {
    const [r, c, s, p] = layout.touch;
    const ARROWS = ['→', '↓', '←', '↑'];

    // The arrow is the label, not decoration on one: this button is the only
    // way to aim a machine on a device with no `R` key, and a playtester could
    // neither find it nor read which way it was pointing.
    const rotate = this.hudButton(r.x, r.y, r.w, r.h, ARROWS[0], 30, () => GameState.events.emit('ui:rotate'));
    rotate.label.setColor('#ffe066');
    this.add
      .text(r.x + r.w / 2, r.y + r.h - 13, 'ROTATE', { ...FONT, fontSize: '11px', fontStyle: 'bold', color: '#8892a6' })
      .setOrigin(0.5);
    rotate.label.setY(r.y + r.h / 2 - 7);
    GameState.events.on('builddir', (dir: number) => rotate.label.setText(ARROWS[dir & 3]));

    // Lit only while something is staged. A confirm that looks available with
    // nothing to confirm teaches the player it does nothing.
    const confirm = this.hudButton(c.x, c.y, c.w, c.h, '✓', 30, () => GameState.events.emit('ui:confirm'));
    const confirmCap = this.add
      .text(c.x + c.w / 2, c.y + c.h - 13, 'PLACE', { ...FONT, fontSize: '11px', fontStyle: 'bold', color: '#8892a6' })
      .setOrigin(0.5);
    confirm.label.setY(c.y + c.h / 2 - 7);
    // Stroke and text only, never the fill: hudButton restores its own fill on
    // pointerout, so a fill set here would survive exactly until the finger
    // lifted off the button that set it.
    const setConfirm = (armed: boolean): void => {
      confirm.label.setColor(armed ? '#5ef078' : '#454b5e');
      confirm.frame.setStrokeStyle(armed ? 3 : 2, armed ? 0x5ef078 : 0x2b3040);
      confirmCap.setColor(armed ? '#7cf7c4' : '#4a5164');
    };
    setConfirm(false);
    GameState.events.on('pending', setConfirm);

    const sell = this.hudButton(s.x, s.y, s.w, s.h, 'SELL', 15, () => GameState.events.emit('ui:sellmode'));
    GameState.events.on('sellmode', (on: boolean) => {
      sell.label.setText(on ? 'SELL ✓' : 'SELL').setColor(on ? '#ff8b8b' : '#cdd6e4');
      sell.frame.setStrokeStyle(2, on ? 0xff5555 : 0x2b3040);
    });

    const pause = this.hudButton(p.x, p.y, p.w, p.h, '❚❚', 17, () => GameState.togglePause());
    GameState.events.on('paused', (paused: boolean) => {
      pause.label.setText(paused ? '▶' : '❚❚').setColor(paused ? '#5ef078' : '#cdd6e4');
    });
  }

  /**
   * A brief readout whenever the board zoom changes.
   *
   * Zoom and pan exist on every device but announced themselves nowhere: on
   * desktop they were `+`/`-`/`HOME`/wheel with nothing on screen saying so, and
   * a player who nudged the wheel by accident had no way to tell what had
   * happened or how to undo it. Fades on its own — a permanent readout would be
   * clutter for a value that is 1 almost all the time.
   */
  private buildZoomReadout(): void {
    const label = this.add
      .text(GAME_W - 12, PLAYFIELD_H - 12, '', {
        ...FONT,
        fontSize: '12px',
        fontStyle: 'bold',
        color: '#cdd6e4',
        backgroundColor: '#0e0f1acc',
        padding: { x: 7, y: 4 },
      })
      .setOrigin(1, 1)
      .setDepth(44)
      .setAlpha(0);

    let last = 1;
    GameState.events.on('zoom', (zoom: number) => {
      if (Math.abs(zoom - last) < 0.001) return;
      last = zoom;
      const reset = IS_TOUCH ? 'pinch to fit' : `[${key('zoomReset')}] resets`;
      label.setText(`⤢ ${Math.round(zoom * 100)}%  ·  ${reset}`).setAlpha(1);
      this.zoomHide?.remove();
      this.zoomHide = this.time.delayedCall(1600, () => {
        this.tweens.add({ targets: label, alpha: 0, duration: 350 });
      });
    });
  }

  /**
   * A transient UNDO offer after a sale, the way every mail client offers one.
   *
   * Selling is the only irreversible action in the game and a drag now removes
   * a whole line at once, so the safety net has to be reachable without a
   * keyboard. Deliberately not a permanent pad button: it is meaningless most
   * of the time, and the pad's four cells are all doing work already.
   */
  private buildUndoChip(): void {
    const w = IS_TOUCH ? 132 : 104;
    const h = IS_TOUCH ? 46 : 32;
    const x = UI_SPACE[2];
    const y = PLAYFIELD_H - h - UI_SPACE[2];
    const chip = this.hudButton(x, y, w, h, '↶ UNDO', IS_TOUCH ? 15 : 13, () =>
      GameState.events.emit('ui:undo'),
    );
    const show = (on: boolean): void => {
      chip.frame.setVisible(on);
      chip.label.setVisible(on);
      if (on) chip.frame.setInteractive({ useHandCursor: true });
      else chip.frame.disableInteractive();
      this.undoHide?.remove();
      // Fades from view but the action stays available to the keyboard, exactly
      // like an editor: the chip is the reminder, not the mechanism.
      if (on) this.undoHide = this.time.delayedCall(7000, () => show(false));
    };
    chip.label.setColor('#ffd166');
    show(false);
    GameState.events.on('undo', show);
  }

  /** Wave button + speed/auto/logistics/menu, stacked to fill whatever bar height we have. */
  private buildWaveCluster(layout: HudLayout): void {
    const { preview, send, toggles } = layout;

    this.previewText = this.add
      .text(preview.x + preview.w / 2, preview.y + preview.h / 2, '', {
        ...FONT, fontSize: ROOMY_UI ? '12px' : '10px', color: '#cdd6e4', align: 'center',
      })
      .setOrigin(0.5);

    const actionVisual = controlVisual('active', UI_COLOR.action.hex);
    this.waveBtn = this.add
      .rectangle(send.x, send.y, send.w, send.h, actionVisual.fill)
      .setOrigin(0)
      .setStrokeStyle(2, actionVisual.stroke)
      .setInteractive({ useHandCursor: true });
    this.waveBtnText = this.add
      .text(send.x + send.w / 2, send.y + send.h / 2 - 7, IS_TOUCH ? 'SEND WAVE' : `SEND WAVE [${key('sendWave')}]`, {
        ...FONT, fontSize: ROOMY_UI ? '17px' : '14px', fontStyle: 'bold', color: UI_COLOR.ink.css,
      })
      .setOrigin(0.5);
    // live early-send bonus, ticking down inside the button — the "go now" nudge
    this.earlyText = this.add
      .text(send.x + send.w / 2, send.y + send.h / 2 + 12, '', {
        ...FONT, fontSize: ROOMY_UI ? '12px' : '11px', fontStyle: 'bold', color: UI_COLOR.ink.css,
      })
      .setOrigin(0.5);
    this.waveBtn.on('pointerdown', () => GameState.events.emit('ui:startwave'));

    const [a, s, l, m] = toggles;
    const auto = this.hudButton(a.x, a.y, a.w, a.h, 'AUTO OFF', 13, () => GameState.toggleAuto());
    this.autoBtn = auto.frame;
    this.autoBtnText = auto.label.setColor(UI_COLOR.textMuted.css);

    const speed = this.hudButton(s.x, s.y, s.w, s.h, 'SPEED ×1', 12, () => GameState.cycleSpeed());
    this.speedBtnText = speed.label;

    const logi = this.hudButton(l.x, l.y, l.w, l.h, 'LOGISTICS OFF', 10, () => GameState.toggleOverlay());
    logi.label.setColor(UI_COLOR.textMuted.css);
    GameState.events.on('overlay', (on: boolean) => {
      logi.label.setText(on ? 'LOGISTICS ON' : 'LOGISTICS OFF').setColor(on ? UI_COLOR.logistics.css : UI_COLOR.textMuted.css);
      logi.frame.setStrokeStyle(2, on ? UI_COLOR.logistics.hex : UI_COLOR.line.hex);
    });

    const menu = this.hudButton(m.x, m.y, m.w, m.h, 'MENU', 12, () => {
      if (GameState.phase === 'wave' && !GameState.gameOver && !this.menuConfirm) {
        this.menuConfirm = true;
        menu.label.setText('CONFIRM?').setColor(UI_COLOR.danger.css);
        this.time.delayedCall(2500, () => {
          this.menuConfirm = false;
          if (menu.label.active) menu.label.setText('MENU').setColor('#8892a6');
        });
        return;
      }
      this.menuConfirm = false;
      menu.label.setText('MENU').setColor('#8892a6');
      GameState.events.emit('ui:menu');
    });
    menu.label.setColor('#8892a6');
  }

  update(): void {
    const show = GameState.phase === 'build' && !GameState.gameOver;
    const bonus = show ? earlySendBonus(GameState.wave, GameState.buildElapsed) : 0;
    this.earlyText.setText(bonus > 0 ? `early bonus +$${bonus}` : '');
    // The streak lapses on a clock, so nothing emits when it ends — the meter
    // has to notice for itself.
    if (this.comboShown > 0 && comboExpired(GameState.combo, comboNow())) this.hideCombo();
    GameState.checkMissions();
    this.refreshMissionCards();
  }

  private buildMissionCards(): void {
    const zone = overlayZones(GAME_W, PLAYFIELD_H, this.stripBottom, IS_TOUCH).objective;
    const inset = IS_TOUCH ? 12 : 8;
    const container = this.add.container(zone.x, zone.y).setDepth(26);
    const frame = this.add
      .rectangle(0, 0, zone.w, zone.h, UI_COLOR.surface.hex, 0.94)
      .setOrigin(0)
      .setStrokeStyle(2, UI_COLOR.research.hex, 0.72);
    const name = this.add.text(inset, IS_TOUCH ? 9 : 7, '', {
      ...FONT, fontSize: IS_TOUCH ? '18px' : '12px', fontStyle: 'bold', color: UI_COLOR.text.css,
      wordWrap: { width: zone.w - inset * 2 - (IS_TOUCH ? 104 : 82) },
    });
    const progress = this.add.text(inset, IS_TOUCH ? 31 : 26, '', {
      fontFamily: UI_FONT.body, fontSize: IS_TOUCH ? '16px' : '11px', color: UI_COLOR.textMuted.css,
      wordWrap: { width: zone.w - inset * 2 },
    });
    const fill = this.add.rectangle(inset, zone.h - 5, 0, 3, UI_COLOR.research.hex, 0.9).setOrigin(0);
    const extra = this.add.text(zone.w - inset, IS_TOUCH ? 9 : 7, '', {
      ...FONT, fontSize: IS_TOUCH ? '16px' : '9px', color: UI_COLOR.research.css,
    }).setOrigin(1, 0);
    container.add([frame, name, progress, fill, extra]);
    frame.setInteractive({ useHandCursor: true });
    frame.on('pointerdown', () => this.cycleMissionCard());
    this.missionCard = { container, frame, name, progress, fill, extra };
  }

  private refreshMissionCards(): void {
    const facts = GameState.missionFacts();
    this.presentedMission = presentedMissionId(GameState.missions, this.presentedMission);
    const mission = GameState.missions.find((candidate) => candidate.id === this.presentedMission);
    const def = mission ? missionDef(mission.id) : undefined;
    const progress = mission && def ? `${def.desc} · ${missionProgress(mission, facts)}` : 'No active contract';
    const name = mission && def ? (IS_TOUCH ? `${def.name} +$${mission.payout}` : `CONTRACT · ${def.name}   +$${mission.payout}`) : 'NO ACTIVE CONTRACT';
    const extra = GameState.missions.length > 1 ? `+${Math.max(0, GameState.missions.length - 1)} contracts` : '';
    const copy = hudCardCopyLimits(IS_TOUCH);
    const fittedProgress = fitCardCopy(progress, copy.missionDetail, 1);
    const fittedName = fitCardCopy(name, copy.missionTitle, 1);
    const ratio = mission ? this.missionRatio(missionProgress(mission, facts)) : 0;
    if (this.missionCard.name.text !== fittedName) this.missionCard.name.setText(fittedName);
    if (this.missionCard.progress.text !== fittedProgress) this.missionCard.progress.setText(fittedProgress);
    if (this.missionCard.extra.text !== extra) this.missionCard.extra.setText(extra);
    this.missionCard.fill.width = Math.round((this.missionCard.frame.width - (IS_TOUCH ? 24 : 16)) * ratio);
  }

  private cycleMissionCard(): void {
    this.presentedMission = nextMissionId(GameState.missions, this.presentedMission);
    this.refreshMissionCards();
  }

  private missionRatio(progress: string): number {
    const match = progress.match(/\$?(\d[\d,]*)\s*\/\s*\$?(\d[\d,]*)/);
    if (!match) return 0;
    const current = Number(match[1].replaceAll(',', ''));
    const goal = Number(match[2].replaceAll(',', ''));
    return goal > 0 ? Phaser.Math.Clamp(current / goal, 0, 1) : 0;
  }

  private buildCoach(): void {
    const zone = overlayZones(GAME_W, PLAYFIELD_H, this.stripBottom, IS_TOUCH).coach;
    const badgeSize = IS_TOUCH ? 36 : 28;
    const inset = IS_TOUCH ? 14 : 10;
    this.coachCard = this.add.container(zone.x, zone.y).setDepth(26);
    const frame = this.add
      .rectangle(0, 0, zone.w, zone.h, UI_COLOR.surface.hex, 0.95)
      .setOrigin(0)
      .setStrokeStyle(2, UI_COLOR.lineBright.hex, 0.85);
    const badge = this.add.rectangle(inset, Math.floor((zone.h - badgeSize) / 2), badgeSize, badgeSize, UI_COLOR.logistics.hex, 0.95).setOrigin(0);
    this.coachStep = this.add
      .text(inset + badgeSize / 2, zone.h / 2, '1', { ...FONT, fontSize: IS_TOUCH ? '19px' : '15px', fontStyle: 'bold', color: UI_COLOR.ink.css })
      .setOrigin(0.5);
    this.coachAction = this.add.text(inset + badgeSize + inset, IS_TOUCH ? 10 : 8, '', {
      fontFamily: UI_FONT.body, fontSize: IS_TOUCH ? '18px' : '13px', fontStyle: 'bold', color: UI_COLOR.text.css,
      wordWrap: { width: zone.w - (inset + badgeSize + inset) - (IS_TOUCH ? 100 : 34) },
    });
    this.descText = this.add.text(inset + badgeSize + inset, IS_TOUCH ? 38 : 31, '', {
      fontFamily: UI_FONT.body, fontSize: IS_TOUCH ? '16px' : '10px', color: UI_COLOR.textMuted.css,
      wordWrap: { width: zone.w - (inset + badgeSize + inset) - (IS_TOUCH ? 100 : 34) },
    });
    const closeSize = IS_TOUCH ? 80 : 22;
    const close = this.add
      .rectangle(zone.w - inset - closeSize, Math.floor((zone.h - closeSize) / 2), closeSize, closeSize, UI_COLOR.surfaceRaised.hex, 0.94)
      .setOrigin(0)
      .setStrokeStyle(1, UI_COLOR.lineBright.hex)
      .setInteractive({ useHandCursor: true });
    const closeText = this.add
      .text(zone.w - inset - closeSize / 2, zone.h / 2, '×', { ...FONT, fontSize: IS_TOUCH ? '24px' : '16px', color: UI_COLOR.textMuted.css })
      .setOrigin(0.5);
    this.coachCard.add([frame, badge, this.coachStep, this.coachAction, this.descText, close, closeText]);
    close.on('pointerdown', () => {
      this.coachDismissed = true;
      this.applyOverlayPlan();
    });
  }

  private refreshCoach(message: CoachMessage): void {
    this.coachStep.setText(String(message.step));
    const copy = hudCardCopyLimits(IS_TOUCH);
    this.coachAction.setText(fitCardCopy(message.action, copy.coachAction, 1));
    this.coachContext = fitCardCopy(message.context, copy.coachContext, 1);
    this.showDesc(this.coachContext);
  }

  /** Keep every gameplay overlay in the priority layer assigned by overlayPlan. */
  private applyOverlayPlan(): void {
    const plan = overlayPlan({
      terminal: this.terminalOpen,
      blocking: this.helpLayer.length > 0 || this.cardLayer.length > 0,
      report: this.summaryCard !== null,
      transient: this.toastActive,
      inspector: this.inspectorOpen,
    });
    this.missionCard.container.setVisible(plan.ambient);
    this.coachCard.setVisible(plan.ambient && !this.coachDismissed);
    this.summaryCard?.setVisible(plan.report);
    this.toastCard?.setVisible(plan.transient);
    this.syncBoardOverlay(plan);
  }

  private syncBoardOverlay(plan: ReturnType<typeof overlayPlan>, force = false): void {
    const next = boardOverlayVisibility(plan, this.missionCard.container.visible, this.coachDismissed);
    if (!force && next.objective === this.boardOverlay.objective && next.coach === this.boardOverlay.coach && next.inspector === this.boardOverlay.inspector) return;
    this.boardOverlay = next;
    GameState.events.emit('boardoverlay', next);
  }

  private dismissReport(): void {
    if (!this.summaryCard) return;
    this.tweens.killTweensOf(this.summaryCard);
    this.summaryCard.destroy();
    this.summaryCard = null;
    this.overlayScheduler.closeReport();
    // The board's pointer guard shields the card while it is up; it has to be
    // told the moment it comes down, or a chunk of playfield stays unbuildable.
    GameState.events.emit('report', false);
  }

  private clearActiveToast(): void {
    if (this.toastCard) this.tweens.killTweensOf(this.toastCard);
    this.toastCard?.destroy();
    this.toastCard = null;
    this.toastActive = false;
    this.overlayScheduler.closeToast();
  }

  private clearAllToasts(): void {
    this.clearActiveToast();
    this.toastQueue = [];
  }

  private queueWaveSummary(wave: number, tally: WaveTally): void {
    if (this.terminalOpen || this.helpLayer.length > 0 || this.cardLayer.length > 0) {
      this.queuedSummary = { wave, tally };
      return;
    }
    this.showWaveSummary(wave, tally);
  }

  /** Production event seam: the report must exist before mission completion queues its toast. */
  private onWaveSummary = (wave: number, tally: WaveTally): void => {
    this.queueWaveSummary(wave, tally);
    GameState.checkMissions({ wave, tally });
  };

  private restoreLowerOverlays(): void {
    this.applyOverlayPlan();
    if (!this.terminalOpen && this.helpLayer.length === 0 && this.cardLayer.length === 0 && this.queuedSummary) {
      const summary = this.queuedSummary;
      this.queuedSummary = null;
      this.showWaveSummary(summary.wave, summary.tally);
      return;
    }
    this.pumpToasts();
  }

  /**
   * Kill-streak meter. Grows and warms as the streak climbs, which is the whole
   * feedback: the number itself is worth nothing (`data/combo.ts` pays no
   * money), so the escalation *is* the reward.
   */
  private refreshCombo(c: ComboState): void {
    if (comboTier(c.count) === 0) {
      this.hideCombo();
      return;
    }
    if (c.count === this.comboShown) return;
    this.comboShown = c.count;
    this.comboText
      .setText(`${c.count}× STREAK`)
      .setColor(comboColor(c.count))
      .setVisible(true)
      .setAlpha(1);
    // a small kick on every kill — the meter should feel struck, not updated
    this.comboText.setScale(1.28);
    this.tweens.add({ targets: this.comboText, scale: 1, duration: 130, ease: 'Quad.out' });
  }

  private hideCombo(): void {
    if (this.comboShown === 0) return;
    this.comboShown = 0;
    this.tweens.add({
      targets: this.comboText,
      alpha: 0,
      duration: 260,
      onComplete: () => this.comboText.setVisible(false),
    });
  }

  /**
   * Wave-clear card: what the round actually cost and produced. Fired vs made
   * is the headline, but it is judged *per ammo type* — a chiller turning one
   * ore into two coolant would otherwise flatter a gun line that is starving.
   */
  private showWaveSummary(wave: number, t: WaveTally): void {
    this.dismissReport();
    this.overlayScheduler.openReport();
    // Low in the board viewport, but never spilling onto the build bar. The
    // entrance offset lives in the layout too: this used to be built at the
    // clamped y and then tweened to a literal 360, which put it behind the bar
    // on every phone. See `reportCard`.
    const R = reportCard(GAME_W, PLAYFIELD_H);
    const W = R.w;
    const H = R.h;
    const c = this.add.container(R.x, R.fromY).setDepth(45).setAlpha(0);
    const short = ammoDeficits(t);
    const deficit = short.length > 0;
    const fired = ammoTotal(t.fired);
    const made = ammoTotal(t.produced);
    const got = ammoTotal(t.delivered);
    const lab = ammoTotal(t.toLab);
    const stranded = ammoUndelivered(t);
    const magDelta = t.magEnd - t.magStart;

    // The diagnosis, not just the numbers. A shortfall has two very different
    // causes and they need opposite fixes: not enough was made (widen
    // production) versus plenty was made and it never arrived (fix the routing).
    // The old card only ever said "add production".
    const totalShort = short.reduce((sum, d) => sum + d.short, 0);
    const routingBound = deficit && stranded >= totalShort;
    const advice = !deficit
      ? '✓ supply kept up with the guns'
      : routingBound
        ? `⚠ ${short.map((d) => `${d.type} −${d.short}`).join('  ')} — made, but not delivered`
        : `⚠ ${short.map((d) => `${d.type} −${d.short}`).join('  ')} — add production`;

    const bg = this.add.rectangle(0, 0, W, H, 0x141625, 0.94).setOrigin(0).setStrokeStyle(2, deficit ? 0xff9f43 : 0x2b3040);
    const rows: Phaser.GameObjects.GameObject[] = [
      bg,
      this.add.text(12, 9, `WAVE ${wave} REPORT`, { ...FONT, fontSize: '13px', fontStyle: 'bold', color: '#ffe066' }),
      this.add.text(12, 32, `Kills      ${t.kills}${t.leaked > 0 ? `        Leaked ${t.leaked}` : ''}`, {
        ...FONT, fontSize: '11px', color: t.leaked > 0 ? '#ff8b8b' : '#cdd6e4',
      }),
      this.add.text(12, 50, `Income     +$${t.income}`, { ...FONT, fontSize: '11px', color: '#ffe066' }),
      this.add.text(12, 68, `Made       ${made}${lab > 0 ? `   (${lab} to lab)` : ''}`, {
        ...FONT, fontSize: '11px', color: '#cdd6e4',
      }),
      this.add.text(12, 86, `Delivered  ${got}${stranded > 0 ? `   (${stranded} never arrived)` : ''}`, {
        ...FONT, fontSize: '11px', color: stranded > 0 ? '#ff9f43' : '#cdd6e4',
      }),
      this.add.text(12, 104, `Fired      ${fired}${t.starved > 0 ? `   (${t.starved} gun${t.starved === 1 ? '' : 's'} ran dry)` : ''}`, {
        ...FONT, fontSize: '11px', color: deficit || t.starved > 0 ? '#ff9f43' : '#5ef078',
      }),
      // The buffer line is what stops a stockpiled wave reading as a success and
      // a restocking wave reading as a failure.
      this.add.text(12, 122, `Magazines  ${magDelta >= 0 ? '+' : ''}${magDelta}  (${t.magStart} → ${t.magEnd})`, {
        ...FONT, fontSize: '11px', color: magDelta < 0 ? '#ff9f43' : '#5ef078',
      }),
      this.add.text(12, 142, advice, { ...FONT, fontSize: '10px', color: deficit ? '#ff9f43' : '#8892a6' }),
    ];
    c.add(rows);
    this.summaryCard = c;
    this.applyOverlayPlan();
    this.tweens.add({ targets: c, alpha: 1, y: R.y, duration: 220, ease: 'Back.out' });

    // No fade timer. This used to vanish after 4.2s, which made "I looked at the
    // board for a second and missed it" a permanent loss — there is no way to
    // reopen the card, and it carries the only per-ammo diagnosis in the game.
    //
    // Tuning that number was never the fix: the card's useful life *is* the
    // build phase, because it exists to tell you what to build next. So it lasts
    // exactly that long — cleared when the next wave starts (`phase`), or by a
    // tap for anyone who wants the board back sooner.
    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerdown', () => this.closeReportNow());
    GameState.events.emit('report', true);
  }

  /** Tear the report down and hand the board back to the ambient overlays. */
  private closeReportNow(): void {
    if (!this.summaryCard) return;
    this.dismissReport();
    this.restoreLowerOverlays();
  }

  /**
   * The level-up draw: three cards, pick one. The sim is already frozen by
   * GameState when this fires, so the player can read the board behind the
   * cards and decide with full information.
   *
   * Deliberately interrupts mid-wave rather than queueing to the build phase —
   * the choice landing at the moment your factory earned it is the whole point.
   */
  private showCardDraw(cards: ResearchCard[], level: number): void {
    this.dismissReport();
    this.clearActiveToast();
    this.clearCards();
    // Bounded by the *playfield*, not the canvas: the build bar is opaque and
    // owns everything below it. See `cardDrawLayout`.
    const L = cardDrawLayout(GAME_W, PLAYFIELD_H, STRIP.h + STRIP.stats.y, cards.length, IS_TOUCH);
    const dim = this.add.rectangle(0, 0, GAME_W, GAME_H, 0x000000, 0.72).setOrigin(0).setDepth(70).setInteractive();
    const title = this.add
      .text(L.title.x, L.title.y, `RESEARCH  ·  LEVEL ${level}`, {
        ...FONT, fontSize: `${L.title.size}px`, fontStyle: 'bold', color: '#7cf7c4', stroke: '#000', strokeThickness: 6,
      })
      .setOrigin(0.5, 0)
      .setDepth(71);
    this.cardLayer.push(dim, title);
    // The title alone says what this is; the sentence is the first thing to go
    // when the board is short.
    if (L.sub.show) {
      this.cardLayer.push(this.add
        .text(L.sub.x, L.sub.y, 'Your factory earned this. Choose one — it lasts the rest of the run.', {
          ...FONT, fontSize: `${L.sub.size}px`, color: '#cdd6e4',
        })
        .setOrigin(0.5, 0)
        .setDepth(71));
    }

    // Ordinary cards first, the best one last: the reveal needs somewhere to
    // build to. Purely a display order — `draw()` already chose the cards, and
    // each hotkey follows the card dealt into its slot.
    const dealt = sortForReveal(cards);
    dealt.forEach((card, i) => {
      const r = rarityStyle(card);
      const slot = L.cards[i];
      const { x, y, w: W, h: H } = slot;
      const frame = this.add
        .rectangle(x, y, W, H, 0x1a1830)
        .setOrigin(0)
        .setStrokeStyle(r.stroke, r.hex, 0.85)
        .setDepth(71)
        .setInteractive({ useHandCursor: true });
      // Rarity band across the top: colour is the fast read, the badge word
      // below it is the one that survives a colourblind player (item 37).
      const band = this.add.rectangle(x, y, W, 4, r.hex).setOrigin(0).setDepth(72);
      const badge = this.add
        .text(x + W / 2, y + 12, r.label, {
          ...FONT, fontSize: `${L.badgeSize}px`, fontStyle: 'bold', color: r.css,
        })
        .setOrigin(0.5, 0)
        .setDepth(72);
      const name = this.add
        .text(x + W / 2, y + 12 + L.badgeSize + 10, card.name, {
          ...FONT, fontSize: `${L.nameSize}px`, fontStyle: 'bold', color: r.css,
          align: 'center', wordWrap: { width: W - 24 },
        })
        .setOrigin(0.5, 0)
        .setDepth(72);
      const desc = this.add
        .text(x + W / 2, y + L.descCy, card.desc, {
          ...FONT, fontSize: `${L.descSize}px`, color: '#cdd6e4',
          align: 'center', wordWrap: { width: W - 32 }, lineSpacing: 4,
        })
        .setOrigin(0.5, 0.5)
        .setDepth(72);
      const stacks = GameState.taken[card.id] ?? 0;
      const held = this.add
        .text(x + W / 2, y + H - 20, stacks > 0 ? `already taken ×${stacks}` : '', {
          ...FONT, fontSize: `${L.metaSize}px`, color: '#8892a6',
        })
        .setOrigin(0.5)
        .setDepth(72);
      const key = this.add
        .text(x + 8, y + 10, `[${i + 1}]`, {
          ...FONT, fontSize: `${L.metaSize}px`, fontStyle: 'bold', color: '#8892a6',
        }).setDepth(72);
      const parts = [frame, band, badge, name, desc, held, key];

      /**
       * Every y-tween below targets an *absolute* position derived from where
       * the part was laid out, never a `+=`/`-=` offset. Relative offsets stack:
       * a hover that lands mid-deal, or a fast in-out-in across the frame edge,
       * leaves the card permanently displaced from its own layout.
       */
      const restY = parts.map((o) => o.y);
      const settle = (offset: number, duration: number, ease: string, delay = 0): void => {
        parts.forEach((o, k) =>
          this.tweens.add({ targets: o, y: restY[k] + offset, duration, ease, delay }));
      };

      // Hover lifts the whole card rather than just recolouring it — the card
      // you are about to commit to should physically come forward. Held off
      // until the deal finishes, so the two animations never own y at once.
      let revealed = false;
      frame.on('pointerover', () => {
        frame.setFillStyle(0x272348);
        if (!revealed) return;
        parts.forEach((o) => this.tweens.killTweensOf(o));
        settle(-6, 110, 'Quad.out');
      });
      frame.on('pointerout', () => {
        frame.setFillStyle(0x1a1830);
        if (!revealed) return;
        parts.forEach((o) => this.tweens.killTweensOf(o));
        settle(0, 110, 'Quad.out');
      });
      frame.on('pointerdown', () => this.pickCard(card.id));

      // The deal: each card drops in and overshoots, one after the next, with
      // its rarity's sting. A rarer card dwells fractionally longer before the
      // one after it, so a keystone arriving last is felt as well as seen.
      const drop = 18;
      parts.forEach((o, k) => { o.setAlpha(0); o.y = restY[k] - drop; });
      const delay = 90 * i + 60 * r.rank;
      this.tweens.add({ targets: parts, alpha: 1, duration: 140, delay });
      settle(0, 260, 'Back.out', delay);
      this.time.delayedCall(delay, () => {
        sfx.cardReveal(r.notes);
        revealed = true;
      });
      this.cardLayer.push(...parts);
    });

    // number keys pick too — the mouse should never be mandatory
    const keys = ['ONE', 'TWO', 'THREE'];
    dealt.forEach((card, i) => {
      if (i >= keys.length) return;
      const handler = () => this.pickCard(card.id);
      this.input.keyboard?.once(`keydown-${keys[i]}`, handler);
      this.cardKeyHandlers.push({ key: `keydown-${keys[i]}`, handler });
    });
    this.applyOverlayPlan();
  }

  private pickCard(id: string): void {
    sfx.cardPick();
    this.clearCards(); // destroy first: GameScene may immediately deal the next level
    GameState.events.emit('ui:pickcard', id);
    this.restoreLowerOverlays();
  }

  private clearCards(): void {
    this.cardLayer.forEach((o) => o.destroy());
    this.cardLayer = [];
    for (const { key, handler } of this.cardKeyHandlers) this.input.keyboard?.off(key, handler);
    this.cardKeyHandlers = [];
  }

  /**
   * Money/lives/wave chips and everything that keys off the wallet. Called on
   * every coin, so it does the cheap work only: the wave preview is rebuilt
   * separately, and each palette slot's greyed-out state is written just when it
   * actually flips. A late swift wave is a hundred kills in forty seconds, and
   * each `setText` re-renders a canvas texture.
   */
  private refreshStats(pop = false): void {
    this.moneyText.setText(`$ ${GameState.money}`);
    this.livesText.setText(`♥ ${GameState.lives}`);
    this.waveText.setText(`Wave ${GameState.wave}`);
    if (pop) {
      this.moneyText.setScale(1.25);
      this.tweens.add({ targets: this.moneyText, scale: 1, duration: 150 });
    }
    for (const info of BUILD_INFO) {
      const can = GameState.money >= info.cost;
      if (this.slotAffordable.get(info.type) === can) continue;
      this.slotAffordable.set(info.type, can);
      this.paletteButtons.get(info.type)?.setAlpha(can ? 1 : 0.72);
      const state = this.paletteState.get(info.type);
      if (state && info.type !== this.selectedType) state.setText(can ? '' : `NEED $${info.cost - GameState.money}`);
    }

    const cost = prospectCost(GameState.surveys, GameState.surveyDiscount);
    const kind = prospectKind(GameState.surveys);
    this.prospectText
      .setText(this.surveyArmed ? `⛏ PICK A SITE  (ESC)` : `⛏ SURVEY ${kind.toUpperCase()}  $${cost}`)
      .setColor(this.surveyArmed ? UI_COLOR.action.css : GameState.money >= cost ? (kind === 'ore' ? UI_COLOR.production.css : UI_COLOR.logistics.css) : UI_COLOR.textMuted.css);
  }

  /**
   * Next-wave preview + map name: only changes when the wave does.
   *
   * The counter-play hint gets its own line only on a roomy bar. The compact
   * 80px strip gives the preview 18px, so a second line spilled over the SEND
   * WAVE button underneath it — there it becomes a short tail on one line.
   */
  private refreshPreview(): void {
    const d = waveDef(GameState.wave);
    // matches the enemy textures, so the preview colour names the thing you'll see
    const KIND_COLOR: Record<string, string> = { normal: '#cdd6e4', swift: '#2fe3d0', armored: '#9aa7bd', boss: '#ff6b6b' };
    const LONG: Record<string, string> = {
      normal: '',
      swift: 'fast & many — splash shines',
      armored: 'resists bullets — shells or lances',
      boss: 'tanky · a leak costs 5♥',
    };
    const SHORT: Record<string, string> = {
      normal: '',
      swift: 'splash shines',
      armored: 'shells or lances',
      boss: 'a leak costs 5♥',
    };
    const hint = ROOMY_UI ? LONG[d.kind] : SHORT[d.kind];
    const tail = hint ? (ROOMY_UI ? `\n${hint}` : ` · ${hint}`) : '';
    this.previewText
      .setText(`Next: ${d.count}× ${WAVE_KIND_LABEL[d.kind]} · ${d.hp} HP${tail}`)
      .setColor(KIND_COLOR[d.kind]);
    this.mapText.setText(`◈ ${activeMap().name}`);
  }

  private refreshWaveBtn(): void {
    const building = GameState.phase === 'build';
    if (!building && this.summaryCard) {
      // the player moved on — get the card out of the playfield
      this.dismissReport();
      this.restoreLowerOverlays();
    }
    this.waveBtn.setFillStyle(building ? UI_COLOR.action.hex : UI_COLOR.surfaceRaised.hex);
    this.waveBtn.setStrokeStyle(2, building ? UI_COLOR.text.hex : UI_COLOR.danger.hex);
    // Never quote a keyboard shortcut on a device with no keyboard — this used
    // to re-stamp "[SPC]" over the touch label on the first phase change.
    this.waveBtnText.setText(building ? (IS_TOUCH ? 'SEND WAVE' : `SEND WAVE [${key('sendWave')}]`) : 'DEFEND!');
    this.refreshStats();
  }

  /** Slide-in achievement and mission cards, one at a time, through one queue. */
  private pumpToasts(): void {
    if (!this.overlayScheduler.canStartToast(this.terminalOpen || this.helpLayer.length > 0 || this.cardLayer.length > 0 || this.summaryCard !== null)) return;
    const def = this.toastQueue.shift();
    if (!def) return;
    this.toastActive = true;
    this.overlayScheduler.openToast();
    const zone = overlayZones(GAME_W, PLAYFIELD_H, this.stripBottom, IS_TOUCH).toast;
    const c = this.add.container(GAME_W + zone.w, zone.y).setDepth(60);
    const bg = this.add.rectangle(0, 0, zone.w, zone.h, UI_COLOR.surface.hex, 0.96).setOrigin(0).setStrokeStyle(2, UI_COLOR.money.hex);
    const copy = hudCardCopyLimits(IS_TOUCH);
    const name = this.add.text(10, IS_TOUCH ? 8 : 5, fitCardCopy(`★ ${def.name}`, copy.toastName, 1), {
      ...FONT, fontSize: IS_TOUCH ? '18px' : '12px', fontStyle: 'bold', color: UI_COLOR.money.css,
    });
    const desc = this.add.text(10, IS_TOUCH ? 40 : 22, fitCardCopy(def.desc, copy.toastDetail, 1), {
      fontFamily: UI_FONT.body, fontSize: IS_TOUCH ? '16px' : '10px', color: UI_COLOR.text.css,
    });
    c.add([bg, name, desc]);
    this.toastCard = c;
    this.applyOverlayPlan();
    sfx.coin();
    this.tweens.add({ targets: c, x: zone.x, duration: 250, ease: 'Back.out' });
    this.tweens.add({
      targets: c,
      x: GAME_W + zone.w,
      delay: 3000,
      duration: 200,
      ease: 'Cubic.in',
      onComplete: () => {
        c.destroy();
        if (this.toastCard === c) this.toastCard = null;
        this.toastActive = false;
        this.overlayScheduler.closeToast();
        this.restoreLowerOverlays();
      },
    });
  }

  /**
   * Armed slot gets a thick gold rim; the rest fall back to their category
   * colour, so the palette still reads as three shelves while one is selected.
   */
  private refreshSelection(t: BuildingType | null): void {
    this.selectedType = t;
    // Follow the selection onto its own shelf. A hotkey (or a touchscreen
    // laptop's keyboard) can arm a building whose tab is not the open one, and
    // an armed slot the player cannot see is worse than no feedback at all.
    if (t && this.tabParts.length > 0) {
      const cat = categoryOf(t);
      const gi = cat ? BUILD_CATEGORIES.findIndex((c) => c.id === cat.id) : -1;
      if (gi >= 0 && gi !== this.shelf) this.showShelf(gi);
    }
    for (const [type, frame] of this.paletteFrames) {
      const state = this.paletteState.get(type);
      if (type === t) {
        frame.setStrokeStyle(3, UI_COLOR.money.hex, 1);
        state?.setText('SELECTED').setColor(UI_COLOR.money.css);
      } else {
        frame.setStrokeStyle(2, this.slotColor.get(type) ?? UI_COLOR.line.hex, 0.45);
        const info = BUILD_INFO.find((entry) => entry.type === type);
        state?.setText(info && GameState.money < info.cost ? `NEED $${info.cost - GameState.money}` : '').setColor(UI_COLOR.warning.css);
      }
    }
    this.showHint();
  }

  private showGameOver(newBest = false, scrapEarned = 0): void {
    this.terminalOpen = true;
    this.queuedSummary = null;
    this.dismissReport();
    this.clearAllToasts();
    this.applyOverlayPlan();
    const score = gradeRun({ wave: GameState.wave, tally: GameState.tally });
    // Centred and measured, never positioned: `GAME_H` bottoms out around 400
    // and the old fixed rows put REBUILD/MENU off the canvas entirely. See
    // `gameOverLayout`.
    const L = gameOverLayout(GAME_W, GAME_H, IS_TOUCH);
    const dim = this.add.rectangle(0, 0, GAME_W, GAME_H, 0x000000, 0.7).setOrigin(0).setDepth(50);
    const title = this.add
      .text(GAME_W / 2, L.title.y, 'FACTORY DESTROYED', { ...FONT, fontSize: `${L.title.size}px`, fontStyle: 'bold', color: '#ff5555', stroke: '#000', strokeThickness: 8 })
      .setOrigin(0.5)
      .setDepth(51);
    const sub = this.add
      .text(GAME_W / 2, L.sub.y, `You survived to wave ${GameState.wave}`, { ...FONT, fontSize: `${L.sub.size}px`, color: '#cdd6e4' })
      .setOrigin(0.5)
      .setDepth(51);
    const best = this.add
      .text(
        GAME_W / 2,
        L.best.y,
        newBest ? '★ NEW PERSONAL BEST ★' : `Personal best: wave ${Math.max(progress.stats.bestWave, GameState.wave)}`,
        { ...FONT, fontSize: `${newBest ? L.best.size : L.best.size - 2}px`, fontStyle: newBest ? 'bold' : 'normal', color: '#ffe066' },
      )
      .setOrigin(0.5)
      .setDepth(51);
    if (newBest) {
      best.setScale(0.5);
      this.tweens.add({ targets: best, scale: 1, duration: 300, ease: 'Back.out' });
    }
    // The payout. Counts up rather than appearing: a number that ticks is the
    // whole reason to look at a defeat screen, and this is the "one more run"
    // hook — every run, however bad, moved the Workshop forward.
    const scrap = this.add
      .text(GAME_W / 2, L.scrap.y, '', { ...FONT, fontSize: `${L.scrap.size}px`, fontStyle: 'bold', color: '#7cf7c4' })
      .setOrigin(0.5)
      .setDepth(51);
    // A compact verdict beside SCRAP: the tier is the hook, and the three
    // supporting numbers make the next-run prescription legible at a glance.
    // First thing dropped on a canvas too short for the whole stack — the tier
    // is a diagnosis, and the buttons are the way out.
    const grade = this.add
      .text(
        GAME_W / 2,
        L.grade.y,
        `${score.tier}  ${score.verdict}   ·   ${score.points}/100\nWave ${score.wave}   ·   ${score.delivered} delivered   ·   ${score.efficiency}% useful\n${score.advice}`,
        { ...FONT, fontSize: `${L.grade.size}px`, fontStyle: 'bold', color: '#cdd6e4', align: 'center' },
      )
      .setOrigin(0.5)
      .setDepth(51)
      .setVisible(L.grade.show);
    const counter = { n: 0 };
    scrap.setText(`⚙ +0 SCRAP   (${meta.scrap - scrapEarned} banked)`);
    this.tweens.add({
      targets: counter,
      n: scrapEarned,
      duration: 700,
      delay: 350,
      ease: 'Cubic.out',
      onUpdate: () => {
        const n = Math.round(counter.n);
        scrap.setText(`⚙ +${n} SCRAP   (${meta.scrap - scrapEarned + n} banked)`);
      },
      onComplete: () => {
        scrap.setText(`⚙ +${scrapEarned} SCRAP   (${meta.scrap} banked)`);
        scrap.setScale(1.15);
        this.tweens.add({ targets: scrap, scale: 1, duration: 160 });
        sfx.coin();
      },
    });
    const B = L.buttons;
    const btn = this.add
      .rectangle(GAME_W / 2 - B.dx, B.y, B.w, B.h, 0x2e7d4f)
      .setStrokeStyle(2, 0x5ef078)
      .setDepth(51)
      .setInteractive({ useHandCursor: true });
    const btnText = this.add
      .text(GAME_W / 2 - B.dx, B.y, 'REBUILD', { ...FONT, fontSize: `${B.size}px`, fontStyle: 'bold', color: '#ffffff' })
      .setOrigin(0.5)
      .setDepth(52);
    const menuBtn = this.add
      .rectangle(GAME_W / 2 + B.dx, B.y, B.w, B.h, 0x1e2233)
      .setStrokeStyle(2, 0x2b3040)
      .setDepth(51)
      .setInteractive({ useHandCursor: true });
    const menuBtnText = this.add
      .text(GAME_W / 2 + B.dx, B.y, 'MENU', { ...FONT, fontSize: `${B.size}px`, fontStyle: 'bold', color: '#cdd6e4' })
      .setOrigin(0.5)
      .setDepth(52);
    this.overlay = [dim, title, sub, best, scrap, grade, btn, btnText, menuBtn, menuBtnText];
    const clearOverlay = (restoreAmbient = false) => {
      this.overlay.forEach((o) => o.destroy());
      this.overlay = [];
      this.terminalOpen = false;
      if (restoreAmbient) this.restoreLowerOverlays();
    };
    btn.on('pointerdown', () => {
      clearOverlay(true);
      this.scene.get('game').scene.restart();
    });
    menuBtn.on('pointerdown', () => {
      clearOverlay();
      GameState.events.emit('ui:menu'); // GameScene owns the transition (and any final save)
    });
  }
}
