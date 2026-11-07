import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  MEDIA_SERVER_MAX_CONCURRENT_REQUESTS,
  MediaServerTimeoutError,
  requestMediaServer,
} from './serverRequest.js'

async function serve(handler: http.RequestListener) {
  const server = http.createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    base,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

describe('requestMediaServer', { timeout: 10_000 }, () => {
  const servers: Array<{ close: () => Promise<void> }> = []
  after(async () => {
    await Promise.all(servers.map((s) => s.close()))
  })

  it('returns the whole body with the status', async () => {
    const s = await serve((_req, res) => {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('missing')
    })
    servers.push(s)
    const reply = await requestMediaServer(s.base, `${s.base}/x`, {}, 2_000)
    assert.deepEqual(
      { ok: reply.ok, status: reply.status, text: reply.text },
      { ok: false, status: 404, text: 'missing' }
    )
  })

  it('times out a body that stalls after the headers arrived', async () => {
    const s = await serve((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.write('{"Items":[')
      // Never ends: the old fetch stopped its clock at the headers and waited forever here.
    })
    servers.push(s)
    const started = Date.now()
    await assert.rejects(
      requestMediaServer(s.base, `${s.base}/Items`, {}, 300),
      (err: unknown) => err instanceof MediaServerTimeoutError && err.timeoutMs === 300
    )
    assert.ok(Date.now() - started < 3_000)
  })

  it('rethrows a refused connection as it came, not as a timeout', async () => {
    const s = await serve((_req, res) => res.end())
    const base = s.base
    await s.close()
    await assert.rejects(
      requestMediaServer(base, `${base}/x`, {}, 2_000),
      (err: unknown) => !(err instanceof MediaServerTimeoutError)
    )
  })

  it('never has more than the cap open against one server', async () => {
    let open = 0
    let most = 0
    const s = await serve((_req, res) => {
      open++
      most = Math.max(most, open)
      setTimeout(() => {
        open--
        res.end('{}')
      }, 40)
    })
    servers.push(s)
    const count = MEDIA_SERVER_MAX_CONCURRENT_REQUESTS * 3
    const replies = await Promise.all(
      Array.from({ length: count }, (_, i) => requestMediaServer(s.base, `${s.base}/${i}`, {}, 5_000))
    )
    assert.equal(replies.length, count)
    assert.ok(replies.every((r) => r.ok))
    assert.equal(most, MEDIA_SERVER_MAX_CONCURRENT_REQUESTS)
  })

  it('a failed request frees its place in the queue', async () => {
    const s = await serve((req, res) => {
      if (req.url === '/stall') {
        res.writeHead(200)
        res.write('[')
        return
      }
      res.end('ok')
    })
    servers.push(s)
    const stalls = Array.from({ length: MEDIA_SERVER_MAX_CONCURRENT_REQUESTS }, () =>
      requestMediaServer(s.base, `${s.base}/stall`, {}, 200).catch((err: unknown) => err)
    )
    const after = await requestMediaServer(s.base, `${s.base}/fine`, {}, 2_000)
    assert.equal(after.text, 'ok')
    for (const err of await Promise.all(stalls)) assert.ok(err instanceof MediaServerTimeoutError)
  })
})
