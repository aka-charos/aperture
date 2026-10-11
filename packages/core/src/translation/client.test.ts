/**
 * The request path against a real HTTP server on localhost — no model, no
 * database. What these pin is the behaviour that only exists on the wire:
 * silence versus slowness (F-131), Stop reaching a request mid-stream, how a
 * stream that ends without a finish is reported, and the analysis fallback
 * never re-sending a request it has just made.
 */
import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

import {
  TranslationCancelledError,
  TranslationError,
  translateAnalysisText,
  translateText,
} from './client.js'
import { DEFAULT_TRANSLATION_CONFIG, type TranslationConfig } from './rules.js'

/**
 * Every server still open when a test ends — including one that timed out
 * with a request hung on it. Closing their sockets errors that request, so a
 * regression that hangs fails its test and lets the process exit, instead of
 * keeping the run alive on an endless stream.
 */
const openServers = new Set<Server>()
afterEach(() => {
  for (const server of openServers) {
    server.closeAllConnections()
    server.close()
  }
  openServers.clear()
})

/** What the fake model was asked: the user message of one request. */
type Handler = (input: string, res: ServerResponse) => void | Promise<void>

async function withServer(
  handler: Handler,
  run: (config: TranslationConfig, requests: string[]) => Promise<void>,
  overrides: Partial<TranslationConfig> = {}
): Promise<void> {
  const requests: string[] = []
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = ''
    req.on('data', (chunk) => (raw += chunk))
    req.on('end', () => {
      const body = JSON.parse(raw) as { messages: Array<{ content: string }> }
      const input = body.messages[body.messages.length - 1].content
      requests.push(input)
      void handler(input, res)
    })
  })
  openServers.add(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const config: TranslationConfig = {
    ...DEFAULT_TRANSLATION_CONFIG,
    // A chat model's prompt, so the user message IS the text being translated.
    promptStyle: 'instruction',
    baseUrl: `http://127.0.0.1:${port}`,
    model: 'fake',
    timeoutMs: 400,
    ...overrides,
  }
  try {
    await run(config, requests)
  } finally {
    openServers.delete(server)
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

const sse = (res: ServerResponse) => res.writeHead(200, { 'Content-Type': 'text/event-stream' })
const delta = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`
const finish = (reason = 'stop') =>
  `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: reason }] })}\n\ndata: [DONE]\n\n`
/** A "translation" that passes every check: longer than its source, never an echo. */
const translate = (text: string) =>
  text
    .split('\n\n')
    .map((p) => `ΜΕΤΑΦΡΑΣΗ ${p}`)
    .join('\n\n')
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
/**
 * Every test here talks to a socket, so a regression tends to HANG rather than
 * fail — a broken Stop waits on an endless stream until the 30-minute backstop.
 * A limit turns that into a failure with a name on it.
 */
const LIMIT = { timeout: 10_000 }

// ---------------------------------------------------------------- silence, not the clock

test('a stream that keeps arriving is never cut off, however long it takes in total', LIMIT, async () => {
  // Silence window 400ms; the answer takes ~1.2s overall but never goes quiet
  // for more than 150ms. A wall-clock cap of the same 400ms would kill it.
  await withServer(
    async (input, res) => {
      sse(res)
      for (const word of translate(input).split(' ')) {
        res.write(delta(`${word} `))
        await sleep(150)
      }
      res.end(finish())
    },
    async (config) => {
      const result = await translateText(config, 'A heist in Marseille goes wrong.', 'el')
      assert.match(result.text, /^ΜΕΤΑΦΡΑΣΗ A heist/)
      assert.ok(result.latencyMs > 800, `took ${result.latencyMs}ms`)
    }
  )
})

test('a stream that goes silent part-way is ended, and says so', LIMIT, async () => {
  await withServer(
    async (_input, res) => {
      sse(res)
      res.write(delta('Μια '))
      // ...and nothing more, ever.
    },
    async (config) => {
      await assert.rejects(translateText(config, 'A heist in Marseille goes wrong.', 'el'), (err) => {
        assert.ok(err instanceof TranslationError)
        assert.match(err.message, /stopped arriving: nothing for/)
        assert.equal(err.sizeRelated, true)
        return true
      })
    }
  )
})

test('Stop reaches a request that is already streaming', LIMIT, async () => {
  let stop = false
  await withServer(
    async (_input, res) => {
      sse(res)
      for (;;) {
        if (res.destroyed) return
        res.write(delta('λέξη '))
        await sleep(50)
      }
    },
    async (config) => {
      setTimeout(() => (stop = true), 300)
      const started = Date.now()
      await assert.rejects(
        translateText({ ...config, timeoutMs: 5000 }, 'A heist in Marseille goes wrong.', 'el', {
          shouldCancel: () => stop,
        }),
        (err) => err instanceof TranslationCancelledError
      )
      assert.ok(Date.now() - started < 3000, 'Stop took effect mid-stream, not at the end')
    }
  )
})

test('a stream that ends without a finish is refused with its own reason, not "cut off at the output limit"', LIMIT, async () => {
  await withServer(
    (input, res) => {
      sse(res)
      res.end(delta(translate(input)) + 'data: [DONE]\n\n')
    },
    async (config) => {
      await assert.rejects(translateText(config, 'A heist in Marseille goes wrong.', 'el'), (err) => {
        assert.ok(err instanceof TranslationError)
        assert.match(err.message, /ended before the model said it was finished/)
        assert.doesNotMatch(err.message, /output limit/)
        return true
      })
    }
  )
})

// ---------------------------------------------------------------- analysis fallback

const PARAGRAPHS = [
  'The film belongs to the Nordic chamber drama of the early nineties.',
  'Its most striking choice is to withhold the sea until the final minute.',
  'Production was halted twice, once by a storm and once by the money.',
  'Critics were divided on release, and a retrospective later settled it.',
]
const ANALYSIS = PARAGRAPHS.join('\n\n')

test('an analysis cut off in one request falls back to smaller requests instead of failing', LIMIT, async () => {
  await withServer(
    (input, res) => {
      sse(res)
      // The whole analysis (four paragraphs) is "too long"; anything smaller is fine.
      if (input.split('\n\n').length === PARAGRAPHS.length) {
        res.end(delta('ΜΕΤΑΦΡΑΣΗ The film belongs') + finish('length'))
        return
      }
      res.end(delta(translate(input)) + finish())
    },
    async (config, requests) => {
      const result = await translateAnalysisText(config, ANALYSIS, null, 'el')
      assert.equal(result.strategy, 'sections')
      assert.equal(result.paragraphs, PARAGRAPHS.length)
      assert.equal(result.text, translate(ANALYSIS))
      // One whole request, then the halves — never the whole again.
      assert.equal(requests.filter((r) => r === ANALYSIS).length, 1)
      assert.equal(requests.length, 3)
    }
  )
})

test('the fallback never re-sends the request that just failed (greedy decoding would fail it identically)', LIMIT, async () => {
  await withServer(
    (input, res) => {
      sse(res)
      // Merges any multi-paragraph input into one paragraph: a miscount every time.
      res.end(delta(translate(input).split('\n\n').join(' ')) + finish())
    },
    async (config, requests) => {
      const result = await translateAnalysisText(config, ANALYSIS, null, 'el')
      assert.equal(result.paragraphs, PARAGRAPHS.length)
      assert.equal(result.text, translate(ANALYSIS))
      // whole (1) → two halves (2, both miscount) → each paragraph (4).
      assert.equal(requests.filter((r) => r === ANALYSIS).length, 1)
      assert.equal(requests.length, 7)
      // Every request was distinct.
      assert.equal(new Set(requests).size, requests.length)
    }
  )
})

test('an analysis whose one request keeps its paragraphs is one request', LIMIT, async () => {
  await withServer(
    (input, res) => {
      sse(res)
      res.end(delta(translate(input)) + finish())
    },
    async (config, requests) => {
      const result = await translateAnalysisText(config, ANALYSIS, null, 'el')
      assert.equal(result.strategy, 'whole')
      assert.equal(requests.length, 1)
    }
  )
})

test('a failure that is not about size is not retried smaller', LIMIT, async () => {
  await withServer(
    (_input, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'Invalid API key' } }))
    },
    async (config, requests) => {
      await assert.rejects(translateAnalysisText(config, ANALYSIS, null, 'el'), /Invalid API key/)
      assert.equal(requests.length, 1)
    }
  )
})
