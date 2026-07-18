import { SIM_DT } from './core/config';
import { Game } from './core/game';
import { createMap } from './core/map';
import { Renderer } from './render/renderer';
import { Hud } from './ui/hud';
import { setupInput, type UiState } from './ui/input';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Game(createMap());
const ui: UiState = { tool: null, dir: 1, mx: -1, my: -1 };
const renderer = new Renderer(canvas, game, ui);
const hud = new Hud(game, ui);

setupInput(canvas, game, ui);
game.say('Build a factory, then start the wave when ready!');

let last = performance.now();
let accumulator = 0;

function frame(now: number): void {
  // Clamp so a background tab doesn't fast-forward the sim on return.
  accumulator += Math.min(0.25, (now - last) / 1000) * hud.speed;
  last = now;
  while (accumulator >= SIM_DT) {
    game.update(SIM_DT);
    accumulator -= SIM_DT;
  }
  renderer.draw();
  hud.refresh();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
