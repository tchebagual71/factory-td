import { beforeEach, describe, expect, it } from 'vitest';
import { getVolume, isMuted, setVolume, toggleMute } from './sfx';

// The mixer is pure bookkeeping — WebAudio itself is never touched in these
// tests (no AudioContext in node), only the state that gates and scales it.
beforeEach(() => {
  setVolume(0.7);
  if (isMuted()) toggleMute();
});

describe('master volume', () => {
  it('round-trips a level', () => {
    setVolume(0.4);
    expect(getVolume()).toBeCloseTo(0.4);
  });

  it('clamps anything out of range instead of producing silence or clipping', () => {
    expect(setVolume(5)).toBe(1);
    expect(setVolume(-2)).toBe(0);
    expect(getVolume()).toBe(0);
  });

  it('turning the volume up un-mutes — no "why is it silent" trap', () => {
    toggleMute();
    expect(isMuted()).toBe(true);
    setVolume(0.5);
    expect(isMuted()).toBe(false);
    expect(getVolume()).toBeCloseTo(0.5);
  });

  it('setting zero does not un-mute (it is still silence either way)', () => {
    toggleMute();
    setVolume(0);
    expect(isMuted()).toBe(true);
  });
});

describe('mute', () => {
  it('toggles independently of the level, and reports the new state', () => {
    setVolume(0.8);
    expect(toggleMute()).toBe(true);
    expect(getVolume()).toBeCloseTo(0.8); // level is remembered while muted
    expect(toggleMute()).toBe(false);
  });
});
