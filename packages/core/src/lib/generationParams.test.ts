/**
 * Sampling settings: what is offered, what is stored, what is sent.
 *
 * The failures pinned here are all silent. A value sent to a model that does
 * not accept it is DROPPED by OpenRouter rather than refused, so the wrong
 * answer looks exactly like the right one from the settings page; a value
 * clamped instead of refused makes the page and the wire disagree about what
 * was asked for; and a stray default would change every existing role's
 * requests on the deploy that introduced the feature.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  GENERATION_PARAMETERS,
  GENERATION_PARAM_RANGES,
  ROLES_WITH_GENERATION_PARAMS,
  SUGGESTED_GENERATION_PARAMS,
  generationParamsFor,
  resolveGenerationDelivery,
  resolveGenerationParams,
  roleReadsGenerationParams,
} from './generationParams.js'

// The shape a live OpenRouter entry has. Copied from the real catalogue read on
// 2026-09-11, because the whole design rests on this field being populated for
// the model the feature was built to tune.
const deepseek = {
  supportedParameters: [
    'frequency_penalty',
    'include_reasoning',
    'logit_bias',
    'logprobs',
    'max_tokens',
    'min_p',
    'presence_penalty',
    'reasoning',
    'reasoning_effort',
    'repetition_penalty',
    'response_format',
    'seed',
    'stop',
    'structured_outputs',
    'temperature',
    'tool_choice',
    'tools',
    'top_k',
    'top_logprobs',
    'top_p',
  ],
}

// Measured: `anthropic/claude-sonnet-5` declares neither. This is the case that
// makes the gate load-bearing rather than decorative.
const refuser = { supportedParameters: ['max_tokens', 'reasoning', 'tools'] }

test('a model that declares both is offered both, in display order', () => {
  assert.deepEqual(generationParamsFor(deepseek), ['temperature', 'top_p'])
})

test('a model that declares neither is offered nothing', () => {
  assert.deepEqual(generationParamsFor(refuser), [])
})

// Absent is a positive fact, not an unknown to be optimistic about — the
// discipline F-097 had to retrofit onto the embedding input type.
test('no declaration means no control, never "anything goes"', () => {
  assert.deepEqual(generationParamsFor(undefined), [])
  assert.deepEqual(generationParamsFor(null), [])
  assert.deepEqual(generationParamsFor({}), [])
  assert.deepEqual(generationParamsFor({ supportedParameters: [] }), [])
})

test('a model declaring only one gets only that one', () => {
  assert.deepEqual(generationParamsFor({ supportedParameters: ['temperature'] }), ['temperature'])
  assert.deepEqual(generationParamsFor({ supportedParameters: ['top_p'] }), ['top_p'])
})

test('an unset config sends nothing', () => {
  assert.deepEqual(resolveGenerationParams(null), {})
  assert.deepEqual(resolveGenerationParams({}), {})
  assert.deepEqual(resolveGenerationParams(undefined), {})
})

test('a stored value survives the round trip', () => {
  assert.deepEqual(resolveGenerationParams({ temperature: 0.3, topP: 0.9 }), {
    temperature: 0.3,
    topP: 0.9,
  })
})

// Zero is a real temperature (greedy decoding) and must not be swallowed by a
// truthiness test — the NUMERIC-arrives-as-a-string trap in another costume.
test('temperature 0 is a value, not an absence', () => {
  assert.deepEqual(resolveGenerationParams({ temperature: 0 }), { temperature: 0 })
})

// top_p 0 is not a low setting, it is an empty nucleus, and endpoints disagree
// about what to do with it.
test('top_p 0 is refused while temperature 0 is kept', () => {
  assert.deepEqual(resolveGenerationParams({ topP: 0 }), {})
})

test('out of range reads as unset rather than being clamped', () => {
  assert.deepEqual(resolveGenerationParams({ temperature: 2.5 }), {})
  assert.deepEqual(resolveGenerationParams({ temperature: -1 }), {})
  assert.deepEqual(resolveGenerationParams({ topP: 1.5 }), {})
})

test('a non-number is unset, not coerced', () => {
  assert.deepEqual(
    resolveGenerationParams({ temperature: '0.3' as unknown as number }),
    {}
  )
  assert.deepEqual(resolveGenerationParams({ temperature: Number.NaN }), {})
  assert.deepEqual(resolveGenerationParams({ topP: Number.POSITIVE_INFINITY }), {})
})

test('a declared parameter is delivered', () => {
  const d = resolveGenerationDelivery({ model: deepseek, params: { temperature: 0.3, topP: 0.9 } })
  assert.deepEqual(d.params, { temperature: 0.3, topP: 0.9 })
  assert.deepEqual(d.undeliverable, [])
})

// The whole point: this must not reach the wire, AND the caller must be able to
// say so, because OpenRouter would drop it without complaining.
test('an undeclared parameter is dropped and reported', () => {
  const d = resolveGenerationDelivery({ model: refuser, params: { temperature: 0.3, topP: 0.9 } })
  assert.deepEqual(d.params, {})
  assert.deepEqual(d.undeliverable, ['temperature', 'top_p'])
})

test('a partial declaration delivers one and reports the other', () => {
  const d = resolveGenerationDelivery({
    model: { supportedParameters: ['temperature'] },
    params: { temperature: 0.3, topP: 0.9 },
  })
  assert.deepEqual(d.params, { temperature: 0.3 })
  assert.deepEqual(d.undeliverable, ['top_p'])
})

// Nothing asked for and nothing delivered is not an event: a role on a provider
// that declares nothing must not warn on every call it makes.
test('nothing set reports nothing undeliverable', () => {
  const d = resolveGenerationDelivery({ model: null, params: {} })
  assert.deepEqual(d.params, {})
  assert.deepEqual(d.undeliverable, [])
})

// The role list is deliberately one entry — see its docstring. Pinned so that
// widening it is a decision someone makes on purpose, with the call sites in
// hand, rather than a line added while passing.
test('only the role with complete call-site coverage reads these', () => {
  assert.deepEqual([...ROLES_WITH_GENERATION_PARAMS], ['titleAnalysis'])
  assert.equal(roleReadsGenerationParams('titleAnalysis'), true)
  assert.equal(roleReadsGenerationParams('textGeneration'), false)
  assert.equal(roleReadsGenerationParams('chat'), false)
  assert.equal(roleReadsGenerationParams('embeddings'), false)
})

// A suggestion outside its own field's range would be a placeholder the save
// route refuses — the offered value and the accepted value drifting, one
// module's worth of the fault this file exists to prevent.
test('every suggestion is inside the range it suggests for', () => {
  for (const [role, s] of Object.entries(SUGGESTED_GENERATION_PARAMS)) {
    const t = GENERATION_PARAM_RANGES.temperature
    const p = GENERATION_PARAM_RANGES.top_p
    assert.ok(s.temperature >= t.min && s.temperature <= t.max, `${role} temperature`)
    assert.ok(s.topP >= p.min && s.topP <= p.max, `${role} topP`)
    assert.deepEqual(resolveGenerationParams({ temperature: s.temperature, topP: s.topP }), {
      temperature: s.temperature,
      topP: s.topP,
    })
  }
})

// The wire names are read straight out of the catalogue with `includes`, so a
// rename here silently turns every control off.
test('the parameter names are the catalogue wire names', () => {
  assert.deepEqual([...GENERATION_PARAMETERS], ['temperature', 'top_p'])
})
