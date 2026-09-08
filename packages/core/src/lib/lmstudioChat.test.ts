import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { streamLmStudioChat, LmStudioChatError } from './lmstudioChat.js'

/**
 * A fake LM Studio replaying the documented event stream, so the parser is
 * pinned against the real shapes rather than against itself. Every test here
 * covers a case that fails silently if it regresses: a lost answer, a reasoning
 * blob mistaken for the answer, or an error read as an empty response.
 */
async function serveEvents(
  frames: string[],
  opts: { status?: number; body?: string } = {}
): Promise<{ server: Server; url: string; seen: { path?: string; body?: string } }> {
  const seen: { path?: string; body?: string } = {}
  const server = createServer((req, res) => {
    seen.path = req.url
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c as Buffer))
    req.on('end', () => {
      seen.body = Buffer.concat(chunks).toString()
      if (opts.status && opts.status >= 400) {
        res.writeHead(opts.status, { 'Content-Type': 'application/json' })
        res.end(opts.body ?? '{"error":"nope"}')
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      for (const f of frames) res.write(f)
      res.end()
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const port = (server.address() as { port: number }).port
  return { server, url: `http://127.0.0.1:${port}/v1`, seen }
}

/** One SSE frame, in the wire form the docs show: `event:` then `data:`. */
const frame = (type: string, data: Record<string, unknown>) =>
  `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`

test('reads the answer and keeps reasoning separate from it', async () => {
  const { server, url } = await serveEvents([
    frame('chat.start', { model_instance_id: 'openai/gpt-oss-20b' }),
    frame('reasoning.start', {}),
    frame('reasoning.delta', { delta: 'The user wants ' }),
    frame('reasoning.delta', { delta: 'an analysis.' }),
    frame('reasoning.end', {}),
    frame('message.start', {}),
    frame('message.delta', { delta: 'Akbarzadeh uses ' }),
    frame('message.delta', { delta: 'a narrow ratio.' }),
    frame('message.end', {}),
    frame('chat.end', {
      result: {
        model_instance_id: 'openai/gpt-oss-20b',
        response_id: 'resp_1',
        output: [
          { type: 'reasoning', content: 'The user wants an analysis.' },
          { type: 'message', content: 'Akbarzadeh uses a narrow ratio.' },
        ],
        stats: {
          input_tokens: 17000,
          total_output_tokens: 268,
          reasoning_output_tokens: 5,
          tokens_per_second: 43.73,
          time_to_first_token_seconds: 0.781,
        },
      },
    }),
  ])
  try {
    const r = await streamLmStudioChat({ model: 'm', input: 'go', baseUrl: url })
    assert.equal(r.text, 'Akbarzadeh uses a narrow ratio.')
    // The whole point: the scratchpad must never be mistaken for the answer.
    assert.equal(r.reasoningText, 'The user wants an analysis.')
    assert.equal(r.modelInstanceId, 'openai/gpt-oss-20b')
    assert.equal(r.responseId, 'resp_1')
    assert.equal(r.stats?.reasoningOutputTokens, 5)
    assert.equal(r.stats?.tokensPerSecond, 43.73)
    assert.equal(r.stats?.timeToFirstTokenSeconds, 0.781)
    assert.equal(r.stats?.inputTokens, 17000)
  } finally {
    server.close()
  }
})

/**
 * The failure this endpoint was adopted to make visible: a reasoning model that
 * never finished thinking. On the OpenAI-compatible path this is an empty
 * `content` and is indistinguishable from a model that said nothing.
 */
test('an answer that never came is empty text plus the reasoning that explains it', async () => {
  const { server, url } = await serveEvents([
    frame('reasoning.delta', { delta: 'Still drafting' }),
    frame('chat.end', {
      result: {
        output: [{ type: 'reasoning', content: 'Still drafting' }],
        stats: { total_output_tokens: 3144, reasoning_output_tokens: 3144 },
      },
    }),
  ])
  try {
    const r = await streamLmStudioChat({ model: 'm', input: 'go', baseUrl: url })
    assert.equal(r.text, '')
    assert.equal(r.reasoningText, 'Still drafting')
    // Every output token went to thinking — the number that names the cause.
    assert.equal(r.stats?.reasoningOutputTokens, 3144)
  } finally {
    server.close()
  }
})

test('progress callbacks fire for a cold load and for prompt processing', async () => {
  const { server, url } = await serveEvents([
    frame('model_load.start', {}),
    frame('model_load.progress', { progress: 0.5 }),
    frame('model_load.end', {}),
    frame('prompt_processing.progress', { progress: 1 }),
    frame('message.delta', { delta: 'hi' }),
    frame('chat.end', { result: { output: [{ type: 'message', content: 'hi' }] } }),
  ])
  const load: number[] = []
  const prompt: number[] = []
  const message: string[] = []
  try {
    await streamLmStudioChat({
      model: 'm',
      input: 'go',
      baseUrl: url,
      progress: {
        onModelLoad: (p) => load.push(p),
        onPromptProgress: (p) => prompt.push(p),
        onMessageDelta: (d) => message.push(d),
      },
    })
    assert.deepEqual(load, [0.5])
    assert.deepEqual(prompt, [1])
    assert.deepEqual(message, ['hi'])
  } finally {
    server.close()
  }
})

/**
 * An error arriving INSIDE a 200 stream must throw. Returning empty text would
 * be read as "the model produced nothing usable" and retried three times
 * instead of failing over to the next model.
 */
test('an error event throws rather than resolving empty', async () => {
  const { server, url } = await serveEvents([
    frame('message.delta', { delta: 'partial' }),
    frame('error', { message: 'context overflow' }),
  ])
  try {
    await assert.rejects(
      streamLmStudioChat({ model: 'm', input: 'go', baseUrl: url }),
      (err: unknown) =>
        err instanceof LmStudioChatError && /context overflow/.test((err as Error).message)
    )
  } finally {
    server.close()
  }
})

test('a non-2xx status throws with the status and the body', async () => {
  const { server, url } = await serveEvents([], { status: 404, body: 'no such model' })
  try {
    await assert.rejects(
      streamLmStudioChat({ model: 'm', input: 'go', baseUrl: url }),
      (err: unknown) =>
        err instanceof LmStudioChatError &&
        err.status === 404 &&
        /no such model/.test((err as Error).message)
    )
  } finally {
    server.close()
  }
})

/**
 * A frame split across TCP reads must not be dropped. This is the parser bug
 * that shortens an answer at random and never reproduces on a fast localhost.
 */
test('an event split across chunks is still read', async () => {
  const whole = frame('chat.end', {
    result: { output: [{ type: 'message', content: 'complete answer' }] },
  })
  const cut = Math.floor(whole.length / 2)
  const { server, url } = await serveEvents([whole.slice(0, cut), whole.slice(cut)])
  try {
    const r = await streamLmStudioChat({ model: 'm', input: 'go', baseUrl: url })
    assert.equal(r.text, 'complete answer')
  } finally {
    server.close()
  }
})

test('context_length is sent only when asked for, and the base URL loses its /v1', async () => {
  const { server, url, seen } = await serveEvents([
    frame('chat.end', { result: { output: [{ type: 'message', content: 'ok' }] } }),
  ])
  try {
    await streamLmStudioChat({ model: 'm', input: 'go', baseUrl: url, contextLength: 32768 })
    // /v1 is the OpenAI-compatible prefix; the native API lives beside it.
    assert.match(seen.path ?? '', /^\/api\/v1\/chat/)
    const body = JSON.parse(seen.body ?? '{}')
    assert.equal(body.context_length, 32768)
    assert.equal(body.stream, true)
    assert.equal(body.input, 'go')
  } finally {
    server.close()
  }

  const second = await serveEvents([
    frame('chat.end', { result: { output: [{ type: 'message', content: 'ok' }] } }),
  ])
  try {
    await streamLmStudioChat({ model: 'm', input: 'go', baseUrl: second.url })
    const body = JSON.parse(second.seen.body ?? '{}')
    assert.ok(!('context_length' in body), 'unset context length must not be sent')
  } finally {
    second.server.close()
  }
})

/** An older server nests nothing and reports a plain message. */
test('the older chat.end shape is read too', async () => {
  const { server, url } = await serveEvents([
    frame('chat.end', {
      message: { role: 'assistant', content: 'older shape' },
      finish_reason: 'stop',
      usage: { input_tokens: 10, total_output_tokens: 20 },
    }),
  ])
  try {
    const r = await streamLmStudioChat({ model: 'm', input: 'go', baseUrl: url })
    assert.equal(r.text, 'older shape')
    assert.equal(r.finishReason, 'stop')
    assert.equal(r.stats?.totalOutputTokens, 20)
  } finally {
    server.close()
  }
})
