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

export function isMuted(): boolean {
  return muted;
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
  if (muted) return;
  try {
    const c = ac();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, c.currentTime);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), c.currentTime + dur);
    g.gain.setValueAtTime(vol, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.connect(g).connect(c.destination);
    o.start();
    o.stop(c.currentTime + dur);
  } catch {
    /* audio blocked until first user gesture — fine */
  }
}

export const sfx = {
  shoot: () => blip(760, 0.06, 'square', 0.025, 240),
  hit: () => blip(200, 0.05, 'sawtooth', 0.04),
  coin: () => {
    blip(988, 0.06, 'square', 0.05);
    setTimeout(() => blip(1319, 0.09, 'square', 0.05), 55);
  },
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
