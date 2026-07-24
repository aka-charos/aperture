/**
 * Google / Gemini API Error Codes
 * https://ai.google.dev/gemini-api/docs/troubleshooting
 *
 * Used for the AI roles that run on Google (chat, and especially the Web Search
 * grounding role, which is Google-only). The grounding role has a tight
 * per-minute quota, so 429 RESOURCE_EXHAUSTED is the common failure and the main
 * reason this table exists.
 */

import type { ApiErrorDefinition } from './types.js'

/**
 * Google error definitions mapped by HTTP status code.
 * Some status codes have multiple possible error types identified by message
 * patterns (see GOOGLE_ERROR_PATTERNS).
 */
export const GOOGLE_ERRORS: Record<number, ApiErrorDefinition | ApiErrorDefinition[]> = {
  400: {
    type: 'validation',
    message: 'Invalid request to the Google Gemini API',
    action: 'Check the request parameters or model name',
    severity: 'error',
  },
  401: {
    type: 'auth',
    message: 'Your Google API key is missing or invalid',
    action: 'Check your API key in Settings > AI',
    actionUrl: 'https://aistudio.google.com/app/apikey',
    severity: 'error',
  },
  403: {
    type: 'auth',
    message: 'Your Google API key lacks permission for this model or API',
    action: 'Verify the key is enabled for the Gemini API',
    actionUrl: 'https://aistudio.google.com/app/apikey',
    severity: 'error',
  },
  429: [
    {
      type: 'rate_limit',
      message: 'Sending requests to Google too quickly. Automatically slowing down.',
      action: 'Will retry automatically',
      autoRetry: true,
      retryAfterSeconds: 60,
      severity: 'warning',
    },
    {
      type: 'limit',
      message: "You've hit your Google Gemini quota (requests or tokens per day).",
      action: 'Raise the quota or wait for it to reset',
      actionUrl: 'https://ai.google.dev/gemini-api/docs/rate-limits',
      severity: 'error',
    },
  ],
  500: {
    type: 'outage',
    message: 'Google servers are having issues. Will retry automatically.',
    autoRetry: true,
    retryAfterSeconds: 30,
    severity: 'info',
  },
  503: {
    type: 'outage',
    message: 'The Google Gemini model is overloaded. Will retry automatically.',
    autoRetry: true,
    retryAfterSeconds: 30,
    severity: 'info',
  },
  504: {
    type: 'outage',
    message: 'The Google Gemini request timed out. Will retry automatically.',
    autoRetry: true,
    retryAfterSeconds: 30,
    severity: 'info',
  },
}

/**
 * Message patterns to disambiguate errors with the same status code.
 * Gemini 429s carry "RESOURCE_EXHAUSTED"; a daily quota/billing exhaustion is
 * distinguished from a transient per-minute rate limit by "quota".
 */
export const GOOGLE_ERROR_PATTERNS: Record<string, { status: number; index: number }> = {
  'per minute': { status: 429, index: 0 },
  'rate limit': { status: 429, index: 0 },
  'per day': { status: 429, index: 1 },
  quota: { status: 429, index: 1 },
  billing: { status: 429, index: 1 },
}
