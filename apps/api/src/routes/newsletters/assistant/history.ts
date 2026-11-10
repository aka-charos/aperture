/**
 * How much of the conversation the model is sent. Pure.
 *
 * Only the latest messages go up: older card lists are dead weight on every
 * turn. But a cut by count can land on an assistant message (every request
 * ends with the new question, so an odd-length history cut to an even number
 * starts on an answer), and Anthropic and Gemini refuse a conversation that
 * does not open with the user. So the cut moves forward to the first user
 * message in what it kept.
 */
export const NEWSLETTER_HISTORY_MESSAGES = 24

export function recentHistory<M extends { role: string }>(
  messages: readonly M[],
  max: number = NEWSLETTER_HISTORY_MESSAGES
): M[] {
  const kept = messages.slice(-max)
  const firstQuestion = kept.findIndex((message) => message.role === 'user')
  // No question at all leaves nothing worth sending; the caller's request is malformed.
  return firstQuestion < 0 ? [] : kept.slice(firstQuestion)
}
