import Phaser from 'phaser';
import { TEXT_RES } from '../config';

/**
 * Render every Text object in a scene at the device's real pixel density.
 *
 * Phaser draws text once into its own canvas at the font's size in *canvas*
 * pixels, and that canvas is then stretched to the screen along with everything
 * else. Wherever the game canvas is displayed larger than its buffer — a
 * 1280-wide canvas in a 1920-wide window, or a phone where the canvas is
 * deliberately small so it can fill the screen — the glyphs are magnified past
 * the resolution they were drawn at, and go soft.
 *
 * Applied by walking the display list rather than by editing every text style,
 * because there are well over a hundred of them across three scenes and a rule
 * that has to be remembered at each call site is a rule that will be forgotten
 * at the next one. New text picks it up automatically.
 */
export function sharpenText(scene: Phaser.Scene): void {
  if (TEXT_RES <= 1) return; // canvas is already drawn at or below 1:1
  const apply = (obj: Phaser.GameObjects.GameObject): void => {
    if (obj instanceof Phaser.GameObjects.Text) obj.setResolution(TEXT_RES);
  };
  for (const obj of scene.children.list) apply(obj);
  scene.events.on(Phaser.Scenes.Events.ADDED_TO_SCENE, apply);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.events.off(Phaser.Scenes.Events.ADDED_TO_SCENE, apply);
  });
}
