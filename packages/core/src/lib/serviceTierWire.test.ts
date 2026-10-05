/**
 * The flex tier reaches the wire, and only where it was asked for.
 *
 * The whole delivery rests on one behaviour of a dependency:
 * `@openrouter/ai-sdk-provider` merges a model's own `extraBody` into the body
 * of every request that model builds. Nothing typed checks that — the setting is
 * a `Record<string, unknown>` — so an upgrade that stopped merging it would
 * leave every flex role on standard pricing with nothing failing anywhere. This
 * captures the real request body the SDK sends, for both the generate and the
 * stream path (title analysis streams; explanations do not), and pins it.
 *
 * Built the way `createOpenRouterProvider` builds a provider, including its
 * provider-level `extraBody`, because the two merge and the test has to show
 * neither eats the other.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { generateText, streamText } from 'ai'

import { resolveServiceTierDelivery } from './serviceTier.js'

type Captured = Record<string, unknown>

const completion = {
  id: 'gen-1',
  model: 'openai/gpt-5',
  provider: 'OpenAI',
  service_tier: 'flex',
  choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
}

const sse = [
  { id: 'gen-1', model: 'openai/gpt-5', choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: null }] },
  {
    id: 'gen-1',
    model: 'openai/gpt-5',
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
  },
]
  .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
  .concat('data: [DONE]\n\n')
  .join('')

/** A provider whose fetch records each request body and answers it cannedly. */
function capturingProvider() {
  const bodies: Captured[] = []
  const fakeFetch = async (_input: unknown, init?: { body?: unknown }): Promise<Response> => {
    const body = JSON.parse(String(init?.body)) as Captured
    bodies.push(body)
    return body.stream === true
      ? new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      : new Response(JSON.stringify(completion), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const provider = createOpenRouter({
    apiKey: 'test-key',
    fetch: fakeFetch as typeof fetch,
    extraBody: { usage: { include: true } },
  })
  return { provider, bodies }
}

const { extraBody: flexBody } = resolveServiceTierDelivery({ provider: 'openrouter', tier: 'flex', facts: null })

test('a model built with the flex extraBody sends service_tier at the top level', async () => {
  const { provider, bodies } = capturingProvider()
  await generateText({ model: provider('openai/gpt-5', { extraBody: flexBody }), prompt: 'hi', maxRetries: 0 })

  assert.equal(bodies.length, 1)
  assert.equal(bodies[0].service_tier, 'flex')
  // The provider-level extraBody survives the merge beside it.
  assert.deepEqual(bodies[0].usage, { include: true })
})

test('the streamed path carries it too', async () => {
  const { provider, bodies } = capturingProvider()
  const result = streamText({ model: provider('openai/gpt-5', { extraBody: flexBody }), prompt: 'hi', maxRetries: 0 })
  await result.text

  assert.equal(bodies.length, 1)
  assert.equal(bodies[0].stream, true)
  assert.equal(bodies[0].service_tier, 'flex')
})

test('a call-level reasoning effort and the model-level tier both arrive', async () => {
  // The effort rides in providerOptions per call, the tier in extraBody per
  // model; neither may overwrite the other.
  const { provider, bodies } = capturingProvider()
  await generateText({
    model: provider('openai/gpt-5', { extraBody: flexBody }),
    prompt: 'hi',
    maxRetries: 0,
    providerOptions: { openrouter: { reasoning: { effort: 'low' } } },
  })

  assert.equal(bodies[0].service_tier, 'flex')
  assert.deepEqual(bodies[0].reasoning, { effort: 'low' })
})

test('a model built without it sends no service_tier key at all', async () => {
  // Every role that never chose flex must build the request it built before.
  const { provider, bodies } = capturingProvider()
  await generateText({ model: provider('openai/gpt-5'), prompt: 'hi', maxRetries: 0 })

  assert.equal('service_tier' in bodies[0], false)
})
