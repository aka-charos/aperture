import test from 'node:test'
import assert from 'node:assert/strict'

import {
  classifyQuotaError,
  clearObservedLimits,
  getFreeTierLimits,
  markSlotExhausted,
  noteObservedLimit,
} from './webSearchQuota.js'

/** A Google 429 as the AI SDK surfaces it: status plus the raw response body. */
function quotaError(body: unknown, statusCode = 429): Error & Record<string, unknown> {
  const err = new Error('Too Many Requests') as Error & Record<string, unknown>
  err.statusCode = statusCode
  err.responseBody = typeof body === 'string' ? body : JSON.stringify(body)
  return err
}

const dailyQuotaBody = {
  error: {
    code: 429,
    status: 'RESOURCE_EXHAUSTED',
    message: 'You exceeded your current quota.',
    details: [
      {
        '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
        violations: [
          {
            quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
            quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
            quotaDimensions: { model: 'gemini-3.5-flash-lite', location: 'global' },
            quotaValue: '20',
          },
        ],
      },
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '27s' },
    ],
  },
}

test('the real limit is read out of a daily QuotaFailure', () => {
  // This is the whole point: the hardcoded table claimed 1000/day for a model
  // the live account caps at 20, and Google has withdrawn the published table.
  // The 429 is the only authority that always knows.
  const info = classifyQuotaError(quotaError(dailyQuotaBody))
  assert.equal(info.isQuota, true)
  assert.equal(info.scope, 'day')
  assert.equal(info.observedLimit, 20)
  assert.equal(info.retryAfterMs, 27000)
})

test('a limit stated only in the message is still picked up', () => {
  const info = classifyQuotaError(
    quotaError('RESOURCE_EXHAUSTED: generate_content_free_tier_requests, limit: 20, per day')
  )
  assert.equal(info.observedLimit, 20)
  assert.equal(info.scope, 'day')
})

test('a token quota is not recorded as a request limit', () => {
  // Token quotas read as PerMinute too, so without the token check a 250,000
  // TPM ceiling would land on the requests-per-minute bar.
  const info = classifyQuotaError(
    quotaError({
      error: {
        message: 'Quota exceeded',
        details: [
          {
            violations: [
              {
                quotaId: 'GenerateContentInputTokensPerModelPerMinute-FreeTier',
                quotaValue: '250000',
              },
            ],
          },
        ],
      },
    })
  )
  assert.equal(info.limitIsTokens, true)
  assert.equal(info.observedLimit, 250000)
})

test('a failure that is not a quota rejection carries no limit', () => {
  const info = classifyQuotaError(new Error('socket hang up'))
  assert.equal(info.isQuota, false)
  assert.equal(info.observedLimit, undefined)
})

test('a non-429 mentioning quota in passing is not a rate limit', () => {
  const info = classifyQuotaError(quotaError('project quota configuration invalid', 400))
  assert.equal(info.isQuota, false)
})

test('day and minute scopes land on different fields', (t) => {
  t.after(clearObservedLimits)
  clearObservedLimits()

  noteObservedLimit('m', { isQuota: true, scope: 'day', observedLimit: 20 })
  noteObservedLimit('m', { isQuota: true, scope: 'minute', observedLimit: 10 })

  assert.deepEqual(getFreeTierLimits('m'), { rpd: 20, rpm: 10 })
})

test('a token limit lands on tpm even though its scope is per-minute', (t) => {
  t.after(clearObservedLimits)
  clearObservedLimits()

  noteObservedLimit('m', {
    isQuota: true,
    scope: 'minute',
    observedLimit: 250000,
    limitIsTokens: true,
  })

  assert.deepEqual(getFreeTierLimits('m'), { tpm: 250000 })
})

test('an unattributed limit is dropped rather than guessed at', (t) => {
  t.after(clearObservedLimits)
  clearObservedLimits()

  // Knowing a number but not which bucket it belongs to is worse than knowing
  // nothing — putting a per-minute cap on the daily bar is the confidently
  // wrong gauge this replaced.
  noteObservedLimit('m', { isQuota: true, scope: 'unknown', observedLimit: 20 })
  assert.equal(getFreeTierLimits('m'), null)
})

test('an unknown model has no limits, and the store never leaks a reference', (t) => {
  t.after(clearObservedLimits)
  clearObservedLimits()

  assert.equal(getFreeTierLimits('never-seen'), null)
  assert.equal(getFreeTierLimits(null), null)

  noteObservedLimit('m', { isQuota: true, scope: 'day', observedLimit: 20 })
  const first = getFreeTierLimits('m')
  assert.ok(first)
  first.rpd = 9999

  // Callers hand this straight into an API response; a mutation there must not
  // rewrite what every later request reports.
  assert.deepEqual(getFreeTierLimits('m'), { rpd: 20 })
})

test('parking a key also harvests the limit, so no caller can forget', (t) => {
  t.after(clearObservedLimits)
  clearObservedLimits()

  const info = classifyQuotaError(quotaError(dailyQuotaBody))
  markSlotExhausted('webSearch', 'primary', info, 'gemini-3.5-flash-lite')

  assert.deepEqual(getFreeTierLimits('gemini-3.5-flash-lite'), { rpd: 20 })
})

test('parking without a model id still parks the key', (t) => {
  t.after(clearObservedLimits)
  clearObservedLimits()

  const until = markSlotExhausted('webSearch', 'primary', {
    isQuota: true,
    scope: 'minute',
  })
  assert.ok(until > Date.now())
})
