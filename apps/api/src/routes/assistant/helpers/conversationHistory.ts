/**
 * Server-side conversation history for the chat handler.
 *
 * The chat endpoint is otherwise stateless — it builds the model context from
 * whatever the client replays. But the client's chat runtime is remounted (and
 * thus emptied) whenever a conversation is (re)loaded or first assigned an id,
 * so a follow-up would arrive with no prior turns: the assistant would both
 * "forget" and improvise a fresh answer. To make memory reliable we rebuild the
 * prior turns here from the persisted conversation (the source of truth) and the
 * caller prepends them to the newly-typed message.
 *
 * Discovery recommendations live ONLY inside the tool-result object and are
 * deliberately kept out of the assistant's prose, so we also fold a compact
 * digest of the shown titles into each assistant turn's text — otherwise the
 * model still could not name what it recommended on the previous turn.
 */
import type { UIMessage } from 'ai'
import { query, queryOne } from '../../../lib/db.js'
import type { MessageRow } from '../types.js'

/** Cap replayed turns so a very long conversation can't blow up the context. */
const MAX_HISTORY_MESSAGES = 40
/** Cap the per-turn title digest so a big list tool doesn't dominate the prompt. */
const MAX_TITLES_PER_TURN = 40

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Collect the display names of items a tool turn put on screen (carousel items
 * for every content tool; `picks` for discovery), so the model can reference
 * them by name on a later turn.
 */
function extractShownTitles(toolInvocations: unknown[]): string[] {
  const titles: string[] = []
  const push = (name: unknown, suffix?: string) => {
    if (typeof name !== 'string' || !name.trim()) return
    titles.push(suffix ? `${name} (${suffix})` : name)
  }

  for (const inv of toolInvocations) {
    const result = isRecord(inv) ? inv.result : undefined
    if (!isRecord(result)) continue

    const carousels = result.carousels
    if (Array.isArray(carousels)) {
      for (const carousel of carousels) {
        const items = isRecord(carousel) ? carousel.items : undefined
        if (!Array.isArray(items)) continue
        for (const item of items) {
          if (isRecord(item)) {
            push(item.name, typeof item.subtitle === 'string' ? item.subtitle : undefined)
          }
        }
      }
    }

    const picks = result.picks
    if (Array.isArray(picks)) {
      for (const pick of picks) {
        if (isRecord(pick)) {
          push(pick.title, typeof pick.year === 'number' ? String(pick.year) : undefined)
        }
      }
    }
  }

  return [...new Set(titles)].slice(0, MAX_TITLES_PER_TURN)
}

/** Persisted row → a text-only UIMessage the model can read back. */
function rowToUIMessage(row: MessageRow): UIMessage {
  const role: 'user' | 'assistant' = row.role === 'assistant' ? 'assistant' : 'user'
  let text = row.content ?? ''

  if (role === 'assistant' && Array.isArray(row.tool_invocations) && row.tool_invocations.length > 0) {
    const titles = extractShownTitles(row.tool_invocations)
    if (titles.length > 0) {
      const digest = `[Items shown to the user in this turn: ${titles.join(', ')}]`
      text = text.trim() ? `${text}\n\n${digest}` : digest
    }
  }

  return {
    id: row.id,
    role,
    parts: [{ type: 'text', text }],
  }
}

/**
 * Load a conversation's prior turns as model-ready UIMessages, scoped to the
 * owning user. Returns [] when the conversation is missing/foreign/empty (the
 * caller then falls back to the client-supplied messages).
 */
export async function loadConversationHistory(
  conversationId: string,
  userId: string
): Promise<UIMessage[]> {
  const owned = await queryOne<{ id: string }>(
    `SELECT id FROM assistant_conversations WHERE id = $1 AND user_id = $2`,
    [conversationId, userId]
  )
  if (!owned) return []

  const result = await query<MessageRow>(
    `SELECT id, role, content, tool_invocations, created_at
     FROM assistant_messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC`,
    [conversationId]
  )

  return result.rows.slice(-MAX_HISTORY_MESSAGES).map(rowToUIMessage)
}
