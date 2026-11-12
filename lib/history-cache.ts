// Bounded process-local cache with coalescing. No stale-on-error fallback.
export class HistoryCache<T> {
  private values = new Map<string, { value: T; expires: number }>();
  private pending = new Map<string, Promise<T>>();
  constructor(private ttlMs: number, private capacity = 160) {}

  async get(key: string, load: () => Promise<T>, now = Date.now()): Promise<{ value: T; hit: boolean }> {
    const saved = this.values.get(key);
    if (saved && saved.expires > now) return { value: saved.value, hit: true };
    this.values.delete(key);
    const pending = this.pending.get(key);
    if (pending) return { value: await pending, hit: true };
    const request = Promise.resolve().then(load).then(value => {
      if (this.values.size >= this.capacity) this.values.delete(this.values.keys().next().value!);
      this.values.set(key, { value, expires: Date.now() + this.ttlMs });
      return value;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return { value: await request, hit: false };
  }
}

export class WindowLimit {
  private windows = new Map<string, { count: number; reset: number }>();
  constructor(private maximum: number, private windowMs: number, private capacity = 1024) {}
  take(key: string, now = Date.now()): number {
    let entry = this.windows.get(key);
    if (!entry || entry.reset <= now) {
      // Do not evict active buckets: a flood of new keys must not reset existing limits.
      if (this.windows.size >= this.capacity) {
        for (const [id, bucket] of this.windows) if (bucket.reset <= now) this.windows.delete(id);
        if (this.windows.size >= this.capacity) return Math.ceil(this.windowMs / 1000);
      }
      entry = { count: 0, reset: now + this.windowMs };
      this.windows.set(key, entry);
    }
    if (entry.count >= this.maximum) return Math.max(1, Math.ceil((entry.reset - now) / 1000));
    entry.count++;
    return 0;
  }
}
