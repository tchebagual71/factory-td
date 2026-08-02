import Phaser from 'phaser';
import { TILE } from '../config';
import { ConveyorSystem } from '../systems/ConveyorSystem';
import { GridSystem } from '../systems/GridSystem';
import { Building, BuildingType, Dir, ItemEnt, ItemType } from '../types';

/**
 * Minimal sprite mock covering everything ConveyorSystem and WaveSystem touch.
 * `tint` / `tintFill` are recorded rather than ignored so the enemy tint
 * priority chain (hit flash over frost over nothing) can be asserted.
 */
export interface MockSprite {
  x: number;
  y: number;
  alpha: number;
  rotation: number;
  scaleX: number;
  fillColor: number;
  /** null = no tint applied */
  tint: number | null;
  /** true when the last tint was a solid fill (a hit flash) rather than a multiply */
  tintFill: boolean;
  destroyed: boolean;
  setPosition(x: number, y: number): MockSprite;
  setAlpha(a: number): MockSprite;
  setDepth(d: number): MockSprite;
  setRotation(r: number): MockSprite;
  setTint(t: number): MockSprite;
  setTintFill(t: number): MockSprite;
  setStrokeStyle(width?: number, color?: number, alpha?: number): MockSprite;
  clearTint(): MockSprite;
  setOrigin(x?: number, y?: number): MockSprite;
  destroy(): void;
}

export function makeSprite(x = 0, y = 0): MockSprite {
  const s: MockSprite = {
    x,
    y,
    alpha: 1,
    rotation: 0,
    scaleX: 1,
    fillColor: 0,
    tint: null,
    tintFill: false,
    destroyed: false,
    setPosition(nx: number, ny: number) {
      s.x = nx;
      s.y = ny;
      return s;
    },
    setAlpha(a: number) {
      s.alpha = a;
      return s;
    },
    setDepth() {
      return s;
    },
    setRotation(r: number) {
      s.rotation = r;
      return s;
    },
    setTint(t: number) {
      s.tint = t;
      s.tintFill = false;
      return s;
    },
    setTintFill(t: number) {
      s.tint = t;
      s.tintFill = true;
      return s;
    },
    setStrokeStyle() {
      return s;
    },
    clearTint() {
      s.tint = null;
      s.tintFill = false;
      return s;
    },
    setOrigin() {
      return s;
    },
    destroy() {
      s.destroyed = true;
    },
  };
  return s;
}

/**
 * Chainable no-op stand-in for Phaser.GameObjects.Graphics / Text: every method
 * returns the object itself, so `.setDepth(1).setVisible(false)` works.
 */
function makeChainable(): Record<string, unknown> {
  const proxy: Record<string, unknown> = new Proxy(
    {},
    {
      get: (target: Record<string, unknown>, prop) => {
        if (prop in target) return target[prop as string];
        return () => proxy;
      },
    },
  );
  return proxy;
}

/**
 * Stand-in for GameScene. Includes the juice helpers the systems call
 * (`floatText`, `burst`, `bigText`, `edgeAlert`, camera shake) so a system under
 * test can be driven through a real wave instead of only having its pure bits
 * poked.
 */
export function makeScene(): Phaser.Scene {
  return {
    add: {
      image: (x: number, y: number) => makeSprite(x, y),
      rectangle: (x: number, y: number) => makeSprite(x, y),
      circle: (x: number, y: number) => makeSprite(x, y),
      particles: () => makeChainable(),
      graphics: () => makeChainable(),
      text: () => makeChainable(),
    },
    tweens: { add: () => undefined, killTweensOf: () => undefined },
    time: { now: 0, delayedCall: () => undefined },
    cameras: { main: { shake: () => undefined, flash: () => undefined } },
    floatText: () => undefined,
    bigText: () => undefined,
    // The wave-clear payoff banner. Records its arguments so a test can pin the
    // invariant that matters: the figure counted up on screen is exactly the
    // figure banked, never a second computation of the bonus.
    bigCount: function (this: Record<string, unknown>, prefix: string, amount: number) {
      (this.bigCountCalls as [string, number][]).push([prefix, amount]);
    },
    bigCountCalls: [] as [string, number][],
    burst: () => undefined,
    // Off-screen markers for leaks and incoming waves. A no-op here, but it must
    // exist: WaveSystem calls it on every leak and every wave start.
    edgeAlert: () => undefined,
    // WaveSystem samples this at the start and end of every wave for the report
    // card's magazine line. No towers in a bare test world, hence zero.
    magazineTotal: () => 0,
  } as unknown as Phaser.Scene;
}

export function makeBuilding(type: BuildingType, x: number, y: number, dir: Dir = 0): Building {
  return {
    type,
    x,
    y,
    dir,
    sprite: makeSprite(center(x), center(y)) as unknown as Phaser.GameObjects.Image,
    item: null,
    outIdx: 0,
    filter: null,
    timer: 0,
    crafting: false,
    inputs: {},
    outputBuf: 0,
    ammo: 0,
    fed: 0,
    cooldown: 0,
    mk: 1,
    path: null,
    invested: 0,
    stalled: false,
    stallReason: null,
    utilBusy: 0,
    utilBlocked: 0,
    utilTotal: 0,
  };
}

/** Pixel center of a tile coordinate. */
export function center(c: number): number {
  return c * TILE + TILE / 2;
}

export function placeBuilding(
  grid: GridSystem,
  type: BuildingType,
  x: number,
  y: number,
  dir: Dir = 0,
): Building {
  const b = makeBuilding(type, x, y, dir);
  grid.place(b);
  return b;
}

/** Put an item at rest on a belt-like building's cell center. */
export function addItem(conv: ConveyorSystem, host: Building, type: ItemType): ItemEnt {
  const it: ItemEnt = {
    type,
    cx: host.x,
    cy: host.y,
    sprite: makeSprite(center(host.x), center(host.y)) as unknown as Phaser.GameObjects.Image,
  };
  host.item = it;
  conv.items.push(it);
  return it;
}
