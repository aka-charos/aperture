/**
 * Chat streaming handler with AI SDK v5 + Tool UI
 * https://www.tool-ui.com/docs/quick-start
 *
 * Uses a custom stream transformer to buffer tool calls until complete,
 * avoiding issues with @assistant-ui/react expecting tool args to stream in order.
 * See: https://www.aha.io/engineering/articles/streaming-ai-responses-incomplete-json
 */
import { Readable } from 'node:stream'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import {
  streamText,
  convertToModelMessages,
  stepCountIs,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
  type ToolSet,
} from 'ai'
import { getChatModelInstance, getEmbeddingModelInstance, getActiveEmbeddingModelId, withInferenceContext } from '@aperture/core'
import { requireAuth, type SessionUser } from '../../../plugins/auth.js'
import { getMediaServerInfo, buildSystemPrompt, applyN8nPreProcess, classifyIntent, latestUserText, assistantErrorText, loadConversationHistory, withUnwatchedFilter, createStatusEmitter, withStatusEvents, withRequestContext } from '../helpers/index.js'
import { createTools, createN8nTools, createEpisodeTools, createDiscoveryResolveTool, DISCOVERY_PROMPT } from '../tools/index.js'
import { withToolErrorHandling } from '../tools/utils.js'
import type { ToolContext } from '../types.js'

interface ChatBody {
  messages: UIMessage[]
}

/**
 * Model round trips per turn — a step is one generation plus any tools it calls,
 * NOT one tool call (a step can call several in parallel).
 *
 * The loop only consults `stopWhen` after a step that called tools, so the last
 * step's results are fetched and then never sent back to the model: nothing is
 * left to read them. A turn that spent every step searching therefore ended with
 * no prose at all — the user saw five "No results found" strips and nothing else,
 * because tool results stream to the client independently of the model composing
 * an answer from them.
 *
 * `prepareStep` closes that hole by taking the tools away on the final step, so
 * the model has to write. Note this costs no retrieval: results from the last
 * step could never reach the model anyway, so the effective tool budget was
 * always MAX_STEPS - 1 and this only repurposes a step that was already dead.
 */
const MAX_STEPS = 5

/**
 * Creates a TransformStream that transforms tool-input streaming events
 * into a single complete event. This fixes compatibility issues with
 * @assistant-ui/react which expects tool args to be appended in order.
 *
 * Some models (like GPT-4.1-mini) stream JSON properties in different orders,
 * breaking the "append only" assumption in assistant-ui.
 *
 * Strategy:
 * - Skip tool-input-start (we'll emit tool-input-available instead)
 * - Skip tool-input-delta (causes the argsText error)
 * - Keep tool-input-available (has complete args, frontend needs this)
 * - Keep tool-output-available (has results)
 */
function createToolBufferingStream(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()

  // Buffer for accumulating SSE data
  let buffer = ''

  return new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true })

      // Process complete SSE events (end with \n\n)
      const events = buffer.split('\n\n')
      // Keep the last incomplete event in the buffer
      buffer = events.pop() || ''

      for (const event of events) {
        if (!event.trim()) continue

        // Parse SSE event to get data
        const lines = event.split('\n')
        let eventData = ''

        for (const line of lines) {
          if (line.startsWith('data:')) {
            eventData = line.slice(5).trim()
          }
        }

        // Parse JSON data to check the type field
        let dataType = ''
        try {
          const parsed = JSON.parse(eventData)
          dataType = parsed.type || ''
        } catch {
          // If we can't parse, pass through
        }

        // Filter out ONLY the streaming delta events
        // - tool-input-start: SKIP (we'll use tool-input-available instead)
        // - tool-input-delta: SKIP (causes the argsText append error)
        // - tool-input-available: KEEP (has complete args, needed by frontend)
        // - tool-output-available: KEEP (has results)
        if (dataType === 'tool-input-start' || dataType === 'tool-input-delta') {
          continue // Skip streaming events
        }

        // Emit the event
        controller.enqueue(encoder.encode(event + '\n\n'))
      }
    },
    flush(controller) {
      // Emit any remaining buffered data
      if (buffer.trim()) {
        controller.enqueue(encoder.encode(buffer))
      }
    },
  })
}

/**
 * Cards in a tool result — `{ items }` plus every `{ carousels: [{ items }] }`,
 * the two shapes the content tools return (see helpers/unwatched.ts, which
 * walks the same containers to filter them).
 *
 * Deliberately shape-tolerant rather than typed against the tool results: this
 * exists only to make a log line legible, and a tool whose payload it does not
 * recognise must log a 0, never throw inside onStepFinish.
 */
function countCards(value: unknown): number {
  if (typeof value !== 'object' || value === null) return 0
  const record = value as Record<string, unknown>
  let count = Array.isArray(record.items) ? record.items.length : 0
  if (Array.isArray(record.carousels)) {
    for (const carousel of record.carousels) {
      if (typeof carousel !== 'object' || carousel === null) continue
      const items = (carousel as Record<string, unknown>).items
      if (Array.isArray(items)) count += items.length
    }
  }
  return count
}

/** `"getWatchHistory:30"` — the one line that explains a wall of posters. */
function describeToolResult(result: { toolName: string; output?: unknown }): string {
  return `${result.toolName}:${countCards(result.output)}`
}

export function registerChatHandler(fastify: FastifyInstance) {
  fastify.post<{ Body: ChatBody }>(
    '/api/assistant/chat',
    { preHandler: requireAuth, schema: { tags: ["ai-assistant"] } },
    async (request: FastifyRequest<{ Body: ChatBody }>, reply: FastifyReply) => {
      const user = request.user as SessionUser
      const { messages } = request.body

      if (!messages || !Array.isArray(messages)) {
        return reply.status(400).send({ error: 'Messages array is required' })
      }

      try {
        const chatModel = await getChatModelInstance()
        const embeddingModel = await getEmbeddingModelInstance()
        const embeddingModelId = await getActiveEmbeddingModelId()
        const mediaServer = await getMediaServerInfo()
        // Composer toggle: only suggest titles the user hasn't watched. Enforced
        // on tool output (see withUnwatchedFilter) so it holds regardless of
        // whether the model honours the instruction.
        const excludeWatched = request.headers['x-exclude-watched'] === 'true'

        if (!embeddingModelId) {
          return reply.status(500).send({ error: 'Embedding model not configured' })
        }

        const conversationId =
          typeof request.headers['x-conversation-id'] === 'string'
            ? request.headers['x-conversation-id'].trim()
            : ''

        // onError replaces the SDK's masked "An error occurred" with a stable
        // AI_ERROR:<code>:<detail> string the frontend maps to localized copy.
        // Needed in BOTH places below: this one covers everything execute does,
        // the one on toUIMessageStream covers mid-stream model/provider failures.
        const onStreamError = (error: unknown) => {
          fastify.log.error({ err: error }, 'Assistant stream error')
          return assistantErrorText(error)
        }

        // Bill every model this turn runs to the conversation, for the AI spend
        // dashboard. A chat turn is the one place where several models fire for a
        // single user action (intent routing, tools, discovery, the completion),
        // so the conversation total is the only meaningful per-turn cost.
        // createUIMessageStream invokes `execute` synchronously, so this scope
        // covers all of it — see core lib/inferenceContext.ts.
        const inferenceContext = {
          feature: 'assistant.chat',
          sessionId: conversationId || undefined,
          userId: user.id,
        }

        // Everything slow runs INSIDE execute, on an already-open stream, so each
        // phase can report itself to the UI (transient `data-status` parts) rather
        // than the user watching one static "Thinking…" through prompt building,
        // intent routing and the whole discovery pipeline.
        //
        // Error behaviour is unchanged in kind: the SDK catches a rejected execute
        // and enqueues `{ type: 'error', errorText: onError(err) }` — exactly the
        // `start` + `error` pair the pre-stream failure path (see the catch below)
        // builds by hand. So a failure while building the prompt or routing intent
        // still reaches the client as a coded, localizable string.
        const stream = withInferenceContext(inferenceContext, () =>
          createUIMessageStream({
          onError: onStreamError,
          execute: async ({ writer }) => {
            // Creates the assistant message client-side; must precede any part.
            writer.write({ type: 'start' })
            const emit = createStatusEmitter(writer)

            emit('preparing')
            const systemPrompt = await buildSystemPrompt(
              user.id,
              user.isAdmin,
              mediaServer?.name,
              excludeWatched
            )

            // Create tool context
            const toolContext: ToolContext = {
              userId: user.id,
              isAdmin: user.isAdmin,
              embeddingModel,
              embeddingModelId, // Format: "provider:model" (e.g., "openai:text-embedding-3-large")
              mediaServer,
              excludeWatched,
              // Only the discovery tool reads this: it hides nine sequential
              // stages behind one tool call, so the per-tool wrapper below would
              // otherwise go quiet for the longest stretch of the turn.
              onStatus: emit,
            }

            // Rebuild prior turns from the persisted conversation (the source of
            // truth). The client's chat runtime is remounted — and emptied — whenever
            // a conversation is (re)loaded or first assigned an id, so a follow-up
            // would otherwise arrive with no history and the assistant would both
            // forget and improvise a fresh, unrelated answer. The conversation id is
            // sent as a header; history is scoped to this user. Falls back to the
            // client-sent messages when there's no id / no stored history.
            let baseMessages: UIMessage[] = messages
            if (conversationId) {
              try {
                const history = await loadConversationHistory(conversationId, user.id)
                if (history.length > 0) {
                  // DB history is authoritative for prior turns; append only the newly
                  // typed message (the client's last) to avoid double-counting the
                  // turns it still holds in a continuous, un-remounted session.
                  const lastClientMessage = messages[messages.length - 1]
                  baseMessages = lastClientMessage ? [...history, lastClientMessage] : history
                }
              } catch (err) {
                fastify.log.warn(
                  { err, conversationId },
                  'Failed to load conversation history; using client messages as-is'
                )
              }
            }

            // Optional n8n pre-processing hook (fails open if n8n is unreachable)
            const { messages: processedMessages, systemAppend } = await applyN8nPreProcess(
              baseMessages,
              { id: user.id, isAdmin: user.isAdmin }
            )

            // Route intent: 'discovery' adds the findCandidatesInLibrary tool, which
            // gathers web-sourced candidates itself (inside its execute, on the Web
            // Search role) so the assistant can stream its opening line before that
            // slow work runs; 'library' (the default) leaves the assistant untouched.
            // Fails open to library.
            let discoveryTools: ToolSet = {}
            let discoveryAppend = ''
            emit('understanding')
            const intent = await classifyIntent(processedMessages)
            request.log.info({ intent }, 'Assistant intent classified')
            // What the user actually typed this turn. Drives the discovery search,
            // and is stamped onto every card list so the UI can act on the request
            // later (naming a playlist after it) without re-reading the thread.
            const userRequest = latestUserText(processedMessages)
            if (intent === 'discovery') {
              discoveryTools = createDiscoveryResolveTool(toolContext, userRequest)
              discoveryAppend = DISCOVERY_PROMPT
            }

            // Create tools with context, plus n8n search_web + discovery (when routed)
            //
            // Both async spreads decide for themselves whether they have
            // anything to contribute — searchEpisodes returns {} when episode
            // embeddings are switched off, so the model is never handed a tool
            // whose table is empty.
            const baseTools = {
              ...createTools(toolContext),
              ...(await createEpisodeTools(toolContext)),
              ...(await createN8nTools()),
            }
            // On discovery turns, drop only the tools that directly duplicate what the
            // discovery tool already produces — query-driven list builders that compete
            // with the web "Recommendations" and tempt the model to bypass
            // findCandidatesInLibrary entirely:
            //   - findSimilarContent: same output as the embeddings "Also worth checking"
            //   - searchContent / semanticSearch: alternative recommendation lists from the query
            // Distinct-intent tools (getTopRated / getMyRecommendations / getUnwatched) stay
            // available so the model can SUPPLEMENT the web picks with broader in-library
            // coverage (e.g. getTopRated by genre). The prompt mandates calling
            // findCandidatesInLibrary first so the reasoned web cards are always primary.
            if (Object.keys(discoveryTools).length > 0) {
              const DISCOVERY_SUPPRESSED_TOOLS = [
                'findSimilarContent',
                'searchContent',
                'semanticSearch',
              ]
              for (const name of DISCOVERY_SUPPRESSED_TOOLS) {
                delete (baseTools as Record<string, unknown>)[name]
              }
            }
            // Backstop: uncaught tool errors become { id, error } payloads instead
            // of aborting the stream with a masked "An error occurred". Wraps the
            // unwatched filter too, so a failure there can't abort the stream.
            // withStatusEvents wraps that so entering a tool is reported before any
            // of it runs; withRequestContext is outermost because it stamps the
            // finished result, once the filter has settled which cards remain.
            const allTools = { ...baseTools, ...discoveryTools }
            const tools = withRequestContext(
              withStatusEvents(
                withToolErrorHandling(
                  excludeWatched ? withUnwatchedFilter(allTools, user.id) : allTools
                ),
                emit
              ),
              userRequest
            )

            request.log.info(
              {
                toolCount: Object.keys(tools).length,
                model: typeof chatModel === 'string' ? chatModel : chatModel.modelId,
                excludeWatched,
              },
              'Starting chat stream'
            )

            // Stream the response using AI SDK v5
            // stopWhen allows the model to continue generating text after tool results
            const result = streamText({
              model: chatModel,
              system: [systemPrompt, systemAppend, discoveryAppend].filter(Boolean).join('\n\n'),
              messages: convertToModelMessages(processedMessages),
              tools,
              toolChoice: 'auto',
              stopWhen: stepCountIs(MAX_STEPS),
              // stepNumber is 0-indexed, so MAX_STEPS - 1 is the last step the
              // loop will run. Forcing toolChoice 'none' there turns "ran out of
              // budget mid-search" into "answered with whatever it found", which
              // is worse than a good answer and far better than silence.
              prepareStep: ({ stepNumber }) => {
                if (stepNumber !== MAX_STEPS - 1) return undefined
                // Warn, not info: reaching this means the model burned every
                // search it had. The turn still answers, but something upstream
                // (a filter returning nothing, a tool it can't drive) made it
                // spend the whole budget looking.
                request.log.warn(
                  { stepNumber, maxSteps: MAX_STEPS },
                  'Step budget exhausted — forcing an answer without tools'
                )
                return { toolChoice: 'none' }
              },
              onStepFinish: (step) => {
                request.log.info(
                  {
                    // Tool NAMES and card counts, not Object.keys(step) — that
                    // was the same seven strings every time and said nothing.
                    // When a turn comes back with the wrong content, "which
                    // tool, returning how many cards" is the entire question,
                    // and reconstructing it from poster requests in the access
                    // log is not a debugging strategy.
                    tools: step.toolCalls?.map((call) => call.toolName) ?? [],
                    results: step.toolResults?.map(describeToolResult) ?? [],
                    hasText: !!step.text,
                    textLength: step.text?.length,
                  },
                  'Step finished'
                )
                // Tools have returned; whatever comes next is the model writing
                // prose, which is a meaningfully different wait to sit through.
                if (step.toolResults?.length) emit('composing')
              },
            })

            // sendStart: false — `start` was already written above, and a second
            // one would open a second assistant message.
            writer.merge(result.toUIMessageStream({ sendStart: false, onError: onStreamError }))
          },
          })
        )

        const webResponse = createUIMessageStreamResponse({ stream })

        // Forward status + headers to Fastify
        reply.status(webResponse.status)
        webResponse.headers.forEach((value: string, key: string) => reply.header(key, value))

        // Pipe through the tool buffering transform to fix streaming order issues
        // Then pipe to Node response
        const bufferedStream = webResponse.body!.pipeThrough(createToolBufferingStream())
        const nodeStream = Readable.fromWeb(
          bufferedStream as Parameters<typeof Readable.fromWeb>[0]
        )

        return reply.send(nodeStream)
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error'
        const errorStack = err instanceof Error ? err.stack : undefined
        fastify.log.error({ err, errorMessage, errorStack }, 'Assistant chat error')

        if (reply.raw.headersSent) {
          reply.raw.end()
          return
        }

        // Only pre-flight failures reach here now (resolving the configured
        // models, opening the stream) — anything thrown inside execute is caught
        // by the SDK and routed through onStreamError instead. A bare 500 would
        // be swallowed silently by the chat UI, so return a UI-message stream:
        // `start` creates the assistant message, `error` carries the coded
        // message the frontend localizes — same path as mid-stream errors.
        const errorText = assistantErrorText(err)
        const webResponse = createUIMessageStreamResponse({
          stream: createUIMessageStream({
            execute: ({ writer }) => {
              writer.write({ type: 'start' })
              writer.write({ type: 'error', errorText })
            },
          }),
        })
        reply.status(webResponse.status)
        webResponse.headers.forEach((value: string, key: string) => reply.header(key, value))
        return reply.send(Readable.fromWeb(webResponse.body! as Parameters<typeof Readable.fromWeb>[0]))
      }
    }
  )
}
