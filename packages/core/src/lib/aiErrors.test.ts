/**
 * Pins the shape of a logged AI failure.
 *
 * The property that matters is negative: the request body must never reach the
 * log. That is what made a real title-analysis failure unreadable -- ~16 KB of
 * scraped article text serialized ahead of the status code, so the cause was
 * present and unreachable.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { APICallError, RetryError } from 'ai'

import { describeAiError, diagnoseFromUrl } from './aiErrors.js'

/** The live failure this module was written for, reconstructed. */
function openRouterFailure(overrides: Partial<ConstructorParameters<typeof APICallError>[0]> = {}) {
  return new APICallError({
    message: 'Provider returned error',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    requestBodyValues: {
      model: 'nvidia/nemotron-3-super-120b-a12b:free',
      max_tokens: 8000,
      messages: [{ role: 'user', content: 'x'.repeat(16000) }],
    },
    statusCode: 502,
    responseBody: '{"error":{"message":"Upstream provider is unavailable","code":502}}',
    isRetryable: true,
    ...overrides,
  })
}

describe('describeAiError', () => {
  test('keeps the fields that identify the fault', () => {
    const described = describeAiError(openRouterFailure())
    assert.equal(described.status, 502)
    assert.equal(described.isRetryable, true)
    assert.equal(described.model, 'nvidia/nemotron-3-super-120b-a12b:free')
    assert.equal(described.url, 'https://openrouter.ai/api/v1/chat/completions')
    assert.match(described.providerMessage ?? '', /Upstream provider is unavailable/)
  })

  test('never carries the request body', () => {
    // The whole point. A 16 KB prompt in a log line is why the status code
    // above went unread twice.
    const serialized = JSON.stringify(describeAiError(openRouterFailure()))
    assert.doesNotMatch(serialized, /x{100}/)
    assert.ok(serialized.length < 1000, `log line was ${serialized.length} chars`)
  })

  test('unwraps a RetryError to the failure underneath', () => {
    // The SDK's backoff wraps the real error, and its own message says only
    // that retries were exhausted -- reading the top of the chain would lose
    // the status on exactly the calls that tried hardest.
    const wrapped = new RetryError({
      message: 'Failed after 3 attempts',
      reason: 'maxRetriesExceeded',
      errors: [openRouterFailure()],
    })
    const described = describeAiError(wrapped)
    assert.equal(described.status, 502)
    assert.equal(described.model, 'nvidia/nemotron-3-super-120b-a12b:free')
  })

  test('a 401 is distinguishable from a 429 and a 502', () => {
    // The three faults look identical from the outside and have completely
    // different fixes: a key, a quota, and nothing you can do locally.
    assert.equal(describeAiError(openRouterFailure({ statusCode: 401 })).status, 401)
    assert.equal(describeAiError(openRouterFailure({ statusCode: 429 })).status, 429)
  })

  test('omits a body that only repeats the message', () => {
    const described = describeAiError(
      openRouterFailure({ responseBody: 'Provider returned error' })
    )
    assert.equal(described.providerMessage, undefined)
  })

  test('a request that never landed has no status', () => {
    // Absent must stay absent: a network failure and a 0 are different claims,
    // and something rendering `status: 0` would read as a real response.
    const described = describeAiError(new Error('fetch failed'))
    assert.equal(described.status, undefined)
    assert.equal(described.message, 'fetch failed')
  })

  test('survives a non-error rejection', () => {
    // Call sites log this unconditionally, so it must not need a type check
    // performed before it to be safe.
    assert.equal(describeAiError('something went wrong').message, 'something went wrong')
    assert.ok(describeAiError(null).message.length > 0)
  })

  test('clips a provider that answers with a wall of text', () => {
    const described = describeAiError(openRouterFailure({ responseBody: 'y'.repeat(5000) }))
    assert.ok((described.providerMessage ?? '').length <= 404)
  })
})

describe('isProviderError', () => {
  test('true for a provider failure, with or without a status', () => {
    assert.equal(describeAiError(openRouterFailure()).isProviderError, true)
    // A dropped connection to the provider is still the provider's half of the
    // job failing, so a caller must not infer "not the model" from a missing
    // status. APICallError carries no statusCode when the request never landed.
    const noStatus = new APICallError({
      message: 'fetch failed',
      url: 'https://openrouter.ai/api/v1/chat/completions',
      requestBodyValues: { model: 'x' },
    })
    assert.equal(describeAiError(noStatus).isProviderError, true)
    assert.equal(describeAiError(noStatus).status, undefined)
  })

  test('false for a failure that never reached a model', () => {
    // This is the discriminator that stopped the analysis panel blaming a
    // search quota for a dead model endpoint -- and, in the default retrieval
    // mode, for a quota that does not exist.
    assert.equal(describeAiError(new Error('CRW search returned no results')).isProviderError, false)
    assert.equal(describeAiError('boom').isProviderError, false)
  })
})

describe('diagnoseFromUrl', () => {
  /** A Z.AI call made against a base URL missing its API path. */
  function zaiFailure(url: string) {
    return new APICallError({
      message: 'Not Found',
      url,
      requestBodyValues: { model: 'glm-5.3' },
      statusCode: 404,
      responseBody: '<html>404</html>',
      isRetryable: false,
    })
  }

  test('names the missing API path on a bare Z.AI host', () => {
    // The whole point: the SDK appends /chat/completions to whatever base URL is
    // configured, so pasting the bare host produces a 404 -- which reads as a
    // dead key to anyone who has configured an AI provider before, and sends
    // them off to regenerate a perfectly good one.
    const hint = diagnoseFromUrl(404, 'https://api.z.ai/chat/completions')
    assert.match(hint ?? '', /\/api\/paas\/v4/)
    // Both platforms are named, because the other half of the mistake is a
    // mainland key against the international host.
    assert.match(hint ?? '', /open\.bigmodel\.cn/)

    assert.ok(diagnoseFromUrl(404, 'https://open.bigmodel.cn/chat/completions'))
  })

  test('says nothing when the path is already right', () => {
    // A 404 from a correctly-formed URL is a different fault -- most likely a
    // model id this account cannot reach -- and telling someone to fix the one
    // setting that is correct is worse than saying nothing at all.
    assert.equal(
      diagnoseFromUrl(404, 'https://api.z.ai/api/paas/v4/chat/completions'),
      undefined
    )
  })

  test('only 404, and only Z.AI', () => {
    // A 401 from a bare host is a key problem and must keep saying so; another
    // vendor's 404 is not this diagnosis to make.
    assert.equal(diagnoseFromUrl(401, 'https://api.z.ai/chat/completions'), undefined)
    assert.equal(diagnoseFromUrl(500, 'https://api.z.ai/chat/completions'), undefined)
    assert.equal(diagnoseFromUrl(404, 'https://openrouter.ai/api/v1/chat/completions'), undefined)
    assert.equal(diagnoseFromUrl(404, 'http://localhost:1234/v1/chat/completions'), undefined)
  })

  test('survives a status or URL it cannot read', () => {
    assert.equal(diagnoseFromUrl(undefined, 'https://api.z.ai/chat/completions'), undefined)
    assert.equal(diagnoseFromUrl(404, undefined), undefined)
    assert.equal(diagnoseFromUrl(404, 'not a url'), undefined)
  })

  test('reaches the description without being asked for', () => {
    // Read off the error's own URL rather than passed in by the caller: an
    // optional provider argument would be supplied by some of the dozen call
    // sites and forgotten by others, so the same fault would be diagnosed on one
    // screen and not another.
    const described = describeAiError(zaiFailure('https://api.z.ai/chat/completions'))
    assert.match(described.hint ?? '', /\/api\/paas\/v4/)
    // The provider's own words survive alongside it -- the hint adds, never
    // replaces.
    assert.ok(described.providerMessage)
    assert.equal(described.status, 404)
  })

  test('absent on an ordinary failure', () => {
    assert.equal(describeAiError(openRouterFailure()).hint, undefined)
    assert.equal(describeAiError(new Error('boom')).hint, undefined)
  })
})
