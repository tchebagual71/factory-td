import { describe, expect, it } from 'vitest';
import { BUILD_INFO, buildGroupSizes } from '../data/buildings';
import { controlVisual } from './uiTheme';
import { UIScene } from './UIScene';

class PaletteObject {
  fill: number | undefined;
  stroke: number | undefined;
  interactive = false;
  handlers = new Map<string, () => void>();

  setOrigin(): this { return this; }
  setStrokeStyle(_width: number, color: number): this { this.stroke = color; return this; }
  setInteractive(): this { this.interactive = true; return this; }
  on(event: string, handler: () => void): this { this.handlers.set(event, handler); return this; }
  setFillStyle(color: number): this { this.fill = color; return this; }
  setScale(): this { return this; }
}

describe('UIScene description handoff', () => {
  it('does not write coach copy before the coach text exists', () => {
    const showDesc = (UIScene.prototype as unknown as { showDesc(text: string): void }).showDesc;

    expect(() => showDesc.call({ descText: undefined }, 'Build the line.')).not.toThrow();
  });

  it('gives a hovered build slot the semantic bright hover border', () => {
    const frames: PaletteObject[] = [];
    const object = () => new PaletteObject();
    const scene = {
      add: {
        container: () => ({ add: () => undefined }),
        rectangle: (_x: number, _y: number, _w: number, _h: number, fill: number) => {
          const frame = object();
          frame.fill = fill;
          frames.push(frame);
          return frame;
        },
        image: object,
        text: object,
      },
      slotColor: new Map(),
      paletteFrames: new Map(),
      paletteButtons: new Map(),
      paletteState: new Map(),
      showDesc: () => undefined,
      showHint: () => undefined,
    };
    const buildPalette = (UIScene.prototype as unknown as { buildPalette(layout: unknown): void }).buildPalette;
    buildPalette.call(scene, {
      slots: BUILD_INFO.map((_, index) => ({ x: index * 80, y: 0, w: 76, h: 64 })),
      groupHeaders: buildGroupSizes().map((_, index) => ({ x: index * 200, y: 0, w: 180, h: 11 })),
    });
    const frame = frames.find((candidate) => candidate.interactive);

    expect(frame).toBeDefined();
    frame!.handlers.get('pointerover')!();
    expect(frame!.stroke).toBe(controlVisual('hover').stroke);
  });
});
