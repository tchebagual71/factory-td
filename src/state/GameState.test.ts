import { beforeEach, describe, expect, it } from 'vitest';
import { START_MONEY } from '../config';
import { emptyTally, GameState } from './GameState';

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

    GameState.tally.fired = 12;
    GameState.applySnapshot({ money: 10, lives: 3, wave: 4, speed: 2, auto: false });
    expect(GameState.tally).toEqual(emptyTally());
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
