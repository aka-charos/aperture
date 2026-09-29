import test from 'node:test'
import assert from 'node:assert/strict'
import {
  countStatuses,
  defaultSharedTab,
  latestSharedAt,
  parseSharedTab,
  splitByType,
  STATUS_ORDER,
  type SentStatus,
} from './sharedView'

test('splitByType puts movies first, keeps each order, and drops an empty kind', () => {
  const items = [
    { id: 's1', mediaType: 'series' as const },
    { id: 'm1', mediaType: 'movie' as const },
    { id: 's2', mediaType: 'series' as const },
    { id: 'm2', mediaType: 'movie' as const },
  ]
  assert.deepEqual(
    splitByType(items).map((s) => [s.type, s.items.map((i) => i.id)]),
    [
      ['movie', ['m1', 'm2']],
      ['series', ['s1', 's2']],
    ]
  )
  assert.deepEqual(
    splitByType([{ id: 's1', mediaType: 'series' as const }]).map((s) => s.type),
    ['series'],
    'an all-series card has one section, not an empty Movies one'
  )
  assert.deepEqual(splitByType([]), [])
})

test('parseSharedTab accepts the two tabs and nothing else', () => {
  assert.equal(parseSharedTab('received'), 'received')
  assert.equal(parseSharedTab('sent'), 'sent')
  assert.equal(parseSharedTab(null), null)
  assert.equal(parseSharedTab('Sent'), null)
  assert.equal(parseSharedTab(''), null)
})

test('defaultSharedTab opens Sent only when Received is empty and Sent is not', () => {
  assert.equal(defaultSharedTab(0, 0), 'received', 'nothing anywhere: the received empty state')
  assert.equal(defaultSharedTab(2, 0), 'received')
  assert.equal(defaultSharedTab(2, 5), 'received', 'something waiting outranks the record')
  assert.equal(defaultSharedTab(0, 5), 'sent')
})

test('countStatuses reports every status, zero or not', () => {
  const items: Array<{ status: SentStatus }> = [
    { status: 'watched' },
    { status: 'waiting' },
    { status: 'watched' },
    { status: 'unavailable' },
  ]
  assert.deepEqual(countStatuses(items), { watched: 2, watching: 0, waiting: 1, unavailable: 1 })
  assert.deepEqual(countStatuses([]), { watched: 0, watching: 0, waiting: 0, unavailable: 0 })
})

test('STATUS_ORDER names every status exactly once', () => {
  assert.deepEqual([...STATUS_ORDER].sort(), ['unavailable', 'waiting', 'watched', 'watching'])
})

test('latestSharedAt is the newest timestamp, whatever the row order', () => {
  assert.equal(
    latestSharedAt([
      { recommendedAt: '2026-09-20T10:00:00.000Z' },
      { recommendedAt: '2026-09-28T09:00:00.000Z' },
      { recommendedAt: '2026-09-25T23:00:00.000Z' },
    ]),
    '2026-09-28T09:00:00.000Z'
  )
  assert.equal(latestSharedAt([]), null)
})
