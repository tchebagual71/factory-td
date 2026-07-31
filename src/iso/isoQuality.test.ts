import { describe, expect, it } from 'vitest';
import {
  createIsoQualityState,
  initialIsoQuality,
  ISO_QUALITY_PRESETS,
  IsoQualityState,
  QUALITY_BAD_AVERAGES,
  QUALITY_FRAME_WINDOW,
  sampleIsoFrame,
} from './isoQuality';

const feed = (state: IsoQualityState, frames: readonly number[]): IsoQualityState =>
  frames.reduce(sampleIsoFrame, state);

const sustained = (ms: number): number[] =>
  Array.from({ length: QUALITY_FRAME_WINDOW + QUALITY_BAD_AVERAGES }, () => ms);

describe('initial isometric quality', () => {
  it('uses the low preset for touch and low-DPR devices', () => {
    expect(initialIsoQuality({ isTouch: true, devicePixelRatio: 3 })).toBe('low');
    expect(initialIsoQuality({ isTouch: false, devicePixelRatio: 1 })).toBe('low');
    expect(ISO_QUALITY_PRESETS.low).toMatchObject({
      antialias: false,
      dprCap: 1,
      shadows: false,
      shadowMapSize: 512,
    });
  });

  it('keeps the high preset on a high-DPR desktop', () => {
    expect(initialIsoQuality({ isTouch: false, devicePixelRatio: 2 })).toBe('high');
    expect(ISO_QUALITY_PRESETS.high).toMatchObject({
      antialias: true,
      dprCap: 2,
      shadows: true,
      shadowMapSize: 2048,
    });
  });
});

describe('adaptive isometric quality', () => {
  it('steps high to medium to low after sustained slow frames', () => {
    let state = feed(createIsoQualityState('high'), sustained(35));
    expect(state.level).toBe('medium');
    state = feed(state, sustained(35));
    expect(state.level).toBe('low');
  });

  it('does not oscillate when frame time hovers on a boundary', () => {
    let state = feed(createIsoQualityState('high'), sustained(25));
    expect(state.level).toBe('medium');
    const boundary = Array.from({ length: 600 }, (_, i) => (i % 2 === 0 ? 29 : 31));
    state = feed(state, boundary);
    expect(state.level).toBe('medium');
    state = feed(state, Array.from({ length: 600 }, () => 16));
    expect(state.level).toBe('medium');
  });

  it('falls back to flat only after sustained unusable performance', () => {
    let state = sampleIsoFrame(createIsoQualityState('low'), 1000);
    expect(state.level).toBe('low');
    state = feed(state, Array.from({ length: QUALITY_FRAME_WINDOW * 2 }, () => 16));
    expect(state.level).toBe('low');
    state = feed(state, sustained(60));
    expect(state.level).toBe('flat');
  });
});
