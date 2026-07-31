import { describe, expect, it } from 'vitest';
import { UI_COLOR, UI_FONT, UI_SPACE, contrastRatio, controlVisual } from './uiTheme';

describe('polished industrial UI theme', () => {
  it('keeps every semantic tone usable as both Phaser and CSS color', () => {
    for (const tone of Object.values(UI_COLOR)) {
      expect(tone.hex).toBe(Number.parseInt(tone.css.slice(1), 16));
      expect(tone.css).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('keeps primary and secondary copy readable on the main surface', () => {
    expect(contrastRatio(UI_COLOR.text.hex, UI_COLOR.surface.hex)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(UI_COLOR.textMuted.hex, UI_COLOR.surface.hex)).toBeGreaterThanOrEqual(4.5);
  });

  it('uses distinct words and borders for state instead of color alone', () => {
    expect(controlVisual('selected').label).toBe('SELECTED');
    expect(controlVisual('disabled').label).toBe('UNAVAILABLE');
    expect(controlVisual('active').stroke).not.toBe(controlVisual('idle').stroke);
  });

  it('defines the approved type and spacing scales', () => {
    expect(UI_FONT.body).toContain('system-ui');
    expect(UI_FONT.mono).toContain('monospace');
    expect(UI_FONT.touchPrimary).toBeGreaterThanOrEqual(18);
    expect(UI_SPACE).toEqual([...UI_SPACE].sort((a, b) => a - b));
  });
});
