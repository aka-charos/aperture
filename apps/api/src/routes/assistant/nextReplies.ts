/**
 * Suggested replies: up to three short messages the reader might send next,
 * shown under the latest answer. Tapping one puts it in the message box as a
 * draft; nothing is sent until the reader sends it.
 *
 * Written after the turn, by its own short call, never inside the chat turn:
 * a tool the chat model calls would spend a step of its budget and resend
 * every tool result (handlers/chat.ts MAX_STEPS), and a call inside the stream
 * would keep the turn "running" (and Stop on screen) after the answer had
 * finished. This reads only what the reader was shown — the question, the
 * answer's prose and the titles on its cards — so it costs the same however
 * many tool results the turn produced.
 *
 * The pure parts (prompt, cleaning, titles) are exported for the tests.
 */
import { generateShortText, getShortTextWriter, resolveEffectiveAiLanguage, buildAiLanguageInstruction } from '@aperture/core'
import { query } from '../../lib/db.js'

/** At most this many suggestions are shown. */
export const MAX_NEXT_REPLIES = 3
/** A suggestion longer than this is not a short reply; it is dropped. */
export const NEXT_REPLY_MAX_CHARS = 160
const QUESTION_CHARS = 1000
const ANSWER_CHARS = 3000
const TITLES_SHOWN = 12

export const NEXT_REPLIES_SYSTEM = [
  'You suggest what a person might type next in a chat with the assistant of their personal film and TV library.',
  'Given their last message and the assistant\'s answer, write up to three short messages THE PERSON could send next.',
  'Each one: specific to this exchange (name a title from the answer where it helps), different from the others, at most twelve words, written as the person speaking to the assistant.',
  'Only things the assistant can do: find, compare or narrow titles in their library, say more about a title, explain why something was suggested, look at what they watched or rated.',
  'Never repeat their last message. Never suggest approving, buying or downloading anything.',
  'Write one suggestion per line: no numbering, no quotation marks, no introduction, nothing else.',
].join('\n')

function clip(text: string, max: number): string {
  const trimmed = text.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed
}

/** The user prompt: what the reader asked and what they were shown. */
export function buildNextRepliesPrompt(input: {
  question: string
  answer: string
  titles: readonly string[]
  languageInstruction: string
}): string {
  const lines = [`Their last message:\n${clip(input.question, QUESTION_CHARS)}`]
  if (input.answer.trim()) lines.push(`The assistant's answer:\n${clip(input.answer, ANSWER_CHARS)}`)
  if (input.titles.length > 0) lines.push(`Titles shown on cards with the answer: ${input.titles.join('; ')}`)
  lines.push(input.languageInstruction)
  return lines.join('\n\n')
}

const LEAD = /^\s*(?:[-*•·]+|\d+[.)]|\(\d+\))\s*/
const QUOTES = /^["'“”‘’«»„]+|["'“”‘’«»„]+$/g

/** What the model wrote, as at most MAX_NEXT_REPLIES clean, distinct suggestions. */
export function parseNextReplies(text: string, question = ''): string[] {
  const seen = new Set<string>()
  const asked = question.trim().toLocaleLowerCase()
  if (asked) seen.add(asked)
  const out: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(LEAD, '').replace(QUOTES, '').trim()
    // An introduction ("Here are some ideas:") is not a reply.
    if (!line || line.endsWith(':') || line.length > NEXT_REPLY_MAX_CHARS) continue
    const key = line.toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(line)
    if (out.length === MAX_NEXT_REPLIES) break
  }
  return out
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function titlesOf(items: unknown, into: string[]) {
  if (!Array.isArray(items)) return
  for (const item of items) {
    if (isRecord(item) && typeof item.title === 'string' && item.title.trim()) into.push(item.title.trim())
  }
}

/** Titles on the answer's cards, in order, once each, from the stored tool results. */
export function cardTitles(toolInvocations: unknown): string[] {
  if (!Array.isArray(toolInvocations)) return []
  const found: string[] = []
  for (const call of toolInvocations) {
    const result = isRecord(call) ? call.result : undefined
    if (!isRecord(result)) continue
    titlesOf(result.items, found)
    if (Array.isArray(result.carousels)) {
      for (const carousel of result.carousels) if (isRecord(carousel)) titlesOf(carousel.items, found)
    }
    if (isRecord(result.item) && typeof result.item.title === 'string') found.push(result.item.title)
  }
  return [...new Set(found)].slice(0, TITLES_SHOWN)
}

interface LastMessageRow {
  role: string
  content: string | null
  tool_invocations: unknown
}

/**
 * Suggestions for the conversation's latest answer, or none: no answer yet,
 * the last message is the reader's (the turn is still running or failed), or
 * the model gave nothing usable. Throws only when the model call fails, so the
 * route can log it; the reader is shown nothing either way.
 */
export async function suggestNextReplies(conversationId: string, userId: string): Promise<string[]> {
  const rows = await query<LastMessageRow>(
    `SELECT role, content, tool_invocations
       FROM assistant_messages
      WHERE conversation_id = $1
      ORDER BY created_at DESC
      LIMIT 2`,
    [conversationId]
  )
  const [answer, question] = rows.rows
  if (answer?.role !== 'assistant' || question?.role !== 'user') return []
  const questionText = question.content ?? ''
  const titles = cardTitles(answer.tool_invocations)
  if (!questionText.trim() || (!answer.content?.trim() && titles.length === 0)) return []

  const language = buildAiLanguageInstruction(await resolveEffectiveAiLanguage(userId))
  const text = await generateShortText({
    purpose: 'assistant.nextReplies',
    system: NEXT_REPLIES_SYSTEM,
    prompt: buildNextRepliesPrompt({ question: questionText, answer: answer.content ?? '', titles, languageInstruction: language }),
    // A reader without a Text Generation model still has a chat model, and any prose model will do.
    writer: await getShortTextWriter({ fallbackToChat: true }),
    maxRetries: 1,
    // Cleaned before the emptiness check, so an answer with nothing usable is refused, not shown.
    clean: (raw) => parseNextReplies(raw, questionText).join('\n'),
  })
  return text.split('\n')
}
