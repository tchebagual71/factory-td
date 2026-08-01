import Phaser from 'phaser';
import { GAME_H, GAME_W } from '../config';

/**
 * HTML text inputs anchored to the game canvas with explicit math.
 *
 * Phaser's DOM-element layer mispositions elements relative to the canvas
 * when Scale.FIT letterboxes or the browser zooms — inputs drifted onto
 * neighboring buttons. This helper bypasses it entirely: the input lives on
 * document.body, and its position/size are recomputed from
 * canvas.getBoundingClientRect() in GAME-coordinate space, so it stays glued
 * to its spot at every window size, zoom level, and device.
 */

export interface AnchoredInput {
  node: HTMLInputElement;
  destroy(): void;
}

const BASE_CSS =
  'position: absolute; z-index: 20; box-sizing: border-box; font-family: monospace; ' +
  'background: #1e2233; color: #e8edf5; border: 2px solid #2b3040; border-radius: 0; outline: none; padding: 0 10px;';

/** cx/cy are the input's CENTER in game coordinates (like Phaser origin 0.5); w/h its game-pixel size. */
export function anchorInput(
  scene: Phaser.Scene,
  cx: number,
  cy: number,
  w: number,
  h: number,
  placeholder: string,
): AnchoredInput {
  const canvas = scene.game.canvas;
  const node = document.createElement('input');
  node.type = 'text';
  node.placeholder = placeholder;
  node.style.cssText = BASE_CSS;
  node.addEventListener('focus', () => (node.style.borderColor = '#ffe066'));
  node.addEventListener('blur', () => (node.style.borderColor = '#2b3040'));
  document.body.appendChild(node);

  const reposition = (): void => {
    const r = canvas.getBoundingClientRect();
    // Two hops, because the scene may not be drawn 1:1 onto the canvas: the
    // title screen renders through a scaled camera so its layout survives a
    // canvas shorter than 720px. Scene coords → canvas coords via the camera,
    // then canvas coords → page pixels via the element's real size.
    const cam = scene.cameras.main;
    const z = cam.zoom;
    const toCanvasX = (v: number): number => (v - cam.midPoint.x) * z + cam.width / 2;
    const toCanvasY = (v: number): number => (v - cam.midPoint.y) * z + cam.height / 2;
    const sx = r.width / GAME_W;
    const sy = r.height / GAME_H;
    node.style.left = `${r.left + window.scrollX + toCanvasX(cx - w / 2) * sx}px`;
    node.style.top = `${r.top + window.scrollY + toCanvasY(cy - h / 2) * sy}px`;
    node.style.width = `${w * z * sx}px`;
    node.style.height = `${h * z * sy}px`;
    node.style.fontSize = `${Math.max(10, Math.round(13 * z * sy))}px`;
  };
  reposition();
  requestAnimationFrame(reposition); // once more after layout settles
  window.addEventListener('resize', reposition);
  window.addEventListener('scroll', reposition, { passive: true });
  scene.scale.on('resize', reposition);

  return {
    node,
    destroy: () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition);
      scene.scale.off('resize', reposition);
      node.remove();
    },
  };
}
