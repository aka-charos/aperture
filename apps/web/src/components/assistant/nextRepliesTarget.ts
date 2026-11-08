/**
 * Which answer gets suggested replies: the newest message, when it is an
 * answer that finished on its own. Not while one is being written, not after
 * Stop or an error (the server's latest answer would then be a cut-off one or
 * none), and not for a conversation loaded from history, whose runtime holds
 * no messages.
 *
 * Shaped after assistant-ui's thread messages, with only the fields read here.
 */
export interface ThreadMessageLike {
  id: string
  role: string
  status?: { type: string }
  content: ReadonlyArray<{ type: string; text?: string }>
}

export function nextRepliesTarget(messages: readonly ThreadMessageLike[], isRunning: boolean): string | null {
  if (isRunning) return null
  const last = messages[messages.length - 1]
  if (!last || last.role !== 'assistant' || last.status?.type !== 'complete') return null
  // An answer is prose or cards; an empty message (a failed turn) is neither.
  const answered = last.content.some(
    (part) => (part.type === 'text' && !!part.text?.trim()) || part.type === 'tool-call'
  )
  return answered ? last.id : null
}

/**
 * What the message box holds after a suggestion is tapped. An empty box, or
 * one still holding a suggestion as it was put there, takes the new one; a
 * draft the reader typed or edited is kept, with the suggestion added on a new
 * line, so a tap never throws away their words.
 */
export function draftWithReply(current: string, reply: string, suggestions: readonly string[]): string {
  const typed = current.trim()
  if (!typed || suggestions.includes(typed)) return reply
  return `${current.trimEnd()}\n${reply}`
}
