/**
 * The flex tier: which models have one, and what reaches the wire.
 *
 * Every failure pinned here is silent. A tier read off the wrong segment of a
 * tag offers flex for a model that has none (it then saves, displays, and bills
 * at full price), or hides it for one that has it. "Could not ask" collapsed
 * into "has none" tells an operator something false. And a stray default would
 * change every existing role's requests on the deploy that introduced this.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  APP_SENT_PARAMETERS,
  ROLES_WITH_SERVICE_TIER,
  SERVICE_TIER_OPTIONS,
  endpointTier,
  flexEndpoints,
  normalizeServedTier,
  parseEndpointsResponse,
  pricePerMillion,
  resolveServiceTier,
  resolveServiceTierDelivery,
  roleReadsServiceTier,
  serviceTierOptionsFor,
  summarizeFlex,
} from './serviceTier.js'

// The documented shape of `GET /api/v1/models/{author}/{slug}/endpoints`
// (`PublicEndpoint` in OpenRouter's OpenAPI spec): prices are USD per token as
// strings, and a tier endpoint is its own entry whose `tag` carries the tier.
// The region-scoped default tag is real — it is the one F-038 pins embeddings
// to — and is here because it is the tag a loose "has a slash" test misreads.
const geminiListing = {
  data: {
    id: 'google/gemini-3.5-flash',
    endpoints: [
      {
        tag: 'google-vertex/us-central1',
        provider_name: 'Google Vertex',
        pricing: { prompt: '0.0000003', completion: '0.0000025' },
        supported_parameters: ['tools', 'reasoning', 'temperature', 'top_p', 'response_format'],
      },
      {
        tag: 'google-ai-studio',
        provider_name: 'Google AI Studio',
        pricing: { prompt: '0.00000035', completion: '0.0000025' },
        supported_parameters: ['tools', 'reasoning', 'temperature', 'top_p'],
      },
      {
        tag: 'google-vertex/flex',
        provider_name: 'Google Vertex',
        pricing: { prompt: '0.00000015', completion: '0.00000125' },
        supported_parameters: ['reasoning', 'temperature', 'top_p', 'response_format'],
      },
      {
        tag: 'google-ai-studio/flex',
        provider_name: 'Google AI Studio',
        pricing: { prompt: '0.000000175', completion: '0.00000125' },
        supported_parameters: ['reasoning', 'temperature', 'top_p'],
      },
    ],
  },
}

const noFlexListing = {
  data: {
    endpoints: [
      { tag: 'deepinfra/fp8', provider_name: 'DeepInfra', pricing: { prompt: '0.0000002', completion: '0.0000008' } },
      { tag: 'novita', provider_name: 'Novita', pricing: { prompt: '0.00000025', completion: '0.000001' } },
    ],
  },
}

// ---------------------------------------------------------------------------
// Reading a tag
// ---------------------------------------------------------------------------

test('a tier suffix on the provider slug names the tier', () => {
  assert.equal(endpointTier('openai/flex'), 'flex')
  assert.equal(endpointTier('google-vertex/flex'), 'flex')
  assert.equal(endpointTier('google-ai-studio/flex'), 'flex')
  assert.equal(endpointTier('openai/ultrafast'), 'ultrafast')
})

test('fast and priority are one tier with two names', () => {
  assert.equal(endpointTier('openai/fast'), 'priority')
  assert.equal(endpointTier('openai/priority'), 'priority')
})

test('a bare slug and a region are the default tier, not a tier of their own', () => {
  assert.equal(endpointTier('openai'), 'default')
  assert.equal(endpointTier('google-vertex/us-central1'), 'default')
  // A quantization suffix shares the slot a tier would use.
  assert.equal(endpointTier('deepinfra/fp8'), 'default')
})

test('only a whole segment names a tier, and never the provider slug itself', () => {
  assert.equal(endpointTier('openai/flexible'), 'default')
  // A provider that happened to be called `flex` is still a provider.
  assert.equal(endpointTier('flex'), 'default')
  assert.equal(endpointTier('flex/us-east'), 'default')
  // A region-scoped tier tag would still be read as its tier.
  assert.equal(endpointTier('google-vertex/europe-west4/flex'), 'flex')
})

test('tags are read case-insensitively and trimmed', () => {
  assert.equal(endpointTier(' OpenAI/FLEX '), 'flex')
})

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

test('a per-token price string becomes a per-million number', () => {
  assert.equal(pricePerMillion('0.0000025'), 2.5)
  assert.equal(pricePerMillion('0.00000015'), 0.15)
})

test('a missing or unparseable price is null, and a published zero survives as zero', () => {
  assert.equal(pricePerMillion(undefined), null)
  assert.equal(pricePerMillion(''), null)
  assert.equal(pricePerMillion('n/a'), null)
  assert.equal(pricePerMillion('-1'), null)
  // Free is a published price, not an unknown one.
  assert.equal(pricePerMillion('0'), 0)
})

// ---------------------------------------------------------------------------
// The listing
// ---------------------------------------------------------------------------

test('the listing is read into endpoints with their tier and their own price', () => {
  const facts = parseEndpointsResponse(geminiListing)
  assert.ok(facts)
  assert.equal(facts.endpoints.length, 4)
  const vertexFlex = facts.endpoints.find((e) => e.tag === 'google-vertex/flex')
  assert.deepEqual(vertexFlex, {
    tag: 'google-vertex/flex',
    providerName: 'Google Vertex',
    tier: 'flex',
    inputCostPerMillion: 0.15,
    outputCostPerMillion: 1.25,
    supportedParameters: ['reasoning', 'temperature', 'top_p', 'response_format'],
  })
  assert.equal(flexEndpoints(facts).length, 2)
})

test('a body that is not the documented shape is UNKNOWN, not an empty listing', () => {
  assert.equal(parseEndpointsResponse(null), null)
  assert.equal(parseEndpointsResponse({}), null)
  assert.equal(parseEndpointsResponse({ data: { endpoints: 'nope' } }), null)
  assert.equal(parseEndpointsResponse({ error: { message: 'Model not found' } }), null)
})

test('an entry with no tag is skipped rather than read as a default endpoint', () => {
  const facts = parseEndpointsResponse({ data: { endpoints: [{ provider_name: 'X' }, { tag: 'openai/flex' }] } })
  assert.deepEqual(facts?.endpoints.map((e) => e.tag), ['openai/flex'])
})

test('an endpoint declaring no parameters is unknown, not one that takes none', () => {
  const facts = parseEndpointsResponse({ data: { endpoints: [{ tag: 'openai/flex' }] } })
  assert.equal(facts?.endpoints[0].supportedParameters, null)
})

// ---------------------------------------------------------------------------
// What is offered
// ---------------------------------------------------------------------------

test('a model with a flex endpoint is offered default and flex, in that order', () => {
  assert.deepEqual(serviceTierOptionsFor(parseEndpointsResponse(geminiListing)), ['default', 'flex'])
})

test('a model with no flex endpoint, or an unknown one, is offered no choice', () => {
  assert.deepEqual(serviceTierOptionsFor(parseEndpointsResponse(noFlexListing)), [])
  assert.deepEqual(serviceTierOptionsFor({ endpoints: [] }), [])
  assert.deepEqual(serviceTierOptionsFor(null), [])
})

test('a priority endpoint does not make flex available', () => {
  const facts = parseEndpointsResponse({ data: { endpoints: [{ tag: 'openai' }, { tag: 'openai/fast' }] } })
  assert.deepEqual(serviceTierOptionsFor(facts), [])
})

test('only default and flex are ever offered', () => {
  assert.deepEqual([...SERVICE_TIER_OPTIONS], ['default', 'flex'])
})

// ---------------------------------------------------------------------------
// The summary the card and the test print
// ---------------------------------------------------------------------------

test('unknown and unavailable stay two different answers', () => {
  assert.equal(summarizeFlex(null).status, 'unknown')
  assert.equal(summarizeFlex(parseEndpointsResponse(noFlexListing)).status, 'unavailable')
  assert.equal(summarizeFlex({ endpoints: [] }).status, 'unavailable')
})

test('the summary names who serves flex and compares the cheapest of each tier', () => {
  const s = summarizeFlex(parseEndpointsResponse(geminiListing))
  assert.equal(s.status, 'available')
  assert.deepEqual(s.providers, ['Google Vertex', 'Google AI Studio'])
  assert.equal(s.inputCostPerMillion, 0.15)
  assert.equal(s.outputCostPerMillion, 1.25)
  // Standard is the region-scoped Vertex endpoint, cheaper than AI Studio's,
  // and NOT a flex endpoint mistaken for standard capacity.
  assert.equal(s.standardInputCostPerMillion, 0.3)
  assert.equal(s.standardOutputCostPerMillion, 2.5)
})

test('a parameter standard capacity takes and flex does not is reported — tools here', () => {
  // The case that matters: a chat role on flex would lose tool calling.
  const s = summarizeFlex(parseEndpointsResponse(geminiListing))
  assert.deepEqual(s.missingParameters, ['tools'])
})

test('a flex endpoint that declares nothing is unknown, so nothing is called missing', () => {
  const facts = parseEndpointsResponse({
    data: {
      endpoints: [
        { tag: 'openai', supported_parameters: ['tools', 'reasoning'] },
        { tag: 'openai/flex' },
      ],
    },
  })
  assert.deepEqual(summarizeFlex(facts).missingParameters, [])
})

test('only parameters this app sends are reported missing', () => {
  const facts = parseEndpointsResponse({
    data: {
      endpoints: [
        { tag: 'openai', supported_parameters: ['tools', 'logprobs', 'top_logprobs'] },
        { tag: 'openai/flex', supported_parameters: ['tools'] },
      ],
    },
  })
  assert.deepEqual(summarizeFlex(facts).missingParameters, [])
  assert.ok((APP_SENT_PARAMETERS as readonly string[]).includes('tools'))
})

// ---------------------------------------------------------------------------
// What is stored
// ---------------------------------------------------------------------------

test('flex is the only value a config can carry', () => {
  assert.equal(resolveServiceTier({ serviceTier: 'flex' }), 'flex')
  assert.equal(resolveServiceTier({ serviceTier: ' FLEX ' }), 'flex')
})

test('default, an unrecognised word and absence all read as the default tier', () => {
  assert.equal(resolveServiceTier({ serviceTier: 'default' }), undefined)
  // A hand-edited costlier tier must not start being sent.
  assert.equal(resolveServiceTier({ serviceTier: 'priority' }), undefined)
  assert.equal(resolveServiceTier({ serviceTier: 1 }), undefined)
  assert.equal(resolveServiceTier({}), undefined)
  assert.equal(resolveServiceTier(null), undefined)
})

// ---------------------------------------------------------------------------
// What is sent
// ---------------------------------------------------------------------------

const flexFacts = parseEndpointsResponse(geminiListing)
const noFlexFacts = parseEndpointsResponse(noFlexListing)

test('no tier means nothing is sent — every existing role builds the same request', () => {
  const d = resolveServiceTierDelivery({ provider: 'openrouter', tier: undefined, facts: flexFacts })
  assert.deepEqual(d, { undeliverable: null, unverified: false })
  assert.equal('extraBody' in d, false)
})

test('flex on a model that lists it is sent as the top-level body field', () => {
  assert.deepEqual(resolveServiceTierDelivery({ provider: 'openrouter', tier: 'flex', facts: flexFacts }), {
    extraBody: { service_tier: 'flex' },
    undeliverable: null,
    unverified: false,
  })
})

test('flex on a model whose listing names no flex endpoint is not sent, and says why', () => {
  assert.deepEqual(resolveServiceTierDelivery({ provider: 'openrouter', tier: 'flex', facts: noFlexFacts }), {
    undeliverable: 'model',
    unverified: false,
  })
})

test('an unreadable listing still sends flex, flagged unverified', () => {
  // OpenRouter routes a flex request with no flex endpoint at standard rates,
  // so the hopeful send cannot produce a request nobody chose — while dropping
  // it would double the bill for as long as the lookup is down.
  assert.deepEqual(resolveServiceTierDelivery({ provider: 'openrouter', tier: 'flex', facts: null }), {
    extraBody: { service_tier: 'flex' },
    undeliverable: null,
    unverified: true,
  })
})

test('no other provider is sent the field', () => {
  for (const provider of ['openai', 'google', 'zai', 'lmstudio']) {
    assert.deepEqual(resolveServiceTierDelivery({ provider, tier: 'flex', facts: flexFacts }), {
      undeliverable: 'provider',
      unverified: false,
    })
  }
})

// ---------------------------------------------------------------------------
// The response's report
// ---------------------------------------------------------------------------

test('the served tier is normalised, Google and Anthropic spellings included', () => {
  assert.equal(normalizeServedTier('flex'), 'flex')
  assert.equal(normalizeServedTier('default'), 'default')
  assert.equal(normalizeServedTier('standard'), 'default')
  assert.equal(normalizeServedTier('priority'), 'priority')
  assert.equal(normalizeServedTier(null), null)
  assert.equal(normalizeServedTier(undefined), null)
  assert.equal(normalizeServedTier('scale'), null)
})

// ---------------------------------------------------------------------------
// Who reads it
// ---------------------------------------------------------------------------

test('every language role applies a tier; embeddings and web search do not', () => {
  for (const role of ['chat', 'textGeneration', 'exploration', 'titleAnalysis']) {
    assert.equal(roleReadsServiceTier(role), true, role)
  }
  assert.equal(roleReadsServiceTier('embeddings'), false)
  assert.equal(roleReadsServiceTier('webSearch'), false)
  assert.equal(ROLES_WITH_SERVICE_TIER.length, 4)
})
