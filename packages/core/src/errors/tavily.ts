/**
 * Tavily Search API Error Codes
 * https://docs.tavily.com/
 *
 * Tavily is an optional web-search grounding source for the AI assistant's
 * discovery pipeline. Like the Google grounding role it has per-plan rate and
 * usage limits, so 429 is the common failure this table exists to surface.
 */

import type { ApiErrorDefinition } from './types.js'

/**
 * Tavily error definitions mapped by HTTP status code.
 * Some status codes have multiple possible error types identified by message
 * patterns (see TAVILY_ERROR_PATTERNS).
 */
export const TAVILY_ERRORS: Record<number, ApiErrorDefinition | ApiErrorDefinition[]> = {
  400: {
    type: 'validation',
    message: 'Invalid request to the Tavily API',
    action: 'Check the search parameters',
    severity: 'error',
  },
  401: {
    type: 'auth',
    message: 'Your Tavily API key is missing or invalid',
    action: 'Check your API key in Settings > AI',
    actionUrl: 'https://app.tavily.com/',
    severity: 'error',
  },
  403: {
    type: 'auth',
    message: 'Your Tavily API key lacks permission for this request',
    action: 'Verify the key and your plan in the Tavily dashboard',
    actionUrl: 'https://app.tavily.com/',
    severity: 'error',
  },
  429: [
    {
      type: 'rate_limit',
      message: 'Sending requests to Tavily too quickly. Automatically slowing down.',
      action: 'Will retry automatically',
      autoRetry: true,
      retryAfterSeconds: 30,
      severity: 'warning',
    },
    {
      type: 'limit',
      message: "You've used up your Tavily search credits for the current plan period.",
      action: 'Upgrade your plan or wait for credits to reset',
      actionUrl: 'https://tavily.com/#pricing',
      severity: 'error',
    },
  ],
  // Tavily returns 432 when the account's usage/plan limit is exhausted.
  432: {
    type: 'limit',
    message: "You've used up your Tavily search credits for the current plan period.",
    action: 'Upgrade your plan or wait for credits to reset',
    actionUrl: 'https://tavily.com/#pricing',
    severity: 'error',
  },
  500: {
    type: 'outage',
    message: 'Tavily servers are having issues. Will retry automatically.',
    autoRetry: true,
    retryAfterSeconds: 30,
    severity: 'info',
  },
  502: {
    type: 'outage',
    message: 'Tavily is unreachable right now. Will retry automatically.',
    autoRetry: true,
    retryAfterSeconds: 30,
    severity: 'info',
  },
  503: {
    type: 'outage',
    message: 'The Tavily service is overloaded. Will retry automatically.',
    autoRetry: true,
    retryAfterSeconds: 30,
    severity: 'info',
  },
  504: {
    type: 'outage',
    message: 'The Tavily request timed out. Will retry automatically.',
    autoRetry: true,
    retryAfterSeconds: 30,
    severity: 'info',
  },
}

/**
 * Message patterns to disambiguate errors sharing a status code. A Tavily 429
 * can be a transient per-second rate limit (retry) or a monthly usage/credit
 * exhaustion (needs a plan change); the latter carries "usage"/"credit"/"plan".
 */
export const TAVILY_ERROR_PATTERNS: Record<string, { status: number; index: number }> = {
  'rate limit': { status: 429, index: 0 },
  'too many': { status: 429, index: 0 },
  usage: { status: 429, index: 1 },
  credit: { status: 429, index: 1 },
  plan: { status: 429, index: 1 },
  quota: { status: 429, index: 1 },
}
