/**
 * Z.AI usage pricing.
 *
 * The regression these exist for is the one a spend dashboard cannot survive:
 * a number that looks like money but is not. Z.AI reports tokens and no cost, so
 * every figure here is computed — which is fine, and is labelled as such — but
 * only as long as it is computed from a published price and never invented. The
 * two ways to invent one are pricing a model nobody published a rate for, and
 * turning "nothing measured" into a confident $0.00.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { priceZaiCall, zaiModelPrices } from './zai-usage.js'

// Prices as zai.json publishes them, verified against docs.z.ai 2026-09-10.
const GLM_53_IN = 1.4
const GLM_53_OUT = 4.4

test('a catalog model is priced from its published per-million rates', () => {
  assert.deepEqual(zaiModelPrices('glm-5.3'), { input: GLM_53_IN, output: GLM_53_OUT })

  // One million each way, so the arithmetic is readable rather than asserted
  // against a magic constant.
  const cost = priceZaiCall('glm-5.3', { promptTokens: 1_000_000, completionTokens: 1_000_000 })
  assert.equal(cost, GLM_53_IN + GLM_53_OUT)
})

test('a free model is priced at zero, and zero is a real answer', () => {
  // The distinction this pins: `inputCostPerMillion: 0` is a PUBLISHED price and
  // must survive, whereas an absent one must not become 0. A truthiness guard
  // would collapse the two and report a free model as unpriceable.
  assert.deepEqual(zaiModelPrices('glm-4.7-flash'), { input: 0, output: 0 })
  assert.equal(priceZaiCall('glm-4.7-flash', { promptTokens: 5000, completionTokens: 5000 }), 0)
})

test('a model the catalog does not list is not priced at all', () => {
  // Every custom model takes this path: `custom_ai_models` has no price columns,
  // so there is nothing to read and nothing may be assumed. The row still
  // carries its token counts; the read side reports it under `pricedCalls`.
  assert.equal(zaiModelPrices('glm-6-imaginary'), null)
  assert.equal(
    priceZaiCall('glm-6-imaginary', { promptTokens: 1000, completionTokens: 1000 }),
    undefined
  )
})

test('nothing measured is priced as nothing, not as free', () => {
  // A failed call reaches the meter with an empty usage object. Returning 0
  // there would file it as a successful free call and quietly pad the
  // priced-call count that the dashboard uses to report its own coverage.
  assert.equal(priceZaiCall('glm-5.3', {}), undefined)
  assert.equal(priceZaiCall('glm-5.3', { promptTokens: 0, completionTokens: 0 }), undefined)
})

test('one direction measured is still a real call', () => {
  // A truncated or empty completion still consumed the prompt, and that is
  // billed. Requiring both would drop exactly the calls worth investigating.
  assert.equal(priceZaiCall('glm-5.3', { promptTokens: 1_000_000 }), GLM_53_IN)
  assert.equal(priceZaiCall('glm-5.3', { completionTokens: 1_000_000 }), GLM_53_OUT)
})

test('reasoning tokens are not billed twice', () => {
  // `completion_tokens_details.reasoning_tokens` is a BREAKDOWN of
  // `completion_tokens`, not an addition to it. Adding it would over-report
  // precisely the models this metering exists to keep an eye on — and it would
  // do so silently, since both numbers are plausible.
  const withScratchpad = priceZaiCall('glm-5.3', {
    promptTokens: 1_000_000,
    completionTokens: 1_000_000,
    reasoningTokens: 900_000,
  })
  assert.equal(withScratchpad, GLM_53_IN + GLM_53_OUT)
})

test('cached prompt tokens are billed at the full rate, deliberately', () => {
  // Z.AI charges less for cached input and the catalog carries no cached rate,
  // so this overshoots. That is the safe direction for a spend figure and the
  // UI says the number is an estimate — but it is a decision, so it is pinned:
  // silently discounting by a rate nobody published would be the worse bug.
  const cached = priceZaiCall('glm-5.3', {
    promptTokens: 1_000_000,
    completionTokens: 0,
    cachedTokens: 1_000_000,
  })
  assert.equal(cached, GLM_53_IN)
})

test('every catalog model either has both prices or neither', () => {
  // A model with an input price and no output price would silently bill its
  // completions at zero — the one shape that produces a confident undercount.
  for (const id of ['glm-5.3', 'glm-5.3-flash', 'glm-4.7', 'glm-4.7-flash', 'glm-4.6']) {
    const prices = zaiModelPrices(id)
    assert.ok(prices, `${id} should be in the catalog`)
    assert.equal(typeof prices.input, 'number', id)
    assert.equal(typeof prices.output, 'number', id)
  }
})
