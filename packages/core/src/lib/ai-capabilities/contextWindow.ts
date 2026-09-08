/**
 * Format a token count the way built-in model metadata writes it: "1M", "128K".
 *
 * One copy, because two catalogs feed the same dropdown — OpenRouter's live
 * `context_length` and LM Studio's `max_context_length` — and a model listed as
 * "131K" beside one listed as "131072" reads as two different kinds of fact.
 */
export function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000
    return `${Number.isInteger(millions) ? millions : Math.round(millions * 10) / 10}M`
  }
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return String(tokens)
}
