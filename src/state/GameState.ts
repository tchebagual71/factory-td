import Phaser from 'phaser';
import { START_LIVES, START_MONEY } from '../config';

export type Phase = 'build' | 'wave';

/**
 * Shared game state singleton. GameScene mutates it, UIScene renders it.
 * Scenes communicate exclusively through `events` — no direct references.
 *
 * Events: 'money', 'lives', 'wave', 'phase', 'gameover',
 *         'ui:select' (UI→Game building choice), 'ui:startwave' (UI→Game),
 *         'selected' (Game→UI current build selection)
 */
class GameStateClass {
  events = new Phaser.Events.EventEmitter();

  money = START_MONEY;
  lives = START_LIVES;
  wave = 1;
  phase: Phase = 'build';
  gameOver = false;
  speed: 1 | 2 | 3 = 1;
  auto = false;

  cycleSpeed(): void {
    this.speed = this.speed === 3 ? 1 : ((this.speed + 1) as 1 | 2 | 3);
    this.events.emit('speed', this.speed);
  }

  toggleAuto(): void {
    this.auto = !this.auto;
    this.events.emit('auto', this.auto);
  }

  addMoney(n: number): void {
    this.money += n;
    this.events.emit('money', this.money);
  }

  spend(n: number): boolean {
    if (this.money < n) return false;
    this.money -= n;
    this.events.emit('money', this.money);
    return true;
  }

  loseLives(n: number): void {
    this.lives = Math.max(0, this.lives - n);
    this.events.emit('lives', this.lives);
    if (this.lives === 0 && !this.gameOver) {
      this.gameOver = true;
      this.events.emit('gameover');
    }
  }

  setPhase(p: Phase): void {
    this.phase = p;
    this.events.emit('phase', p);
  }

  nextWave(): void {
    this.wave += 1;
    this.events.emit('wave', this.wave);
  }

  reset(): void {
    this.money = START_MONEY;
    this.lives = START_LIVES;
    this.wave = 1;
    this.phase = 'build';
    this.gameOver = false;
    this.speed = 1;
    this.auto = false;
    this.events.emit('money', this.money);
    this.events.emit('lives', this.lives);
    this.events.emit('wave', this.wave);
    this.events.emit('phase', this.phase);
    this.events.emit('speed', this.speed);
    this.events.emit('auto', this.auto);
  }
}

export const GameState = new GameStateClass();
