/**
 * Physical feedback: screenshake, screen flash, and phone vibration.
 *
 * All three are the same design decision wearing different clothes — how hard
 * the game hits you for something that happened — so they share one setting
 * rather than three. "Reduced" is not a lesser mode: a boss wave at ×3 speed
 * shakes and flashes several times a second, which is genuinely unpleasant for
 * some players and disqualifying for others, and on a weak phone the shake is
 * also frame budget spent on nothing the simulation needs.
 *
 * Deliberately its own module rather than part of `sfx`: audio is muted for
 * social reasons ("I am on a train"), motion is reduced for physical ones, and
 * conflating them means one cannot be fixed without breaking the other.
 */

const KEY = 'ftd:reducedfx';

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false; // private mode, blocked storage — the default is full effects
  }
}

let reduced = typeof localStorage === 'undefined' ? false : read();

export function reducedFx(): boolean {
  return reduced;
}

export function setReducedFx(on: boolean): void {
  reduced = on;
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // Preference is still live for this session; only persistence is lost.
  }
}

export function toggleReducedFx(): boolean {
  setReducedFx(!reduced);
  return reduced;
}

/**
 * A short vibration, where the device has one.
 *
 * Silently absent on desktop and on iOS Safari, which has never implemented
 * `navigator.vibrate` — so this can never be the *only* feedback for anything.
 * Every caller here also plays a sound and draws something.
 */
export function haptic(pattern: number | readonly number[]): void {
  if (reduced) return;
  try {
    // Copied because the DOM signature demands a mutable array, and the patterns
    // below are frozen so a caller cannot reshape them for everyone else.
    navigator.vibrate?.(typeof pattern === 'number' ? pattern : [...pattern]);
  } catch {
    // Some browsers throw on a blocked or malformed pattern rather than no-op.
  }
}

/** Vibration patterns, named for what they mean rather than how long they are. */
export const HAPTIC = {
  place: 12,
  sell: [8, 30, 8],
  leak: [40, 60, 40],
  boss: [30, 40, 30, 40, 60],
  reject: 25,
} as const;
