/**
 * Stopping a chat turn on purpose (helpers/activeTurns.ts `stopTurn`,
 * helpers/untilStopped.ts).
 *
 * The bug this pins: Stop only made the browser stop reading. The turn kept
 * running, its model calls were paid for, and its answer was saved and came
 * back on reload. Now an explicit stop aborts the turn's controller, which the
 * chat handler passes to its model calls, and the handler stops waiting.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerTurnStop, stopTurn } from './activeTurns.js'
import { STOPPED, untilStopped } from './untilStopped.js'

test("only the conversation's own user can stop its turn", () => {
  const controller = new AbortController()
  const release = registerTurnStop('conv-1', 'alice', controller)

  assert.equal(stopTurn('conv-1', 'mallory'), false)
  assert.equal(controller.signal.aborted, false)
  assert.equal(stopTurn('conv-2', 'alice'), false)

  assert.equal(stopTurn('conv-1', 'alice'), true)
  assert.equal(controller.signal.aborted, true)
  // Stopped once; a second press has nothing left to stop.
  assert.equal(stopTurn('conv-1', 'alice'), false)
  release()
})

test("a finished turn's release does not remove a newer turn's handle", () => {
  const older = new AbortController()
  const newer = new AbortController()
  const releaseOlder = registerTurnStop('conv-3', 'alice', older)
  const releaseNewer = registerTurnStop('conv-3', 'alice', newer)

  releaseOlder()
  assert.equal(stopTurn('conv-3', 'alice'), true)
  assert.equal(newer.signal.aborted, true)
  assert.equal(older.signal.aborted, false)
  releaseNewer()
})

test('a released turn cannot be stopped', () => {
  const controller = new AbortController()
  registerTurnStop('conv-4', 'alice', controller)()
  assert.equal(stopTurn('conv-4', 'alice'), false)
  assert.equal(controller.signal.aborted, false)
})

test('the wait ends on a stop, whatever the promise then does', async () => {
  const controller = new AbortController()
  let rejectLater: (error: Error) => void = () => {}
  const never = new Promise<string>((_, reject) => (rejectLater = reject))
  const waiting = untilStopped(never, controller.signal)
  controller.abort()
  assert.equal(await waiting, STOPPED)
  // Rejecting after the stop is not an unhandled rejection: it was observed.
  rejectLater(new Error('aborted'))
  await new Promise((resolve) => setImmediate(resolve))
})

test('without a stop the value and the error pass through', async () => {
  const controller = new AbortController()
  assert.equal(await untilStopped(Promise.resolve('steps'), controller.signal), 'steps')
  await assert.rejects(untilStopped(Promise.reject(new Error('model failed')), controller.signal), /model failed/)
})

test('a rejection caused by the stop reads as the stop, and an aborted signal answers at once', async () => {
  const controller = new AbortController()
  const rejectsOnAbort = new Promise<string>((_, reject) =>
    controller.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
  )
  const waiting = untilStopped(rejectsOnAbort, controller.signal)
  controller.abort()
  assert.equal(await waiting, STOPPED)
  assert.equal(await untilStopped(Promise.reject(new Error('late')), controller.signal), STOPPED)
})

test('the chat handler wires the stop into both model calls and waits through untilStopped', () => {
  const source = readFileSync(new URL('../handlers/chat.ts', import.meta.url), 'utf8')
  assert.equal(source.match(/abortSignal: stop\.signal/g)?.length, 2, 'both streamText calls take the signal')
  assert.match(source, /registerTurnStop\(conversationId, user\.id, stop\)/)
  assert.match(source, /await untilStopped\(result\.steps, stop\.signal\)/)
  assert.match(source, /await untilStopped\(forced\.steps, stop\.signal\)/)
  // Released on every way out: the error path and the end of the turn.
  assert.ok((source.match(/releaseStop\(\)/g)?.length ?? 0) >= 2)
  // The bare waits are gone, so nothing can hang on a stopped stream.
  assert.doesNotMatch(source, /await result\.steps\b/)
  assert.doesNotMatch(source, /await forced\.(text|steps)\b/)
})
