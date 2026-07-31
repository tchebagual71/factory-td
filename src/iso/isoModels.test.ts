import { describe, expect, it } from 'vitest';
import { BUILD_INFO } from '../data/buildings';
import { BELT_FRAME_KEYS } from '../scenes/beltFrames';
import { ItemType } from '../types';
import { GROUND_Y, modelFor, modelledKeys } from './isoModels';

/**
 * The 3D view extrudes whatever the 2D game puts on screen, so a texture with
 * no model is an object that silently vanishes in isometric mode. These tests
 * are the guard: add a building or an ammo type and the model table has to
 * grow with it.
 */

const ITEM_TYPES: ItemType[] = ['ore', 'crystal', 'ammo', 'shell', 'piercing', 'coolant'];
const ENEMY_KEYS = ['enemy', 'armored', 'swift', 'boss'];
const SHOT_KEYS = ['bullet', 'cannonball', 'lance', 'muzzle'];
const BARREL_KEYS = ['barrel', 'barrel-cannon', 'barrel-lancer'];

describe('model coverage', () => {
  it('models every building in the palette', () => {
    for (const info of BUILD_INFO) expect(modelFor(info.type), info.type).not.toBeNull();
  });

  it('models every belt animation frame, so the lid keeps scrolling', () => {
    for (const key of BELT_FRAME_KEYS) expect(modelFor(key), key).not.toBeNull();
  });

  it('models every item that can ride a belt', () => {
    for (const t of ITEM_TYPES) expect(modelFor(`item-${t}`), t).not.toBeNull();
  });

  it('models every enemy, barrel and projectile', () => {
    for (const key of [...ENEMY_KEYS, ...SHOT_KEYS, ...BARREL_KEYS]) expect(modelFor(key), key).not.toBeNull();
  });

  it('returns null for an unknown key rather than throwing', () => {
    expect(modelFor('px')).toBeNull();
    expect(modelFor('not-a-texture')).toBeNull();
  });
});

describe('model geometry', () => {
  it('gives everything a positive footprint and height', () => {
    for (const key of modelledKeys()) {
      const m = modelFor(key)!;
      expect(m.w, key).toBeGreaterThan(0);
      expect(m.d, key).toBeGreaterThan(0);
      expect(m.h, key).toBeGreaterThan(0);
      expect(m.lift, key).toBeGreaterThanOrEqual(0);
    }
  });

  it('walks enemies on the sunken road, not up on the buildable ground', () => {
    // The road is a canyon between grass slabs; an enemy lifted to GROUND_Y
    // would appear to hover over it.
    for (const key of ENEMY_KEYS) expect(modelFor(key)!.lift, key).toBe(0);
  });

  it('stands every building on the grass', () => {
    for (const info of BUILD_INFO) expect(modelFor(info.type)!.lift, info.type).toBe(GROUND_Y);
  });

  it('keeps belts flush enough that an item on one still reads as carried', () => {
    for (const key of BELT_FRAME_KEYS) {
      const belt = modelFor(key)!;
      const ore = modelFor('item-ore')!;
      expect(belt.lift + belt.h).toBeLessThanOrEqual(ore.lift);
    }
  });

  it('rests each barrel on top of its own turret', () => {
    const pairs: [string, string][] = [
      ['tower', 'barrel'],
      ['cannon', 'barrel-cannon'],
      ['lancer', 'barrel-lancer'],
    ];
    for (const [turret, barrel] of pairs) {
      const t = modelFor(turret)!;
      const b = modelFor(barrel)!;
      expect(b.lift, barrel).toBeGreaterThanOrEqual(t.lift + t.h - 1);
      expect(b.lift, barrel).toBeLessThanOrEqual(t.lift + t.h + 2);
    }
  });
});
