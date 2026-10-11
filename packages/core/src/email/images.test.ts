/**
 * Fetching an image against a real HTTP server on localhost. What these pin:
 * nothing but an image of a supported type comes back, the size cap holds
 * even when the server does not say how big the body is, and every failure is
 * null rather than a throw.
 */
import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

import { fetchEmailImage } from './images.js'

const openServers = new Set<Server>()
afterEach(() => {
  for (const server of openServers) {
    server.closeAllConnections()
    server.close()
  }
  openServers.clear()
})

async function serve(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  const server = createServer(handler)
  openServers.add(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/poster.jpg`
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])
const LIMIT = { timeout: 10_000 }

test('an image comes back with its bytes and its type', LIMIT, async () => {
  const url = await serve((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/jpeg; charset=binary', 'Content-Length': JPEG.length })
    res.end(JPEG)
  })
  const image = await fetchEmailImage(url, 'poster-1')
  assert.ok(image)
  assert.equal(image.cid, 'poster-1')
  assert.equal(image.contentType, 'image/jpeg')
  assert.deepEqual([...image.content], [...JPEG])
})

test('anything that is not a supported image is refused', LIMIT, async () => {
  const html = await serve((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<html></html>')
  })
  assert.equal(await fetchEmailImage(html, 'a'), null)
  const svg = await serve((_req, res) => {
    // An SVG can carry script; mail clients treat it inconsistently.
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' })
    res.end('<svg/>')
  })
  assert.equal(await fetchEmailImage(svg, 'a'), null)
})

test('the size cap holds when the server declares the size and when it does not', LIMIT, async () => {
  const declared = await serve((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': 5000 })
    res.end(Buffer.alloc(5000))
  })
  assert.equal(await fetchEmailImage(declared, 'a', { maxBytes: 1000 }), null)

  const streamed = await serve((_req, res) => {
    // No Content-Length: chunked, and larger than the cap.
    res.writeHead(200, { 'Content-Type': 'image/png' })
    for (let i = 0; i < 10; i++) res.write(Buffer.alloc(500))
    res.end()
  })
  assert.equal(await fetchEmailImage(streamed, 'a', { maxBytes: 1000 }), null)
})

test('an error status, a timeout and a bad address are all just null', LIMIT, async () => {
  const missing = await serve((_req, res) => {
    res.writeHead(404)
    res.end()
  })
  assert.equal(await fetchEmailImage(missing, 'a'), null)

  const slow = await serve(() => {
    // Never answers.
  })
  assert.equal(await fetchEmailImage(slow, 'a', { timeoutMs: 200 }), null)

  const redirect = await serve((_req, res) => {
    res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data' })
    res.end()
  })
  assert.equal(await fetchEmailImage(redirect, 'a'), null)

  assert.equal(await fetchEmailImage('file:///etc/passwd', 'a'), null)
  assert.equal(await fetchEmailImage('not a url', 'a'), null)
})

test('a content id that could not be referenced safely is refused before fetching', LIMIT, async () => {
  let requests = 0
  const url = await serve((_req, res) => {
    requests++
    res.writeHead(200, { 'Content-Type': 'image/jpeg' })
    res.end(JPEG)
  })
  assert.equal(await fetchEmailImage(url, 'a"b'), null)
  assert.equal(requests, 0)
})
