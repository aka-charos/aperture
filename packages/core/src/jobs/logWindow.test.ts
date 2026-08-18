import assert from 'node:assert/strict'
import { test } from 'node:test'

import { condenseLogs, LOG_HEAD_ENTRIES, type JobLogEntry } from './logWindow.js'

const entry = (message: string): JobLogEntry => ({
  timestamp: new Date('2026-08-18T15:25:00Z'),
  level: 'info',
  message,
})

test('a log within budget is untouched', () => {
  const logs = [entry('a'), entry('b')]
  assert.deepEqual(condenseLogs(logs, 100), logs)
})

test('the opening lines survive, which is the whole point', () => {
  // The shape that lost them: 200 titles, two entries each, tail-only cap.
  const logs = [entry('📚 13,574 title(s) pending'), ...Array.from({ length: 420 }, (_, i) => entry(`line ${i}`))]
  const out = condenseLogs(logs, 100)

  assert.equal(out.length, 100)
  assert.equal(out[0].message, '📚 13,574 title(s) pending')
  assert.equal(out[out.length - 1].message, 'line 419')
})

test('the gap is stated rather than silent', () => {
  const logs = Array.from({ length: 500 }, (_, i) => entry(`line ${i}`))
  const out = condenseLogs(logs, 100)
  const marker = out[LOG_HEAD_ENTRIES]

  assert.match(marker.message, /earlier entries not kept/)
  // head + marker + tail === limit, exactly.
  assert.equal(out.length, 100)
  // Nothing is double-counted or skipped: 500 = 30 head + 401 elided + 69 tail.
  assert.match(marker.message, /401/)
})

test('a tiny budget still produces a valid window', () => {
  const logs = Array.from({ length: 50 }, (_, i) => entry(`line ${i}`))
  for (const limit of [1, 2, 3, 5]) {
    const out = condenseLogs(logs, limit)
    assert.equal(out.length, limit, `limit ${limit}`)
  }
  assert.deepEqual(condenseLogs(logs, 0), [])
})
