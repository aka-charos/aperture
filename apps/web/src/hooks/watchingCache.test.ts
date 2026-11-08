import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  WATCHING_CACHE_TTL_MS,
  WATCHING_CACHE_VERSION,
  readWatchingCache,
  serializeWatchingCache,
} from './watchingCache'

const NOW = 1_800_000_000_000
const LIST = [{ seriesId: 'a' }]

test('the owner gets their list back', () => {
  assert.deepEqual(readWatchingCache(serializeWatchingCache(LIST, 'ana', NOW), 'ana', NOW), LIST)
})

test('the next person at this browser does not', () => {
  assert.equal(readWatchingCache(serializeWatchingCache(LIST, 'ana', NOW), 'ben', NOW), null)
})

test('an entry from before owners were recorded belongs to nobody', () => {
  const old = JSON.stringify({ series: LIST, timestamp: NOW, version: WATCHING_CACHE_VERSION })
  assert.equal(readWatchingCache(old, 'ana', NOW), null)
})

test('no viewer known yet means no list', () => {
  assert.equal(readWatchingCache(serializeWatchingCache(LIST, 'ana', NOW), null, NOW), null)
})

test('an old entry, another version or a broken one is a miss', () => {
  const stored = serializeWatchingCache(LIST, 'ana', NOW)
  assert.equal(readWatchingCache(stored, 'ana', NOW + WATCHING_CACHE_TTL_MS + 1), null)
  assert.equal(readWatchingCache(JSON.stringify({ ...JSON.parse(stored), version: 1 }), 'ana', NOW), null)
  assert.equal(readWatchingCache('{not json', 'ana', NOW), null)
  assert.equal(readWatchingCache('null', 'ana', NOW), null)
  assert.equal(readWatchingCache(null, 'ana', NOW), null)
})
