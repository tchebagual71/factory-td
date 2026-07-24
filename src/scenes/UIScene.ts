import Phaser from 'phaser';
import { GAME_H, GAME_W, PLAYFIELD_H } from '../config';
import { AchievementDef } from '../data/achievements';
import { BUILD_INFO } from '../data/buildings';
import { waveDef, WAVE_KIND_LABEL } from '../data/waves';
import { GameState } from '../state/GameState';
import { progress } from '../state/progress';
import { BuildingType } from '../types';
import { sfx } from '../utils/sfx';

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
  private toastQueue: AchievementDef[] = [];
  private toastActive = false;

  constructor() {
    super('ui');
  }

  create(): void {
    // ----- top-left stat chips -----
    this.add.rectangle(8, 8, 320, 30, 0x000000, 0.55).setOrigin(0).setDepth(0);
    this.moneyText = this.add.text(18, 14, '', { ...FONT, fontSize: '16px', fontStyle: 'bold', color: '#ffe066' });
    this.livesText = this.add.text(130, 14, '', { ...FONT, fontSize: '16px', fontStyle: 'bold', color: '#ff6b6b' });
    this.waveText = this.add.text(230, 14, '', { ...FONT, fontSize: '16px', fontStyle: 'bold', color: '#cdd6e4' });

    // ----- bottom bar -----
    this.add.rectangle(0, PLAYFIELD_H, GAME_W, GAME_H - PLAYFIELD_H, 0x141625).setOrigin(0);
    this.add.rectangle(0, PLAYFIELD_H, GAME_W, 2, 0x2b3040).setOrigin(0);

    let bx = 10;
    const BW = 100;
    for (const info of BUILD_INFO) {
      const container = this.add.container(bx, PLAYFIELD_H + 8);
      const frame = this.add
        .rectangle(0, 0, BW, 64, 0x1e2233)
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
        this.descText.setText('R rotate · drag paints belts · right-click sells 50% · click a tower to upgrade');
      });
      container.add([
        frame,
        this.add.image(BW / 2, 20, info.type).setScale(0.95),
        this.add.text(BW / 2, 40, info.name, { ...FONT, fontSize: '10px', fontStyle: 'bold', color: '#e8edf5' }).setOrigin(0.5, 0),
        this.add.text(BW / 2, 52, `$${info.cost}`, { ...FONT, fontSize: '11px', color: '#ffe066' }).setOrigin(0.5, 0),
        this.add.text(4, 3, info.hotkey, { ...FONT, fontSize: '9px', color: '#8892a6' }),
      ]);
      this.paletteFrames.set(info.type, frame);
      this.paletteButtons.set(info.type, container);
      bx += BW + 6;
    }
    this.descText = this.add.text(12, PLAYFIELD_H - 22, 'R rotate · drag paints belts · right-click sells 50% · click a tower to upgrade', {
      ...FONT,
      fontSize: '11px',
      color: '#cdd6e4',
      stroke: '#000000',
      strokeThickness: 3,
    });

    // ----- wave control (bottom right) -----
    this.previewText = this.add
      .text(GAME_W - 105, PLAYFIELD_H + 18, '', { ...FONT, fontSize: '12px', color: '#cdd6e4' })
      .setOrigin(0.5);
    this.waveBtn = this.add
      .rectangle(GAME_W - 190, PLAYFIELD_H + 32, 170, 40, 0x2e7d4f)
      .setOrigin(0)
      .setStrokeStyle(2, 0x5ef078)
      .setInteractive({ useHandCursor: true });
    this.waveBtnText = this.add
      .text(GAME_W - 105, PLAYFIELD_H + 52, 'SEND WAVE [SPC]', { ...FONT, fontSize: '14px', fontStyle: 'bold', color: '#ffffff' })
      .setOrigin(0.5);
    this.waveBtn.on('pointerdown', () => GameState.events.emit('ui:startwave'));

    // speed + auto-send controls
    const speedBtn = this.add
      .rectangle(GAME_W - 258, PLAYFIELD_H + 32, 56, 40, 0x1e2233)
      .setOrigin(0)
      .setStrokeStyle(2, 0x2b3040)
      .setInteractive({ useHandCursor: true });
    this.speedBtnText = this.add
      .text(GAME_W - 230, PLAYFIELD_H + 52, '×1', { ...FONT, fontSize: '15px', fontStyle: 'bold', color: '#cdd6e4' })
      .setOrigin(0.5);
    this.add.text(GAME_W - 230, PLAYFIELD_H + 18, '[F]', { ...FONT, fontSize: '10px', color: '#8892a6' }).setOrigin(0.5);
    speedBtn.on('pointerdown', () => GameState.cycleSpeed());

    this.autoBtn = this.add
      .rectangle(GAME_W - 336, PLAYFIELD_H + 32, 68, 40, 0x1e2233)
      .setOrigin(0)
      .setStrokeStyle(2, 0x2b3040)
      .setInteractive({ useHandCursor: true });
    this.autoBtnText = this.add
      .text(GAME_W - 302, PLAYFIELD_H + 52, 'AUTO', { ...FONT, fontSize: '13px', fontStyle: 'bold', color: '#8892a6' })
      .setOrigin(0.5);
    this.autoBtn.on('pointerdown', () => GameState.toggleAuto());

    // ----- state listeners -----
    const ev = GameState.events;
    ev.on('money', () => this.refreshStats(true));
    ev.on('lives', () => this.refreshStats());
    ev.on('wave', () => this.refreshStats());
    ev.on('phase', () => this.refreshWaveBtn());
    ev.on('selected', (t: BuildingType | null) => this.refreshSelection(t));
    ev.on('gameover', () => {
      progress.recordMax('bestWave', GameState.wave);
      this.showGameOver();
    });
    ev.on('achievement', (def: AchievementDef) => {
      this.toastQueue.push(def);
      this.pumpToasts();
    });
    ev.on('speed', (s: number) => this.speedBtnText.setText(`×${s}`).setColor(s > 1 ? '#ffe066' : '#cdd6e4'));
    ev.on('auto', (on: boolean) => {
      this.autoBtnText.setColor(on ? '#5ef078' : '#8892a6');
      this.autoBtn.setStrokeStyle(2, on ? 0x5ef078 : 0x2b3040);
    });

    this.refreshStats();
    this.refreshWaveBtn();
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
    this.previewText.setText(`Next: ${d.count}× ${WAVE_KIND_LABEL[d.kind]} · ${d.hp} HP`);
    for (const info of BUILD_INFO) {
      this.paletteButtons.get(info.type)?.setAlpha(GameState.money >= info.cost ? 1 : 0.45);
    }
  }

  private refreshWaveBtn(): void {
    const building = GameState.phase === 'build';
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

  private showGameOver(): void {
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
      .text(GAME_W / 2, 348, `Personal best: wave ${Math.max(progress.stats.bestWave, GameState.wave)}`, { ...FONT, fontSize: '14px', color: '#ffe066' })
      .setOrigin(0.5)
      .setDepth(51);
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
      this.scene.stop('game');
      this.scene.launch('menu');
      this.scene.sleep(); // sleep (not stop) — keeps this scene's GameState listeners singular
    });
  }
}
