import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_DT } from '../config';
import { MACHINES, minerCycle } from '../data/buildings';
import { GameState } from '../state/GameState';
import { makeScene, placeBuilding } from '../test/helpers';
import { ConveyorSystem } from './ConveyorSystem';
import { GridSystem } from './GridSystem';
import { ProductionSystem } from './ProductionSystem';

/**
 * Frame-rate invariance of the producers.
 *
 * Every producer used to reset its timer to zero on completion, discarding
 * whatever the frame had overshot by. A cycle then cost `ceil(cycle / dt)`
 * frames rather than `cycle` seconds, making throughput a function of the
 * display refresh rather than the clock.
 *
 * Two things about how that bug actually manifests, both of which these tests
 * are shaped around:
 *
 * - **The shipped cycle times hide it.** 1.5s and 1.0s divide exactly into
 *   1/60, 1/30 and 0.05, so at an idealised fixed frame rate the overshoot is
 *   genuinely zero and the old code looked correct. Real frames jitter, so the
 *   tests below drive *irregular* steps, which is the condition players are in.
 * - **Speed mods are what make it bite.** `cycle / mods.minerSpeed` with a
 *   Workshop or research bonus applied is not a round number, so the
 *   quantisation loss no longer cancels. That is the case pinned hardest here.
 */

const SIM_SECONDS = 400;

/** Deterministic frame jitter: real frames are never exactly 1/60. */
function jitteredSteps(baseFps: number, speed: number, seed = 12345): () => number {
  let s = seed;
  return () => {
    // xorshift — cheap, seeded, and stable across runs
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    const wobble = 0.6 + (Math.abs(s % 1000) / 1000) * 0.8; // 0.6x–1.4x of the nominal frame
    return Math.min((1 / baseFps) * wobble, MAX_DT) * speed;
  };
}

let grid: GridSystem;
let conveyor: ConveyorSystem;
let production: ProductionSystem;

function freshWorld(): void {
  GameState.reset();
  grid = new GridSystem();
  conveyor = new ConveyorSystem(makeScene() as never, grid);
  production = new ProductionSystem(makeScene() as never, grid, conveyor);
}

beforeEach(freshWorld);

/** An ore tile that never runs dry, so depletion cannot confound the count. */
function bottomlessOreTile(): { x: number; y: number } {
  let found: { x: number; y: number } | null = null;
  grid.forEachCell((cell, x, y) => {
    if (found || cell.kind !== 'ore') return;
    grid.setReserves(x, y, Number.MAX_SAFE_INTEGER);
    found = { x, y };
  });
  if (!found) throw new Error('map has no ore patch');
  return found;
}

/**
 * Mine for `seconds` of simulated time, taking each item away immediately so the
 * miner is never output-blocked — this measures the cycle timer, nothing else.
 */
function mineFor(seconds: number, nextDt: () => number, minerSpeed = 1): number {
  freshWorld();
  GameState.mods.minerSpeed = minerSpeed;
  const { x, y } = bottomlessOreTile();
  placeBuilding(grid, 'miner', x, y);
  placeBuilding(grid, 'belt', x + 1, y); // dir 0 = East: somewhere to put the ore
  let mined = 0;
  for (let t = 0; t < seconds; ) {
    const dt = nextDt();
    t += dt;
    production.update(dt);
    mined += conveyor.items.length;
    for (const it of conveyor.items) {
      const host = grid.cellAt(it.cx, it.cy)?.building;
      if (host) host.item = null;
    }
    conveyor.items.length = 0;
  }
  return mined;
}

describe('miner throughput tracks the clock, not the frame rate', () => {
  const CASES = [
    { label: '144fps ×1', fps: 144, speed: 1 },
    { label: '60fps ×1', fps: 60, speed: 1 },
    { label: '60fps ×3', fps: 60, speed: 3 },
    { label: '30fps ×1', fps: 30, speed: 1 },
    { label: '30fps ×3', fps: 30, speed: 3 },
  ];

  // A speed mod makes the effective cycle a non-round number, which is when
  // discarded overshoot stops cancelling out. This is the regression guard.
  const MINER_SPEED = 1.15;
  const cycle = minerCycle('ore') / MINER_SPEED;
  const ideal = Math.floor(SIM_SECONDS / cycle);

  for (const { label, fps, speed } of CASES) {
    it(`mines the clock-correct amount at ${label} with jittered frames`, () => {
      const mined = mineFor(SIM_SECONDS, jitteredSteps(fps, speed), MINER_SPEED);
      expect(Math.abs(mined - ideal), `${label}: mined ${mined}, clock says ${ideal}`).toBeLessThanOrEqual(1);
    });
  }

  it('agrees across every frame rate and speed setting', () => {
    const counts = CASES.map(({ fps, speed }) =>
      mineFor(SIM_SECONDS, jitteredSteps(fps, speed), MINER_SPEED),
    );
    expect(Math.max(...counts) - Math.min(...counts), `counts: ${counts.join(', ')}`).toBeLessThanOrEqual(1);
  });
});

describe('a blocked miner holds one unit and never banks a backlog', () => {
  it('does not burst-release after a long stall', () => {
    const { x, y } = bottomlessOreTile();
    // Nothing in front of it: spawnFrom fails every tick, so the miner is blocked.
    const miner = placeBuilding(grid, 'miner', x, y);
    for (let t = 0; t < 120; t += 1 / 60) production.update(1 / 60);

    expect(conveyor.items.length).toBe(0);
    expect(miner.stalled, 'a blocked miner reports itself stalled').toBe(true);
    // Two minutes of being blocked must leave exactly one finished unit pending,
    // not eighty. Without the clamp the timer would be ~120s and the miner would
    // flood the belt the instant it cleared.
    expect(miner.timer).toBeLessThanOrEqual(minerCycle('ore'));

    // Give it an outlet: it should produce one item, then go back to normal pace.
    placeBuilding(grid, 'belt', x + 1, y);
    production.update(1 / 60);
    expect(conveyor.items.length).toBe(1);
  });
});

describe('machine craft rate tracks the clock, not the frame rate', () => {
  const CRAFT_SPEED = 1.15;
  const cycle = MACHINES.press.cycle / CRAFT_SPEED;

  /** A press hand-fed every tick and instantly drained, so only its timer limits it. */
  function pressOutput(nextDt: () => number, seconds: number): number {
    freshWorld();
    GameState.mods.craftSpeed = CRAFT_SPEED;
    const press = placeBuilding(grid, 'press', 2, 2);
    let made = 0;
    for (let t = 0; t < seconds; ) {
      const dt = nextDt();
      t += dt;
      press.inputs.ore = 99; // never starved
      const before = press.outputBuf;
      production.update(dt);
      if (press.outputBuf > before) made += press.outputBuf - before;
      press.outputBuf = 0; // never backed up
    }
    return made;
  }

  const CASES = [
    { label: '144fps ×1', fps: 144, speed: 1 },
    { label: '60fps ×1', fps: 60, speed: 1 },
    { label: '30fps ×3', fps: 30, speed: 3 },
  ];

  for (const { label, fps, speed } of CASES) {
    it(`crafts the clock-correct amount at ${label}`, () => {
      const made = pressOutput(jitteredSteps(fps, speed), SIM_SECONDS);
      const ideal = Math.floor(SIM_SECONDS / cycle) * MACHINES.press.outputPer;
      expect(Math.abs(made - ideal), `${label}: made ${made}, clock says ${ideal}`).toBeLessThanOrEqual(
        MACHINES.press.outputPer,
      );
    });
  }

  it('agrees across every frame rate', () => {
    const counts = CASES.map(({ fps, speed }) => pressOutput(jitteredSteps(fps, speed), SIM_SECONDS));
    expect(Math.max(...counts) - Math.min(...counts), `counts: ${counts.join(', ')}`).toBeLessThanOrEqual(
      MACHINES.press.outputPer,
    );
  });
});
