import test from 'node:test'
import assert from 'node:assert/strict'
import { getModelsForFunction, getEmbeddingDimensions, getProvider } from './ai-capabilities.js'
import { VALID_EMBEDDING_DIMENSIONS } from './ai-provider.js'
import { isEmbeddingInputType, resolveInputTypeDelivery } from './embeddingIdentity.js'

/**
 * OpenRouter is a `CUSTOM_MODEL_PROVIDERS` member — it deliberately ships no
 * built-in chat models, because its catalog is thousands of entries that change
 * weekly. Embeddings are the exception: that catalog is a handful, so leaving it
 * empty meant every operator had to hand-register a model before they could use
 * the feature at all.
 *
 * The declared dimension is the load-bearing part. `getCurrentEmbeddingDimensions`
 * reads it to pick which `embeddings_<n>` table to query, so editing a number
 * here does not migrate anything — it points every read at a different table and
 * the library appears to have lost its vectors.
 */

const OPENROUTER_EMBEDDINGS = getModelsForFunction('openrouter', 'embeddings')

test('openrouter ships built-in embedding models', () => {
  assert.ok(OPENROUTER_EMBEDDINGS.length > 0)
})

test('every declared dimension has a table to live in', () => {
  for (const model of OPENROUTER_EMBEDDINGS) {
    assert.ok(
      model.embeddingDimensions,
      `${model.id} declares no dimension, so no table can be chosen for it`
    )
    assert.ok(
      VALID_EMBEDDING_DIMENSIONS.includes(model.embeddingDimensions as never),
      `${model.id} declares ${model.embeddingDimensions}, which has no embeddings_<n> table`
    )
  }
})

/**
 * These two have vectors on disk on the instance this catalog was written for.
 * Changing either number silently repoints every read at an empty table, and
 * nothing errors — the recommender just finds no candidates.
 */
test('models with stored vectors keep the dimensions their rows are in', () => {
  assert.equal(getEmbeddingDimensions('openrouter', 'google/gemini-embedding-001'), 3072)
  assert.equal(getEmbeddingDimensions('openrouter', 'qwen/qwen3-embedding-8b'), 4096)
})

test('gemini-embedding-2 is 3072, matching 001 for a fair comparison', () => {
  // Deliberately not one of its smaller Matryoshka sizes: comparing 3072
  // against 1536 measures truncation, not the model.
  assert.equal(getEmbeddingDimensions('openrouter', 'google/gemini-embedding-2'), 3072)
})

test('built-in entries carry no static price', () => {
  // `pricing-cache.ts` has no openrouter table, so a number written here would
  // be the only source and would drift. The live catalog fills it in at list
  // time instead (see getModelsForFunctionWithCustom).
  for (const model of OPENROUTER_EMBEDDINGS) {
    assert.equal(
      model.inputCostPerMillion,
      undefined,
      `${model.id} hardcodes a price; OpenRouter's live catalog is the authority`
    )
  }
})

test('ids are unique, or the picker offers the same model twice', () => {
  const ids = OPENROUTER_EMBEDDINGS.map((m) => m.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('every entry actually claims the embeddings capability', () => {
  for (const model of OPENROUTER_EMBEDDINGS) {
    assert.ok(
      model.capabilities.supportsEmbeddings,
      `${model.id} would be filtered out of its own role`
    )
  }
})

test('the other openrouter roles stay custom-only', () => {
  // The reason OpenRouter is in CUSTOM_MODEL_PROVIDERS. Shipping a curated chat
  // list would date immediately and hide the thousands of models that are the
  // point of using OpenRouter at all.
  const provider = getProvider('openrouter')
  assert.ok(provider)
  assert.equal(provider.chatModels.length, 0)
  assert.equal(provider.textGenerationModels.length, 0)
  assert.equal(provider.explorationModels.length, 0)
})

/**
 * The catalog is where an operator finds out that gemini-embedding-001 without
 * a mode lands in the retrieval space. A missing note is not cosmetic: the mode
 * control would then sit there with no indication that leaving it blank is a
 * choice, which is the state this whole change exists to fix.
 */
test('every entry explains its mode, including the ones needing none', () => {
  for (const model of OPENROUTER_EMBEDDINGS) {
    assert.ok(model.inputTypeNote, `${model.id} says nothing about its retrieval mode`)
  }
})

test('a recommended mode is one the system can actually store', () => {
  for (const model of OPENROUTER_EMBEDDINGS) {
    if (model.recommendedInputType === undefined) continue
    assert.ok(
      isEmbeddingInputType(model.recommendedInputType),
      `${model.id} recommends ${model.recommendedInputType}, which the settings route would reject`
    )
  }
})

test('both Gemini models want the symmetric space, by different mechanisms', () => {
  // The correction this test exists to hold. Both recommend the same mode, but
  // 001 takes it as a PARAMETER and gemini-2 as a TEXT PREFIX -- it ignores
  // input_type outright, returning the byte-identical vector to sending
  // nothing. Reading that identity as "its default is already semantic" is the
  // mistake that shipped here once.
  //
  // Qwen recommends nothing: its instruction recipe is query-side against bare
  // documents, and this recommender's query is a centroid, not text. It still
  // carries a note saying so; silence would read as an oversight.
  const byId = Object.fromEntries(OPENROUTER_EMBEDDINGS.map((m) => [m.id, m]))

  assert.equal(byId['google/gemini-embedding-001'].recommendedInputType, 'semantic_similarity')
  assert.equal(byId['google/gemini-embedding-001'].inputTypeMechanism, 'parameter')

  assert.equal(byId['google/gemini-embedding-2'].recommendedInputType, 'semantic_similarity')
  assert.equal(byId['google/gemini-embedding-2'].inputTypeMechanism, 'textPrefix')

  assert.equal(byId['qwen/qwen3-embedding-8b'].recommendedInputType, undefined)
})

test('every recommended mode can actually be delivered by its model', () => {
  // A recommendation the Apply button would produce a 400 for.
  for (const model of OPENROUTER_EMBEDDINGS) {
    if (!model.recommendedInputType) continue
    const { mechanism } = resolveInputTypeDelivery({
      inputType: model.recommendedInputType,
      mechanism: model.inputTypeMechanism,
      prefixes: model.inputTypePrefixes,
    })
    assert.notEqual(
      mechanism,
      'none',
      `${model.id} recommends ${model.recommendedInputType} but has no way to send it`
    )
  }
})

test('a textPrefix model ships the prefix it needs', () => {
  for (const model of OPENROUTER_EMBEDDINGS) {
    if (model.inputTypeMechanism !== 'textPrefix') continue
    assert.ok(
      Object.keys(model.inputTypePrefixes ?? {}).length > 0,
      `${model.id} is prefix-conditioned but ships no prefixes, so no mode reaches it`
    )
  }
})
