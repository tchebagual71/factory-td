/**
 * Rendering quality is data, not a collection of renderer-side guesses. Keeping
 * the device choice and frame-time policy here makes them testable without a
 * DOM, Phaser or Three.js, and keeps every transition one-way: a wave can shed
 * visual work, but it never pauses to rebuild more expensive rendering again.
 */

export type IsoQualityLevel = 'high' | 'medium' | 'low' | 'flat';
export type IsoRenderQuality = Exclude<IsoQualityLevel, 'flat'>;

export interface IsoQualityPreset {
  antialias: boolean;
  dprCap: number;
  shadows: boolean;
  shadowMapSize: number;
  /** Zero means mirror every simulation frame; positive values cap only the mirror. */
  minRenderIntervalMs: number;
}

export const ISO_QUALITY_PRESETS: Readonly<Record<IsoRenderQuality, Readonly<IsoQualityPreset>>> = {
  high: {
    antialias: true,
    dprCap: 2,
    shadows: true,
    shadowMapSize: 2048,
    minRenderIntervalMs: 0,
  },
  medium: {
    antialias: true,
    dprCap: 1,
    shadows: true,
    shadowMapSize: 1024,
    minRenderIntervalMs: 1000 / 30,
  },
  low: {
    antialias: false,
    dprCap: 1,
    shadows: false,
    // Kept small even while disabled so a renderer never allocates the high
    // tier's map while applying the mobile preset.
    shadowMapSize: 512,
    minRenderIntervalMs: 1000 / 30,
  },
};

export interface IsoDeviceQuality {
  isTouch: boolean;
  devicePixelRatio: number;
}

/** Pick the construction-time preset before a WebGL context is requested. */
export function initialIsoQuality(device: IsoDeviceQuality): IsoRenderQuality {
  const dpr = Number.isFinite(device.devicePixelRatio) ? device.devicePixelRatio : 1;
  return device.isTouch || dpr <= 1 ? 'low' : 'high';
}

export const QUALITY_FRAME_WINDOW = 60;
export const QUALITY_BAD_AVERAGES = 30;

/**
 * Each threshold is deliberately separated from the previous tier's. More
 * importantly, transitions are monotonic: boundary noise can reset the bad
 * streak, but no good streak can upgrade a renderer and introduce a mid-wave
 * rebuild hitch.
 */
const BAD_FRAME_MS: Readonly<Record<IsoRenderQuality, number>> = {
  high: 24,
  medium: 30,
  low: 45,
};

export interface IsoQualityState {
  level: IsoQualityLevel;
  samples: readonly number[];
  badAverages: number;
}

export function createIsoQualityState(level: IsoRenderQuality): IsoQualityState {
  return { level, samples: [], badAverages: 0 };
}

/**
 * Add one real main-loop frame duration and return the next quality state.
 * Durations are capped before averaging so one tab-away or debugger pause can
 * never masquerade as sustained failure. A downgrade needs a full rolling
 * window followed by repeated over-budget averages; flat therefore cannot be
 * reached from one pathological frame.
 */
export function sampleIsoFrame(state: IsoQualityState, frameMs: number): IsoQualityState {
  if (state.level === 'flat') return state;

  const finite = Number.isFinite(frameMs) ? frameMs : 0;
  const sample = Math.max(0, Math.min(100, finite));
  const samples = [...state.samples, sample].slice(-QUALITY_FRAME_WINDOW);
  if (samples.length < QUALITY_FRAME_WINDOW) return { ...state, samples };

  const average = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const badAverages = average > BAD_FRAME_MS[state.level] ? state.badAverages + 1 : 0;
  if (badAverages < QUALITY_BAD_AVERAGES) return { ...state, samples, badAverages };

  const next: IsoQualityLevel = state.level === 'high' ? 'medium' : state.level === 'medium' ? 'low' : 'flat';
  return { level: next, samples: [], badAverages: 0 };
}
