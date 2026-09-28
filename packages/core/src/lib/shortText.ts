/**
 * The one way short interactive text is generated: playlist and collection names, descriptions and
 * preferences (all three dialogs), and the one-line notes under each preview pick.
 *
 * These were four call sites with four output budgets, none sized for a reasoning model's
 * scratchpad and none sending a reasoning setting, so whether a click worked depended on how long
 * the model happened to think that time. The rules now live in one place:
 *
 * - the reasoning setting is the weakest the model offers at or above `low`
 *   (`getShortTextReasoningFor`), never the role's configured effort;
 * - the output ceiling is `SHORT_TEXT_MAX_OUTPUT_TOKENS`, far above any real answer;
 * - a cut-off or empty answer is refused rather than stored (`shortTextFailure`);
 * - a provider failure becomes a sentence worth showing (`describeAiFailure`) and is logged through
 *   `describeAiError`, never as a bare error object that puts the request body first.
 */
import { generateText, type JSONValue, type LanguageModel } from 'ai'
import { createChildLogger } from './logger.js'
import {
  getChatModelInstance,
  getFunctionConfig,
  getShortTextReasoningFor,
  getTextGenerationModelInstance,
} from './ai-provider.js'
import { describeAiFailure } from './aiFailure.js'
import { describeAiError } from './aiErrors.js'
import { SHORT_TEXT_MAX_OUTPUT_TOKENS, shortTextFailure } from './shortTextPolicy.js'

const logger = createChildLogger('short-text')

const NOT_CONFIGURED =
  'Text generation provider is not configured. Please configure it in Settings > AI.'

/** A resolved writing model, reusable across several calls (the preview notes run in batches). */
export interface ShortTextWriter {
  role: 'textGeneration' | 'chat'
  provider: string
  modelId: string
  model: LanguageModel
  /** The effort asked for, for logs. Absent when the model publishes no effort vocabulary. */
  effort?: string
  providerOptions?: Record<string, Record<string, JSONValue>>
}

/**
 * The Text Generation role's model, with its short-text reasoning cap resolved.
 *
 * `fallbackToChat` borrows the chat model when Text Generation is not configured — the preview
 * notes have always done that, since notes are an enhancement and any prose model will do. The
 * dialogs do not, so an unconfigured role says so instead of quietly using another.
 */
export async function getShortTextWriter(
  options: { fallbackToChat?: boolean } = {}
): Promise<ShortTextWriter> {
  let role: ShortTextWriter['role'] = 'textGeneration'
  let config = await getFunctionConfig('textGeneration')
  if (!config && options.fallbackToChat) {
    role = 'chat'
    config = await getFunctionConfig('chat')
  }
  if (!config) throw new Error(NOT_CONFIGURED)

  const model =
    role === 'chat' ? await getChatModelInstance() : await getTextGenerationModelInstance()

  // The cap is an optimisation, so failing to look it up (a cold OpenRouter catalogue that will
  // not answer) must not fail the call: it runs as before, with the ceiling as the safety net.
  let reasoning: Awaited<ReturnType<typeof getShortTextReasoningFor>> = {}
  try {
    reasoning = await getShortTextReasoningFor(config.provider, config.model, role)
  } catch (err) {
    logger.warn(
      { err, provider: config.provider, model: config.model },
      'Could not resolve a reasoning cap for short text; sending none'
    )
  }

  return { role, provider: config.provider, modelId: config.model, model, ...reasoning }
}

/**
 * Generate one short answer, or throw an Error whose message is fit to show the user.
 *
 * `clean` runs before the emptiness check, so an answer that cleans to nothing (a lone lead-in,
 * a stray quote) is refused rather than returned as ''. Default: trim.
 */
export async function generateShortText(params: {
  /** For logs: which surface asked. */
  purpose: string
  prompt: string
  system?: string
  temperature?: number
  maxRetries?: number
  /** Pass one when making several calls in a row; resolved per call otherwise. */
  writer?: ShortTextWriter
  clean?: (text: string) => string
}): Promise<string> {
  const writer = params.writer ?? (await getShortTextWriter())
  const context = {
    purpose: params.purpose,
    role: writer.role,
    provider: writer.provider,
    model: writer.modelId,
    effort: writer.effort,
  }

  let result: Awaited<ReturnType<typeof generateText>>
  try {
    result = await generateText({
      model: writer.model,
      ...(params.system ? { system: params.system } : {}),
      prompt: params.prompt,
      // Omitted rather than passed as undefined: on some providers those are different requests.
      ...(params.temperature != null ? { temperature: params.temperature } : {}),
      ...(params.maxRetries != null ? { maxRetries: params.maxRetries } : {}),
      maxOutputTokens: SHORT_TEXT_MAX_OUTPUT_TOKENS,
      ...(writer.providerOptions ? { providerOptions: writer.providerOptions } : {}),
    })
  } catch (error) {
    logger.error({ ...describeAiError(error), ...context }, 'Short text generation failed')
    throw new Error(await describeAiFailure(writer.provider, error))
  }

  const raw = result.text ?? ''
  const text = params.clean ? params.clean(raw) : raw.trim()
  const usage = {
    finishReason: result.finishReason,
    outputTokens: result.usage?.outputTokens,
    reasoningTokens: result.usage?.reasoningTokens,
  }

  const failure = shortTextFailure({ text, finishReason: result.finishReason })
  if (failure) {
    logger.warn(
      { ...context, ...usage, visibleChars: raw.length },
      'Short text generation produced no usable answer'
    )
    throw new Error(failure)
  }

  logger.debug({ ...context, ...usage }, 'Short text generated')
  return text
}
