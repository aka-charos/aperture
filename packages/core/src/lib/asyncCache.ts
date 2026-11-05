/**
 * A small process-local cache for something slow to read: entries live for a
 * fixed time, concurrent callers of one key share a single load, and a load that
 * fails or answers null or undefined is not kept, so the next caller asks again.
 *
 * A caller must put everything its answer depends on into the key. The cache
 * cannot see who is asking.
 */

export interface AsyncCacheOptions<T> {
  ttlMs: number
  maxEntries: number
  /**
   * Bound on the total weight held, for entries too unequal for `maxEntries`
   * alone. The newest entry is always kept, however heavy.
   */
  maxWeight?: number
  weigh?: (value: T) => number
}

interface Entry<T> {
  value: T
  expires: number
  weight: number
}

export class AsyncCache<T> {
  private readonly values = new Map<string, Entry<T>>()
  private readonly pending = new Map<string, Promise<T | null | undefined>>()
  private totalWeight = 0
  private sweep: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly options: AsyncCacheOptions<T>) {}

  get(key: string, load: () => Promise<T | null | undefined>): Promise<T | null | undefined> {
    const cached = this.values.get(key)
    if (cached && cached.expires > Date.now()) {
      // Map order is the eviction order: last read goes last.
      this.values.delete(key)
      this.values.set(key, cached)
      return Promise.resolve(cached.value)
    }
    if (cached) this.remove(key)

    const existing = this.pending.get(key)
    if (existing) return existing

    const promise = Promise.resolve()
      .then(load)
      .then((value) => {
        if (value != null && this.pending.get(key) === promise) this.store(key, value)
        return value
      })
      .finally(() => {
        if (this.pending.get(key) === promise) this.pending.delete(key)
      })
    this.pending.set(key, promise)
    return promise
  }

  /** Forgets everything; a load in flight still answers its callers but is not kept. */
  clear(): void {
    this.values.clear()
    this.pending.clear()
    this.totalWeight = 0
    if (this.sweep) clearTimeout(this.sweep)
    this.sweep = null
  }

  get size(): number {
    return this.values.size
  }

  private store(key: string, value: T): void {
    this.remove(key)
    const weight = this.options.weigh?.(value) ?? 0
    this.values.set(key, { value, expires: Date.now() + this.options.ttlMs, weight })
    this.totalWeight += weight

    const { maxEntries, maxWeight = Infinity } = this.options
    while (
      this.values.size > 1 &&
      (this.values.size > maxEntries || this.totalWeight > maxWeight)
    ) {
      this.remove(this.values.keys().next().value as string)
    }
    this.armSweep()
  }

  private remove(key: string): void {
    const entry = this.values.get(key)
    if (!entry) return
    this.values.delete(key)
    this.totalWeight -= entry.weight
  }

  /** Expired entries are released even if nobody reads this cache again. */
  private armSweep(): void {
    if (this.sweep) return
    this.sweep = setTimeout(() => {
      this.sweep = null
      const now = Date.now()
      for (const [key, entry] of this.values) {
        if (entry.expires <= now) this.remove(key)
      }
      if (this.values.size > 0) this.armSweep()
    }, this.options.ttlMs)
    this.sweep.unref?.()
  }
}

/** At most `max` of the wrapped calls run at once; the rest wait in order. */
export function concurrencyLimit(max: number) {
  let active = 0
  const waiting: Array<() => void> = []
  return async <T>(load: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve))
    else active++
    try {
      return await load()
    } finally {
      const next = waiting.shift()
      if (next) next()
      else active--
    }
  }
}
