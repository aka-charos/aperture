/**
 * Which conversations have a turn running right now.
 *
 * A discovery turn takes minutes, and the browser that started it is not the
 * only place it can be looked at. Switching conversations destroys the chat
 * runtime, so a reader who comes back mid-turn has nothing: the question is
 * stored (persistTurn writes it as the turn starts) but the answer does not
 * exist yet, and nothing on the page says one is coming or refreshes when it
 * lands. This is what lets the conversation say "still working" and poll.
 *
 * In memory, deliberately. It describes THIS process's work, so a restart
 * correctly forgets everything — a flag in the database would outlive the
 * request that set it and strand a conversation as permanently generating.
 * The staleness sweep covers the same hazard within one process: a turn whose
 * `finally` never ran (an uncatchable crash inside the stream) would otherwise
 * pin its conversation forever.
 */

/** Longer than any real turn; past this an entry is a leak, not work. */
const STALE_MS = 15 * 60 * 1000

const started = new Map<string, number>()

/**
 * How to end a running turn on purpose, and whose it is.
 *
 * Pressing Stop only made the browser stop listening: the request kept
 * running, its model calls and web searches were paid for, and the answer was
 * saved and reappeared on reload. Closing the tab or switching conversation
 * must NOT end a turn (that is what persisting from the request is for), so
 * the browser's abort cannot be the signal; an explicit stop is
 * (`POST /api/assistant/conversations/:id/stop`). One turn per conversation:
 * a newer turn replaces the older one's handle.
 */
const stoppers = new Map<string, { userId: string; controller: AbortController }>()

export function markTurnStarted(conversationId: string): void {
  if (conversationId) started.set(conversationId, Date.now())
}

export function markTurnFinished(conversationId: string): void {
  started.delete(conversationId)
}

/**
 * Register the controller that ends this conversation's running turn. Returns
 * the release to call when the turn ends, which removes the handle only while
 * it is still this turn's (a newer turn may have replaced it).
 */
export function registerTurnStop(
  conversationId: string,
  userId: string,
  controller: AbortController
): () => void {
  const entry = { userId, controller }
  stoppers.set(conversationId, entry)
  return () => {
    if (stoppers.get(conversationId) === entry) stoppers.delete(conversationId)
  }
}

/**
 * End this conversation's running turn, if one is running and it belongs to
 * `userId`. False when there is nothing to stop, or it is someone else's: the
 * route answers those the same way, so a stop says nothing about other users.
 */
export function stopTurn(conversationId: string, userId: string): boolean {
  const entry = stoppers.get(conversationId)
  if (!entry || entry.userId !== userId) return false
  stoppers.delete(conversationId)
  entry.controller.abort()
  return true
}

/** Whether a turn is running for this conversation, forgetting stale entries. */
export function isTurnActive(conversationId: string): boolean {
  const at = started.get(conversationId)
  if (at == null) return false
  if (Date.now() - at > STALE_MS) {
    started.delete(conversationId)
    return false
  }
  return true
}
