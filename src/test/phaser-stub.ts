// Test-time stand-in for the 'phaser' module (aliased in vitest.config.ts).
// Game modules import Phaser for types and for calls on scene objects the
// tests inject as mocks, so almost nothing real is needed here. The exceptions
// are the pure utilities that actually execute inside the systems under test:
// the GameState event emitter and the Phaser.Math helpers.

type Handler = (...args: unknown[]) => void;

class EventEmitter {
  private handlers = new Map<string, Handler[]>();

  on(event: string, fn: Handler): this {
    const list = this.handlers.get(event) ?? [];
    list.push(fn);
    this.handlers.set(event, list);
    return this;
  }

  once(event: string, fn: Handler): this {
    const wrapped: Handler = (...args) => {
      this.off(event, wrapped);
      fn(...args);
    };
    return this.on(event, wrapped);
  }

  off(event: string, fn?: Handler): this {
    if (!fn) this.handlers.delete(event);
    else this.handlers.set(event, (this.handlers.get(event) ?? []).filter((h) => h !== fn));
    return this;
  }

  removeAllListeners(): this {
    this.handlers.clear();
    return this;
  }

  emit(event: string, ...args: unknown[]): boolean {
    const list = this.handlers.get(event);
    for (const fn of [...(list ?? [])]) fn(...args);
    return !!list?.length;
  }
}

const MathStub = {
  Clamp: (v: number, min: number, max: number) => Math.min(Math.max(v, min), max),
  Distance: {
    Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
  },
};

export default { Events: { EventEmitter }, Math: MathStub };
export { EventEmitter };
