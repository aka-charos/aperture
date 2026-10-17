import test from 'node:test'
import assert from 'node:assert/strict'
import { partitionHistorySyncUsers } from './historySyncUsers.js'

/**
 * The history syncs skip accounts the media server no longer lists, so a user
 * deleted on Emby but not yet marked by the user sync is not asked about (Emby
 * answers a 500). These pin that, and that an untrusted listing skips nobody.
 */

const alice = { id: 'a', provider_user_id: 'emby-a', username: 'alice' }
const bob = { id: 'b', provider_user_id: 'emby-b', username: 'bob' }
const gone = { id: 'k', provider_user_id: 'emby-k', username: 'korncopy' }
const before = [alice, bob, gone]

test('an account missing from the listing is skipped, the rest are synced', () => {
  const result = partitionHistorySyncUsers([alice, bob, gone], before, ['emby-a', 'emby-b'])
  assert.deepEqual(result.sync, [alice, bob])
  assert.deepEqual(result.skipped, [gone])
  assert.equal(result.refusal, null)
})

test('an empty listing is not believed: nobody is skipped', () => {
  const result = partitionHistorySyncUsers([alice, bob], before, [])
  assert.deepEqual(result.sync, [alice, bob])
  assert.deepEqual(result.skipped, [])
  assert.equal(result.refusal, 'emptyListing')
})

test('a listing sharing no account with Aperture is not believed either', () => {
  const result = partitionHistorySyncUsers([alice, bob], before, ['someone-else'])
  assert.deepEqual(result.skipped, [])
  assert.equal(result.refusal, 'noOverlap')
})

test('gone is judged against the accounts from BEFORE the import', () => {
  // A listing from a different server imports its own users first; judged
  // after that, those imports would supply the overlap and every existing
  // account would read as gone.
  const imported = { id: 'x', provider_user_id: 'other-x', username: 'x' }
  const result = partitionHistorySyncUsers([alice, bob, imported], before, ['other-x'])
  assert.equal(result.refusal, 'noOverlap')
  assert.deepEqual(result.skipped, [])
})

test('a new account the sync just imported is synced', () => {
  const fresh = { id: 'n', provider_user_id: 'emby-n', username: 'newbie' }
  const result = partitionHistorySyncUsers([alice, fresh], before, ['emby-a', 'emby-n'])
  assert.deepEqual(result.sync, [alice, fresh])
})
