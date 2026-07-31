import { describe, expect, it } from 'vitest';
import { coachMessage } from './coach';

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
});
