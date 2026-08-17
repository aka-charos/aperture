import test from 'node:test'
import assert from 'node:assert/strict'

import {
  classifyQuotaError,
  clearObservedLimits,
  getFreeTierLimits,
  markSlotExhausted,
  noteObservedLimit,
  resolveModelLimits,
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

// ============================================================================
// Grounding quota — a different ceiling from the model's own
// ============================================================================

test('a grounding refusal is not filed as the model’s own daily limit', (t) => {
  t.after(clearObservedLimits)
  clearObservedLimits()

  // 1,500 grounded searches a day and 20 model requests a day are both "per
  // day" quotas, so without the grounding check the search allowance would be
  // drawn on a bar measuring a model capped at 20.
  const info = classifyQuotaError(
    quotaError({
      error: {
        message: 'You exceeded your current quota.',
        details: [
          {
            violations: [
              {
                quotaId: 'GroundingWithGoogleSearchRequestsPerDayPerProject-FreeTier',
                quotaValue: '1500',
              },
            ],
          },
        ],
      },
    })
  )
  assert.equal(info.limitIsGrounding, true)

  noteObservedLimit('m', info)
  assert.deepEqual(getFreeTierLimits('m'), { groundingRpd: 1500 })
})

test('an ordinary model 429 is not mistaken for a grounding one', () => {
  // The everyday quota ids carry neither "grounding" nor "search", and neither
  // do Gemini model ids — this is what keeps the guard from firing on them.
  const info = classifyQuotaError(quotaError(dailyQuotaBody))
  assert.notEqual(info.limitIsGrounding, true)
  assert.equal(info.scope, 'day')
})

// ============================================================================
// Free-tier defaults, and their subordination to what Google enforces
// ============================================================================

test('the free-tier table supplies a denominator when nothing has been observed', (t) => {
  t.after(clearObservedLimits)
  clearObservedLimits()

  const limits = resolveModelLimits('gemini-2.5-flash', { freeTier: true })
  assert.ok(limits)
  assert.equal(limits.rpd, 20)
  assert.equal(limits.rpm, 5)
  assert.equal(limits.tpm, 250_000)
  assert.equal(limits.source, 'freeTier')
})

test('turning the free tier off withdraws the table but not the evidence', (t) => {
  t.after(clearObservedLimits)
  clearObservedLimits()

  // A paid project's real budget is many times the free one, so asserting the
  // free ceiling there is the same confidently-wrong gauge in different clothes.
  assert.equal(resolveModelLimits('gemini-2.5-flash', { freeTier: false }), null)

  // A 429 is a fact about this account whatever tier it is on.
  noteObservedLimit('gemini-2.5-flash', { isQuota: true, scope: 'day', observedLimit: 10_000 })
  const limits = resolveModelLimits('gemini-2.5-flash', { freeTier: false })
  assert.deepEqual(limits, { rpd: 10_000, source: 'observed' })
})

test('what Google enforced overrides the table, field by field', (t) => {
  t.after(clearObservedLimits)
  clearObservedLimits()

  // The table says 20/day for this model. If the account actually enforces 50,
  // the table must lose — that inversion is the whole reason the old one was
  // deleted — while the fields it said nothing about survive underneath.
  noteObservedLimit('gemini-2.5-flash', { isQuota: true, scope: 'day', observedLimit: 50 })

  const limits = resolveModelLimits('gemini-2.5-flash', { freeTier: true })
  assert.ok(limits)
  assert.equal(limits.rpd, 50)
  assert.equal(limits.rpm, 5)
  assert.equal(limits.source, 'mixed')
})

test('the Gemini 3.x family has a grounding allowance of zero, and zero is an answer', () => {
  // The finding that decides which model a free-tier Web Search role can use:
  // 3.5 Flash Lite has 25× the daily requests of 2.5 Flash and cannot ground at
  // all. Read with `!= null`, never truthily, or "none" reads as "unknown".
  const lite = resolveModelLimits('gemini-3.5-flash-lite', { freeTier: true })
  assert.ok(lite)
  assert.equal(lite.rpd, 500)
  assert.equal(lite.groundingRpd, 0)

  const flash = resolveModelLimits('gemini-2.5-flash', { freeTier: true })
  assert.equal(flash?.groundingRpd, 1500)
})

test('the longest family prefix wins, so 2.5 is not read as plain 2.x', () => {
  // Today both buckets say 1,500 and the ordering is invisible; the next
  // revision of Google's page is exactly when it would stop being.
  assert.equal(resolveModelLimits('gemini-2.5-flash-lite', { freeTier: true })?.groundingRpd, 1500)
  assert.equal(resolveModelLimits('gemini-3.7-flash', { freeTier: true })?.groundingRpd, 0)
})

test('a model the table does not cover stays silent', (t) => {
  t.after(clearObservedLimits)
  clearObservedLimits()

  // Legacy and unknown ids get no bar rather than a borrowed number — the
  // panel renders bare counts, which is the honest state.
  assert.equal(resolveModelLimits('gemini-1.5-pro', { freeTier: true }), null)
  assert.equal(resolveModelLimits('some-model-nobody-shipped', { freeTier: true }), null)
  assert.equal(resolveModelLimits(null, { freeTier: true }), null)
})
