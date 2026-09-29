import test from 'node:test'
import assert from 'node:assert/strict'
import { formatRelativeTime } from './relativeTime'

const now = new Date('2026-09-29T12:00:00Z')

test('formatRelativeTime words a past moment', () => {
  assert.equal(formatRelativeTime(new Date('2026-09-26T12:00:00Z'), now, 'en'), '3 days ago')
  assert.equal(formatRelativeTime(new Date('2026-09-28T11:00:00Z'), now, 'en'), 'yesterday')
})

test('a timestamp ahead of the browser clock reads as now, never "in 2 minutes"', () => {
  // A share made seconds ago on a server whose clock runs slightly ahead.
  const ahead = new Date(now.getTime() + 2 * 60_000)
  assert.equal(formatRelativeTime(ahead, now, 'en'), formatRelativeTime(now, now, 'en'))
  assert.doesNotMatch(formatRelativeTime(ahead, now, 'en'), /^in /)
})
