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
    { mechanism: 'parameter' }
  )
})

test('an unstated mechanism defaults to parameter', () => {
  // Every model but gemini-2, and every custom model, which has no catalog entry.
  assert.deepEqual(resolveInputTypeDelivery({ inputType: 'search_query' }), {
    mechanism: 'parameter',
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
