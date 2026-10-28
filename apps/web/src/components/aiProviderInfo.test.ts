import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { DEFAULT_PROVIDER_COPY, PROVIDER_INFO } from './aiProviderInfo'

/**
 * The role card reads each provider's wording and abilities off PROVIDER_INFO,
 * so a wrong entry there is a raw translation key on screen or a provider whose
 * models cannot be added. Both are pinned here, the second against core's own
 * lists read as text (the web bundle never imports core).
 */
const here = dirname(fileURLToPath(import.meta.url))
const en = JSON.parse(
  readFileSync(resolve(here, '../i18n/locales/en/translation.json'), 'utf8')
) as Record<string, unknown>
const coreLib = resolve(here, '../../../../packages/core/src/lib')

function resolves(key: string): boolean {
  let node: unknown = en
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object') return false
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string'
}

/** The quoted strings inside the first `[...]` after `marker` in a core source file. */
function coreList(file: string, marker: string): string[] {
  const source = readFileSync(resolve(coreLib, file), 'utf8')
  const start = source.indexOf(marker)
  assert.ok(start >= 0, `${marker} not found in ${file}`)
  const open = source.indexOf('[', start)
  const close = source.indexOf(']', open)
  const body = source.slice(open, close).replace(/\/\/.*$/gm, '')
  return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()
}

test('every translation key a provider names exists in English', () => {
  const keys = [
    ...Object.values(DEFAULT_PROVIDER_COPY),
    ...Object.values(PROVIDER_INFO).flatMap((info) => Object.values(info.copy ?? {})),
  ]
  for (const key of keys) assert.ok(resolves(key), `${key} is missing from en/translation.json`)
})

test('the providers offering custom models are exactly core’s', () => {
  const web = Object.values(PROVIDER_INFO)
    .filter((info) => info.customModels)
    .map((info) => info.id)
    .sort()
  assert.deepEqual(web, coreList('ai-capabilities/customModels.ts', 'export const CUSTOM_MODEL_PROVIDERS'))
})

test('the providers whose server can be probed are exactly core’s discoverable ones', () => {
  const web = Object.values(PROVIDER_INFO)
    .filter((info) => info.serverProbe != null)
    .map((info) => info.id)
    .sort()
  const source = readFileSync(resolve(coreLib, 'localModelDiscovery.ts'), 'utf8')
  const union = /export type DiscoverableProvider = ([^\n]+)/.exec(source)
  assert.ok(union, 'DiscoverableProvider not found')
  const core = [...union[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()
  assert.deepEqual(web, core)
})

test('a key is optional only where it is offered', () => {
  const unsloth = PROVIDER_INFO.unsloth
  assert.equal(unsloth.requiresApiKey, false)
  assert.equal(unsloth.acceptsApiKey, true)
})
