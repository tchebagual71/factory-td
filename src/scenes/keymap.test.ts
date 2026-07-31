import { describe, expect, it } from 'vitest';
import { BUILD_INFO } from '../data/buildings';
import { allBoundKeys, KEYS, key, phaserKeyName } from './keymap';

describe('keymap', () => {
  /**
   * The regression this file exists for. `V` was the cryo tower's hotkey *and*
   * the isometric view toggle; Phaser registers both listeners, so one press
   * armed a $160 tower and the next board click planted it.
   */
  it('never binds one key to two actions', () => {
    const keys = allBoundKeys();
    const seen = new Map<string, number>();
    for (const k of keys) seen.set(k, (seen.get(k) ?? 0) + 1);
    const clashes = [...seen].filter(([, n]) => n > 1).map(([k]) => k);
    expect(clashes, `these keys are bound twice: ${clashes.join(', ')}`).toEqual([]);
  });

  it('keeps the four guns on ZXCV, under one hand', () => {
    const guns = BUILD_INFO.filter((b) => b.cat === 'defense').map((b) => b.hotkey);
    expect(guns).toEqual(['Z', 'X', 'C', 'V']);
  });

  it('binds every action exactly once', () => {
    const actions = KEYS.map((k) => k.action);
    expect(new Set(actions).size).toBe(actions.length);
  });

  it('gives every binding a label to print', () => {
    for (const k of KEYS) {
      expect(k.label.length, `${k.action} has no label`).toBeGreaterThan(0);
      expect(k.key.length, `${k.action} has no key`).toBeGreaterThan(0);
    }
  });

  it('resolves display hotkeys to the names Phaser actually emits', () => {
    expect(phaserKeyName('1')).toBe('ONE');
    expect(phaserKeyName('9')).toBe('NINE');
    expect(phaserKeyName('z')).toBe('Z');
    expect(phaserKeyName('V')).toBe('V');
  });

  it('looks a label up by action, so no UI string hardcodes a key', () => {
    expect(key('sendWave')).toBe('SPC');
    expect(() => key('nope' as never)).toThrow();
  });
});
