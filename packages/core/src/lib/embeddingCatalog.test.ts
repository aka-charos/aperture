import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getModelsForFunction,
  getEmbeddingDimensions,
  getModel,
  getProvider,
  getProvidersForFunction,
} from './ai-capabilities.js'
import { VALID_EMBEDDING_DIMENSIONS } from './ai-provider.js'
import {
  isEmbeddingInputType,
  requiresProviderPin,
  resolveInputTypeDelivery,
} from './embeddingIdentity.js'

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
  const byId = Object.fromEntries(OPENROUTER_EMBEDDINGS.map((m) => [m.id, m]))

  // gemini-2 conditions on a TEXT PREFIX and is byte-stable over five identical
  // requests. The prefix changes the input, so no route can collapse it into
  // the unconditioned vector, and no pin is needed.
  assert.equal(byId['google/gemini-embedding-2'].recommendedInputType, 'semantic_similarity')
  assert.equal(byId['google/gemini-embedding-2'].inputTypeMechanism, 'textPrefix')

  // 001 takes the mode as a request PARAMETER, which OpenRouter's two upstreams
  // treat differently -- google-vertex honours it, google-ai-studio drops it.
  // Usable, but ONLY pinned, which `requiresProviderPin` enforces at the
  // settings route rather than leaving to whoever reads the note.
  assert.equal(byId['google/gemini-embedding-001'].recommendedInputType, 'semantic_similarity')
  assert.equal(byId['google/gemini-embedding-001'].inputTypeMechanism, 'parameter')
  assert.ok(
    requiresProviderPin({ provider: 'openrouter', mechanism: 'parameter' }),
    'recommending a parameter mode on openrouter must still demand a pin'
  )

  // Qwen: its instruction recipe is query-side against bare documents, and this
  // recommender's query is a centroid, not text.
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

/**
 * A catalog entry whose declared spelling the upstream rejects is a job that
 * dies on its first batch, and nothing before runtime can tell. Google's enum
 * is the one Vertex named in its own 400: [CLASSIFICATION, CLUSTERING,
 * CODE_RETRIEVAL_QUERY, DEFAULT, FACT_VERIFICATION, QUESTION_ANSWERING,
 * RETRIEVAL_DOCUMENT, RETRIEVAL_QUERY, SEMANTIC_SIMILARITY].
 */
test('google models on openrouter declare google spellings', () => {
  const VERTEX_TASK_TYPES = new Set([
    'CLASSIFICATION',
    'CLUSTERING',
    'CODE_RETRIEVAL_QUERY',
    'DEFAULT',
    'FACT_VERIFICATION',
    'QUESTION_ANSWERING',
    'RETRIEVAL_DOCUMENT',
    'RETRIEVAL_QUERY',
    'SEMANTIC_SIMILARITY',
  ])

  for (const model of OPENROUTER_EMBEDDINGS) {
    if (model.inputTypeMechanism !== 'parameter') continue
    if (!model.id.startsWith('google/')) continue
    assert.ok(
      model.inputTypeValues,
      `${model.id} sends input_type to a Google upstream but declares no spelling; ` +
        'the canonical lower-case name is a 400 on the batch path'
    )
    for (const [mode, wire] of Object.entries(model.inputTypeValues)) {
      assert.ok(
        VERTEX_TASK_TYPES.has(wire),
        `${model.id} maps ${mode} to "${wire}", which Vertex does not accept`
      )
    }
  }
})

test('every recommended mode has a spelling that will actually be sent', () => {
  for (const model of OPENROUTER_EMBEDDINGS) {
    if (!model.recommendedInputType) continue
    const { mechanism, parameterValue } = resolveInputTypeDelivery({
      inputType: model.recommendedInputType,
      mechanism: model.inputTypeMechanism,
      prefixes: model.inputTypePrefixes,
      values: model.inputTypeValues,
    })
    if (mechanism !== 'parameter') continue
    assert.ok(parameterValue, `${model.id} would send an empty input_type`)
  }
})

/**
 * The retrieval-mode control is offered per MODEL, not per provider, and the
 * catalog is the only thing that says which models can carry one.
 *
 * `resolveInputTypeDelivery` used to default an undeclared model to `parameter`.
 * That was true of native Google and false of everything else, and the cost was
 * not a rejected request: OpenRouter takes `input_type` as an unconstrained
 * string, so a mode set on Qwen or pplx-embed was sent, ignored, and then
 * written into the set identity anyway -- because `embeddingSetId` reads the
 * config and never the mechanism. A paid-for re-embed producing byte-identical
 * vectors under a second name.
 */
test('a model that can carry a mode declares how, on every provider', () => {
  // `getProvidersForFunction` returns METADATA, not ids. Passing the object
  // straight to `getModelsForFunction` type-errors but does not throw at
  // runtime -- it just returns nothing, so the loop body never runs and the
  // test passes having asserted precisely nothing. Caught by tsc, not by the
  // test runner, which is the whole argument for `pnpm validate` over `--test`.
  const providers = getProvidersForFunction('embeddings').map((p) => p.id)
  assert.ok(providers.length > 0, 'no provider offers embeddings, so this test checks nothing')

  let inspected = 0
  for (const providerId of providers) {
    for (const model of getModelsForFunction(providerId, 'embeddings')) {
      inspected++
      if (!model.recommendedInputType) continue
      assert.ok(
        model.inputTypeMechanism,
        `${providerId}/${model.id} recommends a mode but declares no mechanism, ` +
          'so nothing would deliver it'
      )
    }
  }
  assert.ok(inspected > 0, 'no built-in embedding models were reached')
})

test('native google declares its parameter mechanism rather than leaning on a default', () => {
  // The one entry the old default was right about, and therefore the one a
  // change to that default silently breaks. Its taskType rides in
  // providerOptions per call; reached natively there is a single upstream, so
  // unlike the same model through OpenRouter it needs no pin.
  const google = getModel('google', 'gemini-embedding-001', 'embeddings')
  assert.ok(google, 'the native google embedding model went missing')
  assert.equal(google.inputTypeMechanism, 'parameter')
  assert.equal(
    resolveInputTypeDelivery({
      inputType: 'semantic_similarity',
      mechanism: google.inputTypeMechanism,
    }).mechanism,
    'parameter'
  )
})

test('a model declaring no mechanism delivers no mode, whatever is asked of it', () => {
  // Qwen and pplx-embed both say in their own notes that they take no mode.
  // This is what makes that a fact the code acts on rather than prose.
  for (const id of ['qwen/qwen3-embedding-8b', 'perplexity/pplx-embed-v1-4b']) {
    const model = getModel('openrouter', id, 'embeddings')
    assert.ok(model, `${id} went missing from the catalog`)
    assert.equal(model.inputTypeMechanism, undefined)
    const { mechanism } = resolveInputTypeDelivery({
      inputType: 'semantic_similarity',
      mechanism: model.inputTypeMechanism,
      prefixes: model.inputTypePrefixes,
    })
    assert.equal(mechanism, 'none', `${id} would be sent a mode it cannot read`)
    assert.equal(
      requiresProviderPin({ provider: 'openrouter', mechanism }),
      false,
      `${id} would demand a Gemini upstream pin for a mode it cannot read`
    )
  }
})
