import Phaser from 'phaser';
import { TILE } from '../config';
import { ConveyorSystem } from '../systems/ConveyorSystem';
import { GridSystem } from '../systems/GridSystem';
import { Building, BuildingType, Dir, ItemEnt, ItemType } from '../types';

/** Minimal sprite mock covering everything ConveyorSystem touches. */
export interface MockSprite {
  x: number;
  y: number;
  alpha: number;
  destroyed: boolean;
  setPosition(x: number, y: number): MockSprite;
  setAlpha(a: number): MockSprite;
  setDepth(d: number): MockSprite;
  destroy(): void;
}

export function makeSprite(x = 0, y = 0): MockSprite {
  const s: MockSprite = {
    x,
    y,
    alpha: 1,
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

export function makeScene(): Phaser.Scene {
  return {
    add: {
      image: (x: number, y: number) => makeSprite(x, y),
      graphics: () => makeChainable(),
      text: () => makeChainable(),
    },
    tweens: { add: () => undefined },
    time: { now: 0, delayedCall: () => undefined },
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
    timer: 0,
    crafting: false,
    inputOre: 0,
    inputCrystal: 0,
    outputBuf: 0,
    ammo: 0,
    cooldown: 0,
    mk: 1,
    path: null,
    invested: 0,
    stalled: false,
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
