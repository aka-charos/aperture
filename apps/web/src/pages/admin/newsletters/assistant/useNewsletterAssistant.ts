import { useCallback, useEffect, useRef, useState } from 'react'
import { DefaultChatTransport, readUIMessageStream, type UIMessage, type UIMessageChunk } from 'ai'

import type { AssistantDraft } from './assistantParts'

const ENDPOINT = '/api/newsletters/assistant'

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** A refused request's own sentence: the transport throws the response body as text. */
function requestFailure(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  try {
    const parsed = JSON.parse(raw) as { error?: unknown }
    if (typeof parsed.error === 'string') return parsed.error
  } catch {
    // Not JSON: the text is the message.
  }
  return raw
}

/**
 * The newsletter writing assistant's conversation, held in the page.
 *
 * Nothing is stored server-side: the whole conversation goes up with each turn
 * (the server keeps the latest messages), together with the newsletter as the
 * editor holds it right now, so the assistant reads unsaved edits. Closing the
 * page ends the conversation; Stop ends the turn (the server's model call
 * stops with it).
 *
 * Status phases arrive as transient `data-status` chunks and coded failures as
 * `error` chunks; both are taken off the stream here, so the message only ever
 * holds what the assistant said and the tools it used.
 */
export function useNewsletterAssistant(getDraft: () => AssistantDraft) {
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [running, setRunning] = useState(false)
  const [phase, setPhase] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const messagesRef = useRef<UIMessage[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const draftRef = useRef(getDraft)
  draftRef.current = getDraft

  // Leaving the editor ends a turn still running.
  useEffect(() => () => abortRef.current?.abort(), [])

  const publish = (next: UIMessage[]) => {
    messagesRef.current = next
    setMessages(next)
  }

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || abortRef.current) return
    const history: UIMessage[] = [
      ...messagesRef.current,
      { id: newId(), role: 'user', parts: [{ type: 'text', text: trimmed }] },
    ]
    publish(history)
    setError(null)
    setRunning(true)
    setPhase('preparing')
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const transport = new DefaultChatTransport<UIMessage>({
        api: ENDPOINT,
        credentials: 'include',
        prepareSendMessagesRequest: ({ messages: outgoing }) => ({
          body: { messages: outgoing, draft: draftRef.current() },
        }),
      })
      const stream = await transport.sendMessages({
        chatId: 'newsletter-assistant',
        messages: history,
        abortSignal: controller.signal,
        trigger: 'submit-message',
        messageId: undefined,
      })
      const watched = stream.pipeThrough(
        new TransformStream<UIMessageChunk, UIMessageChunk>({
          transform(chunk, out) {
            if (chunk.type === 'data-status') {
              const data = (chunk as { data?: { phase?: unknown } }).data
              if (typeof data?.phase === 'string') setPhase(data.phase)
              return
            }
            if (chunk.type === 'error') {
              setError(chunk.errorText)
              return
            }
            out.enqueue(chunk)
          },
        })
      )
      const reply: UIMessage = { id: newId(), role: 'assistant', parts: [] }
      for await (const message of readUIMessageStream({ stream: watched, message: reply })) {
        // A conversation cleared mid-turn must not get this answer back.
        if (controller.signal.aborted) break
        publish([...history, message])
      }
    } catch (err) {
      if (!controller.signal.aborted) setError(requestFailure(err))
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
        setRunning(false)
        setPhase(null)
      }
    }
  }, [])

  const stop = useCallback(() => abortRef.current?.abort(), [])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    publish([])
    setError(null)
    setRunning(false)
    setPhase(null)
  }, [])

  return { messages, running, phase, error, send, stop, reset }
}
