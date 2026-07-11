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
import { getChatModelInstance, getEmbeddingModelInstance, getActiveEmbeddingModelId } from '@aperture/core'
import { requireAuth, type SessionUser } from '../../../plugins/auth.js'
import { getMediaServerInfo, buildSystemPrompt, applyN8nPreProcess, classifyIntent, latestUserText, assistantErrorText } from '../helpers/index.js'
import { createTools, createN8nTools, createDiscoveryResolveTool, DISCOVERY_PROMPT } from '../tools/index.js'
import { withToolErrorHandling } from '../tools/utils.js'
import { gatherWebCandidates } from '../discovery/webCandidates.js'
import type { ToolContext } from '../types.js'

interface ChatBody {
  messages: UIMessage[]
}

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
        const systemPrompt = await buildSystemPrompt(user.id, user.isAdmin)

        if (!embeddingModelId) {
          return reply.status(500).send({ error: 'Embedding model not configured' })
        }

        // Create tool context
        const toolContext: ToolContext = {
          userId: user.id,
          isAdmin: user.isAdmin,
          embeddingModel,
          embeddingModelId, // Format: "provider:model" (e.g., "openai:text-embedding-3-large")
          mediaServer,
        }

        // Optional n8n pre-processing hook (fails open if n8n is unreachable)
        const { messages: processedMessages, systemAppend } = await applyN8nPreProcess(messages, {
          id: user.id,
          isAdmin: user.isAdmin,
        })

        // Route intent: 'discovery' gathers web-sourced candidates (isolated,
        // on the Web Search role) to resolve against the library; 'library'
        // (the default) leaves the assistant untouched. Fails open to library.
        let discoveryTools: ToolSet = {}
        let discoveryAppend = ''
        const intent = await classifyIntent(processedMessages)
        fastify.log.info({ intent }, 'Assistant intent classified')
        if (intent === 'discovery') {
          toolContext.discoveryCandidates = await gatherWebCandidates(latestUserText(processedMessages))
          const candidateCount = toolContext.discoveryCandidates?.length ?? 0
          fastify.log.info(
            { candidateCount, discoveryEnabled: candidateCount > 0 },
            'Discovery candidates resolved'
          )
          if (candidateCount > 0) {
            discoveryTools = createDiscoveryResolveTool(toolContext)
            discoveryAppend = DISCOVERY_PROMPT
          }
        }

        // Create tools with context, plus n8n search_web + discovery (when routed)
        const baseTools = {
          ...createTools(toolContext),
          ...(await createN8nTools()),
        }
        // On discovery turns the discovery tool subsumes findSimilarContent — it adds
        // the embeddings "Also worth checking" section itself — so drop it to keep web
        // results primary (otherwise the model tends to call findSimilarContent instead).
        if (Object.keys(discoveryTools).length > 0) {
          delete (baseTools as Record<string, unknown>).findSimilarContent
        }
        // Backstop: uncaught tool errors become { id, error } payloads instead
        // of aborting the stream with a masked "An error occurred".
        const tools = withToolErrorHandling({ ...baseTools, ...discoveryTools })

        fastify.log.info(
          {
            toolCount: Object.keys(tools).length,
            model: typeof chatModel === 'string' ? chatModel : chatModel.modelId,
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
          stopWhen: stepCountIs(5), // Stop after 5 steps (allows tool calls + follow-up responses)
          onStepFinish: (step) => {
            fastify.log.info(
              {
                stepKeys: Object.keys(step),
                hasText: !!step.text,
                textLength: step.text?.length,
                toolCallCount: step.toolCalls?.length ?? 0,
                toolResultCount: step.toolResults?.length ?? 0,
              },
              'Step finished'
            )
          },
        })

        // Get the UI Message Stream Response (Web Response).
        // onError replaces the SDK's masked "An error occurred" with a stable
        // AI_ERROR:<code>:<detail> string the frontend maps to localized copy.
        const webResponse = result.toUIMessageStreamResponse({
          onError: (error) => {
            fastify.log.error({ err: error }, 'Assistant stream error')
            return assistantErrorText(error)
          },
        })

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

        // Failures before the stream starts (model not configured, DB down
        // while building the prompt, ...) would surface as a bare 500 the chat
        // UI swallows silently. Return a UI-message stream instead: `start`
        // creates the assistant message, `error` carries the coded message the
        // frontend localizes — same path as mid-stream errors.
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
