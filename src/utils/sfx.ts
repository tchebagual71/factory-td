/**
 * Tiny synthesized SFX — no audio assets needed. Every player action and
 * game event gets an immediate sound; that feedback loop is core to the feel.
 */
let ctx: AudioContext | null = null;

let muted = ((): boolean => {
  try {
    return localStorage.getItem('ftd:mute') === '1';
  } catch {
    return false;
  }
})();

/** Master gain, 0..1. Per-sound volumes below are mixed relative to this. */
let volume = ((): number => {
  try {
    const raw = Number(localStorage.getItem('ftd:vol'));
    return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 0.7;
  } catch {
    return 0.7;
  }
})();

export function isMuted(): boolean {
  return muted;
}

export function getVolume(): number {
  return volume;
}

/** Set the master volume (clamped). Raising it above zero also lifts mute. */
export function setVolume(v: number): number {
  volume = Math.min(1, Math.max(0, v));
  try {
    localStorage.setItem('ftd:vol', String(volume));
  } catch {
    // storage unavailable — volume still applies for this session
  }
  if (volume > 0 && muted) toggleMute();
  return volume;
}

export function toggleMute(): boolean {
  muted = !muted;
  try {
    localStorage.setItem('ftd:mute', muted ? '1' : '0');
  } catch {
    // storage unavailable — mute still applies for this session
  }
  return muted;
}

function ac(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function blip(
  freq: number,
  dur: number,
  type: OscillatorType = 'square',
  vol = 0.08,
  slideTo = 0,
): void {
  if (muted || volume <= 0) return;
  try {
    const c = ac();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, c.currentTime);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), c.currentTime + dur);
    g.gain.setValueAtTime(vol * volume, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.connect(g).connect(c.destination);
    o.start();
    o.stop(c.currentTime + dur);
  } catch {
    /* audio blocked until first user gesture — fine */
  }
}

/**
 * Voice budget for the ambient battle sounds. A dozen gatlings at ×3 speed ask
 * for ~100 blips a second: that is a wall of noise, not feedback, and it piles
 * up oscillator nodes for the GC. Each ambient sound declares a minimum gap and
 * requests inside it are dropped, so the mix stays legible however big the
 * factory gets. Player-initiated sounds (place, sell, error, wave, leak) are
 * never throttled — those must answer every single input.
 */
const lastPlayed = new Map<string, number>();

function gated(key: string, gapMs: number): boolean {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const prev = lastPlayed.get(key);
  if (prev !== undefined && now - prev < gapMs) return false;
  lastPlayed.set(key, now);
  return true;
}

export const sfx = {
  shoot: () => gated('shoot', 45) && blip(760, 0.06, 'square', 0.025, 240),
  hit: () => gated('hit', 55) && blip(200, 0.05, 'sawtooth', 0.04),
  /**
   * Kill blip. `pitch` is the kill-streak multiplier (see `data/combo.ts`): a
   * streak audibly climbs, which is most of why it feels like a streak at all.
   * The gate stays, so the rise is legible instead of a wall of chirps.
   */
  coin: (pitch = 1) => {
    if (!gated('coin', 70)) return;
    blip(988 * pitch, 0.06, 'square', 0.05);
    setTimeout(() => blip(1319 * pitch, 0.09, 'square', 0.05), 55);
  },
  /** cryo pulse: a soft downward sine puff, distinct from the percussive weapons */
  chill: () => gated('chill', 130) && blip(880, 0.22, 'sine', 0.05, 330),
  place: () => blip(523, 0.08, 'triangle', 0.09),
  sell: () => blip(392, 0.1, 'triangle', 0.08, 260),
  error: () => blip(140, 0.14, 'sawtooth', 0.07),
  leak: () => blip(120, 0.3, 'sawtooth', 0.11, 55),
  waveStart: () => {
    blip(440, 0.1, 'square', 0.07);
    setTimeout(() => blip(587, 0.12, 'square', 0.07), 110);
  },
  waveClear: () => {
    blip(523, 0.09, 'square', 0.07);
    setTimeout(() => blip(659, 0.09, 'square', 0.07), 90);
    setTimeout(() => blip(784, 0.16, 'square', 0.07), 180);
  },
};
