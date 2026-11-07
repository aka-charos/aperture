/**
 * Tell the server to end the turn running in this conversation.
 *
 * The composer's Stop only aborts the browser's request, and the server keeps
 * a turn running when its request goes away on purpose: leaving the
 * conversation or the tab must not lose an answer. So Stop says it in words
 * too (`POST /api/assistant/conversations/:id/stop`), which ends the model
 * calls and saves what was written so far. Fire and forget: a turn that has
 * already finished answers `{ stopped: false }`, and a failed call leaves the
 * old behaviour (the turn finishes and is saved).
 */
export function requestTurnStop(conversationId: string | null | undefined): void {
  if (!conversationId) return
  void fetch(`/api/assistant/conversations/${encodeURIComponent(conversationId)}/stop`, {
    method: 'POST',
    credentials: 'include',
  }).catch(() => {})
}
