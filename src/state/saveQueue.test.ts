import { describe, expect, it, vi } from 'vitest';
import { LatestSaveQueue, SaveWriter } from './saveQueue';

interface TestSave {
  savedAt: number;
  value: string;
}

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (reason?: unknown) => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('LatestSaveQueue', () => {
  it('keeps only one write in flight even when the later response resolves first', async () => {
    const first = deferred();
    const second = deferred();
    const gates = [first, second];
    let writesStarted = 0;
    const writer = vi.fn<SaveWriter<TestSave>>(() => gates[writesStarted++]!.promise);
    const queue = new LatestSaveQueue(writer);

    queue.request({ savedAt: 1, value: 'first' });
    queue.request({ savedAt: 2, value: 'second' });

    // Resolve the newer request's gate first: it must not exist as a write yet.
    second.resolve();
    await flushMicrotasks();
    expect(writer).toHaveBeenCalledTimes(1);

    first.resolve();
    await flushMicrotasks();
    expect(writer).toHaveBeenCalledTimes(2);
  });

  it('coalesces a burst behind one write into exactly the newest payload', async () => {
    const first = deferred();
    const second = deferred();
    const gates = [first, second];
    let writesStarted = 0;
    const writer = vi.fn<SaveWriter<TestSave>>(() => gates[writesStarted++]!.promise);
    const queue = new LatestSaveQueue(writer);

    queue.request({ savedAt: 10, value: 'in flight' });
    for (let i = 11; i <= 20; i += 1) queue.request({ savedAt: i, value: `burst ${i}` });
    expect(writer).toHaveBeenCalledTimes(1);

    first.resolve();
    await flushMicrotasks();
    expect(writer).toHaveBeenCalledTimes(2);
    expect(writer).toHaveBeenLastCalledWith({ savedAt: 20, value: 'burst 20' });

    second.resolve();
    await flushMicrotasks();
    expect(writer).toHaveBeenCalledTimes(2);
  });

  it('never writes an older savedAt after a newer save, even when newer resolves first', async () => {
    const older = deferred();
    const newer = deferred();
    const writer = vi.fn<SaveWriter<TestSave>>((save) => {
      if (save.savedAt === 100) return older.promise;
      if (save.savedAt === 300) return newer.promise;
      return Promise.resolve();
    });
    const queue = new LatestSaveQueue(writer);

    queue.request({ savedAt: 100, value: 'already in flight' });
    queue.request({ savedAt: 300, value: 'newest queued' });
    queue.request({ savedAt: 200, value: 'must not replace newest' });

    // Settle the newer response first, before its write is allowed to start.
    newer.resolve();
    await flushMicrotasks();
    expect(writer).toHaveBeenCalledTimes(1);

    older.resolve();
    await flushMicrotasks();
    queue.request({ savedAt: 250, value: 'stale after newer started' });
    await flushMicrotasks();

    expect(writer.mock.calls.map(([save]) => save.savedAt)).toEqual([100, 300]);
  });

  it('continues with the newest queued save after a rejected write', async () => {
    const first = deferred();
    const second = deferred();
    const gates = [first, second];
    let writesStarted = 0;
    const writer = vi.fn<SaveWriter<TestSave>>(() => gates[writesStarted++]!.promise);
    const queue = new LatestSaveQueue(writer);

    queue.request({ savedAt: 1, value: 'fails' });
    queue.request({ savedAt: 2, value: 'survives' });
    first.reject(new Error('offline'));
    await flushMicrotasks();

    expect(writer).toHaveBeenCalledTimes(2);
    expect(writer).toHaveBeenLastCalledWith({ savedAt: 2, value: 'survives' });
    second.resolve();
  });

  it('quietly drops saves when no writer is available', () => {
    const queue = new LatestSaveQueue<TestSave>(null);
    expect(() => queue.request({ savedAt: 1, value: 'local still works' })).not.toThrow();
  });
});
