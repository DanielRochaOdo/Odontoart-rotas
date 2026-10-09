type Entry = { value?: unknown; expiresAt: number; pending?: Promise<unknown> };

/** Session-only, bounded cache. Invalidated requests cannot repopulate the cache. */
export class QueryCache {
  private entries = new Map<string, Entry>();

  private maxEntries: number;
  private now: () => number;

  constructor(maxEntries = 24, now = Date.now) {
    this.maxEntries = maxEntries;
    this.now = now;
  }

  async get<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
    const existing = this.entries.get(key);
    if (existing?.pending) return existing.pending as Promise<T>;
    if (existing && existing.expiresAt > this.now()) return existing.value as T;
    const entry: Entry = { expiresAt: 0 };
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value!);
    }
    entry.pending = Promise.resolve().then(fetcher).then((value) => {
      if (this.entries.get(key) === entry) {
        entry.value = value;
        entry.expiresAt = this.now() + ttlMs;
        entry.pending = undefined;
      }
      return value;
    }, (error: unknown) => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      throw error;
    });
    return entry.pending as Promise<T>;
  }

  invalidate(matches: (key: string) => boolean = () => true) {
    for (const key of this.entries.keys()) if (matches(key)) this.entries.delete(key);
  }
}

export const dashboardQueryCache = new QueryCache();
