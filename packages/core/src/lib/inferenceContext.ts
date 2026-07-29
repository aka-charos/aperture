/**
 * Ambient attribution for LLM calls.
 *
 * Usage is captured deep down, in the HTTP layer of the provider (see
 * ./openrouter-usage.ts), which knows the model and the token counts but has no
 * idea *why* the call happened. The caller knows why and nothing else. Threading
 * a "who asked" argument through every generateText/streamText site — and the
 * dozen core functions between them — would be a wide, invasive change for a
 * field only the dashboard reads.
 *
 * So attribution rides in an AsyncLocalStorage instead: whoever starts a unit of
 * work (a job run, a chat turn) wraps it once, and every call underneath inherits
 * the label. Nesting merges, so an outer `job:…` can be refined by an inner
 * feature without losing the job.
 *
 * Absent context is normal, not an error — an unwrapped call records with just
 * its role, which is still enough to bill it to an AI function.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

export interface InferenceContext {
  /**
   * Surface or job the work belongs to. Convention: `job:<job-name>` for
   * background work, dotted paths for request-driven work (`assistant.chat`).
   */
  feature?: string
  /** Assistant conversation id, so a chat's spend can be totalled per thread. */
  sessionId?: string
  /** Aperture user the work was done for. */
  userId?: string
}

const storage = new AsyncLocalStorage<InferenceContext>()

/**
 * Run `fn` with these labels attached to every LLM call it makes, directly or
 * indirectly. Merges with any enclosing context; the innermost value wins.
 *
 * `fn` may be sync or async — the return value is passed straight through. The
 * sync form matters: a caller that only *starts* the work inside the scope (a
 * stream whose execute callback runs synchronously, say) still tags everything
 * that callback goes on to await.
 */
export function withInferenceContext<T>(context: InferenceContext, fn: () => T): T {
  const parent = storage.getStore()
  return storage.run({ ...parent, ...context }, fn)
}

/** The labels in force right now, if any. */
export function getInferenceContext(): InferenceContext | undefined {
  return storage.getStore()
}
