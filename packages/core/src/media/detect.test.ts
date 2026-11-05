import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classifyMediaServer, detectMediaServerType } from './detect.js'
import { getMediaServerCapabilities } from './capabilities.js'

function fakeFetch(body: unknown, init: { ok?: boolean; throws?: boolean } = {}): typeof fetch {
  return (async () => {
    if (init.throws) throw new Error('connect ECONNREFUSED')
    return {
      ok: init.ok ?? true,
      json: async () => body,
    } as unknown as Response
  }) as typeof fetch
}

test('classifies by ProductName first', () => {
  const jf = classifyMediaServer({ ProductName: 'Jellyfin Server', Version: '10.10.7' })
  assert.equal(jf.type, 'jellyfin')
  assert.equal(jf.basis, 'productName')

  const emby = classifyMediaServer({ ProductName: 'Emby Server', Version: '4.9.0.0' })
  assert.equal(emby.type, 'emby')
  assert.equal(emby.basis, 'productName')
})

test('ProductName wins over a conflicting version', () => {
  const result = classifyMediaServer({ ProductName: 'Jellyfin Server', Version: '4.8.0' })
  assert.equal(result.type, 'jellyfin')
})

test('falls back to the major version when ProductName is absent', () => {
  assert.deepEqual(
    [classifyMediaServer({ Version: '4.8.10.0' }).type, classifyMediaServer({ Version: '4.8.10.0' }).basis],
    ['emby', 'version']
  )
  assert.equal(classifyMediaServer({ Version: '10.11.2' }).type, 'jellyfin')
  assert.equal(classifyMediaServer({ Version: '11.0.0' }).type, 'jellyfin')
})

test('leaves unrecognised servers unclassified instead of guessing', () => {
  assert.equal(classifyMediaServer({}).type, null)
  assert.equal(classifyMediaServer({ Version: '5.1.0' }).type, null)
  assert.equal(classifyMediaServer({ Version: 'not-a-version' }).type, null)
  assert.equal(classifyMediaServer({ ProductName: 'Plex Media Server' }).type, null)
})

test('detectMediaServerType reads /System/Info/Public and tolerates a trailing slash', async () => {
  let requested = ''
  const impl = (async (url: string) => {
    requested = url
    return {
      ok: true,
      json: async () => ({ ProductName: 'Jellyfin Server', Version: '10.10.7', ServerName: 'Home' }),
    } as unknown as Response
  }) as unknown as typeof fetch

  const result = await detectMediaServerType('http://jf:8096/', impl)
  assert.equal(requested, 'http://jf:8096/System/Info/Public')
  assert.equal(result?.type, 'jellyfin')
  assert.equal(result?.serverName, 'Home')
})

test('detectMediaServerType returns null on network errors, HTTP errors and bad bodies', async () => {
  assert.equal(await detectMediaServerType('http://x', fakeFetch({}, { throws: true })), null)
  assert.equal(await detectMediaServerType('http://x', fakeFetch({}, { ok: false })), null)
  assert.equal(await detectMediaServerType('http://x', fakeFetch(null)), null)
})

test('capabilities: dynamic home rows are Emby-only; unknown type behaves like Emby', () => {
  assert.equal(getMediaServerCapabilities('emby').dynamicHomeRows, true)
  assert.equal(getMediaServerCapabilities('jellyfin').dynamicHomeRows, false)
  assert.equal(getMediaServerCapabilities(null).dynamicHomeRows, true)
  assert.equal(getMediaServerCapabilities('plex').dynamicHomeRows, true)
})
