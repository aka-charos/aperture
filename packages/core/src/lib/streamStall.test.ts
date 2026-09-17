/**
 * The guard that was missing when one title analysis call hung for 8h45m with
 * nothing able to end it. Every assertion here is one of the three ways that
 * happened, or one of the two ways a naive guard would break healthy work.
 *
 * Real timers at millisecond scale rather than fake ones: the thing under test
 * IS the interplay of an interval, a timestamp and an AbortController, and a
 * fake clock would pin the arithmetic while leaving the wiring untested.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { startStreamStallGuard } from './streamStall.js'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

test('a silent stream is aborted, and the reason says why', async () => {
  const seen: string[] = []
  const guard = startStreamStallGuard({
    stallMs: 40,
    checkMs: 5,
    onAbort: (reason) => seen.push(reason),
  })
  try {
    assert.equal(guard.reason(), null, 'alive before the stall window has passed')
    await sleep(120)
    assert.equal(guard.reason(), 'stalled')
    assert.equal(guard.signal.aborted, true)
    assert.deepEqual(seen, ['stalled'], 'reported exactly once')
  } finally {
    guard.stop()
  }
})

test('a slow but living stream is never aborted', async () => {
  // The failure a wall-clock cap produces: a legitimately slow answer killed
  // for taking longer than someone guessed. Chunks here arrive well inside the
  // stall window for several times that window's length.
  const guard = startStreamStallGuard({ stallMs: 40, checkMs: 5 })
  try {
    for (let i = 0; i < 10; i++) {
      await sleep(15)
      guard.activity()
    }
    assert.equal(guard.reason(), null)
    assert.equal(guard.signal.aborted, false)
  } finally {
    guard.stop()
  }
})

test('the absolute deadline still ends a stream that keeps dribbling', async () => {
  const guard = startStreamStallGuard({ stallMs: 10_000, deadlineMs: 50, checkMs: 5 })
  try {
    for (let i = 0; i < 8; i++) {
      await sleep(15)
      guard.activity()
    }
    assert.equal(guard.reason(), 'deadline')
  } finally {
    guard.stop()
  }
})

test('cancellation reaches a call that is already in flight', async () => {
  // The user-visible half of the original failure: Stop set a status that the
  // stuck title never read, because the job polls only between titles.
  let cancelled = false
  const guard = startStreamStallGuard({
    stallMs: 10_000,
    checkMs: 5,
    shouldCancel: () => cancelled,
  })
  try {
    await sleep(30)
    assert.equal(guard.reason(), null, 'not cancelled yet')
    cancelled = true
    await sleep(60)
    assert.equal(guard.reason(), 'cancelled')
    assert.equal(guard.signal.aborted, true)
  } finally {
    guard.stop()
  }
})

test('an async cancellation check is awaited, not read as truthy', async () => {
  // `isJobCancelled` is synchronous today, but the type allows a promise and a
  // promise object is always truthy -- so a guard that skipped the await would
  // abort every call on its first poll.
  const guard = startStreamStallGuard({
    stallMs: 10_000,
    checkMs: 5,
    shouldCancel: async () => false,
  })
  try {
    await sleep(60)
    assert.equal(guard.reason(), null)
  } finally {
    guard.stop()
  }
})

test('a cancellation check that throws leaves the call alone', async () => {
  const guard = startStreamStallGuard({
    stallMs: 10_000,
    checkMs: 5,
    shouldCancel: () => {
      throw new Error('database went away')
    },
  })
  try {
    await sleep(60)
    assert.equal(guard.reason(), null, 'a failed poll says nothing about the stream')
    assert.equal(guard.signal.aborted, false)
  } finally {
    guard.stop()
  }
})

test('stop() ends the watching, so a finished call cannot be aborted later', async () => {
  const guard = startStreamStallGuard({ stallMs: 20, checkMs: 5 })
  guard.stop()
  await sleep(60)
  assert.equal(guard.reason(), null)
  assert.equal(guard.signal.aborted, false)
})

test('the aborted promise is what wakes a caller whose await never settles', async () => {
  // Measured on ai@5.0.118: after an abort, `await stream.text` never settles
  // and onAbort never fires, so a caller awaiting the promise bundle is still
  // hung with a perfectly closed socket. This promise is the way out, so it
  // must resolve (never reject) and carry the reason.
  const guard = startStreamStallGuard({ stallMs: 20, checkMs: 5 })
  try {
    const neverSettles = new Promise<string>(() => {})
    const winner = await Promise.race([
      neverSettles.then(() => 'read'),
      guard.aborted.then((reason) => `aborted:${reason}`),
    ])
    assert.equal(winner, 'aborted:stalled')
  } finally {
    guard.stop()
  }
})

test('the aborted promise stays pending for a healthy call', async () => {
  const guard = startStreamStallGuard({ stallMs: 10_000, checkMs: 5 })
  try {
    const winner = await Promise.race([
      guard.aborted.then((reason) => `aborted:${reason}`),
      new Promise((resolve) => setTimeout(() => resolve('read'), 40)),
    ])
    assert.equal(winner, 'read')
  } finally {
    guard.stop()
  }
})

test('the abort carries a reason a log can read', async () => {
  const guard = startStreamStallGuard({ stallMs: 10, checkMs: 5 })
  try {
    await sleep(60)
    const reason = guard.signal.reason as Error
    assert.ok(reason instanceof Error)
    assert.match(reason.message, /silent/)
  } finally {
    guard.stop()
  }
})
