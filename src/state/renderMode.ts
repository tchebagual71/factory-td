/**
 * Which renderer draws the playfield. This is a *view* setting, not run state:
 * it lives outside the save, survives across runs, and switching it mid-run
 * changes nothing about the simulation — the isometric view mirrors the same
 * objects the flat one draws.
 */
export type RenderMode = '2d' | 'iso';

const KEY = 'ftd:view';

/** Isometric needs WebGL and a real DOM; a headless or ancient browser gets flat. */
export function isoSupported(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export function renderMode(): RenderMode {
  try {
    return localStorage.getItem(KEY) === 'iso' && isoSupported() ? 'iso' : '2d';
  } catch {
    return '2d';
  }
}

export function setRenderMode(mode: RenderMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // private browsing: the choice just doesn't persist
  }
}

export function toggleRenderMode(): RenderMode {
  const next: RenderMode = renderMode() === 'iso' ? '2d' : 'iso';
  setRenderMode(next);
  return next;
}
