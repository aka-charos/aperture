import test from 'node:test'
import assert from 'node:assert/strict'
import { isDiscoverableProvider, unslothModelsForRole } from './localModelDiscovery.js'
import {
  parseUnslothModels,
  readUnslothProps,
  unslothInferenceBaseUrl,
  unslothServerRoot,
} from './unslothServer.js'

/**
 * `GET /v1/models` as a live Unsloth Studio (v0.1.911-beta) answered it, two
 * rows of the four kept verbatim, plus the two shapes that server did not have
 * to hand: a loaded row carrying its context window, and an audio model, which
 * is told apart from a language model by `task` alone.
 */
const LIVE_LIST = {
  object: 'list',
  data: [
    {
      id: 'ornith-ai/Ornith-1.5-9B-GGUF',
      object: 'model',
      created: 1793059406,
      owned_by: 'unsloth-studio',
      loaded: false,
      quant: 'Q4_K_M',
      display_name: 'Ornith-1.5-9B-GGUF',
      status: { value: 'unloaded' },
    },
    {
      id: 'bartowski/Altworld_Hemmingway-1-GGUF',
      object: 'model',
      created: 1793059406,
      owned_by: 'unsloth-studio',
      loaded: true,
      quant: 'Q4_K_S',
      display_name: 'Altworld_Hemmingway-1-GGUF',
      context_length: 32768,
      status: { value: 'loaded' },
    },
    {
      id: 'kokoro-82m',
      object: 'model',
      owned_by: 'unsloth-studio',
      task: 'text-to-speech',
      loaded: false,
      status: { value: 'unloaded' },
    },
  ],
}

test('the live list parses to ids, names, quants and residency', () => {
  const models = parseUnslothModels(LIVE_LIST)
  assert.deepEqual(models[0], {
    id: 'ornith-ai/Ornith-1.5-9B-GGUF',
    displayName: 'Ornith-1.5-9B-GGUF',
    quant: 'Q4_K_M',
    loaded: false,
  })
  assert.equal(models[1].loaded, true)
  assert.equal(models[1].contextLength, 32768)
  assert.equal(models[2].task, 'text-to-speech')
})

test('a row is never claimed loaded without saying so, and junk is dropped', () => {
  const models = parseUnslothModels({
    data: [{ id: 'a' }, { id: 'b', loaded: 'yes' }, { id: '' }, { loaded: true }, null, 'x'],
  })
  assert.deepEqual(
    models.map((m) => [m.id, m.loaded]),
    [
      ['a', false],
      ['b', false],
    ]
  )
  assert.deepEqual(parseUnslothModels({}), [])
  assert.deepEqual(parseUnslothModels(null), [])
})

test('a writing role is offered every language model and none of the media ones', () => {
  const result = unslothModelsForRole(parseUnslothModels(LIVE_LIST), 'titleAnalysis')
  assert.deepEqual(
    result.models.map((m) => m.id),
    ['ornith-ai/Ornith-1.5-9B-GGUF', 'bartowski/Altworld_Hemmingway-1-GGUF']
  )
  assert.deepEqual(result.skipped, [{ id: 'kokoro-82m', reason: 'wrongType' }])
  assert.equal(result.models[0].description, 'Ornith-1.5-9B-GGUF · Q4_K_M')
  assert.equal(result.models[0].loaded, false)
  assert.equal(result.models[1].loaded, true)
  assert.ok(result.models[1].contextWindow, 'a loaded row keeps its context window')
})

test('Chat assumes tool calling, since Unsloth publishes no tool support to withhold on', () => {
  const result = unslothModelsForRole(parseUnslothModels(LIVE_LIST), 'chat')
  assert.equal(result.models.length, 2)
  assert.ok(result.models.every((m) => m.capabilities.supportsToolCalling))
})

test('embeddings and web search get nothing: the provider holds neither role', () => {
  for (const fn of ['embeddings', 'webSearch'] as const) {
    assert.deepEqual(unslothModelsForRole(parseUnslothModels(LIVE_LIST), fn), { models: [], skipped: [] })
  }
})

test('inference always gets /v1, and the root never keeps it', () => {
  for (const typed of [
    'http://192.168.196.72:8888',
    'http://192.168.196.72:8888/',
    'http://192.168.196.72:8888/v1',
    'http://192.168.196.72:8888/V1/',
    '  http://192.168.196.72:8888/v1  ',
  ]) {
    assert.equal(unslothInferenceBaseUrl(typed), 'http://192.168.196.72:8888/v1', typed)
    assert.equal(unslothServerRoot(typed), 'http://192.168.196.72:8888', typed)
  }
  assert.equal(unslothInferenceBaseUrl(undefined), 'http://localhost:8888/v1')
  assert.equal(unslothInferenceBaseUrl(''), 'http://localhost:8888/v1')
})

test('props report the loaded context window, and nothing when nothing is loaded', () => {
  // As the live server answered with no model loaded.
  assert.deepEqual(
    readUnslothProps({
      endpoint_props: false,
      endpoint_slots: false,
      endpoint_metrics: false,
      build_info: 'unsloth-studio/v0.1.911-beta',
    }),
    {}
  )
  assert.deepEqual(
    readUnslothProps({
      model_path: 'bartowski/Altworld_Hemmingway-1-GGUF',
      default_generation_settings: { n_ctx: 16384 },
    }),
    { modelId: 'bartowski/Altworld_Hemmingway-1-GGUF', contextLength: 16384 }
  )
  assert.deepEqual(readUnslothProps({ default_generation_settings: { n_ctx: 0 } }), {})
})

test('Unsloth is a provider whose installed models can be listed', () => {
  assert.equal(isDiscoverableProvider('unsloth'), true)
})
