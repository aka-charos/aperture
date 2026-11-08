import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classifyMediaServer, describeDetection, detectMediaServerType } from './detect.js'
import { getMediaServerCapabilities } from './capabilities.js'

function fakeFetch(body: unknown, init: { status?: number; throws?: boolean } = {}): typeof fetch {
  return (async () => {
    if (init.throws) throw new Error('connect ECONNREFUSED')
    const text = typeof body === 'string' ? body : JSON.stringify(body)
    return new Response(text, { status: init.status ?? 200 })
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
  let redirect: RequestInit['redirect']
  const impl = (async (url: string, init?: RequestInit) => {
    requested = url
    redirect = init?.redirect
    return new Response(
      JSON.stringify({ ProductName: 'Jellyfin Server', Version: '10.10.7', ServerName: 'Home' })
    )
  }) as unknown as typeof fetch

  const result = await detectMediaServerType('http://jf:8096/', impl)
  assert.equal(requested, 'http://jf:8096/System/Info/Public')
  assert.equal(redirect, 'manual')
  assert.equal(result?.type, 'jellyfin')
  assert.equal(result?.serverName, 'Home')
})

test('detectMediaServerType returns null on network errors, HTTP errors, redirects and bad bodies', async () => {
  assert.equal(await detectMediaServerType('http://x', fakeFetch({}, { throws: true })), null)
  assert.equal(await detectMediaServerType('http://x', fakeFetch({}, { status: 500 })), null)
  assert.equal(await detectMediaServerType('http://x', fakeFetch('', { status: 302 })), null)
  assert.equal(await detectMediaServerType('http://x', fakeFetch('null')), null)
  assert.equal(await detectMediaServerType('http://x', fakeFetch('<html>not json</html>')), null)
})

test('detectMediaServerType refuses oversized responses', async () => {
  const big = JSON.stringify({ ProductName: 'Jellyfin Server', pad: 'x'.repeat(64 * 1024) })
  assert.equal(await detectMediaServerType('http://x', fakeFetch(big)), null)
})

test('describeDetection exposes only the type and mismatch flag', () => {
  const jf = classifyMediaServer({ ProductName: 'Jellyfin Server', Version: '10.10.7', ServerName: 'Home' })

  assert.deepEqual(describeDetection(jf, 'emby'), { detectedType: 'jellyfin', typeMismatch: true })
  assert.deepEqual(describeDetection(jf, 'jellyfin'), { detectedType: 'jellyfin', typeMismatch: false })
  // Nothing from the remote server beyond the classified type is returned
  assert.deepEqual(Object.keys(describeDetection(jf, 'emby')).sort(), ['detectedType', 'typeMismatch'])
  assert.deepEqual(describeDetection(null, 'emby'), {})
  assert.deepEqual(describeDetection(classifyMediaServer({}), 'emby'), {})
})

test('capabilities: dynamic home rows are Emby-only; unknown type behaves like Emby', () => {
  assert.equal(getMediaServerCapabilities('emby').dynamicHomeRows, true)
  assert.equal(getMediaServerCapabilities('jellyfin').dynamicHomeRows, false)
  assert.equal(getMediaServerCapabilities(null).dynamicHomeRows, true)
  assert.equal(getMediaServerCapabilities('plex').dynamicHomeRows, true)
})
