import test from 'node:test'
import assert from 'node:assert/strict'
import { lmStudioModelsForRole, isDiscoverableProvider } from './localModelDiscovery.js'
import {
  enrichFromV0,
  lmStudioInferenceBaseUrl,
  normalizeLmStudioV1Model,
  type LmStudioModel,
} from './local-model-capabilities.js'

/**
 * A catalog shaped like a real one: an embedding model, a tool-calling chat
 * model, a language model that cannot call tools, and one from a server too old
 * to report capabilities at all.
 */
const CATALOG: LmStudioModel[] = [
  {
    id: 'text-embedding-nomic-embed-text-v1.5',
    type: 'embeddings',
    publisher: 'nomic-ai',
    arch: 'nomic-bert',
    quantization: 'Q4_0',
    state: 'not-loaded',
    max_context_length: 2048,
  },
  {
    id: 'qwen/qwen3-8b',
    type: 'llm',
    publisher: 'lmstudio-community',
    arch: 'qwen3',
    quantization: 'Q4_K_M',
    state: 'loaded',
    max_context_length: 131072,
    capabilities: ['tool_use'],
  },
  {
    id: 'google/gemma-3-4b',
    type: 'llm',
    publisher: 'lmstudio-community',
    arch: 'gemma3',
    state: 'not-loaded',
    max_context_length: 8192,
    capabilities: [],
  },
  {
    // Pre-0.3.16: no capabilities field at all.
    id: 'meta-llama-3.1-8b-instruct',
    type: 'llm',
    max_context_length: 131072,
  },
]

const ids = (entries: { id: string }[]) => entries.map((e) => e.id)

test('embeddings offers embedding models only', () => {
  const { models, skipped } = lmStudioModelsForRole(CATALOG, 'embeddings')
  assert.deepEqual(ids(models), ['text-embedding-nomic-embed-text-v1.5'])
  assert.ok(models[0].capabilities.supportsEmbeddings)
  assert.equal(skipped.length, 3)
  assert.ok(skipped.every((s) => s.reason === 'wrongType'))
})

test('writing roles offer language models only', () => {
  for (const fn of ['textGeneration', 'exploration', 'titleAnalysis'] as const) {
    const { models } = lmStudioModelsForRole(CATALOG, fn)
    assert.deepEqual(
      ids(models),
      ['qwen/qwen3-8b', 'google/gemma-3-4b', 'meta-llama-3.1-8b-instruct'],
      `${fn} should offer every language model`
    )
  }
})

/**
 * The asymmetry that matters: a model KNOWN to lack tool calling is withheld
 * from the assistant, while one whose server never said is offered. Reversing
 * either half is a silent failure — the first gives a broken assistant, the
 * second empties the list on any LM Studio older than 0.3.16 and reads as a
 * failed detection.
 */
test('chat withholds known-toolless models but keeps unknown ones', () => {
  const { models, skipped } = lmStudioModelsForRole(CATALOG, 'chat')
  assert.deepEqual(ids(models), ['qwen/qwen3-8b', 'meta-llama-3.1-8b-instruct'])
  assert.deepEqual(skipped.filter((s) => s.reason === 'noToolCalling').map((s) => s.id), [
    'google/gemma-3-4b',
  ])
})

test('a model with no reported capabilities is assumed to fit the role it was listed for', () => {
  const { models } = lmStudioModelsForRole(CATALOG, 'chat')
  const legacy = models.find((m) => m.id === 'meta-llama-3.1-8b-instruct')
  assert.ok(legacy)
  assert.equal(legacy.capabilities.supportsToolCalling, true)
})

/**
 * `type` is absent on a server that answers LM Studio's path without being LM
 * Studio. Excluding those would report an empty catalog, which is indistinguishable
 * from "nothing installed" — so they count as language models, the wider role.
 */
test('an entry with no type is treated as a language model', () => {
  const untyped: LmStudioModel[] = [{ id: 'mystery-model' }]
  assert.deepEqual(ids(lmStudioModelsForRole(untyped, 'textGeneration').models), ['mystery-model'])
  assert.deepEqual(ids(lmStudioModelsForRole(untyped, 'embeddings').models), [])
})

test('context window is formatted the way the catalog writes it', () => {
  const { models } = lmStudioModelsForRole(CATALOG, 'textGeneration')
  assert.equal(models.find((m) => m.id === 'qwen/qwen3-8b')?.contextWindow, '131K')
  assert.equal(models.find((m) => m.id === 'google/gemma-3-4b')?.contextWindow, '8K')
})

test('load state rides along, and absent is not "unloaded"', () => {
  const { models } = lmStudioModelsForRole(CATALOG, 'textGeneration')
  assert.equal(models.find((m) => m.id === 'qwen/qwen3-8b')?.loaded, true)
  assert.equal(models.find((m) => m.id === 'google/gemma-3-4b')?.loaded, false)
  assert.equal(models.find((m) => m.id === 'meta-llama-3.1-8b-instruct')?.loaded, undefined)
})

test('the description names the model without repeating its id', () => {
  const { models } = lmStudioModelsForRole(CATALOG, 'textGeneration')
  assert.equal(
    models.find((m) => m.id === 'qwen/qwen3-8b')?.description,
    'lmstudio-community · qwen3 · Q4_K_M'
  )
  // Nothing to say is said as nothing, not as an empty separator run.
  assert.equal(models.find((m) => m.id === 'meta-llama-3.1-8b-instruct')?.description, undefined)
})

/**
 * Web Search grounds through the provider itself and stays Google-only, so a
 * local server can never answer it.
 */
test('web search discovers nothing', () => {
  assert.deepEqual(lmStudioModelsForRole(CATALOG, 'webSearch'), { models: [], skipped: [] })
})

/**
 * `openai-compatible` has shipped LM Studio's own port as its default base URL
 * since before this provider existed, so anyone who wired LM Studio up the old
 * way keeps discovery. It probes harmlessly against anything else.
 */
test('openai-compatible discovers too, because it might be LM Studio', () => {
  assert.ok(isDiscoverableProvider('lmstudio'))
  assert.ok(isDiscoverableProvider('openai-compatible'))
  assert.ok(!isDiscoverableProvider('ollama'))
  assert.ok(!isDiscoverableProvider('openai'))
})

// ===========================================================================
// The newer /api/v1/models, normalised into the v0 shape the filter reads.
// ===========================================================================

/** The documented v1 payload, from lmstudio.ai/docs/developer/rest/list. */
const V1_LLM = {
  type: 'llm',
  publisher: 'microsoft',
  key: 'microsoft/phi-2',
  display_name: 'Phi-2',
  architecture: 'phi',
  quantization: { name: 'q4_0', bits_per_weight: 4 },
  size_bytes: 4294967296,
  params_string: '2.7B',
  loaded_instances: [
    { id: '8a7b6c5d', config: { context_length: 2048 } },
  ],
}

/**
 * The single letter that decides everything: v1 says 'embedding', v0 says
 * 'embeddings', and the role filter reads v0's vocabulary. Get this wrong and
 * every embedding model is offered to the assistant and none to Embeddings.
 */
test('v1 embedding models land in the embeddings role, despite the singular', () => {
  const model = normalizeLmStudioV1Model({
    type: 'embedding',
    key: 'nomic-ai/nomic-embed-text-v1.5',
    display_name: 'Nomic Embed Text v1.5',
    architecture: null,
    quantization: null,
    loaded_instances: [],
  })
  assert.equal(model.type, 'embeddings')

  const { models } = lmStudioModelsForRole([model], 'embeddings')
  assert.deepEqual(models.map((m) => m.id), ['nomic-ai/nomic-embed-text-v1.5'])
  assert.equal(lmStudioModelsForRole([model], 'chat').models.length, 0)
})

test('the id is the key, because that is what gets sent as `model`', () => {
  assert.equal(normalizeLmStudioV1Model(V1_LLM).id, 'microsoft/phi-2')
  // The human name is display only and must never become the id.
  assert.equal(lmStudioModelsForRole([normalizeLmStudioV1Model(V1_LLM)], 'chat').models[0].name,
    'microsoft/phi-2')
})

test('a running instance is what makes a v1 model "loaded"', () => {
  assert.equal(normalizeLmStudioV1Model(V1_LLM).state, 'loaded')
  assert.equal(normalizeLmStudioV1Model({ ...V1_LLM, loaded_instances: [] }).state, 'not-loaded')
})

/**
 * v1 carries context length only on a loaded instance. Absent must stay absent
 * — a downloaded-but-not-loaded model has an unknown window, not a zero one,
 * and "0" printed beside a model reads as a broken model.
 */
test('v1 context length comes from the loaded instance, and unknown stays unknown', () => {
  assert.equal(normalizeLmStudioV1Model(V1_LLM).max_context_length, 2048)
  assert.equal(
    normalizeLmStudioV1Model({ ...V1_LLM, loaded_instances: [] }).max_context_length,
    undefined
  )
  const { models } = lmStudioModelsForRole(
    [normalizeLmStudioV1Model({ ...V1_LLM, loaded_instances: [] })],
    'chat'
  )
  assert.equal(models[0].contextWindow, undefined)
})

/**
 * v1 publishes no `capabilities`, so tool support is genuinely unknown there.
 * That must read as "offer it" and not as "cannot call tools", or a v1-only
 * server shows an empty Chat list and looks undetected.
 */
test('v1 models are offered for chat, since v1 cannot say whether they call tools', () => {
  const model = normalizeLmStudioV1Model(V1_LLM)
  assert.equal(model.capabilities, undefined)
  const { models, skipped } = lmStudioModelsForRole([model], 'chat')
  assert.deepEqual(models.map((m) => m.id), ['microsoft/phi-2'])
  assert.equal(skipped.length, 0)
})

test("v1's richer names reach the description, nulls and all", () => {
  const { models } = lmStudioModelsForRole([normalizeLmStudioV1Model(V1_LLM)], 'chat')
  assert.equal(models[0].description, 'Phi-2 · 2.7B · microsoft · phi · q4_0')

  // Every optional field is documented as nullable; none may become "null".
  const bare = normalizeLmStudioV1Model({ key: 'x', type: 'llm', architecture: null, quantization: null, params_string: null })
  assert.equal(lmStudioModelsForRole([bare], 'chat').models[0].description, undefined)
})

/**
 * An unrecognised future type must not silently become an embedding model:
 * language is the wider role, and being wrong there is recoverable.
 */
test('an unknown v1 type passes through as a language model', () => {
  const model = normalizeLmStudioV1Model({ key: 'y', type: 'something-new' })
  assert.equal(model.type, 'something-new')
  assert.equal(lmStudioModelsForRole([model], 'textGeneration').models.length, 1)
  assert.equal(lmStudioModelsForRole([model], 'embeddings').models.length, 0)
})

/**
 * v1 is the primary listing and publishes no tool support, so v0 is read
 * alongside it purely to supply `capabilities`. Without this the Chat filter
 * has no signal on a modern LM Studio and offers every language model.
 */
test('v0 supplies the tool support that v1 does not publish', () => {
  const fromV1 = [
    normalizeLmStudioV1Model({ key: 'a-tool-caller', type: 'llm', loaded_instances: [] }),
    normalizeLmStudioV1Model({ key: 'b-no-tools', type: 'llm', loaded_instances: [] }),
  ]
  const fromV0: LmStudioModel[] = [
    { id: 'a-tool-caller', type: 'llm', capabilities: ['tool_use'], max_context_length: 8192 },
    { id: 'b-no-tools', type: 'llm', capabilities: [], max_context_length: 4096 },
  ]

  const merged = enrichFromV0(fromV1, fromV0)
  const { models, skipped } = lmStudioModelsForRole(merged, 'chat')
  assert.deepEqual(ids(models), ['a-tool-caller'])
  assert.deepEqual(skipped, [{ id: 'b-no-tools', reason: 'noToolCalling' }])
  // And the gap v1 leaves for an unloaded model is filled.
  assert.equal(models[0].contextWindow, '8K')
})

/**
 * The two APIs need not spell a model the same way. A fuzzy match would hand
 * one model's tool support to another, so an unmatched entry keeps v1's answer
 * — which is "unknown", and therefore offered rather than withheld.
 */
test('an id present in only one API is left exactly as v1 reported it', () => {
  const fromV1 = [normalizeLmStudioV1Model({ key: 'publisher/model-x', type: 'llm' })]
  const fromV0: LmStudioModel[] = [{ id: 'model-x', type: 'llm', capabilities: [] }]

  const merged = enrichFromV0(fromV1, fromV0)
  assert.equal(merged[0].capabilities, undefined)
  assert.deepEqual(ids(lmStudioModelsForRole(merged, 'chat').models), ['publisher/model-x'])
})

test('a loaded v1 model keeps its own context length, which describes the running instance', () => {
  const fromV1 = [normalizeLmStudioV1Model(V1_LLM)] // loaded, 2048
  const fromV0: LmStudioModel[] = [{ id: 'microsoft/phi-2', max_context_length: 131072 }]
  assert.equal(enrichFromV0(fromV1, fromV0)[0].max_context_length, 2048)
})

// ===========================================================================
// The two base URLs. LM Studio serves its native API under /api and its
// OpenAI-compatible one under /v1, off the same host — and only the second is
// appended to verbatim, so only the second has a required shape.
// ===========================================================================

test('the inference base URL gains /v1 when the operator left it off', () => {
  // The exact case that lists models perfectly and then fails every test:
  // discovery strips /v1 so it never noticed, inference needs it.
  assert.equal(lmStudioInferenceBaseUrl('http://localhost:1234'), 'http://localhost:1234/v1')
  assert.equal(lmStudioInferenceBaseUrl('http://localhost:1234/'), 'http://localhost:1234/v1')
})

test('a base URL that already works is returned unchanged', () => {
  assert.equal(lmStudioInferenceBaseUrl('http://localhost:1234/v1'), 'http://localhost:1234/v1')
  // Trailing slashes are the same URL, not a different one.
  assert.equal(lmStudioInferenceBaseUrl('http://localhost:1234/v1/'), 'http://localhost:1234/v1')
  // Never doubled.
  assert.equal(
    lmStudioInferenceBaseUrl(lmStudioInferenceBaseUrl('http://localhost:1234')),
    'http://localhost:1234/v1'
  )
})

test('a remote LM Studio behind a path prefix keeps its prefix', () => {
  assert.equal(lmStudioInferenceBaseUrl('http://nas.local:1234/lmstudio'), 'http://nas.local:1234/lmstudio/v1')
})

test('nothing configured falls back to the documented default', () => {
  assert.equal(lmStudioInferenceBaseUrl(undefined), 'http://localhost:1234/v1')
  assert.equal(lmStudioInferenceBaseUrl(''), 'http://localhost:1234/v1')
})
