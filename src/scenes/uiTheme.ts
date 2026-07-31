export interface UiTone {
  hex: number;
  css: string;
}

export type ControlState = 'idle' | 'hover' | 'selected' | 'active' | 'disabled' | 'danger';

export interface ControlVisual {
  fill: number;
  stroke: number;
  text: number;
  label: string;
}

const tone = (hex: number): UiTone => ({
  hex,
  css: `#${hex.toString(16).padStart(6, '0')}`,
});

export const UI_COLOR = {
  ink: tone(0x081019),
  surface: tone(0x101b26),
  surfaceRaised: tone(0x172635),
  line: tone(0x2b4053),
  lineBright: tone(0x45657d),
  text: tone(0xe7eef5),
  textMuted: tone(0x91a4b7),
  money: tone(0xffd166),
  logistics: tone(0x38bdf8),
  production: tone(0xf59e42),
  defense: tone(0xfb7185),
  action: tone(0x52e58c),
  warning: tone(0xffad42),
  danger: tone(0xff5c67),
  research: tone(0x70e1c1),
} as const;

export const UI_FONT = {
  mono: 'ui-monospace, SFMono-Regular, Consolas, monospace',
  body: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  desktopSecondary: 12,
  desktopPrimary: 14,
  touchSecondary: 16,
  touchPrimary: 18,
} as const;

export const UI_SPACE = [4, 8, 12, 16, 24, 32] as const;

const luminance = (hex: number): number => {
  const channels = [hex >> 16, (hex >> 8) & 0xff, hex & 0xff];
  const linear = channels.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
};

export const contrastRatio = (foreground: number, background: number): number => {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
};

export const controlVisual = (state: ControlState, accent = UI_COLOR.action.hex): ControlVisual => {
  switch (state) {
    case 'hover':
      return { fill: UI_COLOR.surfaceRaised.hex, stroke: UI_COLOR.lineBright.hex, text: UI_COLOR.text.hex, label: 'HOVER' };
    case 'selected':
      return { fill: UI_COLOR.surfaceRaised.hex, stroke: accent, text: UI_COLOR.text.hex, label: 'SELECTED' };
    case 'active':
      return { fill: accent, stroke: UI_COLOR.text.hex, text: UI_COLOR.ink.hex, label: 'ACTIVE' };
    case 'disabled':
      return { fill: UI_COLOR.surface.hex, stroke: UI_COLOR.line.hex, text: UI_COLOR.textMuted.hex, label: 'UNAVAILABLE' };
    case 'danger':
      return { fill: UI_COLOR.danger.hex, stroke: UI_COLOR.text.hex, text: UI_COLOR.ink.hex, label: 'DANGER' };
    case 'idle':
      return { fill: UI_COLOR.surface.hex, stroke: UI_COLOR.line.hex, text: UI_COLOR.text.hex, label: 'READY' };
  }
};
