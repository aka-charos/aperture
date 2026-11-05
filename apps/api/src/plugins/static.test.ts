/**
 * What a browser and any cache in front of the server get for the web bundle, read
 * off the real plugin over a build laid out the way Vite and precompress.mjs leave
 * it. Run with --test-force-exit, since the core package starts timers on import.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brotliCompressSync, brotliDecompressSync, gunzipSync, gzipSync } from 'node:zlib'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'

// An address nothing listens on: the instance name read falls back at once.
process.env.DATABASE_URL ??= 'postgres://boot:test@127.0.0.1:1/boot_test'
process.env.NODE_ENV = 'production'

const CHUNK = 'export const chunk = "the same text, over and over, over and over";\n'.repeat(50)
const NEVER_CACHE = /no-cache/
const FOR_A_YEAR = /public, max-age=31536000, immutable/

let dist: string
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any

before(async () => {
  dist = mkdtempSync(join(tmpdir(), 'aperture-static-'))
  mkdirSync(join(dist, 'assets'))
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>x</title>')
  writeFileSync(join(dist, 'robots.txt'), 'User-agent: *\n')
  writeFileSync(join(dist, 'assets', 'page-AbCd1234.js'), CHUNK)
  writeFileSync(join(dist, 'assets', 'page-AbCd1234.js.br'), brotliCompressSync(CHUNK))
  writeFileSync(join(dist, 'assets', 'page-AbCd1234.js.gz'), gzipSync(CHUNK))
  writeFileSync(join(dist, 'assets', 'tiny-AbCd1234.js'), 'export {}\n')

  const { default: staticPlugin } = await import('./static.js')
  app = Fastify({ logger: false })
  // server.ts registers CORS, whose Vary is set on the reply and so outranks one
  // set on the raw response: without it here the Vary test passes and the real
  // server drops the header.
  await app.register(cors, { origin: true, credentials: true })
  await app.register(cookie)
  await app.register(staticPlugin, { webDistPath: dist })
  await app.ready()
})

after(async () => {
  await app?.close()
  rmSync(dist, { recursive: true, force: true })
  const { closePool } = await import('../lib/db.js')
  await closePool()
})

const get = (url: string, headers: Record<string, string> = {}) => app.inject({ method: 'GET', url, headers })

test('a browser gets the smallest copy it accepts, typed as the script it is', async () => {
  const res = await get('/assets/page-AbCd1234.js', { 'accept-encoding': 'gzip, deflate, br' })
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['content-encoding'], 'br')
  assert.match(String(res.headers['content-type']), /javascript/)
  assert.equal(brotliDecompressSync(res.rawPayload).toString(), CHUNK)
  assert.equal(Number(res.headers['content-length']), res.rawPayload.length)
})

test('a client without brotli gets gzip', async () => {
  const res = await get('/assets/page-AbCd1234.js', { 'accept-encoding': 'gzip' })
  assert.equal(res.headers['content-encoding'], 'gzip')
  assert.equal(gunzipSync(res.rawPayload).toString(), CHUNK)
})

test('a client accepting nothing we hold gets the plain file', async () => {
  const asked: Record<string, string>[] = [{}, { 'accept-encoding': 'deflate' }, { 'accept-encoding': 'identity' }]
  for (const headers of asked) {
    const res = await get('/assets/page-AbCd1234.js', headers)
    assert.equal(res.statusCode, 200)
    assert.equal(res.headers['content-encoding'], undefined)
    assert.equal(res.payload, CHUNK)
  }
})

test('a chunk too small to have compressed copies is still served', async () => {
  const res = await get('/assets/tiny-AbCd1234.js', { 'accept-encoding': 'br, gzip' })
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['content-encoding'], undefined)
  assert.equal(res.payload, 'export {}\n')
  assert.match(String(res.headers['cache-control']), FOR_A_YEAR)
})

test('every copy of a chunk is cached for a year and tells caches it varies', async () => {
  for (const encoding of ['br', 'gzip', 'identity']) {
    const res = await get('/assets/page-AbCd1234.js', { 'accept-encoding': encoding, origin: 'http://app.test' })
    assert.match(String(res.headers['cache-control']), FOR_A_YEAR, encoding)
    assert.match(String(res.headers.vary), /accept-encoding/i, encoding)
    assert.match(String(res.headers.vary), /origin/i, 'and keeps what CORS said')
  }
})

test('the copies have their own validators, so a revalidation cannot cross them', async () => {
  const br = await get('/assets/page-AbCd1234.js', { 'accept-encoding': 'br' })
  const gzip = await get('/assets/page-AbCd1234.js', { 'accept-encoding': 'gzip' })
  assert.ok(br.headers.etag)
  assert.notEqual(br.headers.etag, gzip.headers.etag)
  const again = await get('/assets/page-AbCd1234.js', {
    'accept-encoding': 'br',
    'if-none-match': String(br.headers.etag),
  })
  assert.equal(again.statusCode, 304)
})

test('a chunk gone after a deploy gets the page, uncached, which starts the reload', async () => {
  const res = await get('/assets/gone-AbCd1234.js', { 'accept-encoding': 'br, gzip' })
  assert.equal(res.statusCode, 200)
  assert.match(String(res.headers['content-type']), /text\/html/)
  assert.match(String(res.headers['cache-control']), NEVER_CACHE)
  assert.doesNotMatch(String(res.headers['cache-control']), /immutable/)
  assert.equal(res.headers['content-encoding'], undefined)
})

test('the shell is never cached, and files with fixed names are not cached for a year', async () => {
  const shell = await get('/')
  assert.match(String(shell.headers['cache-control']), NEVER_CACHE)
  const robots = await get('/robots.txt')
  assert.equal(robots.statusCode, 200)
  assert.doesNotMatch(String(robots.headers['cache-control']), /immutable/)
})

test('an app route still gets the shell', async () => {
  const res = await get('/browse/movies')
  assert.equal(res.statusCode, 200)
  assert.match(String(res.headers['content-type']), /text\/html/)
})
