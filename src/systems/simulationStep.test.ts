import { describe, expect, it } from 'vitest';
import { stepSimulation } from './simulationStep';

function harness(stopAfter?: string) {
  const calls: string[] = [];
  let halted = false;
  const update = (name: string) => () => {
    calls.push(name);
    if (name === stopAfter) halted = true;
  };
  return {
    calls,
    systems: {
      wave: { update: update('wave') },
      conveyor: { update: update('conveyor') },
      production: { update: update('production') },
      combat: { update: update('combat') },
      logistics: { update: update('logistics') },
    },
    halted: () => halted,
  };
}

describe('stepSimulation', () => {
  it('runs every system in the documented order on a live frame', () => {
    const h = harness();
    stepSimulation(h.systems, 0.05, h.halted);
    expect(h.calls).toEqual(['wave', 'conveyor', 'production', 'combat', 'logistics']);
  });

  it.each(['wave', 'conveyor', 'production', 'combat'])(
    'stops after %s makes the frame terminal or frozen',
    (name) => {
      const h = harness(name);
      stepSimulation(h.systems, 0.05, h.halted);
      expect(h.calls.at(-1)).toBe(name);
    },
  );
});
