export interface TimestampedSave {
  savedAt: number;
}

export type SaveWriter<T> = (save: T) => Promise<void>;

/**
 * Cloud saves only mirror the local primary store, so requests never wait for
 * the network. One writer runs at a time and a pending slot keeps only the
 * highest timestamp; this removes the overlap that lets an old response land
 * last without turning offline failures into retries or gameplay errors.
 */
export class LatestSaveQueue<T extends TimestampedSave> {
  private inFlight = false;
  private queued: T | null = null;
  private newestStartedAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly writer: SaveWriter<T> | null | undefined) {}

  request(save: T): void {
    if (!this.writer) return;

    // A timestamp older than a write already handed to the network is stale,
    // even if it was requested later by a delayed caller.
    if (save.savedAt < this.newestStartedAt) return;

    if (this.inFlight) {
      // Equal millisecond timestamps are replaced too: request order is the
      // only remaining way to identify the later capture.
      if (!this.queued || save.savedAt >= this.queued.savedAt) this.queued = save;
      return;
    }

    this.start(save);
  }

  private start(save: T): void {
    if (!this.writer || save.savedAt < this.newestStartedAt) return;
    this.inFlight = true;
    this.newestStartedAt = save.savedAt;
    void this.settle(save);
  }

  private async settle(save: T): Promise<void> {
    try {
      await this.writer!(save);
    } catch {
      // Cloud is best-effort; failure drops this write and never starts a retry loop.
    } finally {
      this.inFlight = false;
      const next = this.queued;
      this.queued = null;
      if (next) this.start(next);
    }
  }
}
