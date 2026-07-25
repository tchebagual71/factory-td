import { beforeEach, describe, expect, it } from 'vitest';
import { START_MONEY } from '../config';
import { ammoDeficits, ammoTotal, bumpAmmo, cloneTally, emptyTally, GameState } from './GameState';

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
    bumpAmmo(t.produced, 'ammo', 10);
    // one chiller turns 1 ore into 2 coolant, so this line looks generous
    bumpAmmo(t.fired, 'coolant', 8);
    bumpAmmo(t.produced, 'coolant', 60);

    // the grand total says the factory kept up — it did not
    expect(ammoTotal(t.produced)).toBeGreaterThan(ammoTotal(t.fired));
    expect(ammoDeficits(t)).toEqual([{ type: 'ammo', short: 30 }]);
  });

  it('reports the worst shortfall first so the player knows which line to widen', () => {
    const t = emptyTally();
    bumpAmmo(t.fired, 'ammo', 20);
    bumpAmmo(t.fired, 'shell', 30);
    bumpAmmo(t.produced, 'shell', 5);
    expect(ammoDeficits(t).map((d) => d.type)).toEqual(['shell', 'ammo']);
  });

  it('reports nothing when every line kept up', () => {
    const t = emptyTally();
    bumpAmmo(t.fired, 'piercing', 6);
    bumpAmmo(t.produced, 'piercing', 6);
    expect(ammoDeficits(t)).toEqual([]);
  });

  it('cloneTally deep-copies, so the card cannot keep counting after the wave ends', () => {
    const t = emptyTally();
    bumpAmmo(t.fired, 'ammo', 3);
    const snap = cloneTally(t);
    bumpAmmo(t.fired, 'ammo', 99);
    expect(snap.fired.ammo).toBe(3);
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
