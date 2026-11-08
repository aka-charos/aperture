import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  chatTestAbortMessage,
  chatToolTestFailure,
  CHAT_TEST_DEADLINE_MS,
  CHAT_TEST_STALL_MS,
  CHAT_TEST_TOOL,
  CHAT_TEST_PROMPT,
  CHAT_TEST_INPUT_SCHEMA,
  CHAT_TEST_MAX_OUTPUT_TOKENS,
} from './chatToolTest.js'

test('a valid call to the test tool passes, whatever else came with it', () => {
  assert.equal(chatToolTestFailure({ calls: [{ toolName: CHAT_TEST_TOOL }], finishReason: 'tool-calls' }), null)
  // An invalid first try and a valid second one: the model can do it.
  assert.equal(
    chatToolTestFailure({
      calls: [{ toolName: CHAT_TEST_TOOL, invalid: true }, { toolName: CHAT_TEST_TOOL, invalid: false }],
      finishReason: 'tool-calls',
    }),
    null
  )
})

test('each way of not calling it is told apart', () => {
  assert.match(
    chatToolTestFailure({ calls: [{ toolName: CHAT_TEST_TOOL, invalid: true }], finishReason: 'tool-calls' })!,
    /did not match its schema/
  )
  assert.match(
    chatToolTestFailure({ calls: [{ toolName: 'search', invalid: true }], finishReason: 'tool-calls' })!,
    /does not exist/
  )
  assert.match(chatToolTestFailure({ calls: [], finishReason: 'length' })!, /length limit/)
  assert.match(chatToolTestFailure({ calls: [], finishReason: 'stop' })!, /answered in text/)
})

test('the request names its tool, allows only "ok", and leaves a reasoning model room', () => {
  assert.ok(CHAT_TEST_PROMPT.includes(CHAT_TEST_TOOL))
  // Only the literal "ok" is a valid call; the SDK checks a call against this schema.
  assert.equal(CHAT_TEST_INPUT_SCHEMA.safeParse({ status: 'ok' }).success, true)
  assert.equal(CHAT_TEST_INPUT_SCHEMA.safeParse({ status: 'yes' }).success, false)
  assert.equal(CHAT_TEST_INPUT_SCHEMA.safeParse({}).success, false)
  assert.ok(CHAT_TEST_MAX_OUTPUT_TOKENS >= 1000)
})

// The real check, against a hand-written streaming model (no network).
process.env.DATABASE_URL ??= 'postgres://unused:unused@127.0.0.1/unused'
const { checkChatToolCall } = await import('./ai-provider.js')

type Part = Record<string, unknown>
function fakeModel(parts: Part[], fail?: Error) {
  return {
    specificationVersion: 'v2' as const,
    provider: 'fake',
    modelId: 'fake',
    supportedUrls: {},
    async doGenerate(): Promise<never> {
      throw new Error('not used')
    },
    async doStream() {
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] })
            for (const part of parts) controller.enqueue(part)
            if (fail) controller.enqueue({ type: 'error', error: fail })
            controller.close()
          },
        }),
      }
    },
  }
}
const finish = (finishReason: string): Part => ({
  type: 'finish',
  finishReason,
  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
})
const call = (input: string): Part => ({ type: 'tool-call', toolCallId: 'c1', toolName: CHAT_TEST_TOOL, input })
const text = (delta: string): Part[] => [
  { type: 'text-start', id: 't' },
  { type: 'text-delta', id: 't', delta },
  { type: 'text-end', id: 't' },
]

test('the check passes a streamed valid call and refuses prose, a wrong argument and a stream error', async () => {
  await checkChatToolCall(fakeModel([call('{"status":"ok"}'), finish('tool-calls')]) as never)
  await assert.rejects(checkChatToolCall(fakeModel([...text('ok'), finish('stop')]) as never), /answered in text/)
  await assert.rejects(
    checkChatToolCall(fakeModel([call('{"status":"yes"}'), finish('tool-calls')]) as never),
    /did not match its schema/
  )
  await assert.rejects(checkChatToolCall(fakeModel([], new Error('model not loaded')) as never), /model not loaded/)
})

/** A model that answers nothing, or keeps "thinking" forever, until aborted. */
function endlessModel(kind: 'silent' | 'thinking') {
  return {
    specificationVersion: 'v2' as const,
    provider: 'fake',
    modelId: 'fake',
    supportedUrls: {},
    async doGenerate(): Promise<never> {
      throw new Error('not used')
    },
    async doStream(options: { abortSignal?: AbortSignal }) {
      let timer: ReturnType<typeof setInterval> | undefined
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] })
            if (kind === 'silent') return
            controller.enqueue({ type: 'reasoning-start', id: 'r' })
            timer = setInterval(() => controller.enqueue({ type: 'reasoning-delta', id: 'r', delta: 'hmm ' }), 10)
            timer.unref()
            options.abortSignal?.addEventListener('abort', () => clearInterval(timer))
          },
          cancel() {
            clearInterval(timer)
          },
        }),
      }
    },
  }
}

test('a silent server and a model that never stops thinking both end with a verdict, not a hang', async (t) => {
  // The guard's timer is unref'd so it never keeps a process alive; a running
  // server holds the event loop open, so the test does the same.
  const keepAlive = setInterval(() => {}, 1000)
  t.after(() => clearInterval(keepAlive))
  await assert.rejects(
    checkChatToolCall(endlessModel('silent') as never, { stallMs: 60, deadlineMs: 5000 }),
    /sent nothing for 0 seconds/
  )
  // Thinking is activity, so only the deadline ends it.
  const started = Date.now()
  await assert.rejects(
    checkChatToolCall(endlessModel('thinking') as never, { stallMs: 60, deadlineMs: 250 }),
    /had not called the test tool after 0 seconds/
  )
  assert.ok(Date.now() - started < 3000, 'ended at the deadline')
})

test('the limits sit under a 100 s tunnel, and each abort reads as itself', () => {
  assert.ok(CHAT_TEST_DEADLINE_MS < 100_000)
  assert.ok(CHAT_TEST_STALL_MS < CHAT_TEST_DEADLINE_MS)
  assert.match(chatTestAbortMessage('stalled', 45_000), /sent nothing for 45 seconds/)
  assert.match(chatTestAbortMessage('deadline', 80_000), /after 80 seconds/)
})
