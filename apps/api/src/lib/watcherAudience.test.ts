import test from 'node:test'
import assert from 'node:assert/strict'
import { audienceLabel, resolveWatcherAudience } from './watcherAudience.js'

const viewer = { id: 'me', isAdmin: false }
const admin = { id: 'boss', isAdmin: true }

test('an admin sees everyone, whatever their connections', () => {
  assert.deepEqual(resolveWatcherAudience(admin, []), { kind: 'all' })
  assert.deepEqual(resolveWatcherAudience(admin, ['a', 'b']), { kind: 'all' })
})

test('no connections means nobody is named', () => {
  assert.deepEqual(resolveWatcherAudience(viewer, []), { kind: 'none' })
})

test('with connections, the viewer is named first, then the connections', () => {
  assert.deepEqual(resolveWatcherAudience(viewer, ['a', 'b']), {
    kind: 'users',
    userIds: ['me', 'a', 'b'],
  })
})

test('the decided label the client picks its copy from', () => {
  assert.equal(audienceLabel({ kind: 'all' }), 'all')
  assert.equal(audienceLabel({ kind: 'users', userIds: ['me'] }), 'connections')
  assert.equal(audienceLabel({ kind: 'none' }), undefined)
})
