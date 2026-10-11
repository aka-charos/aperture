import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  keyHint,
  normalizeEndpoint,
  publicAIConfig,
  publicMediaServerConfig,
  publicRoleConfig,
  publicWebhook,
  resolveFallbackKeyEntries,
  storedKeyMayGoTo,
  withStoredAuthHeader,
} from './secretExposure.js'

// Core's resolveFallbackKeys, restated only for the test.
const fallbacks = (c: { fallbackApiKeys?: string[]; fallbackApiKey?: string }) =>
  [...(c.fallbackApiKeys ?? []), ...(c.fallbackApiKey ? [c.fallbackApiKey] : [])]
    .map((k) => k.trim())
    .filter((k) => k.length > 0)

const PRIMARY = 'AIzaSyPRIMARY-0000000000000000wxyz'
const SPARE_A = 'AIzaSySPARE-A-00000000000000000aaaa'
const SPARE_B = 'AIzaSySPARE-B-00000000000000000bbbb'

test('a role config reaches the browser with no key in it at all', () => {
  const pub = publicRoleConfig(
    { provider: 'google', model: 'gemini', apiKey: PRIMARY, fallbackApiKeys: [SPARE_A], fallbackApiKey: SPARE_B },
    fallbacks
  )
  const text = JSON.stringify(pub)
  for (const secret of [PRIMARY, SPARE_A, SPARE_B]) assert.ok(!text.includes(secret), secret)
  assert.equal(pub?.hasApiKey, true)
  assert.deepEqual(pub?.fallbackKeyHints, ['…aaaa', '…bbbb'])
  assert.equal((pub as Record<string, unknown>).provider, 'google')
})

test('every role of a whole config is masked, and an empty role stays null', () => {
  const pub = publicAIConfig(
    { chat: { provider: 'openrouter', model: 'x', apiKey: PRIMARY }, embeddings: null },
    fallbacks
  )
  assert.ok(!JSON.stringify(pub).includes(PRIMARY))
  assert.equal(pub.embeddings, null)
  assert.equal(pub.chat?.hasApiKey, true)
})

test('a short key gets no hint, since four characters would be most of it', () => {
  assert.equal(keyHint('abc123'), null)
  assert.equal(keyHint(''), null)
  assert.equal(keyHint(undefined), null)
  assert.equal(keyHint(PRIMARY), '…wxyz')
})

test('kept spare-key slots resolve to the stored key at that position', () => {
  assert.deepEqual(resolveFallbackKeyEntries([{ keep: 1 }, ' new-key ', { keep: 0 }], [SPARE_A, SPARE_B]), [
    SPARE_B,
    'new-key',
    SPARE_A,
  ])
})

test('a slot that names nothing stored, or is not a slot, is dropped', () => {
  assert.deepEqual(
    resolveFallbackKeyEntries([{ keep: 5 }, { keep: -1 }, { keep: 0.5 }, { keep: '0' }, null, 42, '   '], [SPARE_A]),
    []
  )
})

test('a stored key may go only to the address it was saved for', () => {
  const allowed = ['http://lmstudio:1234/v1', undefined, 'https://api.z.ai/api/paas/v4']
  assert.ok(storedKeyMayGoTo(undefined, allowed), 'no address means the stored one')
  assert.ok(storedKeyMayGoTo('', allowed))
  assert.ok(storedKeyMayGoTo('http://LMSTUDIO:1234/v1/', allowed), 'case and trailing slash are not a new address')
  assert.ok(!storedKeyMayGoTo('https://attacker.example/v1', allowed))
  assert.ok(!storedKeyMayGoTo('http://lmstudio:1234/v2', allowed), 'a different path is a different endpoint')
  assert.ok(!storedKeyMayGoTo('https://anything.example', []), 'nothing saved admits no address')
})

test('normalizeEndpoint keeps the path and query, folds only what is case-insensitive', () => {
  assert.equal(normalizeEndpoint('HTTP://Host.Example:8080/Path/'), 'http://host.example:8080/Path')
  assert.equal(normalizeEndpoint(' not a url/ '), 'not a url')
})

test('an n8n webhook goes out without its header value', () => {
  const pub = publicWebhook({ enabled: true, webhookUrl: 'https://n8n.local/hook', authHeaderName: 'X-Auth', authHeaderValue: 's3cret' })
  assert.ok(!JSON.stringify(pub).includes('s3cret'))
  assert.equal(pub?.hasAuthHeaderValue, true)
  assert.equal(publicWebhook(null), null)
})

test('a left-out header value is carried over to the same URL under the same name only', () => {
  const stored = { webhookUrl: 'https://n8n.local/hook', authHeaderName: 'X-Auth', authHeaderValue: 's3cret' }
  type Hook = { enabled: boolean; webhookUrl: string; authHeaderName?: string; authHeaderValue?: string }
  const same: Hook = { enabled: true, webhookUrl: 'https://n8n.local/hook/', authHeaderName: 'X-Auth' }
  assert.equal(withStoredAuthHeader(same, stored)?.authHeaderValue, 's3cret')

  const moved: Hook = { ...same, webhookUrl: 'https://attacker.example/hook' }
  assert.equal(withStoredAuthHeader(moved, stored)?.authHeaderValue, undefined, 'never follows a new URL')

  const renamed: Hook = { ...same, authHeaderName: 'X-Other' }
  assert.equal(withStoredAuthHeader(renamed, stored)?.authHeaderValue, undefined)

  const unnamed: Hook = { enabled: true, webhookUrl: same.webhookUrl }
  assert.equal(withStoredAuthHeader(unnamed, stored)?.authHeaderValue, undefined, 'removing the name removes the auth')

  const emptyUrl: Hook = { ...same, webhookUrl: '' }
  assert.equal(withStoredAuthHeader(emptyUrl, stored)?.authHeaderValue, undefined)

  const explicit: Hook = { ...same, authHeaderValue: 'new' }
  assert.equal(withStoredAuthHeader(explicit, stored)?.authHeaderValue, 'new', 'a typed value wins')
})

test('the media server snapshot carries a hint, not the key', () => {
  const pub = publicMediaServerConfig({ type: 'emby', baseUrl: 'http://emby:8096', apiKey: 'emby-admin-key-0123456789abcd', isConfigured: true })
  assert.ok(!JSON.stringify(pub).includes('emby-admin-key'))
  assert.equal(pub.hasApiKey, true)
  assert.equal(pub.apiKeyHint, '…abcd')
  assert.equal(publicMediaServerConfig({ apiKey: null }).hasApiKey, false)
})
