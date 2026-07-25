import Phaser from 'phaser';
import { GAME_H, GAME_W, IS_TOUCH, PLAYFIELD_H, ROOMY_UI, UI_H } from '../config';
import { AchievementDef } from '../data/achievements';
import { BUILD_INFO } from '../data/buildings';
import { activeMap, prospectCost, prospectKind } from '../data/map';
import { ResearchCard, researchForLevel } from '../data/research';
import { earlySendBonus, waveDef, WAVE_KIND_LABEL } from '../data/waves';
import { pushAchievements } from '../services/cloud';
import { ammoDeficits, ammoTotal, GameState, WaveTally } from '../state/GameState';
import { progress } from '../state/progress';
import { BuildingType } from '../types';
import { isMuted, sfx, toggleMute } from '../utils/sfx';
import { HudLayout, hudLayout } from './hudLayout';

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

  constructor() {
    super('ui');
  }

  create(): void {
    // ----- top-left stat chips -----
    this.add.rectangle(8, 8, 356, 30, 0x000000, 0.55).setOrigin(0).setDepth(0);
    this.moneyText = this.add.text(18, 14, '', { ...FONT, fontSize: '16px', fontStyle: 'bold', color: '#ffe066' });
    this.livesText = this.add.text(130, 14, '', { ...FONT, fontSize: '16px', fontStyle: 'bold', color: '#ff6b6b' });
    this.waveText = this.add.text(230, 14, '', { ...FONT, fontSize: '16px', fontStyle: 'bold', color: '#cdd6e4' });
    const muteBtn = this.add
      .text(338, 14, isMuted() ? '✕' : '♪', { ...FONT, fontSize: '16px', fontStyle: 'bold', color: isMuted() ? '#8892a6' : '#5ef078' })
      .setInteractive({ useHandCursor: true });
    const applyMute = (m: boolean) => muteBtn.setText(m ? '✕' : '♪').setColor(m ? '#8892a6' : '#5ef078');
    muteBtn.on('pointerdown', () => applyMute(toggleMute()));
    this.input.keyboard?.on('keydown-M', () => applyMute(toggleMute()));

    // ----- prospecting (top strip, right of the stat chips) -----
    const prospectBtn = this.add
      .rectangle(372, 8, 196, 30, 0x1e2233, 0.9)
      .setOrigin(0)
      .setStrokeStyle(2, 0x2b3040)
      .setInteractive({ useHandCursor: true });
    this.prospectText = this.add
      .text(470, 23, '', { ...FONT, fontSize: '12px', fontStyle: 'bold', color: '#cdd6e4' })
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
      .text(582, 23, '', { ...FONT, fontSize: '11px', fontStyle: 'bold', color: '#6b7689' })
      .setOrigin(0, 0.5);

    // ----- research chip (top strip, right of the map name) -----
    // Progress toward the next level-up draw. It only appears once a Lab has
    // actually banked something, so a player who never builds one is not
    // nagged by an empty bar.
    const researchBox = this.add.rectangle(700, 8, 236, 30, 0x1a1830, 0.9).setOrigin(0).setStrokeStyle(2, 0x474170).setVisible(false);
    this.researchBar = this.add.rectangle(703, 31, 0, 4, 0x7cf7c4).setOrigin(0, 1).setVisible(false);
    this.researchText = this.add
      .text(706, 12, '', { ...FONT, fontSize: '12px', fontStyle: 'bold', color: '#7cf7c4' })
      .setVisible(false);
    GameState.events.on('research', (points: number, level: number) => {
      const need = researchForLevel(level + 1);
      const show = level > 0 || points > 0;
      researchBox.setVisible(show);
      this.researchBar.setVisible(show);
      this.researchText.setVisible(show);
      this.researchText.setText(`⚗ RESEARCH  Lv${level}   ${points}/${need}`);
      this.researchBar.width = Math.round(230 * Phaser.Math.Clamp(points / need, 0, 1));
    });

    // ----- pause overlay -----
    const pauseDim = this.add.rectangle(0, 0, GAME_W, PLAYFIELD_H, 0x000000, 0.45).setOrigin(0).setDepth(40).setVisible(false);
    const pauseText = this.add
      .text(GAME_W / 2, PLAYFIELD_H / 2, 'PAUSED\n[P] to resume', { ...FONT, fontSize: '36px', fontStyle: 'bold', color: '#ffe066', align: 'center', stroke: '#000', strokeThickness: 6 })
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
      slotCount: BUILD_INFO.length,
    });

    this.buildPalette(layout);
    if (IS_TOUCH) this.buildTouchControls(layout);
    this.buildWaveCluster(layout);

    const legend = this.add
      .text(GAME_W / 2, 10, 'LOGISTICS  ·  tower % = ammo uptime last wave  ·  green belts flowing, red jammed  ·  orange rings = starved or backed up', {
        ...FONT, fontSize: '11px', color: '#cdd6e4', backgroundColor: '#000000cc', padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5, 0)
      .setDepth(30)
      .setVisible(false);
    GameState.events.on('overlay', (on: boolean) => legend.setVisible(on));

    // ----- state listeners -----
    const ev = GameState.events;
    ev.on('money', () => this.refreshStats(true));
    ev.on('lives', () => this.refreshStats());
    ev.on('wave', () => this.refreshStats());
    ev.on('phase', () => this.refreshWaveBtn());
    ev.on('selected', (t: BuildingType | null) => this.refreshSelection(t));
    ev.on('gameover', () => {
      // A pending draw would otherwise sit on top of the game-over buttons and
      // keep the sim frozen with no way out.
      this.clearCards();
      GameState.finishDraw();
      const prevBest = progress.stats.bestWave;
      progress.recordMax('bestWave', GameState.wave);
      this.showGameOver(prevBest > 0 && GameState.wave > prevBest);
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

    ev.on('wavesummary', (wave: number, tally: WaveTally) => this.showWaveSummary(wave, tally));
    ev.on('cards', (cards: ResearchCard[], level: number) => this.showCardDraw(cards, level));

    this.refreshStats();
    this.refreshWaveBtn();
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
   * Build palette. One row of small slots on a 16:9 desktop bar; two rows of
   * big, finger-sized slots whenever the bar is roomy (tablets and touch).
   */
  private buildPalette(layout: HudLayout): void {
    const bh = layout.slots[0].h;
    const big = bh >= 78;
    const iconScale = Math.min(2, Math.max(0.9, (bh * 0.42) / 32));

    const HINT = IS_TOUCH
      ? 'Tap a slot then tap the map · ROTATE turns it · tap a placed belt to turn it · SELL then tap to refund 50% · tap a tower to upgrade'
      : 'Drag paints belts round corners · R turns what is under the cursor · click a placed belt to turn it · right-click sells · click a tower to upgrade · [L] logistics';

    BUILD_INFO.forEach((info, i) => {
      const { x, y, w: bw } = layout.slots[i];
      const container = this.add.container(x, y);
      const frame = this.add
        .rectangle(0, 0, bw, bh, 0x1e2233)
        .setOrigin(0)
        .setStrokeStyle(2, 0x2b3040)
        .setInteractive({ useHandCursor: true });
      frame.on('pointerdown', () => GameState.events.emit('ui:select', info.type));
      frame.on('pointerover', () => {
        frame.setFillStyle(0x272c42);
        this.descText.setText(info.desc);
      });
      frame.on('pointerout', () => {
        frame.setFillStyle(0x1e2233);
        this.descText.setText(HINT);
      });
      container.add([
        frame,
        this.add.image(bw / 2, bh * 0.34, info.type).setScale(iconScale),
        this.add
          .text(bw / 2, bh * 0.6, info.name, { ...FONT, fontSize: big ? '12px' : '10px', fontStyle: 'bold', color: '#e8edf5' })
          .setOrigin(0.5, 0),
        this.add
          .text(bw / 2, bh * 0.78, `$${info.cost}`, { ...FONT, fontSize: big ? '13px' : '11px', color: '#ffe066' })
          .setOrigin(0.5, 0),
      ]);
      // the hotkey badge is noise on a device with no keyboard
      if (!IS_TOUCH) {
        container.add(this.add.text(4, 3, info.hotkey, { ...FONT, fontSize: '9px', color: '#8892a6' }));
      }
      this.paletteFrames.set(info.type, frame);
      this.paletteButtons.set(info.type, container);
    });

    this.descText = this.add
      .text(layout.slots[0].x + 2, PLAYFIELD_H - 20, HINT, {
        ...FONT, fontSize: '11px', color: '#cdd6e4', stroke: '#000000', strokeThickness: 3,
      });
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
      .text(send.x + send.w / 2, send.y + send.h / 2 - 7, IS_TOUCH ? 'SEND WAVE' : 'SEND WAVE [SPC]', {
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
  }

  /**
   * Wave-clear card: what the round actually cost and produced. Fired vs made
   * is the headline, but it is judged *per ammo type* — a chiller turning one
   * ore into two coolant would otherwise flatter a gun line that is starving.
   */
  private showWaveSummary(wave: number, t: WaveTally): void {
    this.summaryCard?.destroy();
    const W = 268;
    const H = 118;
    const c = this.add.container(GAME_W / 2 - W / 2, 372).setDepth(45).setAlpha(0);
    const short = ammoDeficits(t);
    const deficit = short.length > 0;
    const fired = ammoTotal(t.fired);
    const made = ammoTotal(t.produced);
    const bg = this.add.rectangle(0, 0, W, H, 0x141625, 0.94).setOrigin(0).setStrokeStyle(2, deficit ? 0xff9f43 : 0x2b3040);
    const rows: Phaser.GameObjects.GameObject[] = [
      bg,
      this.add.text(12, 9, `WAVE ${wave} REPORT`, { ...FONT, fontSize: '13px', fontStyle: 'bold', color: '#ffe066' }),
      this.add.text(12, 32, `Kills      ${t.kills}${t.leaked > 0 ? `        Leaked ${t.leaked}` : ''}`, {
        ...FONT, fontSize: '11px', color: t.leaked > 0 ? '#ff8b8b' : '#cdd6e4',
      }),
      this.add.text(12, 50, `Income     +$${t.income}`, { ...FONT, fontSize: '11px', color: '#ffe066' }),
      this.add.text(12, 68, `Ammo       ${fired} fired · ${made} made`, {
        ...FONT, fontSize: '11px', color: deficit ? '#ff9f43' : '#5ef078',
      }),
      this.add.text(
        12,
        90,
        deficit
          ? `⚠ ${short.map((d) => `${d.type} −${d.short}`).join('  ')} — add production`
          : '✓ production kept up',
        { ...FONT, fontSize: '10px', color: deficit ? '#ff9f43' : '#8892a6' },
      ),
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

  private refreshStats(pop = false): void {
    this.moneyText.setText(`$ ${GameState.money}`);
    this.livesText.setText(`♥ ${GameState.lives}`);
    this.waveText.setText(`Wave ${GameState.wave}`);
    if (pop) {
      this.moneyText.setScale(1.25);
      this.tweens.add({ targets: this.moneyText, scale: 1, duration: 150 });
    }
    const d = waveDef(GameState.wave);
    // matches the enemy textures, so the preview colour names the thing you'll see
    const KIND_COLOR: Record<string, string> = { normal: '#cdd6e4', swift: '#2fe3d0', armored: '#9aa7bd', boss: '#ff6b6b' };
    const KIND_HINT: Record<string, string> = {
      normal: '',
      swift: '\nfast & many — splash shines',
      armored: '\nresists bullets — shells or lances',
      boss: '\ntanky · a leak costs 5♥',
    };
    this.previewText
      .setText(`Next: ${d.count}× ${WAVE_KIND_LABEL[d.kind]} · ${d.hp} HP${KIND_HINT[d.kind]}`)
      .setColor(KIND_COLOR[d.kind]);
    for (const info of BUILD_INFO) {
      this.paletteButtons.get(info.type)?.setAlpha(GameState.money >= info.cost ? 1 : 0.45);
    }

    this.mapText.setText(`◈ ${activeMap().name}`);
    const cost = prospectCost(GameState.surveys);
    const kind = prospectKind(GameState.surveys);
    this.prospectText
      .setText(this.surveyArmed ? `⛏ PICK A SITE  (ESC)` : `⛏ SURVEY ${kind.toUpperCase()}  $${cost}`)
      .setColor(this.surveyArmed ? '#5ef078' : GameState.money >= cost ? (kind === 'ore' ? '#ff9f43' : '#6bd4ff') : '#8892a6');
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
    this.waveBtnText.setText(building ? 'SEND WAVE [SPC]' : 'DEFEND!');
    this.refreshStats();
  }

  /** Slide-in achievement cards, one at a time, top-right above the upgrade panel. */
  private pumpToasts(): void {
    if (this.toastActive) return;
    const def = this.toastQueue.shift();
    if (!def) return;
    this.toastActive = true;
    const c = this.add.container(GAME_W + 270, 8).setDepth(60);
    const bg = this.add.rectangle(0, 0, 262, 34, 0x141625, 0.95).setOrigin(0).setStrokeStyle(2, 0xffe066);
    const name = this.add.text(10, 4, `★ ${def.name}`, { ...FONT, fontSize: '12px', fontStyle: 'bold', color: '#ffe066' });
    const desc = this.add.text(10, 20, def.unlock ? `${def.desc} — ${def.unlock.label}` : def.desc, { ...FONT, fontSize: '9px', color: '#cdd6e4' });
    c.add([bg, name, desc]);
    sfx.coin();
    this.tweens.add({ targets: c, x: GAME_W - 270, duration: 250, ease: 'Back.out' });
    this.tweens.add({
      targets: c,
      x: GAME_W + 270,
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

  private refreshSelection(t: BuildingType | null): void {
    for (const [type, frame] of this.paletteFrames) {
      frame.setStrokeStyle(2, type === t ? 0xffe066 : 0x2b3040);
    }
  }

  private showGameOver(newBest = false): void {
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
    this.overlay = [dim, title, sub, best, btn, btnText, menuBtn, menuBtnText];
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
