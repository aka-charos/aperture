import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_DECISION_MODEL_CONFIG,
  DECISION_CONCURRENCY_MAX,
  DECISION_TIMEOUT_MIN_MS,
  isRetryableDecisionFailure,
  isSystemicDecisionFailure,
  modelsUrlFor,
  readNoul,
  readSystemOneUsage,
  sanitizeDecisionModelConfig,
  systemOneUrl,
  type SystemOneUsage,
} from './decisionModelRules.js'

test('the feature is off unless something explicitly turned it on', () => {
  assert.equal(DEFAULT_DECISION_MODEL_CONFIG.enabled, false)
  assert.equal(sanitizeDecisionModelConfig(undefined).enabled, false)
  assert.equal(sanitizeDecisionModelConfig({}).enabled, false)
  // Only a real true counts — a stored string is not a switch.
  assert.equal(sanitizeDecisionModelConfig({ enabled: 'true' as unknown as boolean }).enabled, false)
  assert.equal(sanitizeDecisionModelConfig({ enabled: true }).enabled, true)
})

test('a missing knob takes its default, not its minimum', () => {
  // Number(null) is 0 and finite, so coercing before checking absence would
  // clamp a missing timeout to the floor.
  const config = sanitizeDecisionModelConfig({ timeoutMs: null as unknown as number })
  assert.equal(config.timeoutMs, DEFAULT_DECISION_MODEL_CONFIG.timeoutMs)
  assert.equal(config.concurrency, DEFAULT_DECISION_MODEL_CONFIG.concurrency)
})

test('out-of-range stored values are clamped and junk falls back', () => {
  const config = sanitizeDecisionModelConfig({
    timeoutMs: 5,
    concurrency: 999,
    source: 'nonsense' as never,
    model: '   ',
  })
  assert.equal(config.timeoutMs, DECISION_TIMEOUT_MIN_MS)
  assert.equal(config.concurrency, DECISION_CONCURRENCY_MAX)
  assert.equal(config.source, 'openrouter')
  assert.equal(config.model, DEFAULT_DECISION_MODEL_CONFIG.model)
})

test('a self-hosted URL is accepted as root, /v1 or the full endpoint', () => {
  const want = 'http://host.docker.internal:11435/v1/systemone'
  assert.equal(systemOneUrl('http://host.docker.internal:11435'), want)
  assert.equal(systemOneUrl('http://host.docker.internal:11435/'), want)
  assert.equal(systemOneUrl('http://host.docker.internal:11435/v1'), want)
  assert.equal(systemOneUrl('http://host.docker.internal:11435/v1/systemone'), want)
  assert.equal(systemOneUrl('  http://host.docker.internal:11435/v1/  '), want)
  assert.equal(modelsUrlFor('http://localhost:8009'), 'http://localhost:8009/v1/models')
})

test('anything that is not an http URL has no endpoint', () => {
  assert.equal(systemOneUrl(''), null)
  assert.equal(systemOneUrl('localhost:11435'), null)
  assert.equal(systemOneUrl('ftp://x'), null)
  assert.equal(modelsUrlFor(''), null)
})

test('a noul answer is a probability in [0, 1], and anything else is no answer', () => {
  assert.equal(readNoul({ type: 'noul', noul: 0.93 }), 0.93)
  assert.equal(readNoul({ noul: 0 }), 0)
  assert.equal(readNoul({ type: 'noul', noul: 1 }), 1)
  // Never coerced to "no": a malformed answer must fall back, not hedge.
  assert.equal(readNoul({ type: 'noul', noul: '0.9' }), null)
  assert.equal(readNoul({ type: 'noul', noul: 1.2 }), null)
  assert.equal(readNoul({ type: 'noul', noul: Number.NaN }), null)
  assert.equal(readNoul({ type: 'choice', choice: 'yes' }), null)
  assert.equal(readNoul(null), null)
  assert.equal(readNoul(0.9), null)
})

test('usage is read from the System One spelling, not the OpenAI one', () => {
  // The documented response, as OpenRouter's tutorial prints it.
  const body = {
    model: 'typesafe/jev-1.13-20260917',
    answers: { offsite_transaction: { type: 'noul', noul: 0.05 } },
    usage: { input_tokens: 492, output_tokens: 38, cost: 0.000020664 },
    id: 'gen-dec-1790099229-ahAseXX5gNJzoLiCZICn',
    provider: 'TypeSafe',
  }
  const usage: SystemOneUsage = {}
  readSystemOneUsage(body, usage)
  assert.deepEqual(usage, {
    promptTokens: 492,
    completionTokens: 38,
    cost: 0.000020664,
    generationId: 'gen-dec-1790099229-ahAseXX5gNJzoLiCZICn',
    upstreamProvider: 'TypeSafe',
  })
})

test('a response without usage leaves the accumulator alone', () => {
  const usage: SystemOneUsage = {}
  readSystemOneUsage({ answers: {} }, usage)
  assert.deepEqual(usage, {})
})

test('only configuration faults stop a run at the first failure', () => {
  for (const status of [401, 402, 403, 404]) assert.equal(isSystemicDecisionFailure(status), true)
  // One oversized state answers 400/422 too; that is a fact about one pick.
  for (const status of [400, 422, 429, 500, undefined]) {
    assert.equal(isSystemicDecisionFailure(status), false)
  }
  for (const status of [429, 529, 500, 503]) assert.equal(isRetryableDecisionFailure(status), true)
  for (const status of [400, 401, 422, undefined]) assert.equal(isRetryableDecisionFailure(status), false)
})
