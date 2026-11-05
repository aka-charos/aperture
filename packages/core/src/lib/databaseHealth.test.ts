import { test } from 'node:test'
import assert from 'node:assert/strict'
import { poolHasSpareConnection, probeDatabase, type PoolLoad } from './databaseHealth.js'

const idle: PoolLoad = { totalCount: 3, idleCount: 1, waitingCount: 0, max: 20 }
const room: PoolLoad = { totalCount: 3, idleCount: 0, waitingCount: 0, max: 20 }
const full: PoolLoad = { totalCount: 20, idleCount: 0, waitingCount: 0, max: 20 }
const queued: PoolLoad = { totalCount: 3, idleCount: 0, waitingCount: 2, max: 20 }

test('the pool answers only when it has a connection to spare', () => {
  assert.equal(poolHasSpareConnection(idle), true)
  assert.equal(poolHasSpareConnection(room), true)
  assert.equal(poolHasSpareConnection(full), false)
  assert.equal(poolHasSpareConnection(queued), false, 'a queue means the new check would wait too')
})

test('a saturated pool is not a dead database', async () => {
  const neverPool = () => Promise.reject(new Error('timeout exceeded when trying to connect'))
  assert.equal(await probeDatabase(full, neverPool, () => Promise.resolve()), true)
  assert.equal(await probeDatabase(queued, neverPool, () => Promise.resolve()), true)
})

test('a database that cannot be reached still fails, on either path', async () => {
  const refused = () => Promise.reject(new Error('ECONNREFUSED'))
  const unused = () => Promise.resolve()
  assert.equal(await probeDatabase(full, unused, refused), false)
  assert.equal(await probeDatabase(idle, refused, unused), false)
})

test('an idle pool opens no extra connection', async () => {
  let opened = 0
  const open = () => {
    opened++
    return Promise.resolve()
  }
  assert.equal(await probeDatabase(idle, () => Promise.resolve(), open), true)
  assert.equal(opened, 0)
})
