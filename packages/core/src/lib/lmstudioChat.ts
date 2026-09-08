/**
 * LM Studio's native chat endpoint, for the one role that can use it.
 *
 * WHY A HAND-ROLLED CLIENT AT ALL. Everything else here speaks to models
 * through the AI SDK, and this deliberately does not, because `/api/v1/chat`
 * is not an OpenAI-shaped endpoint and no AI SDK provider can reach it. It
 * takes `{ model, input }` and answers with a stream of typed events.
 *
 * WHY IT IS WORTH THE EXCEPTION. The OpenAI-compatible surface is mandatory
 * for the assistant, which needs custom tools and assistant messages in the
 * request — LM Studio's own comparison marks both ❌ on this endpoint. Title
 * analysis needs neither: it is retrieval, then one prompt, then one answer.
 * So it is the only role that can pay this endpoint's price, and it is also the
 * role that gains most from it:
 *
 *  - `context_length` PER REQUEST. A JIT-loaded model runs at LM Studio's
 *    default context, and this prompt is the largest the app sends — measured
 *    at 69,000 characters, of which 64,000 is scraped source text. Too small a
 *    window truncates it silently, which is a correctness problem and not a
 *    performance one.
 *  - REASONING SEPARATED FROM THE ANSWER. `reasoning.delta` and `message.delta`
 *    are distinct events, so "the model is still thinking" and "the model is
 *    writing" stop being indistinguishable. On the OpenAI-compatible path a
 *    reasoning model that never finished thinking returns an empty `content`
 *    and looks exactly like one that said nothing — the failure this app hit
 *    on a 26B model and had to diagnose from LM Studio's own logs.
 *  - LOAD PROGRESS. `model_load.progress` turns a cold start from an
 *    unexplained silence into a number.
 *  - REAL STATS. `chat.end` reports `reasoning_output_tokens`,
 *    `tokens_per_second` and `time_to_first_token_seconds` — the figures that
 *    say whether a slow title was the prompt, the thinking or the hardware.
 *
 * Verified against lmstudio.ai/docs/developer/rest/streaming-events.
 */

import { createChildLogger } from './logger.js'

const logger = createChildLogger('lmstudio-chat')

const DEFAULT_LMSTUDIO_BASE_URL = 'http://localhost:1234/v1'

/**
 * No wall-clock cap here on purpose. A streamed response is self-policing: it
 * sends headers at once and chunks continuously, so a genuinely dead connection
 * shows up as a stalled read rather than as a slow one, and Node's own
 * `headersTimeout` never applies. The caller's signal is the way to stop it.
 */
function stripV1(url: string): string {
  const trimmed = url.replace(/\/+$/, '')
  return trimmed.toLowerCase().endsWith('/v1') ? trimmed.slice(0, -3) : trimmed
}

/** What `chat.end` reports about how the generation actually went. */
export interface LmStudioChatStats {
  inputTokens?: number
  totalOutputTokens?: number
  /**
   * Tokens spent thinking rather than answering. Billed from the SAME
   * allowance as the prose, which is why a reasoning model can exhaust a large
   * budget and emit nothing — the single most useful number on this object.
   */
  reasoningOutputTokens?: number
  tokensPerSecond?: number
  timeToFirstTokenSeconds?: number
}

/**
 * Progress callbacks. Every one is optional and none is required for
 * correctness — they exist so a long generation can say what it is doing
 * instead of sitting silent for forty minutes.
 */
export interface LmStudioChatProgress {
  /** 0..1 while a cold model is being read off disk. */
  onModelLoad?: (progress: number) => void
  /** 0..1 while the prompt is being processed, before any output. */
  onPromptProgress?: (progress: number) => void
  /** The model is thinking. Not part of the answer. */
  onReasoningDelta?: (delta: string) => void
  /** The model is writing the answer. */
  onMessageDelta?: (delta: string) => void
}

export interface LmStudioChatResult {
  /** The answer. Empty when the model spent everything on reasoning. */
  text: string
  /** The scratchpad, kept so an empty answer can be explained rather than guessed at. */
  reasoningText: string
  finishReason?: string
  modelInstanceId?: string
  responseId?: string
  stats?: LmStudioChatStats
}

export interface LmStudioChatOptions {
  model: string
  input: string
  baseUrl?: string
  apiKey?: string
  /**
   * The context window to run this request at. Sent only when set, so an
   * unspecified value leaves LM Studio's own default alone.
   */
  contextLength?: number
  signal?: AbortSignal
  progress?: LmStudioChatProgress
}

/** An error the server reported inside the stream, rather than as a status. */
export class LmStudioChatError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'LmStudioChatError'
  }
}

/** Read a 0..1 progress figure from an event that may spell it either way. */
function readProgress(event: Record<string, unknown>): number | undefined {
  const value = event.progress ?? event.percent
  return typeof value === 'number' ? value : undefined
}

function readStats(raw: unknown): LmStudioChatStats | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const s = raw as Record<string, unknown>
  const num = (v: unknown) => (typeof v === 'number' ? v : undefined)
  const stats: LmStudioChatStats = {
    inputTokens: num(s.input_tokens),
    totalOutputTokens: num(s.total_output_tokens),
    reasoningOutputTokens: num(s.reasoning_output_tokens),
    tokensPerSecond: num(s.tokens_per_second),
    timeToFirstTokenSeconds: num(s.time_to_first_token_seconds),
  }
  return Object.values(stats).some((v) => v != null) ? stats : undefined
}

/**
 * Pull text out of `chat.end`'s `output` array.
 *
 * Belt and braces alongside the deltas: the deltas are the live signal, and
 * this is the authoritative final copy. Taking the final copy when it exists
 * means a dropped delta cannot silently shorten an answer.
 */
function readFinalOutput(result: Record<string, unknown>): {
  text?: string
  reasoning?: string
} {
  const output = result.output
  if (!Array.isArray(output)) return {}

  const parts: string[] = []
  const reasoning: string[] = []
  for (const entry of output) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as { type?: string; content?: unknown }
    if (typeof e.content !== 'string') continue
    if (e.type === 'message') parts.push(e.content)
    else if (e.type === 'reasoning') reasoning.push(e.content)
  }

  return {
    ...(parts.length > 0 && { text: parts.join('') }),
    ...(reasoning.length > 0 && { reasoning: reasoning.join('') }),
  }
}

/**
 * Send one prompt and read the typed event stream back.
 *
 * Throws on transport failure, a non-2xx status, or an `error` event. Returns
 * whatever the model produced otherwise — including an empty `text`, which is a
 * real answer to record rather than an error, and which `reasoningText` and
 * `stats` are there to explain.
 */
export async function streamLmStudioChat(
  options: LmStudioChatOptions
): Promise<LmStudioChatResult> {
  const base = stripV1(options.baseUrl ?? DEFAULT_LMSTUDIO_BASE_URL)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  }
  if (options.apiKey) headers.Authorization = `Bearer ${options.apiKey}`

  const response = await fetch(`${base}/api/v1/chat?stream=true`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: options.model,
      input: options.input,
      stream: true,
      ...(options.contextLength != null && { context_length: options.contextLength }),
    }),
    ...(options.signal && { signal: options.signal }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new LmStudioChatError(
      `LM Studio answered HTTP ${response.status}${body ? ` — ${body.slice(0, 400)}` : ''}`,
      response.status
    )
  }
  if (!response.body) {
    throw new LmStudioChatError('LM Studio returned no response body')
  }

  const result: LmStudioChatResult = { text: '', reasoningText: '' }
  let streamedText = ''
  let streamedReasoning = ''

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const handle = (event: Record<string, unknown>): void => {
    const type = typeof event.type === 'string' ? event.type : ''

    switch (type) {
      case 'chat.start':
        if (typeof event.model_instance_id === 'string') {
          result.modelInstanceId = event.model_instance_id
        }
        break

      case 'model_load.progress': {
        const p = readProgress(event)
        if (p != null) options.progress?.onModelLoad?.(p)
        break
      }

      case 'prompt_processing.progress': {
        const p = readProgress(event)
        if (p != null) options.progress?.onPromptProgress?.(p)
        break
      }

      case 'reasoning.delta':
        if (typeof event.delta === 'string') {
          streamedReasoning += event.delta
          options.progress?.onReasoningDelta?.(event.delta)
        }
        break

      case 'message.delta':
        if (typeof event.delta === 'string') {
          streamedText += event.delta
          options.progress?.onMessageDelta?.(event.delta)
        }
        break

      case 'error': {
        const message =
          typeof event.message === 'string'
            ? event.message
            : typeof event.error === 'string'
              ? event.error
              : 'LM Studio reported an error mid-stream'
        throw new LmStudioChatError(message)
      }

      case 'chat.end': {
        // Two documented shapes. The newer one nests everything under `result`;
        // an older example puts `message`/`finish_reason`/`usage` at the top.
        // Both are read, because a server answering the older shape is not a
        // failure — it is an older LM Studio.
        const nested =
          event.result && typeof event.result === 'object'
            ? (event.result as Record<string, unknown>)
            : event

        if (typeof nested.model_instance_id === 'string') {
          result.modelInstanceId = nested.model_instance_id
        }
        if (typeof nested.response_id === 'string') result.responseId = nested.response_id
        if (typeof nested.finish_reason === 'string') result.finishReason = nested.finish_reason

        const stats = readStats(nested.stats) ?? readStats(nested.usage)
        if (stats) result.stats = stats

        const final = readFinalOutput(nested)
        if (final.text != null) result.text = final.text
        if (final.reasoning != null) result.reasoningText = final.reasoning

        // The older shape carries a plain message object instead of `output`.
        const message = nested.message
        if (result.text === '' && message && typeof message === 'object') {
          const content = (message as { content?: unknown }).content
          if (typeof content === 'string') result.text = content
        }
        break
      }

      default:
        break
    }
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // SSE frames are separated by a blank line. Anything after the last one
      // is a partial frame and stays in the buffer.
      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)

        for (const line of frame.split('\n')) {
          // `event:` lines are ignored deliberately: the payload carries its own
          // `type`, so reading both invites the two disagreeing.
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (data === '' || data === '[DONE]') continue
          try {
            handle(JSON.parse(data) as Record<string, unknown>)
          } catch (err) {
            if (err instanceof LmStudioChatError) throw err
            logger.debug({ err, data: data.slice(0, 200) }, 'Unparseable LM Studio event')
          }
        }

        boundary = buffer.indexOf('\n\n')
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
  }

  // The deltas are the fallback, not the source of truth — `chat.end` wins when
  // it carried anything, since a dropped delta would otherwise silently
  // truncate an answer that the server sent whole.
  if (result.text === '') result.text = streamedText
  if (result.reasoningText === '') result.reasoningText = streamedReasoning

  return result
}
