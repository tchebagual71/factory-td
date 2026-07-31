/**
 * Every keyboard shortcut in the game, as data.
 *
 * The build palette already derived its hotkeys from `BUILD_INFO` so a key
 * could never drift from the badge drawn on its slot — but the *global*
 * shortcuts were hand-written `kb.on('keydown-X', …)` calls spread across two
 * scenes, and nothing connected the two lists. That is exactly how the view
 * toggle came to be bound to `V` while `V` was already the cryo tower: Phaser
 * happily registers both listeners, so one press armed a $160 tower *and*
 * flipped the renderer, and the next board click planted a tower the player
 * never asked for.
 *
 * Collisions are invisible in review and obvious in a test, so the fix is to
 * make the whole keyboard one list and pin it (`keymap.test.ts`). The help
 * modal reads the same list, which means a rebind can never leave the printed
 * reference lying either.
 */

import { BUILD_INFO } from '../data/buildings';

/** Phaser's key names for the number row — `keydown-1` is not a thing. */
const DIGIT_KEYS = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'];

/** The Phaser key name a displayed hotkey binds to: '1' → 'ONE', 'z' → 'Z'. */
export function phaserKeyName(hotkey: string): string {
  return /^[0-9]$/.test(hotkey) ? DIGIT_KEYS[Number(hotkey)] : hotkey.toUpperCase();
}

export type GameAction =
  | 'sendWave'
  | 'speed'
  | 'pause'
  | 'overlay'
  | 'view'
  | 'rotate'
  | 'cancel'
  | 'upgradeA'
  | 'upgradeB'
  | 'help'
  | 'mute'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset';

export interface KeyBinding {
  action: GameAction;
  /** what the player sees, e.g. 'SPC' — never assume it equals the Phaser name */
  label: string;
  /** the Phaser key name, i.e. the listener is `keydown-${key}` */
  key: string;
  /** which scene owns the listener; both scenes bind their own subset */
  owner: 'game' | 'ui';
}

/**
 * ESC is deliberately shared: GameScene clears the build selection and UIScene
 * closes the help panel. Both are "get this off my screen", so both firing is
 * the correct behaviour rather than a collision — it is listed once, under the
 * scene whose meaning the help text describes.
 */
export const KEYS: KeyBinding[] = [
  { action: 'sendWave', label: 'SPC', key: 'SPACE', owner: 'game' },
  { action: 'speed', label: 'F', key: 'F', owner: 'game' },
  { action: 'pause', label: 'P', key: 'P', owner: 'game' },
  { action: 'overlay', label: 'L', key: 'L', owner: 'game' },
  // Not V: that is the cryo tower, and ZXCV is the four guns in one run under
  // the left hand. A renderer toggle does not get to break that.
  { action: 'view', label: 'G', key: 'G', owner: 'game' },
  { action: 'rotate', label: 'R', key: 'R', owner: 'game' },
  { action: 'cancel', label: 'ESC', key: 'ESC', owner: 'game' },
  { action: 'upgradeA', label: 'U', key: 'U', owner: 'game' },
  { action: 'upgradeB', label: 'I', key: 'I', owner: 'game' },
  { action: 'help', label: 'H', key: 'H', owner: 'ui' },
  { action: 'mute', label: 'M', key: 'M', owner: 'ui' },
  // Board zoom. `0` is free because the palette only claims 1–9, and "0 resets
  // the view" is the convention every map and design tool already uses.
  { action: 'zoomIn', label: '+', key: 'PLUS', owner: 'game' },
  { action: 'zoomOut', label: '-', key: 'MINUS', owner: 'game' },
  { action: 'zoomReset', label: '0', key: 'ZERO', owner: 'game' },
];

const BY_ACTION = new Map(KEYS.map((k) => [k.action, k]));

/** The binding for an action. Throws rather than returning undefined: a typo'd action is a bug, not a missing feature. */
export function binding(action: GameAction): KeyBinding {
  const b = BY_ACTION.get(action);
  if (!b) throw new Error(`no key bound to ${action}`);
  return b;
}

/** Display label for an action, e.g. `key('sendWave')` → 'SPC'. */
export function key(action: GameAction): string {
  return binding(action).label;
}

/** Every Phaser key name the game listens for, build palette included. */
export function allBoundKeys(): string[] {
  return [...KEYS.map((k) => k.key), ...BUILD_INFO.map((b) => phaserKeyName(b.hotkey))];
}
