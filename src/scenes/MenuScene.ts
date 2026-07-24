import Phaser from 'phaser';
import { GAME_H, GAME_W } from '../config';
import { ACHIEVEMENTS } from '../data/achievements';
import {
  accountLabel,
  currentUser,
  isAnonymous,
  linkEmail,
  linkGoogle,
  onAuth,
  setDisplayName,
  signInAnon,
  signInGoogle,
  signInMagicLink,
  signOut,
} from '../services/auth';
import { fetchLeaderboard, syncOnSignIn } from '../services/cloud';
import { clearLocal, loadLocal, setPendingLoad } from '../state/persistence';
import { progress } from '../state/progress';
import { sfx } from '../utils/sfx';

const FONT = { fontFamily: 'monospace' };
const INPUT_CSS =
  'width: 250px; padding: 8px; font-family: monospace; font-size: 13px; background: #1e2233; color: #e8edf5; border: 2px solid #2b3040; outline: none;';

/**
 * Title screen: continue/new-run, achievements, leaderboard, account.
 * Sign-in happens only here — OAuth navigates away, so a live run is never
 * interrupted. On auth changes the scene syncs (cloud merge) and re-renders.
 * UIScene sleeps (never stops) while the menu is up so its GameState
 * listeners stay singular.
 */
export class MenuScene extends Phaser.Scene {
  private confirmingNewRun = false;
  private shownUserId: string | null = null;
  private unsubAuth?: () => void;
  private modal: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super('menu');
  }

  create(): void {
    this.confirmingNewRun = false;
    this.modal = [];
    this.add.rectangle(0, 0, GAME_W, GAME_H, 0x0e0f1a).setOrigin(0);
    for (let i = 0; i < 14; i++) {
      this.add
        .image(60 + i * 90, 620 + (i % 2) * 24, i % 3 === 0 ? 'tower' : 'belt')
        .setAlpha(0.12)
        .setScale(1.4);
    }
    this.add
      .text(GAME_W / 2, 130, 'FACTORY TD', { ...FONT, fontSize: '64px', fontStyle: 'bold', color: '#ffe066', stroke: '#000', strokeThickness: 10 })
      .setOrigin(0.5);
    this.add
      .text(GAME_W / 2, 185, 'Build the factory. Feed the guns. Hold the line.', { ...FONT, fontSize: '15px', color: '#cdd6e4' })
      .setOrigin(0.5);

    // ----- account chip (top-right) -----
    const chip = this.add
      .text(GAME_W - 16, 16, '...', { ...FONT, fontSize: '13px', fontStyle: 'bold', color: '#cdd6e4' })
      .setOrigin(1, 0);
    const accountBtn = this.add
      .rectangle(GAME_W - 16, 42, 150, 30, 0x1e2233)
      .setOrigin(1, 0)
      .setStrokeStyle(2, 0x2b3040)
      .setInteractive({ useHandCursor: true });
    const accountBtnText = this.add
      .text(GAME_W - 91, 57, 'ACCOUNT', { ...FONT, fontSize: '12px', fontStyle: 'bold', color: '#cdd6e4' })
      .setOrigin(0.5);
    accountBtn.on('pointerdown', () => {
      sfx.place();
      void this.showAccount();
    });
    void currentUser().then((u) => {
      if (this.scene.isActive()) {
        chip.setText(accountLabel(u));
        chip.setColor(u ? '#5ef078' : '#8892a6');
        accountBtnText.setText(u ? 'ACCOUNT' : 'SIGN IN');
      }
    });

    // ----- main buttons -----
    const save = loadLocal();
    let y = 265;
    if (save) {
      this.button(y, `CONTINUE  (Wave ${save.wave} · $${save.money})`, 0x2e7d4f, 0x5ef078, () => {
        setPendingLoad(save);
        this.startGame();
      });
      y += 62;
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
    y += 62;
    this.button(y, `ACHIEVEMENTS  (${progress.unlocked.size}/${ACHIEVEMENTS.length})`, 0x1e2233, 0x2b3040, () => this.showAchievements());
    y += 62;
    this.button(y, 'LEADERBOARD', 0x1e2233, 0x2b3040, () => void this.showLeaderboard());

    if (progress.stats.bestWave > 0) {
      this.add
        .text(GAME_W / 2, y + 64, `Personal best: wave ${progress.stats.bestWave}`, { ...FONT, fontSize: '14px', color: '#ffe066' })
        .setOrigin(0.5);
    }

    // ----- auth subscription (re-render on real account changes) -----
    this.unsubAuth?.();
    this.unsubAuth = onAuth((event, session) => {
      const uid = session?.user?.id ?? null;
      if (event === 'SIGNED_OUT' && this.shownUserId !== null) {
        this.shownUserId = null;
        if (this.scene.isActive()) this.scene.restart();
      } else if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && uid && uid !== this.shownUserId) {
        this.shownUserId = uid;
        void syncOnSignIn().finally(() => {
          if (this.scene.isActive()) this.scene.restart();
        });
      }
    });
    this.events.once('shutdown', () => {
      this.unsubAuth?.();
      this.unsubAuth = undefined;
    });

    this.input.keyboard?.on('keydown-ESC', () => this.closeModal());
  }

  private button(
    y: number,
    text: string,
    fill: number,
    stroke: number,
    onClick: () => void,
  ): { frame: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text } {
    const frame = this.add
      .rectangle(GAME_W / 2, y, 380, 50, fill)
      .setStrokeStyle(2, stroke)
      .setInteractive({ useHandCursor: true });
    const label = this.add
      .text(GAME_W / 2, y, text, { ...FONT, fontSize: '16px', fontStyle: 'bold', color: '#ffffff' })
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

  // ---------- modal helpers ----------

  private openModal(height = 560, width = 980): void {
    this.closeModal();
    // dim swallows and closes on outside-clicks; the panel is interactive so
    // clicks inside it never reach the dim (input.topOnly is true by default)
    const dim = this.add.rectangle(0, 0, GAME_W, GAME_H, 0x000000, 0.75).setOrigin(0).setDepth(10).setInteractive();
    dim.on('pointerdown', () => this.closeModal());
    const panel = this.add
      .rectangle(GAME_W / 2, GAME_H / 2, width, height, 0x141625, 0.98)
      .setStrokeStyle(2, 0x2b3040)
      .setDepth(11)
      .setInteractive();
    this.modal.push(dim, panel);
  }

  private closeModal(): void {
    this.modal.forEach((p) => p.destroy());
    this.modal = [];
  }

  private modalTitle(text: string, height: number): void {
    this.modal.push(
      this.add
        .text(GAME_W / 2, GAME_H / 2 - height / 2 + 34, text, { ...FONT, fontSize: '24px', fontStyle: 'bold', color: '#ffe066' })
        .setOrigin(0.5)
        .setDepth(12),
    );
  }

  private modalClose(height: number): void {
    const y = GAME_H / 2 + height / 2 - 44;
    const close = this.add
      .rectangle(GAME_W / 2, y, 180, 44, 0x2e7d4f)
      .setStrokeStyle(2, 0x5ef078)
      .setDepth(12)
      .setInteractive({ useHandCursor: true });
    const closeText = this.add
      .text(GAME_W / 2, y, 'CLOSE', { ...FONT, fontSize: '15px', fontStyle: 'bold', color: '#ffffff' })
      .setOrigin(0.5)
      .setDepth(13);
    close.on('pointerdown', () => this.closeModal());
    this.modal.push(close, closeText);
  }

  private modalButton(x: number, y: number, w: number, text: string, onClick: () => void): Phaser.GameObjects.Text {
    const frame = this.add
      .rectangle(x, y, w, 44, 0x1e2233)
      .setStrokeStyle(2, 0x2b3040)
      .setDepth(12)
      .setInteractive({ useHandCursor: true });
    const label = this.add
      .text(x, y, text, { ...FONT, fontSize: '14px', fontStyle: 'bold', color: '#e8edf5' })
      .setOrigin(0.5)
      .setDepth(13);
    frame.on('pointerover', () => frame.setFillStyle(0x272c42));
    frame.on('pointerout', () => frame.setFillStyle(0x1e2233));
    frame.on('pointerdown', () => {
      sfx.place();
      onClick();
    });
    this.modal.push(frame, label);
    return label;
  }

  // ---------- achievements ----------

  private showAchievements(): void {
    const H = 560;
    this.openModal(H);
    this.modalTitle('ACHIEVEMENTS', H);

    const colW = 470;
    const x0 = GAME_W / 2 - colW + 10;
    ACHIEVEMENTS.forEach((a, i) => {
      const x = x0 + (i % 2) * colW;
      const y = 150 + Math.floor(i / 2) * 52;
      const got = progress.unlocked.has(a.id);
      const cur = Math.min(progress.stats[a.stat], a.goal);
      const detail = a.unlock ? `${a.desc} — ${a.unlock.label}` : a.desc;
      this.modal.push(
        this.add.text(x, y, got ? '★' : '☆', { ...FONT, fontSize: '20px', color: got ? '#ffe066' : '#3a3f52' }).setDepth(12),
        this.add.text(x + 30, y - 2, a.name, { ...FONT, fontSize: '13px', fontStyle: 'bold', color: got ? '#e8edf5' : '#8892a6' }).setDepth(12),
        this.add.text(x + 30, y + 15, `${detail}  (${cur}/${a.goal})`, { ...FONT, fontSize: '10px', color: '#8892a6' }).setDepth(12),
        this.add.rectangle(x + 30, y + 30, 400, 3, 0x1e2233).setOrigin(0, 0.5).setDepth(12),
        this.add
          .rectangle(x + 30, y + 30, Math.round(400 * (cur / a.goal)), 3, got ? 0xffe066 : 0x5ef078)
          .setOrigin(0, 0.5)
          .setDepth(12),
      );
    });
    this.modalClose(H);
  }

  // ---------- leaderboard ----------

  private async showLeaderboard(): Promise<void> {
    const H = 560;
    this.openModal(H);
    this.modalTitle('LEADERBOARD — BEST WAVE', H);
    const loading = this.add
      .text(GAME_W / 2, GAME_H / 2, 'loading…', { ...FONT, fontSize: '14px', color: '#8892a6' })
      .setOrigin(0.5)
      .setDepth(12);
    this.modal.push(loading);
    this.modalClose(H);

    const [rows, me] = await Promise.all([fetchLeaderboard(20), currentUser()]);
    if (!loading.active) return; // modal was closed while loading
    loading.destroy();
    if (rows.length === 0) {
      this.modal.push(
        this.add
          .text(GAME_W / 2, GAME_H / 2, 'No scores yet — sign in and clear a wave to claim the top spot!', { ...FONT, fontSize: '13px', color: '#cdd6e4' })
          .setOrigin(0.5)
          .setDepth(12),
      );
      return;
    }
    rows.forEach((r, i) => {
      const col = i < 10 ? 0 : 1;
      const y = 150 + (i % 10) * 36;
      const x = GAME_W / 2 - 460 + col * 480;
      const mine = me !== null && r.user_id === me.id;
      const color = mine ? '#5ef078' : i === 0 ? '#ffe066' : '#e8edf5';
      this.modal.push(
        this.add.text(x, y, `${String(i + 1).padStart(2, ' ')}.`, { ...FONT, fontSize: '14px', color: '#8892a6' }).setDepth(12),
        this.add.text(x + 44, y, r.display_name + (mine ? '  (you)' : ''), { ...FONT, fontSize: '14px', fontStyle: mine ? 'bold' : 'normal', color }).setDepth(12),
        this.add.text(x + 360, y, `wave ${r.best_wave}`, { ...FONT, fontSize: '14px', fontStyle: 'bold', color }).setDepth(12),
      );
    });
  }

  // ---------- account ----------

  private async showAccount(): Promise<void> {
    const user = await currentUser(); // resolve first so the layout matches the auth state
    const H = user ? 500 : 480;
    this.openModal(H, 560);
    this.modalTitle(user ? 'ACCOUNT' : 'SIGN IN', H);

    const cx = GAME_W / 2;
    const top = GAME_H / 2 - H / 2;
    const status = this.add
      .text(cx, top + H - 92, '', { ...FONT, fontSize: '12px', color: '#ffd75e', align: 'center', wordWrap: { width: 480 } })
      .setOrigin(0.5)
      .setDepth(12);
    this.modal.push(status);

    const note = (y: number, text: string, color = '#8892a6', size = '11px') => {
      this.modal.push(
        this.add.text(cx, y, text, { ...FONT, fontSize: size, color, align: 'center' }).setOrigin(0.5).setDepth(12),
      );
    };
    const inputRow = (y: number, placeholder: string, btnText: string, onSubmit: (value: string) => void) => {
      const input = this.add.dom(cx - 85, y, 'input', INPUT_CSS).setDepth(13);
      const node = input.node as HTMLInputElement;
      node.placeholder = placeholder;
      node.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') onSubmit(node.value.trim());
      });
      this.modal.push(input);
      this.modalButton(cx + 130, y, 150, btnText, () => onSubmit(node.value.trim()));
    };
    const withEmail = (value: string, send: () => void) => {
      if (value.includes('@')) send();
      else status.setText('Enter a valid email first');
    };

    if (!user) {
      let y = top + 92;
      note(y, 'Optional — guests keep local saves. An account adds\ncross-device saves, the leaderboard, and synced achievements.', '#cdd6e4', '12px');
      y += 52;
      this.modalButton(cx, y, 440, 'SIGN IN WITH GOOGLE', () => {
        status.setText('Redirecting to Google…');
        void signInGoogle().then((err) => err && status.setText(err));
      });
      y += 58;
      inputRow(y, 'you@example.com', 'MAGIC LINK', (value) =>
        withEmail(value, () => {
          status.setText('Sending…');
          void signInMagicLink(value).then((err) => status.setText(err ?? 'Check your email for the sign-in link!'));
        }),
      );
      y += 58;
      this.modalButton(cx, y, 440, 'CLOUD BACKUP WITHOUT EMAIL', () => {
        status.setText('Creating anonymous account…');
        void signInAnon().then((err) => err && status.setText(err));
      });
      y += 32;
      note(y, 'device-bound; upgrade to Google/email later to keep it forever', '#8892a6', '10px');
    } else {
      let y = top + 88;
      this.modal.push(
        this.add
          .text(cx, y, accountLabel(user), { ...FONT, fontSize: '15px', fontStyle: 'bold', color: '#5ef078' })
          .setOrigin(0.5)
          .setDepth(12),
      );
      y += 36;
      if (isAnonymous(user)) {
        note(y + 8, 'Anonymous account — link it to keep your progress\neven if you clear browser data or switch devices.', '#ffd75e');
        y += 48;
        this.modalButton(cx, y, 440, 'LINK GOOGLE ACCOUNT', () => {
          status.setText('Redirecting to Google…');
          void linkGoogle().then((err) => err && status.setText(err));
        });
        y += 58;
        inputRow(y, 'you@example.com', 'LINK EMAIL', (value) =>
          withEmail(value, () => {
            status.setText('Linking…');
            void linkEmail(value).then((err) =>
              status.setText(
                err
                  ? `${err} — if that email already has an account, sign out and sign in with it; local progress merges automatically.`
                  : 'Confirmation email sent — click the link to finish.',
              ),
            );
          }),
        );
        y += 58;
      } else {
        inputRow(y + 12, 'display name (leaderboard)', 'SET NAME', (value) => {
          void setDisplayName(value).then((err) => status.setText(err ?? 'Name updated!'));
        });
        y += 70;
      }
      this.modalButton(cx, y, 440, 'SIGN OUT', () => {
        status.setText('Signing out…');
        void signOut();
      });
    }
    this.modalClose(H);
  }
}
