/**
 * Run an async function over items with a bounded number in flight.
 * Results keep the input order. After the first rejection no further item is started; the
 * calls already in flight are awaited, then that first error is thrown. Callers that must not
 * fail should catch inside fn.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  let failed = false
  let firstError: unknown

  async function worker(): Promise<void> {
    while (!failed && next < items.length) {
      const index = next++
      try {
        results[index] = await fn(items[index], index)
      } catch (err) {
        if (!failed) {
          failed = true
          firstError = err
        }
      }
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker)
  await Promise.all(workers)
  if (failed) throw firstError
  return results
}
