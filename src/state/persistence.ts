import { SaveV1, validateSave } from './serialize';

/**
 * localStorage layer for the single run-save slot, plus the pendingLoad
 * handshake: MenuScene stages a save here, GameScene consumes it synchronously
 * in create(). localStorage stays the primary store even when cloud sync
 * exists — a signed-out or offline player loses nothing.
 */

const KEY_RUN = 'ftd:run';

export function saveLocal(save: SaveV1): void {
  try {
    localStorage.setItem(KEY_RUN, JSON.stringify(save));
  } catch {
    // storage unavailable — run simply won't survive a reload
  }
}

export function loadLocal(): SaveV1 | null {
  try {
    const raw = localStorage.getItem(KEY_RUN);
    return raw ? validateSave(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function clearLocal(): void {
  try {
    localStorage.removeItem(KEY_RUN);
  } catch {
    // ignore
  }
}

let pending: SaveV1 | null = null;

export function setPendingLoad(save: SaveV1): void {
  pending = save;
}

export function consumePendingLoad(): SaveV1 | null {
  const p = pending;
  pending = null;
  return p;
}

/** Map chosen on the title screen for the *next* fresh run (same handshake as pendingLoad). */
const KEY_MAP = 'ftd:map';
let pendingMap: string | undefined;

export function setPendingMap(id: string): void {
  pendingMap = id;
  try {
    localStorage.setItem(KEY_MAP, id); // remember the last pick across sessions
  } catch {
    // storage unavailable — the choice just won't persist
  }
}

export function lastPickedMap(): string | undefined {
  try {
    return localStorage.getItem(KEY_MAP) ?? undefined;
  } catch {
    return undefined;
  }
}

export function consumePendingMap(): string | undefined {
  const m = pendingMap ?? lastPickedMap();
  pendingMap = undefined;
  return m;
}
