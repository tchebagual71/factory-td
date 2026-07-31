import Phaser from 'phaser';
import { GAME_H, GAME_W, IS_TOUCH, PLAYFIELD_H, ROOMY_UI, UI_H } from '../config';
import { AchievementDef } from '../data/achievements';
import { BUILD_CATEGORIES, BUILD_INFO, buildGroupSizes, categoryOf } from '../data/buildings';
import { ComboState, comboColor, comboExpired, comboNow, comboTier } from '../data/combo';
import { activeMap, prospectCost, prospectKind } from '../data/map';
import { ResearchCard, researchForLevel } from '../data/research';
import { earlySendBonus, waveDef, WAVE_KIND_LABEL } from '../data/waves';
import { pushAchievements } from '../services/cloud';
import { ammoDeficits, ammoTotal, ammoUndelivered, GameState, WaveTally } from '../state/GameState';
import { meta } from '../state/meta';
import { progress } from '../state/progress';
import { renderMode } from '../state/renderMode';
import { BuildingType } from '../types';
import { isMuted, sfx, toggleMute } from '../utils/sfx';
import { HudLayout, hudLayout, slotContent, topStrip } from './hudLayout';
import { binding, key } from './keymap';

const FONT = { fontFamily: 'monospace' };

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
  /** each slot's category tint, so deselecting restores the right rim colour */
  private slotColor = new Map<BuildingType, number>();
  /** currently armed build type — drives the selection ring and the touch description */
  private selectedType: BuildingType | null = null;
  /** greyed-out state last painted per slot, so an affordability sweep is a no-op when nothing changed */
  private slotAffordable = new Map<BuildingType, boolean>();
  private helpLayer: Phaser.GameObjects.GameObject[] = [];
  /** bottom edge of the status strip — anything that floats over the board hangs off this */
  private stripBottom = 38;
  private descText!: Phaser.GameObjects.Text;
  private overlay: Phaser.GameObjects.GameObject[] = [];
  private earlyText!: Phaser.GameObjects.Text;
  private prospectText!: Phaser.GameObjects.Text;
  private mapText!: Phaser.GameObjects.Text;
  private toastQueue: AchievementDef[] = [];
  private toastActive = false;
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

  constructor() {
    super('ui');
  }

  create(): void {
    // ----- top status strip (pure geometry: see hudLayout.topStrip) -----
    const top = topStrip(GAME_W, IS_TOUCH);
    this.stripBottom = top.stats.y + top.h;
    const chipFont = IS_TOUCH ? '19px' : '16px';
    const cy = top.stats.y + top.h / 2;

    this.add.rectangle(top.stats.x, top.stats.y, top.stats.w, top.h, 0x000000, 0.55).setOrigin(0).setDepth(0);
    const chipX = (frac: number) => top.stats.x + 10 + Math.round((top.stats.w - 20) * frac);
    this.moneyText = this.add
      .text(chipX(0), cy, '', { ...FONT, fontSize: chipFont, fontStyle: 'bold', color: '#ffe066' })
      .setOrigin(0, 0.5);
    this.livesText = this.add
      .text(chipX(0.36), cy, '', { ...FONT, fontSize: chipFont, fontStyle: 'bold', color: '#ff6b6b' })
      .setOrigin(0, 0.5);
    this.waveText = this.add
      .text(chipX(0.65), cy, '', { ...FONT, fontSize: chipFont, fontStyle: 'bold', color: '#cdd6e4' })
      .setOrigin(0, 0.5);

    // ----- prospecting -----
    const prospectBtn = this.add
      .rectangle(top.survey.x, top.survey.y, top.survey.w, top.h, 0x1e2233, 0.9)
      .setOrigin(0)
      .setStrokeStyle(2, 0x2b3040)
      .setInteractive({ useHandCursor: true });
    this.prospectText = this.add
      .text(top.survey.x + top.survey.w / 2, cy, '', {
        ...FONT, fontSize: IS_TOUCH ? '14px' : '12px', fontStyle: 'bold', color: '#cdd6e4',
      })
      .setOrigin(0.5);
    prospectBtn.on('pointerover', () => prospectBtn.setFillStyle(0x272c42, 0.9));
    prospectBtn.on('pointerout', () => prospectBtn.setFillStyle(0x1e2233, 0.9));
    prospectBtn.on('pointerdown', () => GameState.events.emit('ui:prospect'));
    GameState.events.on('surveys', () => this.refreshStats());
    // Armed survey mode: the button stays lit until a site is picked or cancelled
    GameState.events.on('surveymode', (on: boolean) => {
      this.surveyArmed = on;
      prospectBtn.setStrokeStyle(2, on ? 0x5ef078 : 0x2b3040);
      this.refreshStats();
    });

    // Which layout this run is on. UIScene sleeps rather than stopping, so this
    // is refreshed with the stats instead of being captured once at create().
    this.mapText = this.add
      .text(top.map.x + top.map.w, cy, '', { ...FONT, fontSize: '11px', fontStyle: 'bold', color: '#6b7689' })
      .setOrigin(1, 0.5);

    // ----- research chip -----
    // Progress toward the next level-up draw. It only appears once a Lab has
    // actually banked something, so a player who never builds one is not
    // nagged by an empty bar.
    const rr = top.research;
    const researchBox = this.add
      .rectangle(rr.x, rr.y, rr.w, top.h, 0x1a1830, 0.9)
      .setOrigin(0)
      .setStrokeStyle(2, 0x474170)
      .setVisible(false);
    const barW = rr.w - 6;
    this.researchBar = this.add.rectangle(rr.x + 3, rr.y + top.h - 3, 0, 4, 0x7cf7c4).setOrigin(0, 1).setVisible(false);
    this.researchText = this.add
      .text(rr.x + 6, rr.y + 4, '', { ...FONT, fontSize: '12px', fontStyle: 'bold', color: '#7cf7c4' })
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
    help.label.setColor('#8892a6');
    this.input.keyboard?.on(`keydown-${binding('help').key}`, () => this.showHelp());

    const mute = this.hudButton(top.mute.x, top.mute.y, top.mute.w, top.h, '', IS_TOUCH ? 20 : 16, () =>
      applyMute(toggleMute()),
    );
    const applyMute = (m: boolean) => mute.label.setText(m ? '✕' : '♪').setColor(m ? '#8892a6' : '#5ef078');
    applyMute(isMuted());
    this.input.keyboard?.on(`keydown-${binding('mute').key}`, () => applyMute(toggleMute()));

    // 2D ↔ 3D. GameScene owns the renderer, so this only asks. It exists as a
    // chip because the shortcut is keyboard-only and a phone has no keyboard —
    // the 3D board was simply unreachable mid-run on touch.
    const view = this.hudButton(top.view.x, top.view.y, top.view.w, top.h, '', IS_TOUCH ? 15 : 13, () =>
      GameState.events.emit('ui:view'),
    );
    const applyView = (mode: string) =>
      view.label.setText(mode === 'iso' ? '3D' : '2D').setColor(mode === 'iso' ? '#7cf7c4' : '#8892a6');
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
    this.add.rectangle(0, PLAYFIELD_H, GAME_W, UI_H, 0x141625).setOrigin(0);
    this.add.rectangle(0, PLAYFIELD_H, GAME_W, 2, 0x2b3040).setOrigin(0);

    const layout = hudLayout({
      gameW: GAME_W,
      barY: PLAYFIELD_H,
      barH: UI_H,
      roomy: ROOMY_UI,
      touch: IS_TOUCH,
      groups: buildGroupSizes(),
    });

    this.buildPalette(layout);
    if (IS_TOUCH) this.buildTouchControls(layout);
    this.buildWaveCluster(layout);

    // Hangs below the status strip: at y=10 it ran straight through the survey
    // and research chips, which are exactly what you are reading past.
    const legend = this.add
      .text(GAME_W / 2, top.stats.y + top.h + 6, 'LOGISTICS  ·  tower % = ammo uptime last wave  ·  green belts flowing, red jammed  ·  orange rings = starved or backed up', {
        ...FONT, fontSize: '11px', color: '#cdd6e4', backgroundColor: '#000000cc', padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5, 0)
      .setDepth(30)
      .setVisible(false);
    GameState.events.on('overlay', (on: boolean) => legend.setVisible(on));

    // ----- kill streak meter -----
    // Top RIGHT, hanging off the strip: top-left is the achievement toasts and
    // top-centre is the logistics legend. Hidden below tier 1 (see combo.ts) so
    // ordinary trickle kills never put chrome on screen.
    this.comboText = this.add
      .text(GAME_W - 10, this.stripBottom + 8, '', {
        ...FONT, fontSize: '20px', fontStyle: 'bold', color: '#ffe066', stroke: '#000', strokeThickness: 4,
      })
      .setOrigin(1, 0)
      .setDepth(30)
      .setVisible(false);
    GameState.events.on('combo', (c: ComboState) => this.refreshCombo(c));

    // ----- state listeners -----
    const ev = GameState.events;
    ev.on('money', () => this.refreshStats(true));
    ev.on('lives', () => this.refreshStats());
    ev.on('wave', () => {
      this.refreshStats();
      this.refreshPreview();
    });
    ev.on('phase', () => this.refreshWaveBtn());
    ev.on('selected', (t: BuildingType | null) => this.refreshSelection(t));
    ev.on('gameover', () => {
      // A pending draw (or an open help panel) would otherwise sit on top of the
      // game-over buttons and keep the sim frozen with no way out.
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
      this.toastQueue.push(def);
      this.pumpToasts();
      void pushAchievements([def.id]);
    });
    ev.on('speed', (s: number) => this.speedBtnText.setText(`×${s}`).setColor(s > 1 ? '#ffe066' : '#cdd6e4'));
    ev.on('auto', (on: boolean) => {
      this.autoBtnText.setColor(on ? '#5ef078' : '#8892a6');
      this.autoBtn.setStrokeStyle(2, on ? 0x5ef078 : 0x2b3040);
    });

    // UIScene sleeps rather than stops, so anything still on screen when the
    // player leaves would be waiting for them when the next run starts.
    ev.on('ui:menu', () => {
      this.closeHelp();
      this.summaryCard?.destroy();
      this.summaryCard = null;
    });

    ev.on('wavesummary', (wave: number, tally: WaveTally) => this.showWaveSummary(wave, tally));
    ev.on('cards', (cards: ResearchCard[], level: number) => this.showCardDraw(cards, level));

    this.refreshStats();
    this.refreshPreview();
    this.refreshWaveBtn();
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
    const W = 940;
    // Height follows the content instead of a guessed constant — the build
    // reference grows by a row whenever a building is added to the palette.
    const refH = BUILD_CATEGORIES.length * 28 + BUILD_INFO.length * 16;
    const H = Math.min(GAME_H - 40, 66 + Math.max(226, refH) + 76);
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
          ['Build', 'Three shelves: LOGI, PROD, GUNS. Tap a slot, then the board; tap it again to cancel.'],
          ['Belts', 'Drag across the board to paint a line — corners included.'],
          ['Rotate', 'ROTATE sets the facing before you build; tap a placed belt to turn it.'],
          ['Sell', 'SELL, then tap a building — refunds half. Or long-press it. On a belt carrying a stuck item, the first tap clears the item instead.'],
          ['Upgrade', 'Tap a placed tower to open its upgrade panel.'],
          ['Wave', 'SEND WAVE. AUTO sends them back to back; ×1/×2/×3 is game speed.'],
          ['Logistics', 'LOGI shades belts by throughput and shows each tower’s ammo uptime.'],
          ['View', 'The 2D/3D chip up top swaps the flat board for the isometric one.'],
        ]
      : [
          // Every key here is read from `keymap.ts`, so a rebind can never leave
          // this reference quietly lying to the player.
          ['Build', `Pick from the three shelves in the bar, or use the hotkeys listed here. ${key('cancel')} cancels.`],
          ['Belts', 'Hold and drag to paint a line; it turns corners with your drag.'],
          ['Rotate', `${key('rotate')} turns whatever is under the cursor, or the pending build on bare ground. Shift+wheel turns it either way.`],
          ['Sell', 'Right-click a building — refunds half. Expensive ones ask twice. On a belt carrying a stuck item, the first right-click clears the item instead.'],
          ['Upgrade', `Click a placed tower, then ${key('upgradeA')} (or ${key('upgradeB')} for the second path at Mk3).`],
          ['Wave', `${key('sendWave')} sends it · ${key('speed')} cycles speed ×1/×2/×3 · ${key('pause')} pauses.`],
          ['Logistics', `${key('overlay')} shades belts by throughput and shows each tower’s ammo uptime · ${key('mute')} mutes.`],
          ['View', `${key('view')} swaps the flat board for the 3D isometric one, as does the 2D/3D chip.`],
        ];
    let cy = y + 66;
    for (const [head, body] of controls) {
      this.helpLayer.push(
        this.add.text(x + 30, cy, head, { ...FONT, fontSize: '12px', fontStyle: 'bold', color: '#6bd4ff' }).setDepth(82),
        this.add
          .text(x + 116, cy, body, { ...FONT, fontSize: '11px', color: '#cdd6e4', wordWrap: { width: 320 }, lineSpacing: 2 })
          .setDepth(82),
      );
      cy += 30;
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
    const close = this.hudButton(GAME_W / 2 - 80, closeY - 18, 160, 36, 'CLOSE', 14, () => this.closeHelp(), 0x2e7d4f, 0x5ef078);
    close.frame.setDepth(82);
    close.label.setDepth(83).setColor('#ffffff');
    this.helpLayer.push(close.frame, close.label);
  }

  private closeHelp(): void {
    this.helpLayer.forEach((o) => o.destroy());
    this.helpLayer = [];
    GameState.modalOpen = false;
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
    fill = 0x1e2233,
    stroke = 0x2b3040,
  ): { frame: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text } {
    const frame = this.add
      .rectangle(x, y, w, h, fill)
      .setOrigin(0)
      .setStrokeStyle(2, stroke)
      .setInteractive({ useHandCursor: true });
    const label = this.add
      .text(x + w / 2, y + h / 2, text, { ...FONT, fontSize: `${fontSize}px`, fontStyle: 'bold', color: '#cdd6e4' })
      .setOrigin(0.5);
    frame.on('pointerover', () => frame.setFillStyle(0x272c42));
    frame.on('pointerout', () => frame.setFillStyle(fill));
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
      this.add.rectangle(h.x, h.y, h.w, h.h, cat.color, 0.14).setOrigin(0);
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
      const frame = this.add
        .rectangle(0, 0, bw, bh, 0x1e2233)
        .setOrigin(0)
        .setStrokeStyle(2, cat.color, 0.45)
        .setInteractive({ useHandCursor: true });
      frame.on('pointerdown', () => GameState.events.emit('ui:select', info.type));
      frame.on('pointerover', () => {
        frame.setFillStyle(0x272c42);
        this.showDesc(info.desc, cat.css);
      });
      frame.on('pointerout', () => {
        frame.setFillStyle(0x1e2233);
        this.showHint();
      });
      container.add([
        frame,
        this.add.image(bw / 2, inner.iconY, info.type).setScale(inner.iconScale),
        this.add
          .text(bw / 2, inner.costY, `$${info.cost}`, { ...FONT, fontSize: `${inner.costSize}px`, color: '#ffe066' })
          .setOrigin(0.5, 0),
      ]);
      if (inner.showName) {
        container.add(
          this.add
            .text(bw / 2, inner.nameY, info.name, { ...FONT, fontSize: `${inner.nameSize}px`, fontStyle: 'bold', color: '#e8edf5' })
            .setOrigin(0.5, 0),
        );
      }
      // the hotkey badge is noise on a device with no keyboard
      if (!IS_TOUCH) {
        container.add(this.add.text(4, 3, info.hotkey, { ...FONT, fontSize: '9px', color: '#8892a6' }));
      }
      this.paletteFrames.set(info.type, frame);
      this.paletteButtons.set(info.type, container);
    });

    this.descText = this.add
      .text(layout.groupHeaders[0].x + 2, PLAYFIELD_H - 20, '', {
        ...FONT, fontSize: '11px', color: '#cdd6e4', stroke: '#000000', strokeThickness: 3,
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
    this.showDesc(this.paletteHint, '#cdd6e4');
  }

  /**
   * Touch replacements for the affordances that need a keyboard or a right
   * mouse button. Only built on touch devices — a desktop keeps its shortcuts.
   */
  private buildTouchControls(layout: HudLayout): void {
    const [r, s, p] = layout.touch;
    const ARROWS = ['→', '↓', '←', '↑'];

    const rotate = this.hudButton(r.x, r.y, r.w, r.h, `↻ ${ARROWS[0]}`, 15, () => GameState.events.emit('ui:rotate'));
    rotate.label.setColor('#ffe066');
    GameState.events.on('builddir', (dir: number) => rotate.label.setText(`↻ ${ARROWS[dir & 3]}`));

    const sell = this.hudButton(s.x, s.y, s.w, s.h, 'SELL', 14, () => GameState.events.emit('ui:sellmode'));
    GameState.events.on('sellmode', (on: boolean) => {
      sell.label.setText(on ? 'SELL ✓' : 'SELL').setColor(on ? '#ff8b8b' : '#cdd6e4');
      sell.frame.setStrokeStyle(2, on ? 0xff5555 : 0x2b3040);
    });

    const pause = this.hudButton(p.x, p.y, p.w, p.h, '❚❚', 15, () => GameState.togglePause());
    GameState.events.on('paused', (paused: boolean) => {
      pause.label.setText(paused ? '▶' : '❚❚').setColor(paused ? '#5ef078' : '#cdd6e4');
    });
  }

  /** Wave button + speed/auto/logistics/menu, stacked to fill whatever bar height we have. */
  private buildWaveCluster(layout: HudLayout): void {
    const { preview, send, toggles } = layout;

    this.previewText = this.add
      .text(preview.x + preview.w / 2, preview.y + preview.h / 2, '', {
        ...FONT, fontSize: ROOMY_UI ? '12px' : '10px', color: '#cdd6e4', align: 'center',
      })
      .setOrigin(0.5);

    this.waveBtn = this.add
      .rectangle(send.x, send.y, send.w, send.h, 0x2e7d4f)
      .setOrigin(0)
      .setStrokeStyle(2, 0x5ef078)
      .setInteractive({ useHandCursor: true });
    this.waveBtnText = this.add
      .text(send.x + send.w / 2, send.y + send.h / 2 - 7, IS_TOUCH ? 'SEND WAVE' : `SEND WAVE [${key('sendWave')}]`, {
        ...FONT, fontSize: ROOMY_UI ? '17px' : '14px', fontStyle: 'bold', color: '#ffffff',
      })
      .setOrigin(0.5);
    // live early-send bonus, ticking down inside the button — the "go now" nudge
    this.earlyText = this.add
      .text(send.x + send.w / 2, send.y + send.h / 2 + 12, '', {
        ...FONT, fontSize: ROOMY_UI ? '12px' : '11px', fontStyle: 'bold', color: '#c9f0ff',
      })
      .setOrigin(0.5);
    this.waveBtn.on('pointerdown', () => GameState.events.emit('ui:startwave'));

    const [a, s, l, m] = toggles;
    const auto = this.hudButton(a.x, a.y, a.w, a.h, 'AUTO', 13, () => GameState.toggleAuto());
    this.autoBtn = auto.frame;
    this.autoBtnText = auto.label.setColor('#8892a6');

    const speed = this.hudButton(s.x, s.y, s.w, s.h, '×1', 15, () => GameState.cycleSpeed());
    this.speedBtnText = speed.label;

    const logi = this.hudButton(l.x, l.y, l.w, l.h, 'LOGI', 12, () => GameState.toggleOverlay());
    logi.label.setColor('#8892a6');
    GameState.events.on('overlay', (on: boolean) => {
      logi.label.setColor(on ? '#6bd4ff' : '#8892a6');
      logi.frame.setStrokeStyle(2, on ? 0x6bd4ff : 0x2b3040);
    });

    const menu = this.hudButton(m.x, m.y, m.w, m.h, 'MENU', 12, () => {
      if (GameState.phase === 'wave' && !GameState.gameOver && !this.menuConfirm) {
        this.menuConfirm = true;
        menu.label.setText('SURE?').setColor('#ff5555');
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
    this.summaryCard?.destroy();
    const W = 288;
    const H = 158;
    const c = this.add.container(GAME_W / 2 - W / 2, 372).setDepth(45).setAlpha(0);
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
    this.tweens.add({ targets: c, alpha: 1, y: 360, duration: 220, ease: 'Back.out' });
    this.tweens.add({
      targets: c,
      alpha: 0,
      delay: 4200,
      duration: 400,
      onComplete: () => {
        c.destroy();
        if (this.summaryCard === c) this.summaryCard = null;
      },
    });
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
    this.clearCards();
    const dim = this.add.rectangle(0, 0, GAME_W, GAME_H, 0x000000, 0.72).setOrigin(0).setDepth(70).setInteractive();
    const title = this.add
      .text(GAME_W / 2, 96, `RESEARCH  ·  LEVEL ${level}`, {
        ...FONT, fontSize: '30px', fontStyle: 'bold', color: '#7cf7c4', stroke: '#000', strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setDepth(71);
    const sub = this.add
      .text(GAME_W / 2, 132, 'Your factory earned this. Choose one — it lasts the rest of the run.', {
        ...FONT, fontSize: '13px', color: '#cdd6e4',
      })
      .setOrigin(0.5)
      .setDepth(71);
    this.cardLayer.push(dim, title, sub);

    const W = 280;
    const H = 210;
    const gap = 28;
    const total = cards.length * W + (cards.length - 1) * gap;
    cards.forEach((card, i) => {
      const x = GAME_W / 2 - total / 2 + i * (W + gap);
      const y = 190;
      const frame = this.add
        .rectangle(x, y, W, H, 0x1a1830)
        .setOrigin(0)
        .setStrokeStyle(3, 0x474170)
        .setDepth(71)
        .setInteractive({ useHandCursor: true });
      const name = this.add
        .text(x + W / 2, y + 34, card.name, { ...FONT, fontSize: '16px', fontStyle: 'bold', color: '#7cf7c4', align: 'center', wordWrap: { width: W - 30 } })
        .setOrigin(0.5, 0)
        .setDepth(72);
      const desc = this.add
        .text(x + W / 2, y + 92, card.desc, {
          ...FONT, fontSize: '13px', color: '#cdd6e4', align: 'center', wordWrap: { width: W - 40 }, lineSpacing: 4,
        })
        .setOrigin(0.5, 0)
        .setDepth(72);
      const stacks = GameState.taken[card.id] ?? 0;
      const held = this.add
        .text(x + W / 2, y + H - 26, stacks > 0 ? `already taken ×${stacks}` : '', {
          ...FONT, fontSize: '11px', color: '#8892a6',
        })
        .setOrigin(0.5)
        .setDepth(72);
      const key = this.add
        .text(x + 10, y + 8, `[${i + 1}]`, { ...FONT, fontSize: '12px', fontStyle: 'bold', color: '#8892a6' }).setDepth(72);

      frame.on('pointerover', () => frame.setFillStyle(0x272348).setStrokeStyle(3, 0x7cf7c4));
      frame.on('pointerout', () => frame.setFillStyle(0x1a1830).setStrokeStyle(3, 0x474170));
      frame.on('pointerdown', () => this.pickCard(card.id));

      // stagger the entrance so three cards read as a deal, not a popup
      frame.setAlpha(0);
      [name, desc, held, key].forEach((o) => o.setAlpha(0));
      this.tweens.add({ targets: [frame, name, desc, held, key], alpha: 1, duration: 180, delay: 70 * i });
      this.cardLayer.push(frame, name, desc, held, key);
    });

    // number keys pick too — the mouse should never be mandatory
    const keys = ['ONE', 'TWO', 'THREE'];
    cards.forEach((card, i) => {
      const handler = () => this.pickCard(card.id);
      this.input.keyboard?.once(`keydown-${keys[i]}`, handler);
      this.cardKeyHandlers.push({ key: `keydown-${keys[i]}`, handler });
    });
    sfx.waveClear();
  }

  private pickCard(id: string): void {
    this.clearCards(); // destroy first: GameScene may immediately deal the next level
    GameState.events.emit('ui:pickcard', id);
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
      this.paletteButtons.get(info.type)?.setAlpha(can ? 1 : 0.45);
    }

    const cost = prospectCost(GameState.surveys, GameState.surveyDiscount);
    const kind = prospectKind(GameState.surveys);
    this.prospectText
      .setText(this.surveyArmed ? `⛏ PICK A SITE  (ESC)` : `⛏ SURVEY ${kind.toUpperCase()}  $${cost}`)
      .setColor(this.surveyArmed ? '#5ef078' : GameState.money >= cost ? (kind === 'ore' ? '#ff9f43' : '#6bd4ff') : '#8892a6');
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
      this.summaryCard.destroy();
      this.summaryCard = null;
    }
    this.waveBtn.setFillStyle(building ? 0x2e7d4f : 0x5c2530);
    this.waveBtn.setStrokeStyle(2, building ? 0x5ef078 : 0xff5555);
    // Never quote a keyboard shortcut on a device with no keyboard — this used
    // to re-stamp "[SPC]" over the touch label on the first phase change.
    this.waveBtnText.setText(building ? (IS_TOUCH ? 'SEND WAVE' : `SEND WAVE [${key('sendWave')}]`) : 'DEFEND!');
    this.refreshStats();
  }

  /** Slide-in achievement cards, one at a time, top-right above the upgrade panel. */
  private pumpToasts(): void {
    if (this.toastActive) return;
    const def = this.toastQueue.shift();
    if (!def) return;
    this.toastActive = true;
    // Top LEFT, under the stat chips. On the right it slid in over the map name
    // and the help/mute buttons, and — once the upgrade panel moved down to
    // clear the taller touch strip — straight across the panel you were reading.
    const c = this.add.container(-280, this.stripBottom + 8).setDepth(60);
    const bg = this.add.rectangle(0, 0, 262, 34, 0x141625, 0.95).setOrigin(0).setStrokeStyle(2, 0xffe066);
    const name = this.add.text(10, 4, `★ ${def.name}`, { ...FONT, fontSize: '12px', fontStyle: 'bold', color: '#ffe066' });
    const desc = this.add.text(10, 20, def.unlock ? `${def.desc} — ${def.unlock.label}` : def.desc, { ...FONT, fontSize: '9px', color: '#cdd6e4' });
    c.add([bg, name, desc]);
    sfx.coin();
    this.tweens.add({ targets: c, x: 8, duration: 250, ease: 'Back.out' });
    this.tweens.add({
      targets: c,
      x: -280,
      delay: 3000,
      duration: 200,
      ease: 'Cubic.in',
      onComplete: () => {
        c.destroy();
        this.toastActive = false;
        this.pumpToasts();
      },
    });
  }

  /**
   * Armed slot gets a thick gold rim; the rest fall back to their category
   * colour, so the palette still reads as three shelves while one is selected.
   */
  private refreshSelection(t: BuildingType | null): void {
    this.selectedType = t;
    for (const [type, frame] of this.paletteFrames) {
      if (type === t) frame.setStrokeStyle(3, 0xffe066, 1);
      else frame.setStrokeStyle(2, this.slotColor.get(type) ?? 0x2b3040, 0.45);
    }
    this.showHint();
  }

  private showGameOver(newBest = false, scrapEarned = 0): void {
    const dim = this.add.rectangle(0, 0, GAME_W, GAME_H, 0x000000, 0.7).setOrigin(0).setDepth(50);
    const title = this.add
      .text(GAME_W / 2, 260, 'FACTORY DESTROYED', { ...FONT, fontSize: '48px', fontStyle: 'bold', color: '#ff5555', stroke: '#000', strokeThickness: 8 })
      .setOrigin(0.5)
      .setDepth(51);
    const sub = this.add
      .text(GAME_W / 2, 320, `You survived to wave ${GameState.wave}`, { ...FONT, fontSize: '18px', color: '#cdd6e4' })
      .setOrigin(0.5)
      .setDepth(51);
    const best = this.add
      .text(
        GAME_W / 2,
        348,
        newBest ? '★ NEW PERSONAL BEST ★' : `Personal best: wave ${Math.max(progress.stats.bestWave, GameState.wave)}`,
        { ...FONT, fontSize: newBest ? '16px' : '14px', fontStyle: newBest ? 'bold' : 'normal', color: '#ffe066' },
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
      .text(GAME_W / 2, 374, '', { ...FONT, fontSize: '17px', fontStyle: 'bold', color: '#7cf7c4' })
      .setOrigin(0.5)
      .setDepth(51);
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
    const btn = this.add
      .rectangle(GAME_W / 2 - 125, 400, 220, 52, 0x2e7d4f)
      .setStrokeStyle(2, 0x5ef078)
      .setDepth(51)
      .setInteractive({ useHandCursor: true });
    const btnText = this.add
      .text(GAME_W / 2 - 125, 400, 'REBUILD', { ...FONT, fontSize: '20px', fontStyle: 'bold', color: '#ffffff' })
      .setOrigin(0.5)
      .setDepth(52);
    const menuBtn = this.add
      .rectangle(GAME_W / 2 + 125, 400, 220, 52, 0x1e2233)
      .setStrokeStyle(2, 0x2b3040)
      .setDepth(51)
      .setInteractive({ useHandCursor: true });
    const menuBtnText = this.add
      .text(GAME_W / 2 + 125, 400, 'MENU', { ...FONT, fontSize: '20px', fontStyle: 'bold', color: '#cdd6e4' })
      .setOrigin(0.5)
      .setDepth(52);
    this.overlay = [dim, title, sub, best, scrap, btn, btnText, menuBtn, menuBtnText];
    const clearOverlay = () => {
      this.overlay.forEach((o) => o.destroy());
      this.overlay = [];
    };
    btn.on('pointerdown', () => {
      clearOverlay();
      this.scene.get('game').scene.restart();
    });
    menuBtn.on('pointerdown', () => {
      clearOverlay();
      GameState.events.emit('ui:menu'); // GameScene owns the transition (and any final save)
    });
  }
}
