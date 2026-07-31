import { describe, expect, it } from 'vitest';
import { UIScene } from './UIScene';

describe('UIScene description handoff', () => {
  it('does not write coach copy before the coach text exists', () => {
    const showDesc = (UIScene.prototype as unknown as { showDesc(text: string): void }).showDesc;

    expect(() => showDesc.call({ descText: undefined }, 'Build the line.')).not.toThrow();
  });
});
