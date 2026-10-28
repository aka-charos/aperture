import test from 'node:test'
import assert from 'node:assert/strict'
import { isDiscoverableProvider, unslothModelsForRole } from './localModelDiscovery.js'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  UNSLOTH_KEY_REQUIRED,
  listUnslothModels,
  notUnslothApi,
  parseUnslothModels,
  probeUnslothServer,
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

// ============================================================================
// Against a server: what reaches the operator when the answer is not a list
// ============================================================================

/**
 * A stand-in Unsloth on a free local port. `mode` decides how it answers:
 * keyed (401 without the right bearer, as Unsloth does off its keyless
 * addresses), html (its web app, as an older Studio or another web server
 * answers an API path), or open.
 */
async function withServer(
  mode: 'keyed' | 'html' | 'open',
  run: (base: string) => Promise<void>
): Promise<void> {
  const server: Server = createServer((req, res) => {
    if (mode === 'keyed' && req.headers.authorization !== 'Bearer sk-unsloth-good') {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'Not authenticated', type: 'authentication_error' } }))
      return
    }
    if (mode === 'html') {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<!doctype html><html><body>Unsloth Studio</body></html>')
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    if (req.url === '/v1/models') res.end(JSON.stringify(LIVE_LIST))
    else if (req.url === '/version') res.end(JSON.stringify({ version: 'v0.1.911-beta' }))
    else if (req.url === '/v1/props')
      res.end(
        JSON.stringify({
          model_path: 'bartowski/Altworld_Hemmingway-1-GGUF',
          default_generation_settings: { n_ctx: 16384 },
        })
      )
    else res.end('{}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  try {
    await run(`http://127.0.0.1:${port}/v1`)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

test('a 401 says a key is needed, and where keyless access does not reach', { timeout: 15_000 }, async () => {
  await withServer('keyed', async (base) => {
    const status = await probeUnslothServer(base)
    assert.equal(status.reachable, false)
    assert.equal(status.error, UNSLOTH_KEY_REQUIRED)

    let reason: string | undefined
    const listed = await listUnslothModels(base, undefined, (why) => {
      reason = why
    })
    assert.equal(listed, null)
    assert.equal(reason, UNSLOTH_KEY_REQUIRED)

    // The right key opens the same routes.
    const keyed = await probeUnslothServer(base, 'sk-unsloth-good')
    assert.equal(keyed.reachable, true)
  })
})

test('a web page where the API should be is named, never a parser error', { timeout: 15_000 }, async () => {
  await withServer('html', async (base) => {
    const status = await probeUnslothServer(base)
    assert.equal(status.reachable, false)
    assert.equal(status.error, notUnslothApi('/v1/models'))
    assert.doesNotMatch(status.error ?? '', /Unexpected token/)
  })
})

test('a reachable server reports its version, counts and the loaded window', { timeout: 15_000 }, async () => {
  await withServer('open', async (base) => {
    const status = await probeUnslothServer(base)
    assert.equal(status.reachable, true)
    assert.equal(status.version, 'v0.1.911-beta')
    assert.equal(status.totalModels, 3)
    assert.equal(status.languageModels, 2)
    // The row's own context_length wins over /v1/props.
    assert.deepEqual(status.loaded, [{ modelId: 'bartowski/Altworld_Hemmingway-1-GGUF', contextLength: 32768 }])
  })
})
