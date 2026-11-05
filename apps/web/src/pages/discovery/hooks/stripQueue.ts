/**
 * Loads rows that came into view, at most `concurrency` at a time. The queue owns
 * cancellation and de-duplication, for waiting and running rows alike: after a
 * reset, a row still running is aborted and can no longer touch the queue's count.
 */
export const STRIP_CONCURRENCY = 2

export interface StripQueue {
  enqueue: (key: string, canEnqueue: () => boolean) => void
  reset: () => void
}

export function createStripQueue(
  process: (key: string, signal: AbortSignal) => Promise<void>,
  concurrency = STRIP_CONCURRENCY
): StripQueue {
  let generation = 0
  let active = 0
  let waiting: string[] = []
  const keys = new Set<string>()
  const controllers = new Set<AbortController>()

  const drain = () => {
    while (active < concurrency && waiting.length > 0) {
      const key = waiting.shift() as string
      const started = generation
      const controller = new AbortController()
      controllers.add(controller)
      active++
      void Promise.resolve()
        .then(() => process(key, controller.signal))
        .catch(() => {
          // The row shows its own error. The others keep loading.
        })
        .finally(() => {
          if (started !== generation) return
          active--
          keys.delete(key)
          controllers.delete(controller)
          drain()
        })
    }
  }

  return {
    enqueue(key, canEnqueue) {
      if (keys.has(key) || !canEnqueue()) return
      keys.add(key)
      waiting.push(key)
      drain()
    },
    reset() {
      generation++
      for (const controller of controllers) controller.abort()
      controllers.clear()
      keys.clear()
      waiting = []
      active = 0
    },
  }
}
