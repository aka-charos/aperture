import test from 'node:test'
import assert from 'node:assert/strict'
import {
  EMBEDDING_INPUT_TYPES,
  EMBEDDING_MODE_SEPARATOR,
  UNKNOWN_EMBEDDING_SET,
  describeEmbeddingSetId,
  embeddingSetId,
  googleTaskTypeFor,
  isEmbeddingInputType,
  providerSupportsInputType,
  resolveEmbeddingInputType,
  resolveInputTypeDelivery,
  requiresProviderPin,
} from './embeddingIdentity.js'

/**
 * The set id is what separates one population of vectors from another: rows are
 * keyed `UNIQUE(<item>_id, model)` and every read filters `WHERE model = $n`.
 *
 * Two failures are worth a test each, and they fail in opposite directions.
 * Decorate the no-mode case and every embedding already on disk stops matching,
 * which looks like a library that lost its vectors overnight. Fail to decorate
 * the mode case and two genuinely different spaces share one id, so the second
 * embedding pass upserts over the first and the A/B it was run for is gone.
 */

// ============================================================================
// The absent case must be byte-identical to what shipped before modes existed
// ============================================================================

test('no mode produces the exact legacy provider:model string', () => {
  assert.equal(
    embeddingSetId({ provider: 'openrouter', model: 'google/gemini-embedding-001' }),
    'openrouter:google/gemini-embedding-001'
  )
})

test('an explicitly undefined mode is still the legacy string', () => {
  assert.equal(
    embeddingSetId({
      provider: 'openrouter',
      model: 'google/gemini-embedding-001',
      embeddingInputType: undefined,
    }),
    'openrouter:google/gemini-embedding-001'
  )
})

test('an empty or whitespace mode is still the legacy string', () => {
  // A settings field cleared by the admin arrives as '' rather than undefined.
  // If that decorated the id, saving the card without choosing a mode would
  // orphan the whole library.
  for (const blank of ['', '   ', '\t', '\n']) {
    assert.equal(
      embeddingSetId({
        provider: 'openrouter',
        model: 'google/gemini-embedding-001',
        embeddingInputType: blank,
      }),
      'openrouter:google/gemini-embedding-001',
      `blank mode ${JSON.stringify(blank)} must not decorate the id`
    )
  }
})

test('an unrecognised mode is dropped rather than forwarded', () => {
  // OpenRouter's input_type is an unconstrained string, so a typo would be
  // accepted, ignored by the provider, and stored under an id claiming a mode
  // the vectors were never embedded in.
  assert.equal(
    embeddingSetId({
      provider: 'openrouter',
      model: 'google/gemini-embedding-001',
      embeddingInputType: 'sematic_similarity',
    }),
    'openrouter:google/gemini-embedding-001'
  )
  assert.equal(resolveEmbeddingInputType({ embeddingInputType: 'sematic_similarity' }), undefined)
})

// ============================================================================
// A mode makes a distinct set
// ============================================================================

test('a mode suffixes the id so both modes can be stored side by side', () => {
  const bare = embeddingSetId({ provider: 'openrouter', model: 'google/gemini-embedding-001' })
  const semantic = embeddingSetId({
    provider: 'openrouter',
    model: 'google/gemini-embedding-001',
    embeddingInputType: 'semantic_similarity',
  })

  assert.equal(semantic, 'openrouter:google/gemini-embedding-001~semantic_similarity')
  assert.notEqual(bare, semantic)
})

test('every declared mode yields its own distinct id', () => {
  const ids = new Set(
    EMBEDDING_INPUT_TYPES.map((mode) =>
      embeddingSetId({
        provider: 'openrouter',
        model: 'google/gemini-embedding-2',
        embeddingInputType: mode,
      })
    )
  )
  assert.equal(ids.size, EMBEDDING_INPUT_TYPES.length)
})

test('mode is normalised, so one space cannot become two sets', () => {
  const canonical = 'openrouter:google/gemini-embedding-001~semantic_similarity'
  for (const spelling of ['semantic_similarity', 'SEMANTIC_SIMILARITY', ' Semantic_Similarity ']) {
    assert.equal(
      embeddingSetId({
        provider: 'openrouter',
        model: 'google/gemini-embedding-001',
        embeddingInputType: spelling,
      }),
      canonical,
      `${JSON.stringify(spelling)} must normalise onto the canonical id`
    )
  }
})

// ============================================================================
// Separator safety
// ============================================================================

test('the separator does not occur in real model ids', () => {
  // ':' and '/' are both already inside model ids, which is why neither can
  // delimit anything. ':free' is the OpenRouter variant suffix.
  const realIds = [
    'google/gemini-embedding-001',
    'google/gemini-embedding-2',
    'qwen/qwen3-embedding-8b',
    'qwen/qwen3-embedding-8b:free',
    'text-embedding-3-large',
    'nomic-embed-text',
  ]
  for (const id of realIds) {
    assert.ok(
      !id.includes(EMBEDDING_MODE_SEPARATOR),
      `${id} must not contain the separator`
    )
  }
})

test('a model id containing colons and slashes round-trips', () => {
  const setId = embeddingSetId({
    provider: 'openrouter',
    model: 'qwen/qwen3-embedding-8b:free',
    embeddingInputType: 'search_document',
  })
  assert.deepEqual(describeEmbeddingSetId(setId), {
    base: 'openrouter:qwen/qwen3-embedding-8b:free',
    mode: 'search_document',
  })
})

test('a legacy id describes as itself with no mode', () => {
  assert.deepEqual(describeEmbeddingSetId('openrouter:google/gemini-embedding-001'), {
    base: 'openrouter:google/gemini-embedding-001',
  })
})

test('a tilde followed by something that is not a mode is left alone', () => {
  // Better to render an odd label than to silently claim a mode.
  assert.deepEqual(describeEmbeddingSetId('openrouter:some~model'), {
    base: 'openrouter:some~model',
  })
})

// ============================================================================
// Unconfigured
// ============================================================================

test('a missing or incomplete config reads as the unknown set', () => {
  assert.equal(embeddingSetId(null), UNKNOWN_EMBEDDING_SET)
  assert.equal(embeddingSetId(undefined), UNKNOWN_EMBEDDING_SET)
  assert.equal(embeddingSetId({ provider: 'openrouter', model: '' }), UNKNOWN_EMBEDDING_SET)
  assert.equal(embeddingSetId({ provider: '', model: 'x' }), UNKNOWN_EMBEDDING_SET)
})

// ============================================================================
// Provider mapping
// ============================================================================

test('google task types map from the OpenRouter vocabulary', () => {
  assert.equal(googleTaskTypeFor('semantic_similarity'), 'SEMANTIC_SIMILARITY')
  assert.equal(googleTaskTypeFor('search_query'), 'RETRIEVAL_QUERY')
  assert.equal(googleTaskTypeFor('search_document'), 'RETRIEVAL_DOCUMENT')
  assert.equal(googleTaskTypeFor(undefined), undefined)
})

test('every declared mode has a google mapping', () => {
  // A mode added to the list without a mapping would be stored in the set id
  // and then silently not sent on the google provider.
  for (const mode of EMBEDDING_INPUT_TYPES) {
    assert.ok(googleTaskTypeFor(mode), `${mode} has no google task type`)
  }
})

test('only providers that can carry a mode are listed', () => {
  assert.ok(providerSupportsInputType('openrouter'))
  assert.ok(providerSupportsInputType('google'))
  for (const other of ['openai', 'ollama', 'openai-compatible', 'huggingface']) {
    assert.ok(!providerSupportsInputType(other), `${other} cannot carry a mode`)
  }
})

test('isEmbeddingInputType rejects near-misses and non-strings', () => {
  assert.ok(isEmbeddingInputType('semantic_similarity'))
  assert.ok(!isEmbeddingInputType('SEMANTIC_SIMILARITY'))
  assert.ok(!isEmbeddingInputType('semantic-similarity'))
  assert.ok(!isEmbeddingInputType(undefined))
  assert.ok(!isEmbeddingInputType(null))
  assert.ok(!isEmbeddingInputType(3))
})

// ============================================================================
// How a mode is delivered
// ============================================================================

/**
 * Three ways to be silently wrong, none of which raises anything: send a
 * parameter the model ignores, prepend a prefix the model does not expect, or
 * read a byte-identical response as proof a mode was honoured rather than
 * dropped. The third is what actually happened — gemini-embedding-2 returns the
 * identical vector for `semantic_similarity` and for nothing at all, and that
 * was read as "its default is already semantic".
 */

test('no mode asked for means nothing is delivered', () => {
  assert.deepEqual(resolveInputTypeDelivery({}), { mechanism: 'none' })
  assert.deepEqual(
    resolveInputTypeDelivery({ mechanism: 'textPrefix', prefixes: { semantic_similarity: 'x' } }),
    { mechanism: 'none' }
  )
})

test('a parameter model gets the parameter and no prefix', () => {
  assert.deepEqual(
    resolveInputTypeDelivery({ inputType: 'semantic_similarity', mechanism: 'parameter' }),
    // No declared spelling, so the canonical name is what would be sent.
    { mechanism: 'parameter', parameterValue: 'semantic_similarity' }
  )
})

test('an unstated mechanism defaults to parameter', () => {
  // Every model but gemini-2, and every custom model, which has no catalog entry.
  assert.deepEqual(resolveInputTypeDelivery({ inputType: 'search_query' }), {
    mechanism: 'parameter',
    parameterValue: 'search_query',
  })
})

test('a textPrefix model gets the prefix and no parameter', () => {
  const out = resolveInputTypeDelivery({
    inputType: 'semantic_similarity',
    mechanism: 'textPrefix',
    prefixes: { semantic_similarity: 'task: sentence similarity | query: ' },
  })
  assert.deepEqual(out, {
    mechanism: 'textPrefix',
    prefix: 'task: sentence similarity | query: ',
  })
})

test('a textPrefix model with no prefix for that mode delivers nothing', () => {
  // Google documents an asymmetric `title: … | text: …` form this app has never
  // measured and does not want. Absent rather than guessed, and asking for it
  // must fall back to the unconditioned space -- which is where every other row
  // of a fresh set will be -- not to a parameter the model ignores.
  assert.deepEqual(
    resolveInputTypeDelivery({
      inputType: 'search_document',
      mechanism: 'textPrefix',
      prefixes: { semantic_similarity: 'task: sentence similarity | query: ' },
    }),
    { mechanism: 'none' }
  )
})

test('a textPrefix model is never sent the parameter as a consolation', () => {
  // The whole point: gemini-2 ignores input_type, so sending it alongside would
  // be noise in the request and would read to the next maintainer as though the
  // mode were being delivered that way.
  for (const mode of EMBEDDING_INPUT_TYPES) {
    const out = resolveInputTypeDelivery({
      inputType: mode,
      mechanism: 'textPrefix',
      prefixes: { semantic_similarity: 'p' },
    })
    assert.notEqual(out.mechanism, 'parameter', `${mode} must not fall back to a parameter`)
  }
})

// ============================================================================
// The upstream pin
// ============================================================================

/**
 * OpenRouter picks an upstream per call, and they need not treat an
 * undocumented field alike. Measured on gemini-embedding-001: google-vertex
 * honours input_type, google-ai-studio drops it, each deterministic alone. So
 * for a PARAMETER mode the pin decides the space, and must be in the identity.
 * For a TEXT PREFIX mode it decides nothing -- every upstream gets a different
 * input and computes the same answer for it.
 */

/**
 * The wire spelling is the UPSTREAM's, not ours.
 *
 * `input_type` on OpenRouter is a passthrough. Measured on
 * gemini-embedding-001 pinned to google-vertex: the lower-case canonical name
 * is accepted when `input` is a single string and rejected with HTTP 400 when
 * `input` is an array, because OpenRouter normalises on one path and forwards
 * verbatim on the other. `embedMany` always sends an array, so every probe that
 * embedded one document at a time passed while the library job failed on its
 * first batch of 25.
 */
test('a declared spelling is what goes on the wire', () => {
  const { mechanism, parameterValue } = resolveInputTypeDelivery({
    inputType: 'semantic_similarity',
    mechanism: 'parameter',
    values: { semantic_similarity: 'SEMANTIC_SIMILARITY' },
  })
  assert.equal(mechanism, 'parameter')
  assert.equal(parameterValue, 'SEMANTIC_SIMILARITY')
})

test('an undeclared spelling falls back to the canonical name', () => {
  // Cohere's input_type on this same field genuinely is lower-case, so the
  // fallback must be the canonical name and never an upper-casing transform.
  const { parameterValue } = resolveInputTypeDelivery({
    inputType: 'search_document',
    mechanism: 'parameter',
  })
  assert.equal(parameterValue, 'search_document')
})

test('a textPrefix model gets no parameter value at all', () => {
  const { mechanism, parameterValue, prefix } = resolveInputTypeDelivery({
    inputType: 'semantic_similarity',
    mechanism: 'textPrefix',
    prefixes: { semantic_similarity: 'task: sentence similarity | query: ' },
    values: { semantic_similarity: 'SEMANTIC_SIMILARITY' },
  })
  assert.equal(mechanism, 'textPrefix')
  assert.equal(parameterValue, undefined, 'a prefix model must not also be sent the field')
  assert.ok(prefix)
})

test('no mode means no parameter value', () => {
  assert.equal(resolveInputTypeDelivery({}).parameterValue, undefined)
})


test('a pin joins the identity whenever a mode is set', () => {
  const config = {
    provider: 'openrouter',
    model: 'google/gemini-embedding-001',
    embeddingInputType: 'semantic_similarity',
    embeddingProviderOnly: 'google-vertex',
  }

  assert.equal(
    embeddingSetId(config),
    'openrouter:google/gemini-embedding-001~semantic_similarity@google-vertex'
  )
})

/**
 * The regression this file exists for, in its most direct form.
 *
 * `embeddingSetId` took a second argument naming how the mode was delivered,
 * and folded the pin in only for a `parameter` one. The writer knew that and
 * passed it; the sixteen readers -- staleness, the recommender's
 * `WHERE model = $n`, centering, the sets report -- did not, and got a
 * DIFFERENT string. Rows written under one name, looked for under another: a
 * library permanently empty and permanently pending, re-embedding every title
 * on every run and paying for it each time. Nothing errors; nothing is typed
 * wrong; the job just never finishes and the recommender finds no candidates.
 *
 * One argument is the fix, and this asserts the property that makes it one.
 */
test('every caller gets the same id from the same config', () => {
  const config = {
    provider: 'openrouter',
    model: 'google/gemini-embedding-001',
    embeddingInputType: 'semantic_similarity',
    embeddingProviderOnly: 'google-vertex',
  }
  assert.equal(embeddingSetId(config), embeddingSetId({ ...config }))
  assert.equal(embeddingSetId.length, 1, 'a second argument is a second answer')
})

test('two pins under one mode are two different sets', () => {
  const base = {
    provider: 'openrouter',
    model: 'google/gemini-embedding-001',
    embeddingInputType: 'semantic_similarity',
  }
  const vertex = embeddingSetId({ ...base, embeddingProviderOnly: 'google-vertex' })
  const studio = embeddingSetId({ ...base, embeddingProviderOnly: 'google-ai-studio' })
  assert.notEqual(vertex, studio)
})

test('a pin with no mode leaves the id completely alone', () => {
  // The case that protects every row already on disk: both upstreams return
  // the byte-identical vector when no mode is sent, so an unmoded set is one
  // population however it routed, and its id must not move.
  assert.equal(
    embeddingSetId({
      provider: 'openrouter',
      model: 'google/gemini-embedding-001',
      embeddingProviderOnly: 'google-vertex',
    }),
    'openrouter:google/gemini-embedding-001'
  )
})

test('a pin on a provider that has no routing is not identity', () => {
  // Google native takes a mode but has no upstream to pin; a stray pin there
  // describes nothing and must not split the set. Enforced here rather than
  // only at the settings route, so a hand-edited config cannot diverge the
  // writer from the readers.
  assert.equal(
    embeddingSetId({
      provider: 'google',
      model: 'gemini-embedding-001',
      embeddingInputType: 'semantic_similarity',
      embeddingProviderOnly: 'google-vertex',
    }),
    'google:gemini-embedding-001~semantic_similarity'
  )
})

test('a mode on a provider that cannot send one is not named', () => {
  // Those vectors are in the default space. An id claiming a mode they were
  // never embedded in is the confident-number-meaning-nothing failure.
  assert.equal(
    embeddingSetId({
      provider: 'openai',
      model: 'text-embedding-3-large',
      embeddingInputType: 'semantic_similarity',
    }),
    'openai:text-embedding-3-large'
  )
})

test('a pinned id round-trips through describe', () => {
  assert.deepEqual(
    describeEmbeddingSetId(
      'openrouter:google/gemini-embedding-001~semantic_similarity@google-vertex'
    ),
    {
      base: 'openrouter:google/gemini-embedding-001',
      mode: 'semantic_similarity',
      pin: 'google-vertex',
    }
  )
})

test('requiresProviderPin fires only on the mixture case', () => {
  const yes = { provider: 'openrouter', mechanism: 'parameter' as const }
  assert.ok(requiresProviderPin(yes), 'unpinned parameter mode on openrouter is the mixture')
  assert.ok(!requiresProviderPin({ ...yes, pin: 'google-vertex' }), 'pinned is fine')
  // A whitespace pin is no pin. It arrives that way from a cleared text field.
  assert.ok(requiresProviderPin({ ...yes, pin: '   ' }), 'blank pin must not satisfy the guard')

  // A prefix conditions the input, so no route can drop it.
  assert.ok(!requiresProviderPin({ provider: 'openrouter', mechanism: 'textPrefix' }))
  // No mode, nothing to lose.
  assert.ok(!requiresProviderPin({ provider: 'openrouter', mechanism: 'none' }))
  // Google direct is one upstream by definition.
  assert.ok(!requiresProviderPin({ provider: 'google', mechanism: 'parameter' }))
})
