/**
 * The rules for short interactive text: playlist and collection names, descriptions, preferences,
 * and the one-line notes under each preview pick.
 *
 * Pure and DB-free so the decisions can be pinned by a test without pulling in the provider layer.
 * The call itself is `generateShortText` in ./shortText.ts.
 */

/**
 * The output ceiling for every short-text call.
 *
 * Far above any real answer on purpose. A reasoning model bills its scratchpad from this same
 * allowance, and the old per-surface budgets (600 for a name, 1200 for a description, 1500 for
 * preferences, 110 per preview note) were each sized for the visible answer alone — measured on
 * a production ledger, `deepseek-v4.1-flash` spent every token of most name calls and of every
 * preview-note batch reasoning, and wrote nothing. A ceiling is not a reservation: a model that
 * answers directly is billed for what it writes, so the headroom costs nothing on a healthy call.
 *
 * The reasoning floor (`SHORT_TEXT_REASONING_FLOOR`) is what keeps the typical call small; this
 * is what keeps an atypical one from failing.
 */
export const SHORT_TEXT_MAX_OUTPUT_TOKENS = 8000

/**
 * Why a call that succeeded at the HTTP level still cannot be used, or `null` when it can.
 *
 * `text` is the answer AFTER any cleaning the caller applies, so a response that cleans to nothing
 * (a lone lead-in, a stray quote) counts as empty.
 *
 * A cut-off answer is refused even when it has text. With a ceiling this far above the answer,
 * `length` means the model ran away, and what it wrote is the start of something longer — half a
 * description, a preferences paragraph ending mid-clause. Storing that and reporting success is
 * worse than a failure the user can simply retry, because nothing says it was cut.
 */
export function shortTextFailure(result: { text: string; finishReason: string }): string | null {
  const hasText = result.text.trim().length > 0

  if (result.finishReason === 'length') {
    return hasText
      ? 'The AI model hit its output limit before finishing, so the partial answer was discarded. Try again, or pick a different model for the Text Generation role in Settings > AI.'
      : 'The AI model reached its output limit before writing anything. This usually means a reasoning model spent the whole budget thinking — try a different model for the Text Generation role in Settings > AI.'
  }

  if (hasText) return null

  if (result.finishReason === 'content-filter') {
    return "The AI provider's content filter blocked this request. Try different seed titles or preferences."
  }
  return `The AI model returned an empty response (finish reason: ${result.finishReason}).`
}
