import { test } from 'node:test'
import assert from 'node:assert/strict'

import { accountsGoneFromMediaServer } from './providerPresence.js'

const acct = (name: string, providerUserId: string | null) => ({ name, providerUserId })

test('an account whose id the server no longer lists is gone; the rest are not', () => {
  const decision = accountsGoneFromMediaServer([acct('bob', 'm1'), acct('carol', 'm2'), acct('dan', 'm3')], ['m1', 'm3', 'm9'])
  assert.deepEqual(decision, { ok: true, gone: [acct('carol', 'm2')] })
})

test('an account never linked to a media-server id is gone', () => {
  const decision = accountsGoneFromMediaServer([acct('bob', 'm1'), acct('local', null)], ['m1'])
  assert.deepEqual(decision, { ok: true, gone: [acct('local', null)] })
})

test('an empty listing is refused, never read as everyone having left', () => {
  assert.deepEqual(accountsGoneFromMediaServer([acct('bob', 'm1')], []), { ok: false, reason: 'emptyListing' })
})

test('a listing sharing no account with Aperture is a different server and is refused', () => {
  assert.deepEqual(accountsGoneFromMediaServer([acct('bob', 'm1'), acct('carol', 'm2')], ['x1', 'x2']), {
    ok: false,
    reason: 'noOverlap',
  })
})

test('one account still listed is enough to trust the listing', () => {
  const decision = accountsGoneFromMediaServer([acct('bob', 'm1'), acct('carol', 'm2')], ['m1'])
  assert.deepEqual(decision, { ok: true, gone: [acct('carol', 'm2')] })
})

test('with no linked accounts at all there is nothing to overlap, and nothing linked is gone', () => {
  assert.deepEqual(accountsGoneFromMediaServer([], ['m1']), { ok: true, gone: [] })
})
