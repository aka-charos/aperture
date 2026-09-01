/**
 * The reasoning-effort mapping.
 *
 * The regression these exist for: this module first shipped with a fixed
 * `minimal | low | medium | high` union applied to every model on two
 * providers. Measured against OpenRouter's live catalog that is wrong three
 * ways at once — it offers words a model rejects (`minimal` to Anthropic),
 * hides words it accepts (`xhigh`, `max`, `none`), and cannot grow. So the
 * tests below drive the resolver with REAL vocabularies read off the live
 * catalog on 2026-09-01, not with a convenient invented one.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  KNOWN_REASONING_EFFORTS,
  THINKING_LEVELS,
  ROLES_WITH_REASONING_EFFORT,
  isThinkingLevel,
  orderReasoningEfforts,
  reasoningEffortsFor,
  resolveReasoningEffort,
  resolveReasoningOptions,
  roleReadsReasoningEffort,
  type ReasoningCapableModel,
} from './reasoningEffort.js'

/** Vocabularies as OpenRouter published them, verbatim. */
const OPENROUTER = {
  // google/gemini-3.6-flash and 18 others
  gemini: ['high', 'medium', 'low', 'minimal'],
  // openai/gpt-5.6-luna-pro and 12 others
  gpt: ['max', 'xhigh', 'high', 'medium', 'low', 'none'],
  // anthropic/claude-opus-4.6 and 3 others
  claude: ['max', 'high', 'medium', 'low'],
  // sakana/fugu-ultra
  fugu: ['max', 'xhigh', 'high'],
} as const

const orModel = (efforts: readonly string[]): ReasoningCapableModel => ({
  reasoningMechanism: 'effort',
  supportedEfforts: efforts,
})

const googleModel: ReasoningCapableModel = { reasoningMechanism: 'thinkingLevel' }

// ---------------------------------------------------------------------------
// Absent means send nothing
// ---------------------------------------------------------------------------

test('no effort configured sends nothing and reports no problem', () => {
  const out = resolveReasoningOptions({
    provider: 'openrouter',
    model: orModel(OPENROUTER.gpt),
    effort: undefined,
  })
  assert.equal(out.providerOptions, undefined)
  // Not `undeliverable` — nothing was asked for, so nothing failed. The caller
  // logs only a real failure, and conflating the two would warn on every call
  // made by every role that has never chosen an effort.
  assert.equal(out.undeliverable, null)
})

test('a model declaring no mechanism takes no effort', () => {
  // gemini-1.5-pro / gemini-2.5-flash in google.json: 2.5 uses thinkingBudget
  // (a token count) and 1.5 has no thinking at all. Sending thinking_level to
  // either is a 400, which is what a provider-level guard used to ship.
  const out = resolveReasoningOptions({ provider: 'google', model: {}, effort: 'high' })
  assert.equal(out.providerOptions, undefined)
  assert.equal(out.undeliverable, 'model')
})

test('a model the catalog does not know takes no effort', () => {
  for (const model of [null, undefined]) {
    const out = resolveReasoningOptions({ provider: 'openrouter', model, effort: 'high' })
    assert.equal(out.providerOptions, undefined)
    assert.equal(out.undeliverable, 'model')
  }
})

// ---------------------------------------------------------------------------
// The vocabulary is the MODEL'S, not the app's
// ---------------------------------------------------------------------------

test('each model offers exactly what the catalog says, and nothing else', () => {
  assert.deepEqual(reasoningEffortsFor(orModel(OPENROUTER.claude)), OPENROUTER.claude)
  assert.deepEqual(reasoningEffortsFor(orModel(OPENROUTER.fugu)), OPENROUTER.fugu)
  assert.deepEqual(reasoningEffortsFor(orModel([])), [])
  assert.deepEqual(reasoningEffortsFor(orModel(OPENROUTER.gpt)), OPENROUTER.gpt)
})

test('a word one model takes is refused on a model that does not list it', () => {
  // The exact fault the old fixed union shipped: `minimal` is real on Gemini
  // and absent from Anthropic's list, and `xhigh`/`max` are the mirror image.
  assert.equal(
    resolveReasoningOptions({
      provider: 'openrouter',
      model: orModel(OPENROUTER.claude),
      effort: 'minimal',
    }).undeliverable,
    'effort'
  )
  assert.equal(
    resolveReasoningOptions({
      provider: 'openrouter',
      model: orModel(OPENROUTER.gemini),
      effort: 'max',
    }).undeliverable,
    'effort'
  )
})

test('words outside the old union are delivered, not dropped', () => {
  // `xhigh`, `max` and `none` are real on the live catalog and were
  // unrepresentable before. `none` matters most: for a batch writing role it is
  // the strongest form of the thing this feature exists to do.
  for (const effort of ['xhigh', 'max', 'none'] as const) {
    const out = resolveReasoningOptions({
      provider: 'openrouter',
      model: orModel(OPENROUTER.gpt),
      effort,
    })
    assert.deepEqual(out.providerOptions, { openrouter: { reasoning: { effort } } })
    assert.equal(out.undeliverable, null)
  }
})

test('a word the catalog invents tomorrow is offered and sent, not filtered', () => {
  // KNOWN_REASONING_EFFORTS is a display order, never a filter — filtering
  // there would hide a capability the model genuinely has, which is the class
  // of bug this module was rebuilt to stop making.
  const exotic = orModel(['low', 'ultra'])
  assert.ok(reasoningEffortsFor(exotic).includes('ultra'))
  assert.deepEqual(
    resolveReasoningOptions({ provider: 'openrouter', model: exotic, effort: 'ultra' })
      .providerOptions,
    { openrouter: { reasoning: { effort: 'ultra' } } }
  )
})

test('nothing is rounded to a neighbouring level', () => {
  // Mapping `minimal` onto `low` would make the settings page and the wire
  // disagree about what was asked for, and the silent direction of that error
  // is cheaper thinking than requested. Falling back to the provider default
  // errs toward MORE thinking — a cost an operator can see.
  const out = resolveReasoningOptions({
    provider: 'openrouter',
    model: orModel(OPENROUTER.claude),
    effort: 'minimal',
  })
  assert.equal(out.providerOptions, undefined)
})

// ---------------------------------------------------------------------------
// Google's mechanism is fixed by the SDK, not by the catalog
// ---------------------------------------------------------------------------

test('thinkingLevel takes exactly the SDK enum, whatever else is declared', () => {
  assert.deepEqual(reasoningEffortsFor(googleModel), THINKING_LEVELS)
  // A supportedEfforts claim on a thinkingLevel model must not widen it: the
  // SDK validates this field against a zod enum before the request is built, so
  // an off-list value throws locally rather than reaching Google.
  assert.deepEqual(
    reasoningEffortsFor({ reasoningMechanism: 'thinkingLevel', supportedEfforts: ['max'] }),
    THINKING_LEVELS
  )
  assert.equal(
    resolveReasoningOptions({
      provider: 'google',
      model: { reasoningMechanism: 'thinkingLevel', supportedEfforts: ['max'] },
      effort: 'max',
    }).undeliverable,
    'effort'
  )
})

test('google nests under thinkingConfig, all four levels', () => {
  for (const effort of THINKING_LEVELS) {
    const out = resolveReasoningOptions({ provider: 'google', model: googleModel, effort })
    assert.deepEqual(out.providerOptions, { google: { thinkingConfig: { thinkingLevel: effort } } })
    assert.equal(out.undeliverable, null)
  }
})

// ---------------------------------------------------------------------------
// The namespace key must be the provider id
// ---------------------------------------------------------------------------

test('a mechanism on the wrong provider is refused, not misfiled', () => {
  // The SDK hands providerOptions.<id> to that provider and silently ignores
  // every other key, so a mismatch is not an error — it is a setting that
  // saves, displays and does nothing.
  assert.equal(
    resolveReasoningOptions({ provider: 'google', model: orModel(['high']), effort: 'high' })
      .undeliverable,
    'provider'
  )
  assert.equal(
    resolveReasoningOptions({ provider: 'openrouter', model: googleModel, effort: 'high' })
      .undeliverable,
    'provider'
  )
  assert.equal(
    resolveReasoningOptions({ provider: 'anthropic', model: orModel(['high']), effort: 'high' })
      .undeliverable,
    'provider'
  )
})

test('every delivered namespace key is the provider id it was resolved for', () => {
  const cases = [
    { provider: 'openrouter', model: orModel(OPENROUTER.gpt), effort: 'high' },
    { provider: 'google', model: googleModel, effort: 'low' },
  ]
  for (const c of cases) {
    const out = resolveReasoningOptions(c)
    assert.ok(out.providerOptions, `${c.provider} should deliver`)
    assert.deepEqual(Object.keys(out.providerOptions), [c.provider])
  }
})

// ---------------------------------------------------------------------------
// Normalisation and ordering
// ---------------------------------------------------------------------------

test('a stored effort is trimmed and lower-cased, and blank reads as unset', () => {
  assert.equal(resolveReasoningEffort({ reasoningEffort: '  HIGH ' }), 'high')
  assert.equal(resolveReasoningEffort({ reasoningEffort: 'xHigh' }), 'xhigh')
  assert.equal(resolveReasoningEffort({ reasoningEffort: '   ' }), undefined)
  assert.equal(resolveReasoningEffort({ reasoningEffort: '' }), undefined)
  assert.equal(resolveReasoningEffort({}), undefined)
  assert.equal(resolveReasoningEffort(null), undefined)
  assert.equal(resolveReasoningEffort(undefined), undefined)
})

test('an unrecognised stored value is NOT dropped here', () => {
  // Normalisation only. Whether a word is acceptable depends on the model, and
  // deciding it here would need a vocabulary — the thing this module no longer
  // has. The resolver refuses it once it knows which model is in hand.
  assert.equal(resolveReasoningEffort({ reasoningEffort: 'ultra' }), 'ultra')
  assert.equal(
    resolveReasoningOptions({
      provider: 'openrouter',
      model: orModel(OPENROUTER.gemini),
      effort: 'ultra',
    }).undeliverable,
    'effort'
  )
})

test('ordering is weakest first and keeps unknown words at the end', () => {
  assert.deepEqual(orderReasoningEfforts(OPENROUTER.gpt), [
    'none',
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
  ])
  assert.deepEqual(orderReasoningEfforts(OPENROUTER.gemini), ['minimal', 'low', 'medium', 'high'])
  assert.deepEqual(orderReasoningEfforts(['ultra', 'high', 'low']), ['low', 'high', 'ultra'])
  // Ordering must not add or drop anything.
  assert.equal(orderReasoningEfforts(OPENROUTER.fugu).length, OPENROUTER.fugu.length)
})

test('KNOWN_REASONING_EFFORTS covers every word the live catalog publishes', () => {
  // Measured 2026-09-01 across all 418 models: the union of every
  // supported_efforts list. A word missing here still works (it sorts last and
  // labels as itself) but has no translated label, so this is the reminder.
  const observed = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
  for (const word of observed) {
    assert.ok(
      (KNOWN_REASONING_EFFORTS as readonly string[]).includes(word),
      `${word} is published by OpenRouter and needs a label`
    )
  }
})

test('isThinkingLevel guards the SDK enum', () => {
  assert.ok(isThinkingLevel('minimal'))
  assert.ok(!isThinkingLevel('xhigh'))
  assert.ok(!isThinkingLevel('none'))
  assert.ok(!isThinkingLevel(undefined))
})

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

test('only the batch writing roles read an effort', () => {
  assert.deepEqual([...ROLES_WITH_REASONING_EFFORT], ['textGeneration', 'titleAnalysis'])
  assert.ok(roleReadsReasoningEffort('textGeneration'))
  assert.ok(roleReadsReasoningEffort('titleAnalysis'))
  // chat is interactive — a reader is watching and thinking is often the point.
  assert.ok(!roleReadsReasoningEffort('chat'))
  assert.ok(!roleReadsReasoningEffort('embeddings'))
  assert.ok(!roleReadsReasoningEffort('webSearch'))
  assert.ok(!roleReadsReasoningEffort('exploration'))
})
