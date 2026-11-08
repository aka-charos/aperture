import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  MEDIA_SERVER_MAX_CONCURRENT_REQUESTS,
  MediaServerIncompleteResponseError,
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

const timedOut = (stage: string, ms: number) => (err: unknown) =>
  err instanceof MediaServerTimeoutError && err.stage === stage && err.timeoutMs === ms

describe('requestMediaServer', { timeout: 15_000 }, () => {
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

  it('decodes text split across chunks, multi-byte characters included', async () => {
    const s = await serve((_req, res) => {
      res.writeHead(200)
      const bytes = Buffer.from('{"Name":"Αθήνα"}')
      // Split inside the two-byte "Α".
      res.write(bytes.subarray(0, 10))
      setTimeout(() => res.end(bytes.subarray(10)), 20)
    })
    servers.push(s)
    const reply = await requestMediaServer(s.base, `${s.base}/x`, {}, 2_000)
    assert.equal(reply.text, '{"Name":"Αθήνα"}')
  })

  it('times out a body that goes silent after the headers arrived', async () => {
    const s = await serve((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.write('{"Items":[')
      // Never ends: the old fetch stopped its clock at the headers and waited forever here.
    })
    servers.push(s)
    const started = Date.now()
    await assert.rejects(requestMediaServer(s.base, `${s.base}/Items`, {}, 300), timedOut('body', 300))
    assert.ok(Date.now() - started < 3_000)
  })

  it('lets a slow body finish while data keeps arriving, past the limit in total', async () => {
    const s = await serve((_req, res) => {
      res.writeHead(200)
      let sent = 0
      const tick = setInterval(() => {
        res.write('x')
        if (++sent === 8) {
          clearInterval(tick)
          res.end()
        }
      }, 100)
    })
    servers.push(s)
    // 800 ms in all, never more than 100 ms of silence, under a 300 ms limit.
    const reply = await requestMediaServer(s.base, `${s.base}/x`, {}, 300)
    assert.equal(reply.text, 'xxxxxxxx')
  })

  it('times out a server that never starts answering', async () => {
    const s = await serve(() => {
      // Accepts and says nothing.
    })
    servers.push(s)
    await assert.rejects(requestMediaServer(s.base, `${s.base}/x`, {}, 300), timedOut('headers', 300))
  })

  it('reports a body that breaks off as incomplete, not as a connection failure', async () => {
    const s = await serve((_req, res) => {
      res.writeHead(200, { 'Content-Length': '100' })
      res.write('{"Items":[')
      setTimeout(() => res.destroy(), 20)
    })
    servers.push(s)
    await assert.rejects(
      requestMediaServer(s.base, `${s.base}/x`, {}, 2_000),
      (err: unknown) => err instanceof MediaServerIncompleteResponseError && err.status === 200
    )
  })

  it('rethrows a refused connection as it came', async () => {
    const s = await serve((_req, res) => res.end())
    const base = s.base
    await s.close()
    await assert.rejects(
      requestMediaServer(base, `${base}/x`, {}, 2_000),
      (err: unknown) =>
        !(err instanceof MediaServerTimeoutError) && !(err instanceof MediaServerIncompleteResponseError)
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

  it('a request waiting for a slot gives up after the limit instead of waiting forever', async () => {
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
      requestMediaServer(s.base, `${s.base}/stall`, {}, 600).catch((err: unknown) => err)
    )
    const started = Date.now()
    await assert.rejects(requestMediaServer(s.base, `${s.base}/fine`, {}, 200), timedOut('queue', 200))
    assert.ok(Date.now() - started < 500)
    // The stalled requests free their places when they time out, and the queue works again.
    for (const err of await Promise.all(stalls)) assert.ok(timedOut('body', 600)(err))
    const later = await requestMediaServer(s.base, `${s.base}/fine`, {}, 2_000)
    assert.equal(later.text, 'ok')
  })
})
