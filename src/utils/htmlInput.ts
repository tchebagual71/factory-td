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
    const sx = r.width / GAME_W;
    const sy = r.height / GAME_H;
    node.style.left = `${r.left + window.scrollX + (cx - w / 2) * sx}px`;
    node.style.top = `${r.top + window.scrollY + (cy - h / 2) * sy}px`;
    node.style.width = `${w * sx}px`;
    node.style.height = `${h * sy}px`;
    node.style.fontSize = `${Math.max(10, Math.round(13 * sy))}px`;
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
