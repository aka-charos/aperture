/**
 * Reading Tavily's `GET /usage` answer.
 *
 * Tavily bills in credits per billing cycle and reports the balance only on
 * its own endpoint, never on a search response unless asked. Aperture shows it
 * on the Tavily settings card, read live; nothing stores it.
 *
 * Pure (no imports) so the parser is pinned without a database or a key. Three
 * rules. (1) **A missing or non-numeric figure is `null`, never 0** — "used 0"
 * and "Tavily did not say" are different claims, and a 0 limit would read as an
 * exhausted plan. (2) **A `null` limit is shown as "no limit reported"** —
 * Tavily documents a null key limit as "unlimited", and a missing figure is
 * unknown; that wording is true of both. (3) **The whole answer is optional**: a
 * reply with neither block is reported as empty rather than thrown, since the
 * card's job is to show what Tavily said.
 */

export interface TavilyCreditFigures {
  /** Credits used this billing cycle. */
  used: number | null
  /** The cap, or null when Tavily reports none. */
  limit: number | null
}

export interface TavilyUsage {
  /** This API key's own usage and cap. */
  key: TavilyCreditFigures | null
  /** The account's plan: its name, plan credits, and pay-as-you-go credits. */
  account: {
    plan: string | null
    planCredits: TavilyCreditFigures
    payAsYouGo: TavilyCreditFigures
  } | null
}

function figure(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** Turn the raw `GET /usage` body into figures. Never throws. */
export function parseTavilyUsage(body: unknown): TavilyUsage {
  const root = record(body)
  const key = record(root?.key)
  const account = record(root?.account)
  return {
    key: key ? { used: figure(key.usage), limit: figure(key.limit) } : null,
    account: account
      ? {
          plan: typeof account.current_plan === 'string' && account.current_plan.trim()
            ? account.current_plan.trim()
            : null,
          planCredits: { used: figure(account.plan_usage), limit: figure(account.plan_limit) },
          payAsYouGo: { used: figure(account.paygo_usage), limit: figure(account.paygo_limit) },
        }
      : null,
  }
}
