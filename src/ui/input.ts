import type { Game } from '../core/game';
import type { BuildingKind, Dir } from '../core/types';

export interface UiState {
  tool: BuildingKind | 'sell' | null;
  dir: Dir;
  /** Hovered tile coords (may be out of bounds). */
  mx: number;
  my: number;
}

/**
 * Mouse + keyboard bindings. Dragging with the belt tool lays a run and
 * auto-orients each belt (including the previous one) along the drag.
 */
export function setupInput(canvas: HTMLCanvasElement, game: Game, ui: UiState): void {
  let dragging = false;
  let lastPlaced: { x: number; y: number } | null = null;

  const tileFromEvent = (ev: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.floor(((ev.clientX - rect.left) / rect.width) * game.map.width),
      y: Math.floor(((ev.clientY - rect.top) / rect.height) * game.map.height),
    };
  };

  const applyTool = (x: number, y: number) => {
    if (ui.tool === null) return;
    if (ui.tool === 'sell') {
      game.sellBuilding(x, y);
      return;
    }
    if (ui.tool === 'belt' && lastPlaced && (lastPlaced.x !== x || lastPlaced.y !== y)) {
      const dx = x - lastPlaced.x;
      const dy = y - lastPlaced.y;
      if (Math.abs(dx) + Math.abs(dy) === 1) {
        const dir: Dir = dx === 1 ? 1 : dx === -1 ? 3 : dy === 1 ? 2 : 0;
        ui.dir = dir;
        const prev = game.buildingAt(lastPlaced.x, lastPlaced.y);
        if (prev?.kind === 'belt') prev.dir = dir;
      }
    }
    if (game.placeBuilding(ui.tool, x, y, ui.dir)) {
      lastPlaced = { x, y };
    }
  };

  canvas.addEventListener('mousedown', (ev) => {
    if (ev.button !== 0) return;
    dragging = true;
    lastPlaced = null;
    const { x, y } = tileFromEvent(ev);
    applyTool(x, y);
  });

  canvas.addEventListener('mousemove', (ev) => {
    const { x, y } = tileFromEvent(ev);
    ui.mx = x;
    ui.my = y;
    if (dragging && (ui.tool === 'belt' || ui.tool === 'sell')) applyTool(x, y);
  });

  window.addEventListener('mouseup', () => {
    dragging = false;
    lastPlaced = null;
  });

  canvas.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    ui.tool = null;
  });

  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'r' || ev.key === 'R') {
      ui.dir = ((ui.dir + 1) % 4) as Dir;
    } else if (ev.key === 'Escape') {
      ui.tool = null;
    } else if (ev.key === ' ') {
      ev.preventDefault();
      game.startWave();
    } else if (ev.key === 'x' || ev.key === 'X') {
      ui.tool = 'sell';
    }
  });
}
