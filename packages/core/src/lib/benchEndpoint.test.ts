import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { benchEndpointFrom } from './benchEndpoint.js'

const SHARED = { baseUrl: 'http://shared:8888/v1', apiKey: 'shared-key' }

test("on the role's provider the role's own key wins, which the shared lookup cannot see", () => {
  assert.deepEqual(
    benchEndpointFrom('unsloth', { provider: 'unsloth', baseUrl: 'http://own:8888/v1', apiKey: 'own-key' }, {}),
    { baseUrl: 'http://own:8888/v1', apiKey: 'own-key' }
  )
})

test("on the role's provider with no key of its own, the shared key travels with the role's address", () => {
  assert.deepEqual(
    benchEndpointFrom('unsloth', { provider: 'unsloth', baseUrl: 'http://own:8888/v1' }, SHARED),
    { baseUrl: 'http://own:8888/v1', apiKey: 'shared-key' }
  )
  // An empty key is no key, as the writer reads it.
  assert.equal(
    benchEndpointFrom('unsloth', { provider: 'unsloth', baseUrl: 'http://own:8888/v1', apiKey: '' }, SHARED).apiKey,
    'shared-key'
  )
})

test('a role with no address gets none: the writer falls back to no other, so the bench must not', () => {
  assert.equal(benchEndpointFrom('unsloth', { provider: 'unsloth', apiKey: 'own-key' }, SHARED).baseUrl, undefined)
})

test('any other provider, or no role, reads the shared address and key', () => {
  assert.deepEqual(benchEndpointFrom('lmstudio', { provider: 'unsloth', apiKey: 'own-key' }, SHARED), SHARED)
  assert.deepEqual(benchEndpointFrom('unsloth', null, SHARED), SHARED)
  assert.deepEqual(benchEndpointFrom('unsloth', undefined, SHARED), SHARED)
})

test('the list and the run both go through it, or a model that runs cannot be listed', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const route = readFileSync(resolve(here, '../../../../apps/api/src/routes/analysis-compare/index.ts'), 'utf8')
  assert.match(route, /resolveBenchEndpoint\(/)
  assert.doesNotMatch(route, /resolveProviderEndpoint/)

  const provider = readFileSync(resolve(here, 'ai-provider.ts'), 'utf8')
  const build = provider.slice(provider.indexOf('export async function buildTitleAnalysisAttemptFor'))
  assert.match(build.slice(0, build.indexOf('createProviderInstance')), /resolveBenchEndpoint\(/)
})
