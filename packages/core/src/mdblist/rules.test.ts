import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MDBLIST_PENDING_SQL,
  MDBLIST_REFRESH_DAYS,
  MDBListRequestError,
  dedupeStreamingProviders,
  readBatchItems,
} from './rules.js'

test('a stamp is a freshness date: old stamps are due again', () => {
  assert.match(MDBLIST_PENDING_SQL, /mdblist_enriched_at IS NULL/)
  assert.match(MDBLIST_PENDING_SQL, new RegExp(`INTERVAL '${MDBLIST_REFRESH_DAYS} days'`))
  assert.ok(MDBLIST_REFRESH_DAYS > 0)
})

test('an array answer is read as items', () => {
  const items = readBatchItems<{ id: number }>([{ id: 1 }, { id: 2 }])
  assert.deepEqual(items, [{ id: 1 }, { id: 2 }])
})

test('an object keyed by id is read as its values', () => {
  const items = readBatchItems<{ id: number }>({ tt1: { id: 1 }, tt2: { id: 2 } })
  assert.deepEqual(items, [{ id: 1 }, { id: 2 }])
})

test('info pages are dropped', () => {
  const items = readBatchItems([{ id: 1 }, { website: 'x' }, { documentation: 'y' }, null])
  assert.deepEqual(items, [{ id: 1 }])
})

test('anything else is a failed request, never "no data"', () => {
  for (const bad of ['oops', 42, null, undefined, true]) {
    assert.throws(() => readBatchItems(bad), MDBListRequestError)
  }
})

test('a provider listed once per way of watching is shown once', () => {
  const providers = [
    { id: 2, name: 'Apple TV Store' },
    { id: 2, name: 'Apple TV Store' },
    { id: 3, name: 'Google Play Movies' },
    { id: 3, name: 'Google Play Movies' },
    { id: 1853, name: 'Paramount Plus Apple TV Channel ' },
  ]
  assert.deepEqual(dedupeStreamingProviders(providers), [
    { id: 2, name: 'Apple TV Store' },
    { id: 3, name: 'Google Play Movies' },
    { id: 1853, name: 'Paramount Plus Apple TV Channel' },
  ])
})

test('nameless entries are dropped', () => {
  assert.deepEqual(dedupeStreamingProviders([{ id: 9, name: '' }, { id: 10, name: 'Hulu' }]), [
    { id: 10, name: 'Hulu' },
  ])
})
