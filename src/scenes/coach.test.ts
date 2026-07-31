import { describe, expect, it } from 'vitest';
import { coachMessage } from './coach';
import { BUILD_INFO } from '../data/buildings';
import { fitCardCopy, hudCardCopyLimits } from './hudLayout';

describe('contextual build coach', () => {
  it('starts with one miner action instead of a paragraph', () => {
    expect(coachMessage({ buildings: [], fedDefense: false, selected: null })).toMatchObject({ step: 1, action: 'Place a miner on an orange ore deposit' });
  });

  it('advances through belt, press, and gun milestones', () => {
    expect(coachMessage({ buildings: ['miner'], fedDefense: false, selected: null }).step).toBe(2);
    expect(coachMessage({ buildings: ['miner', 'belt'], fedDefense: false, selected: null }).step).toBe(3);
    expect(coachMessage({ buildings: ['miner', 'belt', 'press'], fedDefense: false, selected: null }).step).toBe(4);
  });

  it('uses a selected building description without losing the milestone', () => {
    const result = coachMessage({ buildings: ['miner'], fedDefense: false, selected: 'belt' });
    expect(result.step).toBe(2);
    expect(result.context).toContain('BELT');
  });

  it('ends in a launch-wave action once a gun exists', () => {
    expect(coachMessage({ buildings: ['miner', 'belt', 'press', 'tower'], fedDefense: true, selected: null }))
      .toMatchObject({ step: 5, action: 'Launch the wave when your line is ready' });
  });

  it('keeps a placed but unfed defense on the delivery milestone', () => {
    expect(coachMessage({ buildings: ['miner', 'belt', 'press', 'tower'], fedDefense: false, selected: null }))
      .toMatchObject({ step: 4, action: 'Feed ammo to a defense tower' });
  });

  it('clamps every live coach action and context to desktop and touch card budgets', () => {
    const facts = [
      { buildings: [], fedDefense: false },
      { buildings: ['miner'] as const, fedDefense: false },
      { buildings: ['miner', 'belt'] as const, fedDefense: false },
      { buildings: ['miner', 'belt', 'press', 'tower'] as const, fedDefense: false },
      { buildings: ['miner', 'belt', 'press', 'tower'] as const, fedDefense: true },
    ];
    for (const touch of [false, true]) {
      const limits = hudCardCopyLimits(touch);
      for (const fact of facts) {
        for (const selected of [null, ...BUILD_INFO.map((info) => info.type)]) {
          const message = coachMessage({ ...fact, selected });
          expect(fitCardCopy(message.action, limits.coachAction, 1).length).toBeLessThanOrEqual(limits.coachAction);
          expect(fitCardCopy(message.context, limits.coachContext, 1).length).toBeLessThanOrEqual(limits.coachContext);
        }
      }
    }
  });
});
