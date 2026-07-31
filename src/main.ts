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
  // Transparent rather than opaque: the isometric renderer draws to a canvas
  // stacked *behind* this one, and Phaser has to let it through. The page
  // background is the same `#0e0f1a`, so the flat view is unchanged.
  transparent: true,
  pixelArt: true, // crisp nearest-neighbor upscaling — embraces the chunky procedural art
  scene: [BootScene, MenuScene, GameScene, UIScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    // whole-pixel scaling keeps the procedural art from shimmering
    autoRound: true,
  },
  input: {
    // Two, for pinch-zoom. Belts are still drag-painted and a second finger
    // must still never start a rival stroke — GameScene.updateGesture abandons
    // the in-flight stroke the instant a second pointer lands, and owns the
    // board for as long as the gesture lasts.
    activePointers: 2,
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
