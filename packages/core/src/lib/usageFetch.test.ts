/**
 * The metered fetch's contract.
 *
 * Two rules, and the first is the one worth a test file: metering must never
 * change what the caller sees. This fetch sits under every inference call a
 * metered provider makes, so a mistake in the tee does not produce a wrong
 * number on a dashboard — it produces a broken assistant, a truncated analysis
 * and a failed recommendation run, all at once and none of them mentioning
 * usage. The second rule (never fail the call) is covered by driving an upstream
 * that throws and asserting the throw is the caller's, unchanged.
 *
 * The ledger write itself is not asserted here: it goes through `query`, and
 * standing a database up to prove one INSERT would test pg rather than this.
 * What IS asserted is everything that decides WHAT would be written — the chunk
 * reader is pure and exported for exactly that reason.
 *
 * Running these prints a stack of "Failed to record inference call" warnings.
 * That is the point rather than a defect: with no DATABASE_URL every ledger
 * write fails, and every assertion below still passes — which is rule two,
 * demonstrated.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { createMeteredFetch, readOpenAiUsage, num, type ParsedUsage } from './usageFetch.js'

describe('readOpenAiUsage', () => {
  test('reads the wire format', () => {
    const into: ParsedUsage = {}
    readOpenAiUsage(
      {
        prompt_tokens: 1200,
        completion_tokens: 340,
        total_tokens: 1540,
        prompt_tokens_details: { cached_tokens: 900 },
        completion_tokens_details: { reasoning_tokens: 300 },
      },
      into
    )
    assert.deepEqual(into, {
      promptTokens: 1200,
      completionTokens: 340,
      totalTokens: 1540,
      cachedTokens: 900,
      reasoningTokens: 300,
    })
  })

  test('reads the camelCase form some SDKs hand back', () => {
    const into: ParsedUsage = {}
    readOpenAiUsage(
      {
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
        completionTokensDetails: { reasoningTokens: 5 },
      },
      into
    )
    assert.equal(into.promptTokens, 10)
    assert.equal(into.completionTokens, 20)
    assert.equal(into.reasoningTokens, 5)
  })

  test('a field nobody reported stays absent, not zero', () => {
    // The ledger distinguishes "no scratchpad" from "this provider does not say",
    // and a 0 written here would answer a question the response never answered.
    const into: ParsedUsage = {}
    readOpenAiUsage({ prompt_tokens: 5, completion_tokens: 5 }, into)
    assert.equal(into.reasoningTokens, undefined)
    assert.equal(into.cachedTokens, undefined)
    assert.equal(into.totalTokens, undefined)
  })

  test('junk does not overwrite something already read', () => {
    // Streaming calls this once per chunk. A later chunk with a null or a
    // stringified count must leave the real figure standing rather than erase it.
    const into: ParsedUsage = { promptTokens: 100 }
    readOpenAiUsage({ prompt_tokens: null, completion_tokens: '42' }, into)
    assert.equal(into.promptTokens, 100)
    assert.equal(into.completionTokens, undefined)
  })

  test('num rejects everything that is not a finite number', () => {
    assert.equal(num(7), 7)
    assert.equal(num(0), 0)
    assert.equal(num('7'), undefined)
    assert.equal(num(NaN), undefined)
    assert.equal(num(Infinity), undefined)
    assert.equal(num(null), undefined)
  })
})

describe('createMeteredFetch', () => {
  /** Swap the global fetch for the duration of one call. */
  async function withUpstream<T>(
    upstream: typeof fetch,
    run: (metered: typeof fetch) => Promise<T>
  ): Promise<T> {
    const real = globalThis.fetch
    globalThis.fetch = upstream
    try {
      return await run(
        createMeteredFetch({ provider: 'test', role: 'chat', readChunk: readTestChunk })
      )
    } finally {
      globalThis.fetch = real
    }
  }

  function readTestChunk(chunk: Record<string, unknown>, into: ParsedUsage): void {
    const usage = chunk.usage as Record<string, unknown> | undefined
    if (usage) readOpenAiUsage(usage, into)
  }

  const jsonBody = JSON.stringify({
    id: 'x',
    choices: [{ message: { content: 'hello' } }],
    usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
  })

  test('the caller gets the body back unchanged', async () => {
    const text = await withUpstream(
      async () =>
        new Response(jsonBody, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      async (metered) => {
        const res = await metered('https://example.test/v1/chat/completions', {
          method: 'POST',
          body: JSON.stringify({ model: 'test-model', stream: false }),
        })
        return res.text()
      }
    )
    assert.equal(text, jsonBody)
  })

  test('a stream still streams, chunk for chunk', async () => {
    // The tee is what makes this possible at all: the meter needs the whole body
    // to find the usage chunk at the end, and the caller needs the tokens as
    // they arrive. Reading the body to meter it would stall the UI until the
    // model finished.
    const chunks = [
      'data: {"choices":[{"delta":{"content":"a"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"b"}}]}\n\n',
      'data: {"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\n',
      'data: [DONE]\n\n',
    ]

    const received = await withUpstream(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              const encoder = new TextEncoder()
              for (const c of chunks) controller.enqueue(encoder.encode(c))
              controller.close()
            },
          }),
          { status: 200, headers: { 'content-type': 'text/event-stream' } }
        ),
      async (metered) => {
        const res = await metered('https://example.test/v1/chat/completions', {
          method: 'POST',
          body: JSON.stringify({ model: 'test-model', stream: true }),
        })
        const reader = res.body!.getReader()
        const decoder = new TextDecoder()
        const out: string[] = []
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          out.push(decoder.decode(value))
        }
        return out.join('')
      }
    )

    assert.equal(received, chunks.join(''))
  })

  test('body-encoding headers are dropped, everything else survives', async () => {
    // `response.body` is already decoded, so carrying the original
    // content-length and content-encoding over would advertise a length and an
    // encoding that no longer match the bytes.
    const res = await withUpstream(
      async () =>
        new Response(jsonBody, {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'content-length': '999',
            'content-encoding': 'gzip',
            'x-request-id': 'keep-me',
          },
        }),
      async (metered) =>
        metered('https://example.test/v1/chat/completions', {
          method: 'POST',
          body: JSON.stringify({ model: 'test-model' }),
        })
    )

    assert.equal(res.headers.get('content-encoding'), null)
    assert.equal(res.headers.get('content-length'), null)
    assert.equal(res.headers.get('content-type'), 'application/json')
    assert.equal(res.headers.get('x-request-id'), 'keep-me')
  })

  test('an error response is handed back untouched, status and all', async () => {
    // A rejected request costs nothing and its body belongs to the SDK's error
    // reporting, which is what turns a 404 into a readable diagnosis.
    const res = await withUpstream(
      async () => new Response('{"error":"nope"}', { status: 404 }),
      async (metered) =>
        metered('https://example.test/v1/chat/completions', {
          method: 'POST',
          body: JSON.stringify({ model: 'test-model' }),
        })
    )
    assert.equal(res.status, 404)
    assert.equal(await res.text(), '{"error":"nope"}')
  })

  test('a network failure reaches the caller as its own error', async () => {
    const boom = new Error('ECONNREFUSED')
    await assert.rejects(
      withUpstream(
        async () => {
          throw boom
        },
        async (metered) =>
          metered('https://example.test/v1/chat/completions', {
            method: 'POST',
            body: JSON.stringify({ model: 'test-model' }),
          })
      ),
      (err) => err === boom
    )
  })

  test('an unreadable request body does not stop the call', async () => {
    // The model id is read out of the request so a failed call can still be
    // attributed. A body that is not JSON (or not a string at all) costs the
    // attribution, never the request.
    const text = await withUpstream(
      async () => new Response(jsonBody, { status: 200 }),
      async (metered) => {
        const res = await metered('https://example.test/v1/chat/completions', {
          method: 'POST',
          body: 'not json at all',
        })
        return res.text()
      }
    )
    assert.equal(text, jsonBody)
  })
})
