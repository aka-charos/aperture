/**
 * Synopsis translation settings — the endpoint, model and target languages the
 * `translate-title-synopses` job uses.
 *
 * Endpoints (all admin):
 * - GET    /api/settings/synopsis-translation               - config (key masked), readiness, resolved targets
 * - PUT    /api/settings/synopsis-translation               - partial update
 * - POST   /api/settings/synopsis-translation/test          - one real translation of a fixed sample
 * - GET    /api/settings/synopsis-translation/models        - what the endpoint lists at /models
 * - GET    /api/settings/synopsis-translation/status        - pending and stored per language
 * - DELETE /api/settings/synopsis-translation/translations  - forget stored translations (one language or all)
 *
 * Not the admin "Translations" page (`/api/i18n/*`), which edits the UI's own
 * strings. See core translation/.
 */
import type { FastifyInstance } from 'fastify'
import {
  TRANSLATION_INSTRUCTION_MAX_CHARS,
  TRANSLATION_SPACING_MAX_SECONDS,
  TRANSLATION_TEST_TEXT,
  TRANSLATION_TIMEOUT_MAX_MS,
  TRANSLATION_TIMEOUT_MIN_MS,
  DEFAULT_TRANSLATION_CONFIG,
  chatCompletionsUrl,
  checkTranslationReadiness,
  clearTranslations,
  getSystemLanguageDefaults,
  getTranslationConfig,
  getTranslationStatus,
  isTranslationPromptStyle,
  isValidAppLocale,
  listTranslationModels,
  resolveTargetLanguages,
  sanitizeTranslationConfig,
  setTranslationConfig,
  translateText,
  TranslationError,
  type AppLocaleCode,
  type TranslationConfig,
} from '@aperture/core'
import { requireAdmin } from '../../../plugins/auth.js'

interface UpdateBody {
  enabled?: boolean
  promptStyle?: string
  baseUrl?: string
  model?: string
  /** Omitted leaves the stored key alone; an empty string clears it. */
  apiKey?: string
  sourceLanguage?: string
  /** null follows the enabled UI languages. */
  targetLanguages?: string[] | null
  fields?: { overview?: boolean; plot_full?: boolean }
  instruction?: string
  timeoutMs?: number
  callSpacingSeconds?: number
}

interface TestBody extends UpdateBody {
  /** Which language to test into; defaults to the first resolved target. */
  language?: string
}

function toPublicConfig(config: TranslationConfig) {
  const { apiKey, ...rest } = config
  return { ...rest, hasApiKey: !!apiKey }
}

/**
 * The body has no JSON schema, so a field can arrive as anything. A wrong type
 * is refused before merge() would quietly coerce it.
 */
function typeError(body: UpdateBody): string | null {
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') return 'enabled must be true or false'
  for (const key of ['promptStyle', 'baseUrl', 'model', 'apiKey', 'sourceLanguage', 'instruction'] as const) {
    if (body[key] !== undefined && typeof body[key] !== 'string') return `${key} must be a string`
  }
  for (const key of ['timeoutMs', 'callSpacingSeconds'] as const) {
    if (body[key] !== undefined && typeof body[key] !== 'number') return `${key} must be a number`
  }
  if (
    body.targetLanguages !== undefined &&
    body.targetLanguages !== null &&
    (!Array.isArray(body.targetLanguages) || body.targetLanguages.some((c) => typeof c !== 'string'))
  ) {
    return 'targetLanguages must be a list of language codes, or null'
  }
  if (body.fields !== undefined) {
    if (typeof body.fields !== 'object' || body.fields === null) return 'fields must be an object'
    for (const key of ['overview', 'plot_full'] as const) {
      if (body.fields[key] !== undefined && typeof body.fields[key] !== 'boolean') {
        return `fields.${key} must be true or false`
      }
    }
  }
  return null
}

/**
 * Refused rather than clamped or dropped: somebody is asking for these values
 * right now, and storing different ones looks like it saved.
 */
function validate(body: UpdateBody): string | null {
  const wrongType = typeError(body)
  if (wrongType) return wrongType
  if (body.promptStyle !== undefined && !isTranslationPromptStyle(body.promptStyle)) {
    return 'promptStyle must be index-translate or instruction'
  }
  if (body.baseUrl !== undefined && body.baseUrl.trim() && !chatCompletionsUrl(body.baseUrl)) {
    return 'The base URL must start with http:// or https://'
  }
  if (body.sourceLanguage !== undefined && !isValidAppLocale(body.sourceLanguage)) {
    return 'sourceLanguage is not a supported language'
  }
  const badTarget = body.targetLanguages?.find((c) => !isValidAppLocale(c))
  if (badTarget) return `${badTarget} is not a supported language`
  if (body.instruction !== undefined && body.instruction.trim().length > TRANSLATION_INSTRUCTION_MAX_CHARS) {
    return `The instruction must be at most ${TRANSLATION_INSTRUCTION_MAX_CHARS} characters`
  }
  if (
    body.timeoutMs !== undefined &&
    (!Number.isInteger(body.timeoutMs) ||
      body.timeoutMs < TRANSLATION_TIMEOUT_MIN_MS ||
      body.timeoutMs > TRANSLATION_TIMEOUT_MAX_MS)
  ) {
    return `timeoutMs must be an integer between ${TRANSLATION_TIMEOUT_MIN_MS} and ${TRANSLATION_TIMEOUT_MAX_MS}`
  }
  if (
    body.callSpacingSeconds !== undefined &&
    (!Number.isFinite(body.callSpacingSeconds) ||
      body.callSpacingSeconds < 0 ||
      body.callSpacingSeconds > TRANSLATION_SPACING_MAX_SECONDS)
  ) {
    return `callSpacingSeconds must be between 0 and ${TRANSLATION_SPACING_MAX_SECONDS}`
  }
  return null
}

/**
 * The key a SAVE keeps. Omitted means "keep the stored key" — but only while
 * the endpoint stays the same. Saved against a different endpoint, the old key
 * would be sent to that server on every job call: an OpenRouter key handed to
 * whatever now answers, which is the leak {@link storedKeyFor} exists to stop
 * on Test and the model list. A changed endpoint therefore starts without one
 * unless a key is typed with it.
 */
function keyToStore(current: TranslationConfig, body: UpdateBody, nextBaseUrl: string): string {
  if (body.apiKey !== undefined) return body.apiKey
  return storedKeyFor(current, nextBaseUrl)
}

function merge(current: TranslationConfig, body: UpdateBody): TranslationConfig {
  const baseUrl = sanitizeTranslationConfig({ baseUrl: body.baseUrl ?? current.baseUrl }).baseUrl
  return sanitizeTranslationConfig({
    enabled: body.enabled ?? current.enabled,
    promptStyle: isTranslationPromptStyle(body.promptStyle) ? body.promptStyle : current.promptStyle,
    baseUrl,
    model: body.model ?? current.model,
    apiKey: keyToStore(current, body, baseUrl),
    sourceLanguage: isValidAppLocale(body.sourceLanguage) ? body.sourceLanguage : current.sourceLanguage,
    targetLanguages:
      body.targetLanguages === undefined
        ? current.targetLanguages
        : (body.targetLanguages as AppLocaleCode[] | null),
    fields: {
      overview: body.fields?.overview ?? current.fields.overview,
      plot_full: body.fields?.plot_full ?? current.fields.plot_full,
    },
    instruction: body.instruction ?? current.instruction,
    timeoutMs: body.timeoutMs ?? current.timeoutMs,
    callSpacingSeconds: body.callSpacingSeconds ?? current.callSpacingSeconds,
  })
}

/**
 * The stored key, but only for the endpoint it was saved for. Test and the
 * model list take a URL that may not be saved yet; sending the stored key to
 * it would hand the key to whatever answers there — and the model list is a
 * GET, which a SameSite=lax cookie carries on a plain link (the decision
 * model's `storedKeyFor`, for the same reason).
 */
function storedKeyFor(current: TranslationConfig, baseUrl: string): string {
  const target = chatCompletionsUrl(baseUrl)
  return target !== null && target === chatCompletionsUrl(current.baseUrl) ? current.apiKey : ''
}

async function describe(config: TranslationConfig) {
  const { enabledUiLanguages } = await getSystemLanguageDefaults()
  const targets = resolveTargetLanguages(config, enabledUiLanguages)
  return {
    config: toPublicConfig(config),
    readiness: checkTranslationReadiness(config, targets),
    targets,
    enabledUiLanguages,
    defaults: { baseUrl: DEFAULT_TRANSLATION_CONFIG.baseUrl, model: DEFAULT_TRANSLATION_CONFIG.model },
  }
}

export function registerSynopsisTranslationHandlers(fastify: FastifyInstance) {
  fastify.get(
    '/api/settings/synopsis-translation',
    { preHandler: requireAdmin, schema: { tags: ['settings'] } },
    async (_request, reply) => {
      try {
        return reply.send(await describe(await getTranslationConfig()))
      } catch (err) {
        fastify.log.error({ err }, 'Failed to get synopsis translation config')
        return reply.status(500).send({ error: 'Failed to get synopsis translation configuration' })
      }
    }
  )

  fastify.put<{ Body: UpdateBody }>(
    '/api/settings/synopsis-translation',
    { preHandler: requireAdmin, schema: { tags: ['settings'] } },
    async (request, reply) => {
      try {
        const body = request.body ?? {}
        const error = validate(body)
        if (error) return reply.status(400).send({ error })
        const next = merge(await getTranslationConfig(), body)
        await setTranslationConfig(next)
        return reply.send(await describe(next))
      } catch (err) {
        fastify.log.error({ err }, 'Failed to update synopsis translation config')
        return reply.status(500).send({ error: 'Failed to update synopsis translation configuration' })
      }
    }
  )

  /**
   * Translates a fixed synopsis-shaped sample with the card as it stands,
   * saved or not, so an endpoint can be tried before it is switched on. A real
   * call: "the endpoint answered" passes on a model that echoes its input.
   */
  fastify.post<{ Body: TestBody }>(
    '/api/settings/synopsis-translation/test',
    { preHandler: requireAdmin, schema: { tags: ['settings'] } },
    async (request, reply) => {
      try {
        const body = request.body ?? {}
        const error = validate(body)
        if (error) return reply.status(400).send({ success: false, error })
        const current = await getTranslationConfig()
        const config = merge(current, { ...body, apiKey: undefined })
        config.apiKey = body.apiKey?.trim() || storedKeyFor(current, config.baseUrl)

        const { enabledUiLanguages } = await getSystemLanguageDefaults()
        const targets = resolveTargetLanguages(config, enabledUiLanguages)
        const language = isValidAppLocale(body.language) ? body.language : targets[0]
        if (!language || language === config.sourceLanguage) {
          return reply.status(400).send({
            success: false,
            error: 'Pick a language other than the source language to test with.',
          })
        }
        try {
          // No 429 retries here: the job waits minutes for a rate limit, and a
          // button cannot hold a request open that long.
          const result = await translateText(config, TRANSLATION_TEST_TEXT, language, {
            rateLimitRetries: 0,
          })
          return reply.send({
            success: true,
            language,
            source: TRANSLATION_TEST_TEXT,
            text: result.text,
            model: result.model,
            latencyMs: result.latencyMs,
          })
        } catch (err) {
          // A failed translation is the answer to the question, not a server
          // fault: 200 with the provider's words, the decision-model Test shape.
          if (err instanceof TranslationError) return reply.send({ success: false, error: err.message })
          throw err
        }
      } catch (err) {
        fastify.log.error({ err }, 'Failed to test synopsis translation')
        return reply.status(500).send({ success: false, error: 'Failed to run the translation test' })
      }
    }
  )

  fastify.get<{ Querystring: { baseUrl?: string; promptStyle?: string } }>(
    '/api/settings/synopsis-translation/models',
    { preHandler: requireAdmin, schema: { tags: ['settings'] } },
    async (request, reply) => {
      const current = await getTranslationConfig()
      const baseUrl = typeof request.query.baseUrl === 'string' && request.query.baseUrl.trim()
        ? request.query.baseUrl
        : current.baseUrl
      const promptStyle = isTranslationPromptStyle(request.query.promptStyle)
        ? request.query.promptStyle
        : current.promptStyle
      return reply.send(
        await listTranslationModels({ baseUrl, promptStyle, apiKey: storedKeyFor(current, baseUrl) })
      )
    }
  )

  fastify.get(
    '/api/settings/synopsis-translation/status',
    { preHandler: requireAdmin, schema: { tags: ['settings'] } },
    async (_request, reply) => {
      try {
        return reply.send(await getTranslationStatus())
      } catch (err) {
        fastify.log.error({ err }, 'Failed to read synopsis translation status')
        return reply.status(500).send({ error: 'Failed to read synopsis translation status' })
      }
    }
  )

  fastify.delete<{ Querystring: { language?: string } }>(
    '/api/settings/synopsis-translation/translations',
    { preHandler: requireAdmin, schema: { tags: ['settings'] } },
    async (request, reply) => {
      const { language } = request.query
      if (language !== undefined && !isValidAppLocale(language)) {
        return reply.status(400).send({ error: `${language} is not a supported language` })
      }
      try {
        return reply.send({ cleared: await clearTranslations(language) })
      } catch (err) {
        fastify.log.error({ err }, 'Failed to clear synopsis translations')
        return reply.status(500).send({ error: 'Failed to clear synopsis translations' })
      }
    }
  )
}
