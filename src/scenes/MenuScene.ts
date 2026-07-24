import Phaser from 'phaser';
import { GAME_H, GAME_W } from '../config';
import { ACHIEVEMENTS } from '../data/achievements';
import { clearLocal, loadLocal, setPendingLoad } from '../state/persistence';
import { progress } from '../state/progress';
import { sfx } from '../utils/sfx';

const FONT = { fontFamily: 'monospace' };

/**
 * Title screen: continue/new-run, achievements. Owns launching game+ui;
 * UIScene sleeps (never stops) while the menu is up so its GameState listeners
 * are registered exactly once. Batch 3 adds sign-in and leaderboard here.
 */
export class MenuScene extends Phaser.Scene {
  private confirmingNewRun = false;

  constructor() {
    super('menu');
  }

  create(): void {
    this.confirmingNewRun = false;
    this.add.rectangle(0, 0, GAME_W, GAME_H, 0x0e0f1a).setOrigin(0);
    // faint factory motif
    for (let i = 0; i < 14; i++) {
      this.add
        .image(60 + i * 90, 620 + (i % 2) * 24, i % 3 === 0 ? 'tower' : 'belt')
        .setAlpha(0.12)
        .setScale(1.4);
    }
    this.add
      .text(GAME_W / 2, 150, 'FACTORY TD', { ...FONT, fontSize: '64px', fontStyle: 'bold', color: '#ffe066', stroke: '#000', strokeThickness: 10 })
      .setOrigin(0.5);
    this.add
      .text(GAME_W / 2, 205, 'Build the factory. Feed the guns. Hold the line.', { ...FONT, fontSize: '15px', color: '#cdd6e4' })
      .setOrigin(0.5);

    const save = loadLocal();
    let y = 290;
    if (save) {
      this.button(y, `CONTINUE  (Wave ${save.wave} · $${save.money})`, 0x2e7d4f, 0x5ef078, () => {
        setPendingLoad(save);
        this.startGame();
      });
      y += 66;
    }
    const newRunBtn = this.button(y, 'NEW RUN', save ? 0x1e2233 : 0x2e7d4f, save ? 0x2b3040 : 0x5ef078, () => {
      if (save && !this.confirmingNewRun) {
        this.confirmingNewRun = true;
        newRunBtn.label.setText('OVERWRITE SAVE? CLICK AGAIN');
        newRunBtn.frame.setStrokeStyle(2, 0xff5555);
        this.time.delayedCall(3000, () => {
          if (this.confirmingNewRun && newRunBtn.label.active) {
            this.confirmingNewRun = false;
            newRunBtn.label.setText('NEW RUN');
            newRunBtn.frame.setStrokeStyle(2, 0x2b3040);
          }
        });
        return;
      }
      clearLocal();
      this.startGame();
    });
    y += 66;
    const unlockedCount = progress.unlocked.size;
    this.button(y, `ACHIEVEMENTS  (${unlockedCount}/${ACHIEVEMENTS.length})`, 0x1e2233, 0x2b3040, () => this.showAchievements());

    if (progress.stats.bestWave > 0) {
      this.add
        .text(GAME_W / 2, y + 70, `Personal best: wave ${progress.stats.bestWave}`, { ...FONT, fontSize: '14px', color: '#ffe066' })
        .setOrigin(0.5);
    }
  }

  private button(
    y: number,
    text: string,
    fill: number,
    stroke: number,
    onClick: () => void,
  ): { frame: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text } {
    const frame = this.add
      .rectangle(GAME_W / 2, y, 360, 52, fill)
      .setStrokeStyle(2, stroke)
      .setInteractive({ useHandCursor: true });
    const label = this.add
      .text(GAME_W / 2, y, text, { ...FONT, fontSize: '17px', fontStyle: 'bold', color: '#ffffff' })
      .setOrigin(0.5);
    frame.on('pointerover', () => frame.setFillStyle(fill + 0x0a0a14));
    frame.on('pointerout', () => frame.setFillStyle(fill));
    frame.on('pointerdown', () => {
      sfx.place();
      onClick();
    });
    return { frame, label };
  }

  private startGame(): void {
    if (this.scene.isSleeping('ui')) this.scene.wake('ui');
    else if (!this.scene.isActive('ui')) this.scene.launch('ui');
    this.scene.start('game');
  }

  private showAchievements(): void {
    const parts: Phaser.GameObjects.GameObject[] = [];
    const dim = this.add.rectangle(0, 0, GAME_W, GAME_H, 0x000000, 0.75).setOrigin(0).setDepth(10).setInteractive();
    const panel = this.add.rectangle(GAME_W / 2, GAME_H / 2, 980, 560, 0x141625, 0.98).setStrokeStyle(2, 0x2b3040).setDepth(11);
    const title = this.add
      .text(GAME_W / 2, 110, 'ACHIEVEMENTS', { ...FONT, fontSize: '24px', fontStyle: 'bold', color: '#ffe066' })
      .setOrigin(0.5)
      .setDepth(12);
    parts.push(dim, panel, title);

    const colW = 470;
    const x0 = GAME_W / 2 - colW + 10;
    ACHIEVEMENTS.forEach((a, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = x0 + col * colW;
      const y = 150 + row * 56;
      const got = progress.unlocked.has(a.id);
      const cur = Math.min(progress.stats[a.stat], a.goal);
      const star = this.add
        .text(x, y, got ? '★' : '☆', { ...FONT, fontSize: '20px', color: got ? '#ffe066' : '#3a3f52' })
        .setDepth(12);
      const name = this.add
        .text(x + 30, y - 2, a.name, { ...FONT, fontSize: '13px', fontStyle: 'bold', color: got ? '#e8edf5' : '#8892a6' })
        .setDepth(12);
      const detail = a.unlock ? `${a.desc} — ${a.unlock.label}` : a.desc;
      const desc = this.add
        .text(x + 30, y + 15, `${detail}  (${cur}/${a.goal})`, { ...FONT, fontSize: '10px', color: '#8892a6' })
        .setDepth(12);
      parts.push(star, name, desc);
    });

    const close = this.add
      .rectangle(GAME_W / 2, GAME_H - 90, 180, 44, 0x2e7d4f)
      .setStrokeStyle(2, 0x5ef078)
      .setDepth(12)
      .setInteractive({ useHandCursor: true });
    const closeText = this.add
      .text(GAME_W / 2, GAME_H - 90, 'CLOSE', { ...FONT, fontSize: '15px', fontStyle: 'bold', color: '#ffffff' })
      .setOrigin(0.5)
      .setDepth(13);
    parts.push(close, closeText);
    close.on('pointerdown', () => parts.forEach((p) => p.destroy()));
  }
}
