import { describe, expect, it, vi } from 'vitest';
import { GameScene } from '../scenes/GameScene';
import { GameState } from '../state/GameState';
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

describe('GameScene simulation barrier', () => {
  it('stops downstream systems and post-step work when an earlier system deactivates the scene', () => {
    GameState.reset();
    let active = true;
    const calls: string[] = [];
    const saveRun = vi.fn();
    const updateGhost = vi.fn();
    const drawDeposits = vi.fn();
    const render = vi.fn();
    const syncTerrain = vi.fn();
    const game = new GameScene() as unknown as {
      scene: { isActive(): boolean };
      facingDirty: boolean;
      simulation: {
        wave: { update(dt: number): void };
        conveyor: { update(dt: number): void };
        production: { update(dt: number): void };
        combat: { update(dt: number): void };
        logistics: { update(dt: number): void };
      };
      saveDirty: boolean;
      saveTimer: number;
      saveRun: typeof saveRun;
      updateGhost: typeof updateGhost;
      depositsDirty: boolean;
      depositsTimer: number;
      drawDeposits: typeof drawDeposits;
      iso: { render: typeof render; syncTerrain: typeof syncTerrain };
      selTower: null;
      update(time: number, deltaMs: number): void;
    };
    game.scene = { isActive: () => active };
    game.facingDirty = false;
    game.simulation = {
      wave: { update: () => { calls.push('wave'); active = false; } },
      conveyor: { update: () => { calls.push('conveyor'); } },
      production: { update: () => { calls.push('production'); } },
      combat: { update: () => { calls.push('combat'); } },
      logistics: { update: () => { calls.push('logistics'); } },
    };
    game.saveDirty = true;
    game.saveTimer = 0;
    game.saveRun = saveRun;
    game.updateGhost = updateGhost;
    game.depositsDirty = true;
    game.depositsTimer = 0;
    game.drawDeposits = drawDeposits;
    game.iso = { render, syncTerrain };
    game.selTower = null;

    game.update(0, 16);

    expect(calls).toEqual(['wave']);
    expect(saveRun).not.toHaveBeenCalled();
    expect(updateGhost).not.toHaveBeenCalled();
    expect(drawDeposits).not.toHaveBeenCalled();
    expect(syncTerrain).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });
});
