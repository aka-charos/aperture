/**
 * Z.AI usage accounting.
 *
 * Z.AI answers with the standard OpenAI-compatible `usage` object — token counts
 * and nothing else. So unlike OpenRouter, which reports the credits it charged,
 * money here has to be COMPUTED from the published per-million prices in
 * `zai.json`. That difference is not cosmetic and is carried all the way to the
 * dashboard: one number is what the vendor billed, the other is what this app
 * believes the vendor will bill.
 *
 * WHY METER IT AT ALL, given the money is an estimate. Tokens are a measurement
 * whatever the price is, and they are the number that answers the questions
 * actually asked here: which role is spending, whether a reasoning model is
 * burning its allowance on a scratchpad ([F-030], [F-099]), and whether a
 * library-wide title-analysis pass is affordable before it is started rather
 * than after. Recording nothing meant every GLM call was invisible.
 *
 * THREE WAYS THE ESTIMATE CAN BE WRONG, all in the same direction:
 *   - Cached input is cheaper (GLM-5.3: $0.26 vs $1.4 per million) and the
 *     catalog carries no cached rate, so cached prompt tokens are billed here at
 *     the full rate. The cached count is still recorded, so the overshoot is
 *     visible rather than hidden.
 *   - A promotional or plan rate an operator is actually on is not knowable from
 *     here.
 *   - A price change reaches this only when `zai.json` is updated.
 * All three overstate rather than understate, which is the safe direction for a
 * spend figure. What it must NEVER do is invent one: a model with no published
 * price records tokens and a null cost, which the read side counts separately.
 */
import { getProvider } from './ai-capabilities/registry.js'
import {
  createMeteredFetch,
  readOpenAiUsage,
  type ParsedUsage,
} from './usageFetch.js'

/** Ledger provider id. One spelling, shared with the read side. */
export const ZAI_LEDGER_PROVIDER = 'zai'

/**
 * Read one Z.AI response chunk.
 *
 * Plain OpenAI shape and nothing more: no generation id worth recording, no
 * upstream provider (Z.AI serves its own models), no cost field. Streaming puts
 * the usage object on the final chunk, which the shared scanner handles by
 * letting the last chunk carrying one win.
 */
function readZaiChunk(chunk: Record<string, unknown>, into: ParsedUsage): void {
  const usage = chunk.usage as Record<string, unknown> | undefined
  if (!usage || typeof usage !== 'object') return
  readOpenAiUsage(usage, into)
}

/**
 * The published per-million prices for a Z.AI model, or null.
 *
 * Reads `chatModels` directly rather than going through `getModel(provider, id,
 * fn)`, because the role is not knowable at the HTTP layer and Z.AI's other
 * three lists are copies of this one (`normalizeProvider` fills them in).
 *
 * Null for a model the catalog does not list — which is every custom model, and
 * is why `custom_ai_models` rows produce unpriced ledger entries. That table has
 * no price columns, and inventing a rate for a model whose price nobody stated
 * is exactly what this must not do.
 */
export function zaiModelPrices(
  modelId: string
): { input: number; output: number } | null {
  const model = getProvider(ZAI_LEDGER_PROVIDER)?.chatModels.find((m) => m.id === modelId)
  if (!model) return null
  // `!= null` rather than truthiness: a free model declares 0, and 0 is a real
  // published price rather than a missing one.
  if (model.inputCostPerMillion == null) return null
  return { input: model.inputCostPerMillion, output: model.outputCostPerMillion ?? 0 }
}

/**
 * USD for one call, or undefined when the model has no published price.
 *
 * Reasoning tokens are deliberately not added: every provider reporting
 * `completion_tokens_details.reasoning_tokens` counts the scratchpad INSIDE
 * `completion_tokens`, so adding it would double-bill precisely the models this
 * metering exists to keep an eye on.
 */
export function priceZaiCall(modelId: string, usage: ParsedUsage): number | undefined {
  const prices = zaiModelPrices(modelId)
  if (!prices) return undefined

  const prompt = usage.promptTokens ?? 0
  const completion = usage.completionTokens ?? 0
  // Nothing measured means nothing to price. Recording 0 here would claim a
  // free call rather than an unmeasured one, and a failed call already takes
  // this path with an empty usage object.
  if (prompt === 0 && completion === 0) return undefined

  return (prompt / 1_000_000) * prices.input + (completion / 1_000_000) * prices.output
}

/**
 * A `fetch` for the Z.AI provider that records every call to the ledger.
 *
 * `role` is baked in at provider-creation time for the same reason OpenRouter's
 * is: the model instance is built per AI function, and the HTTP layer has no
 * other way to know which one it is serving.
 */
export function createZaiUsageFetch(role?: string): typeof fetch {
  return createMeteredFetch({
    provider: ZAI_LEDGER_PROVIDER,
    role,
    readChunk: readZaiChunk,
    priceCall: priceZaiCall,
  })
}
