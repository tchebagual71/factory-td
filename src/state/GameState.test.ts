import { beforeEach, describe, expect, it } from 'vitest';
import { START_MONEY } from '../config';
import {
  ammoDeficits,
  ammoTotal,
  ammoUndelivered,
  bumpAmmo,
  cloneTally,
  emptyTally,
  GameState,
} from './GameState';

beforeEach(() => {
  GameState.reset();
});

describe('wave tally', () => {
  it('counts bounties and bonuses as income but never sell refunds', () => {
    GameState.addMoney(40); // a kill bounty
    GameState.addMoney(75, false); // selling a tower back
    expect(GameState.money).toBe(START_MONEY + 40 + 75); // both credits still reach the wallet
    expect(GameState.tally.income).toBe(40);
  });

  it('starts every run and every loaded save with an empty tally', () => {
    GameState.tally.kills = 9;
    GameState.reset();
    expect(GameState.tally).toEqual(emptyTally());

    bumpAmmo(GameState.tally.fired, 'ammo', 12);
    GameState.applySnapshot({ money: 10, lives: 3, wave: 4, speed: 2, auto: false });
    expect(GameState.tally).toEqual(emptyTally());
  });
});

describe('ammo accounting', () => {
  it('judges supply per ammo type, so a fat coolant line cannot mask a starving gun line', () => {
    const t = emptyTally();
    bumpAmmo(t.fired, 'ammo', 40);
    bumpAmmo(t.delivered, 'ammo', 10);
    // one chiller turns 1 ammo into 2 coolant, so this line looks generous
    bumpAmmo(t.fired, 'coolant', 8);
    bumpAmmo(t.delivered, 'coolant', 60);

    // the grand total says supply kept up — it did not
    expect(ammoTotal(t.delivered)).toBeGreaterThan(ammoTotal(t.fired));
    expect(ammoDeficits(t)).toEqual([{ type: 'ammo', short: 30 }]);
  });

  it('reports the worst shortfall first so the player knows which line to widen', () => {
    const t = emptyTally();
    bumpAmmo(t.fired, 'ammo', 20);
    bumpAmmo(t.fired, 'shell', 30);
    bumpAmmo(t.delivered, 'shell', 5);
    expect(ammoDeficits(t).map((d) => d.type)).toEqual(['shell', 'ammo']);
  });

  it('reports nothing when every line kept up', () => {
    const t = emptyTally();
    bumpAmmo(t.fired, 'piercing', 6);
    bumpAmmo(t.delivered, 'piercing', 6);
    expect(ammoDeficits(t)).toEqual([]);
  });

  it('cloneTally deep-copies every counter, so the card cannot keep counting after the wave ends', () => {
    const t = emptyTally();
    bumpAmmo(t.fired, 'ammo', 3);
    bumpAmmo(t.delivered, 'ammo', 2);
    bumpAmmo(t.toLab, 'shell', 1);
    const snap = cloneTally(t);
    bumpAmmo(t.fired, 'ammo', 99);
    bumpAmmo(t.delivered, 'ammo', 99);
    bumpAmmo(t.toLab, 'shell', 99);
    expect(snap.fired.ammo).toBe(3);
    expect(snap.delivered.ammo).toBe(2);
    expect(snap.toLab.shell).toBe(1);
  });
});

/**
 * The report used to compare rounds *fired* against rounds *produced*, which is
 * not the same question. Production is what the factory finished; only delivery
 * is what the guns could actually spend. These pin the difference, because it is
 * the difference that made the old card give the wrong advice.
 */
describe('supply is judged on delivery, not production', () => {
  it('calls out a factory that produced plenty but delivered none of it', () => {
    const t = emptyTally();
    bumpAmmo(t.fired, 'ammo', 30);
    bumpAmmo(t.produced, 'ammo', 40); // presses ran all wave…
    bumpAmmo(t.delivered, 'ammo', 5); // …into a backed-up buffer and a belt going nowhere

    expect(ammoTotal(t.produced), 'the old measure would have said this wave was fine').toBeGreaterThan(
      ammoTotal(t.fired),
    );
    expect(ammoDeficits(t)).toEqual([{ type: 'ammo', short: 25 }]);
    expect(ammoUndelivered(t), 'and names how much never arrived').toBe(35);
  });

  it('does not scold a player for spending a stockpile they had banked', () => {
    const t = emptyTally();
    // Nothing was made this wave, but the belts were full of last wave's output.
    bumpAmmo(t.fired, 'ammo', 20);
    bumpAmmo(t.delivered, 'ammo', 22);
    expect(ammoDeficits(t)).toEqual([]);
    expect(ammoUndelivered(t)).toBe(0); // delivered exceeding produced is not a negative surplus
  });

  it('counts rounds a Lab ate as a sink competing with the guns', () => {
    const t = emptyTally();
    bumpAmmo(t.produced, 'ammo', 20);
    bumpAmmo(t.delivered, 'ammo', 12);
    bumpAmmo(t.toLab, 'ammo', 8);
    // Research is not free: those eight rounds are exactly the shortfall the
    // player is looking at, and the card can now say so.
    expect(ammoTotal(t.toLab)).toBe(8);
    expect(ammoUndelivered(t)).toBe(8);
  });

  it('tracks the magazine buffer across the wave', () => {
    const t = emptyTally();
    t.magStart = 40;
    t.magEnd = 12;
    expect(t.magEnd - t.magStart, 'a wave that drained the guns reads negative').toBe(-28);
    expect(cloneTally(t).magStart).toBe(40);
  });
});

describe('build clock', () => {
  it('restarts whenever the build phase begins', () => {
    GameState.buildElapsed = 18;
    GameState.setPhase('wave');
    expect(GameState.buildElapsed).toBe(18); // untouched while fighting

    GameState.setPhase('build');
    expect(GameState.buildElapsed).toBe(0);
  });

  it('is zeroed by reset and by restoring a save', () => {
    GameState.buildElapsed = 30;
    GameState.reset();
    expect(GameState.buildElapsed).toBe(0);

    GameState.buildElapsed = 30;
    GameState.applySnapshot({ money: 10, lives: 3, wave: 4, speed: 1, auto: true });
    expect(GameState.buildElapsed).toBe(0);
  });
});
