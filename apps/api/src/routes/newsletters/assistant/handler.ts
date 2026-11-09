/**
 * POST /api/newsletters/assistant — the newsletter writing assistant, streamed.
 *
 * Admin only. The editor sends the conversation so far and the newsletter as it
 * stands in the editor (unsaved edits included); nothing is stored here, and
 * nothing here writes to the newsletter: content comes back as `proposeDraft`
 * results that the admin inserts (core newsletter/draft.ts).
 *
 * Built from the chat assistant's parts rather than its handler, which also
 * routes intent, persists turns and runs web discovery; this needs none of
 * that. What it keeps: the same model role (Chat), the same tool wrappers in
 * the same order (scope innermost, as a permission), the same coded errors,
 * the same last-step guard, and the same retry when a turn ends with no
 * prose. Unlike the chat, a reader who closes the panel ends the turn: there
 * is no conversation to save it into.
 */
import { Readable } from 'node:stream'
import type { FastifyInstance } from 'fastify'
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  type UIMessage,
} from 'ai'
import {
  DEFAULT_TITLE_FIELDS,
  TITLE_FIELDS,
  analysisPartsFor,
  buildAiLanguageInstruction,
  getAppName,
  getChatModelInstance,
  getEmbeddingInvocation,
  getLibraryScopeForUser,
  resolveEffectiveAiLanguage,
  summarizeAudience,
  withInferenceContext,
} from '@aperture/core'
import { requireAdmin, type SessionUser } from '../../../plugins/auth.js'
import {
  assistantErrorText,
  createStatusEmitter,
  getMediaServerInfo,
  withLibraryScope,
  withStatusEvents,
} from '../../assistant/helpers/index.js'
import { withToolErrorHandling } from '../../assistant/tools/utils.js'
import type { ToolContext } from '../../assistant/types.js'
import { buildNewsletterToolCatalog } from './catalog.js'
import { newsletterSystemPrompt } from './prompt.js'
import type { NewsletterDraftContext } from './draftSummary.js'

/**
 * Model round trips per turn. More than the chat's five: a whole issue is
 * several searches, a reach check and a draft. The last step runs without tools
 * so the turn always ends in prose.
 */
export const NEWSLETTER_MAX_STEPS = 8

/** Only the latest messages go to the model: older card lists are dead weight. */
export const NEWSLETTER_HISTORY_MESSAGES = 24

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface AssistantBody {
  messages: UIMessage[]
  draft?: {
    subject?: string
    preheader?: string
    content?: unknown
    groupIds?: string[]
  }
}

function readDraftContext(body: AssistantBody['draft']): NewsletterDraftContext {
  return {
    subject: typeof body?.subject === 'string' ? body.subject.slice(0, 200) : '',
    preheader: typeof body?.preheader === 'string' ? body.preheader.slice(0, 200) : '',
    content: body?.content ?? { type: 'doc', content: [] },
    groupIds: [...new Set((body?.groupIds ?? []).filter((id) => typeof id === 'string' && UUID.test(id)))],
  }
}

export function registerNewsletterAssistant(fastify: FastifyInstance) {
  fastify.post<{ Body: AssistantBody }>(
    '/api/newsletters/assistant',
    {
      preHandler: requireAdmin,
      // A conversation carries its card lists back each turn.
      bodyLimit: 4 * 1024 * 1024,
      schema: {
        tags: ['newsletters'],
        summary: 'Newsletter writing assistant (streamed)',
        body: {
          type: 'object',
          required: ['messages'],
          properties: {
            messages: { type: 'array', maxItems: 200, items: { type: 'object', additionalProperties: true } },
            draft: {
              type: 'object',
              properties: {
                subject: { type: 'string', maxLength: 200 },
                preheader: { type: 'string', maxLength: 200 },
                content: { type: 'object', additionalProperties: true },
                groupIds: { type: 'array', items: { type: 'string' }, maxItems: 50 },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user as SessionUser
      const draft = readDraftContext(request.body.draft)
      const messages = request.body.messages.slice(-NEWSLETTER_HISTORY_MESSAGES)

      // Closing the panel or the page ends the model call: there is nowhere
      // to save an answer nobody is reading. `close` on the RESPONSE, never the
      // request, whose `close` fires as soon as the body has been read.
      const stop = new AbortController()
      reply.raw.on('close', () => {
        if (!reply.raw.writableFinished) stop.abort()
      })

      const onStreamError = (error: unknown) => {
        if (!stop.signal.aborted) fastify.log.error({ err: error }, 'Newsletter assistant stream error')
        return assistantErrorText(error)
      }

      const stream = withInferenceContext({ feature: 'newsletter.assistant', userId: user.id }, () =>
        createUIMessageStream({
          onError: onStreamError,
          execute: async ({ writer }) => {
            writer.write({ type: 'start' })
            const emit = createStatusEmitter(writer)
            emit('preparing')

            const [chatModel, embedding, mediaServer, scope, aiLocale, audience, appName] = await Promise.all([
              getChatModelInstance(),
              getEmbeddingInvocation(),
              getMediaServerInfo(),
              getLibraryScopeForUser(user.id),
              resolveEffectiveAiLanguage(user.id),
              draft.groupIds.length > 0 ? summarizeAudience(draft.groupIds) : Promise.resolve(null),
              getAppName(),
            ])

            const ctx: ToolContext = {
              userId: user.id,
              isAdmin: user.isAdmin,
              scope,
              embedding,
              mediaServer,
              onStatus: emit,
            }

            const catalog = buildNewsletterToolCatalog(ctx, draft)
            // Same order as the chat: scope innermost (a permission, before any
            // card reaches another wrapper or the model), then the error
            // backstop, then the status line.
            const tools = withStatusEvents(withToolErrorHandling(withLibraryScope(catalog, scope)), emit)

            const system = newsletterSystemPrompt({
              appName,
              serverName: mediaServer?.name ?? null,
              languageInstruction: buildAiLanguageInstruction(aiLocale),
              audience: audience
                ? {
                    recipients: audience.recipients.length,
                    byLanguage: audience.byLanguage as Record<string, number>,
                  }
                : null,
              titleFields: TITLE_FIELDS,
              defaultTitleFields: DEFAULT_TITLE_FIELDS,
              analysisParts: { movie: analysisPartsFor('movie'), series: analysisPartsFor('series') },
              today: new Date().toISOString().slice(0, 10),
            })
            // With the tools, so earlier proposals reach the model as their
            // summary (proposeDraft's toModelOutput), not as editor nodes.
            const modelMessages = convertToModelMessages(messages, { tools, ignoreIncompleteToolCalls: true })

            const result = streamText({
              model: chatModel,
              system,
              messages: modelMessages,
              tools,
              toolChoice: 'auto',
              stopWhen: stepCountIs(NEWSLETTER_MAX_STEPS),
              abortSignal: stop.signal,
              prepareStep: ({ stepNumber }) =>
                stepNumber === NEWSLETTER_MAX_STEPS - 1 ? { toolChoice: 'none' } : undefined,
              onStepFinish: (step) => {
                request.log.info(
                  {
                    tools: step.toolCalls?.map((call) => call.toolName) ?? [],
                    hasText: !!step.text,
                  },
                  'Newsletter assistant step finished'
                )
                if (step.toolResults?.length) emit('composing')
              },
            })
            writer.merge(result.toUIMessageStream({ sendStart: false, onError: onStreamError }))

            // A turn whose last step wrote nothing gets one more try without
            // tools (as the chat does): cards or a proposal with no word about
            // them leave the admin guessing what happened.
            const steps = await result.steps
            if (!stop.signal.aborted && !steps.at(-1)?.text?.trim()) {
              emit('composing')
              const forced = streamText({
                model: chatModel,
                system,
                messages: [...modelMessages, ...(await result.response).messages],
                tools,
                toolChoice: 'none',
                abortSignal: stop.signal,
              })
              writer.merge(forced.toUIMessageStream({ sendStart: false, onError: onStreamError }))
              await forced.steps
            }
          },
        })
      )

      try {
        const webResponse = createUIMessageStreamResponse({ stream })
        reply.status(webResponse.status)
        webResponse.headers.forEach((value: string, key: string) => reply.header(key, value))
        return reply.send(Readable.fromWeb(webResponse.body! as Parameters<typeof Readable.fromWeb>[0]))
      } catch (err) {
        fastify.log.error({ err }, 'Newsletter assistant failed to start')
        return reply.status(500).send({ error: 'The assistant could not start' })
      }
    }
  )
}
