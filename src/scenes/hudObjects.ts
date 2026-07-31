import Phaser from 'phaser';

/**
 * Is this GameScene object HUD rather than world?
 *
 * Two features depend on this one answer and must never disagree about it:
 *
 * - the **isometric view** masks the flat world off Phaser's camera and leaves
 *   the HUD drawing on the transparent canvas above the 3D scene;
 * - **board zoom** puts the world on a camera that zooms and pans, and the HUD
 *   on one that does not — otherwise zooming in would blow up the upgrade
 *   panel and shove the floating bounties off screen.
 *
 * The rule is the same in both cases, so it lives in one place. Text and
 * Containers are UI; everything else is the board. Anything anchored to a
 * *place* on the board but drawn as Text (a floating bounty, a logistics
 * readout) is projected on the way in — see `GameScene.project`.
 */
export function isHudObject(obj: Phaser.GameObjects.GameObject): boolean {
  return obj instanceof Phaser.GameObjects.Text || obj instanceof Phaser.GameObjects.Container;
}
