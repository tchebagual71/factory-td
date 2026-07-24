import Phaser from 'phaser';
import { GAME_H, GAME_W } from './config';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { MenuScene } from './scenes/MenuScene';
import { UIScene } from './scenes/UIScene';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: GAME_W,
  height: GAME_H,
  parent: 'app',
  backgroundColor: '#0e0f1a',
  pixelArt: true, // crisp nearest-neighbor upscaling — embraces the chunky procedural art
  scene: [BootScene, MenuScene, GameScene, UIScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    // whole-pixel scaling keeps the procedural art from shimmering
    autoRound: true,
  },
  input: {
    // belts are drag-painted; a second finger must never start a rival stroke
    activePointers: 1,
    touch: { capture: true },
  },
  // the browser must not treat the canvas as a scrollable document
  disableContextMenu: true,
});

// Phaser only re-fits on window resize; iOS fires orientation changes slightly
// before the new metrics land, so nudge it once the browser has settled.
const refit = () => game.scale.refresh();
window.addEventListener('orientationchange', () => setTimeout(refit, 150));
window.addEventListener('resize', refit);
