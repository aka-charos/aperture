/**
 * Writing a finished turn to the conversation.
 *
 * This used to be the browser's job: the chat surface subscribed to the thread
 * runtime, waited for `isRunning` to go false, and then POSTed the user message
 * and the assistant message together in one batch. Nothing was written before
 * that, so leaving the conversation mid-turn discarded the whole batch — the
 * question included — and the chat came back EMPTY while the server had
 * finished the answer and thrown it away. On a three-minute discovery turn that
 * is not an edge case.
 *
 * So the server writes its own turn, from inside the request that produced it.
 * It does not care whether anyone is still listening.
 */
import { query, queryOne } from '../../../lib/db.js'

/** One part of an answer, in the order it was produced (migration 0158). */
export type TurnPart =
  | { type: 'text'; text: string }
  | { type: 'tool'; toolCallId: string; toolName: string; args: unknown; result: unknown }

/** Title shown until the first user message renames the conversation. */
const DEFAULT_TITLE = 'New Chat'
const TITLE_MAX = 50

/**
 * Store one completed exchange. Never throws: an answer that reached the reader
 * must not be turned into a failed request by a bookkeeping problem, and the
 * caller is a live stream.
 */
export async function persistTurn(opts: {
  conversationId: string
  userId: string
  userText: string
  parts: TurnPart[]
  log: { warn(obj: object, msg?: string): void }
}): Promise<void> {
  const { conversationId, userId, userText, parts, log } = opts
  try {
    // Ownership is checked here rather than trusted from the request, because
    // the conversation id arrives as a header.
    const owned = await queryOne<{ id: string }>(
      `SELECT id FROM assistant_conversations WHERE id = $1 AND user_id = $2`,
      [conversationId, userId]
    )
    if (!owned) {
      log.warn({ conversationId }, 'Not saving turn: conversation is not this user\'s')
      return
    }

    if (userText.trim()) {
      await query(
        `INSERT INTO assistant_messages (conversation_id, role, content) VALUES ($1, 'user', $2)`,
        [conversationId, userText]
      )
    }

    // The flat pair stays authoritative for everything that reads a message as
    // text — the model's own history, the suggestion refresh — and `parts`
    // carries the order the two renderers need. See 0158.
    const textParts = parts.filter((p): p is Extract<TurnPart, { type: 'text' }> => p.type === 'text')
    const toolParts = parts.filter((p): p is Extract<TurnPart, { type: 'tool' }> => p.type === 'tool')
    if (parts.length > 0) {
      await query(
        `INSERT INTO assistant_messages (conversation_id, role, content, tool_invocations, parts)
         VALUES ($1, 'assistant', $2, $3, $4)`,
        [
          conversationId,
          textParts.map((p) => p.text).join('\n\n'),
          toolParts.length > 0
            ? JSON.stringify(
                toolParts.map(({ toolCallId, toolName, args, result }) => ({
                  toolCallId,
                  toolName,
                  args,
                  result,
                }))
              )
            : null,
          JSON.stringify(parts),
        ]
      )
    }

    const existing = await queryOne<{ title: string }>(
      `SELECT title FROM assistant_conversations WHERE id = $1`,
      [conversationId]
    )
    if (existing?.title === DEFAULT_TITLE && userText.trim()) {
      const title =
        userText.length > TITLE_MAX ? `${userText.substring(0, TITLE_MAX)}...` : userText
      await query(`UPDATE assistant_conversations SET title = $1, updated_at = NOW() WHERE id = $2`, [
        title,
        conversationId,
      ])
    } else {
      await query(`UPDATE assistant_conversations SET updated_at = NOW() WHERE id = $1`, [
        conversationId,
      ])
    }
  } catch (err) {
    log.warn({ err, conversationId }, 'Failed to save turn')
  }
}
