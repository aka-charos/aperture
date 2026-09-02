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

export function markTurnStarted(conversationId: string): void {
  if (conversationId) started.set(conversationId, Date.now())
}

export function markTurnFinished(conversationId: string): void {
  started.delete(conversationId)
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
