/**
 * Pins who a request gets filed as.
 *
 * The failure this exists to prevent is silent in both directions: no match
 * means requests quietly revert to being filed by the admin, and a WRONG
 * match puts one person's name on another person's request — and, once
 * issues land, on their replies.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  matchApertureProfileToSeerrUser,
  normalizeMediaServerId,
  resolveSeerrUserMatch,
  type ApertureUserProfileForSeerr,
} from './userMapping.js'
import type { SeerrUser } from './types.js'

const GUID = '8f4c1d2e3a4b5c6d7e8f9a0b1c2d3e4f'

function seerrUser(overrides: Partial<SeerrUser> = {}): SeerrUser {
  return {
    id: 7,
    email: 'haris',
    username: '',
    plexToken: null,
    jellyfinUsername: 'haris',
    jellyfinUserId: GUID,
    permissions: 0,
    avatar: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  } as SeerrUser
}

function profile(overrides: Partial<ApertureUserProfileForSeerr> = {}): ApertureUserProfileForSeerr {
  return {
    email: null,
    username: 'haris',
    displayName: null,
    provider: 'emby',
    providerUserId: GUID,
    ...overrides,
  }
}

test('an Emby user matches on the media-server id, which Seerr files in its jellyfin column', () => {
  // The whole bug: this used to be guarded by `provider === 'jellyfin'`, so on
  // an Emby instance the one stable identifier both systems hold was skipped.
  const match = resolveSeerrUserMatch(profile(), [seerrUser()])

  assert.equal(match.userId, 7)
  assert.equal(match.matchedBy, 'mediaServerId')
})

test('a dashed id matches an undashed one, because Seerr stores raw and queries normalized', () => {
  const dashed = '8f4c1d2e-3a4b-5c6d-7e8f-9a0b1c2d3e4f'
  const match = resolveSeerrUserMatch(profile({ providerUserId: dashed }), [seerrUser()])

  assert.equal(match.userId, 7)
  assert.equal(match.matchedBy, 'mediaServerId')
})

test('the id wins over a name that points somewhere else', () => {
  // Someone renamed themselves on one side. The id is still the truth.
  const match = resolveSeerrUserMatch(profile({ username: 'someone-else' }), [seerrUser()])

  assert.equal(match.userId, 7)
  assert.equal(match.matchedBy, 'mediaServerId')
})

test('an email is only matched against another email, never against a username', () => {
  // Seerr fills `email` with the person's USERNAME for imported users, so an
  // address matching a bare name is a coincidence, not an identity.
  const match = resolveSeerrUserMatch(
    profile({ email: 'haris', providerUserId: 'not-a-guid', username: 'nobody' }),
    [seerrUser()]
  )

  assert.equal(match.userId, null)
})

test('real emails on both sides still match when there is no usable id', () => {
  const match = resolveSeerrUserMatch(
    profile({ email: 'haris@example.com', providerUserId: 'not-a-guid', username: 'nobody' }),
    [seerrUser({ email: 'Haris@Example.com ' })]
  )

  assert.equal(match.userId, 7)
  assert.equal(match.matchedBy, 'email')
})

test('an imported user with no username column still matches on jellyfinUsername', () => {
  const match = resolveSeerrUserMatch(
    profile({ providerUserId: 'not-a-guid' }),
    [seerrUser({ username: '', jellyfinUsername: 'Haris' })]
  )

  assert.equal(match.userId, 7)
  assert.equal(match.matchedBy, 'username')
})

test('two users matching one tier is refused, not resolved by coin flip', () => {
  const match = resolveSeerrUserMatch(profile({ providerUserId: 'not-a-guid' }), [
    seerrUser({ id: 7, jellyfinUserId: null }),
    seerrUser({ id: 9, jellyfinUserId: null }),
  ])

  assert.equal(match.userId, null)
  assert.equal(match.ambiguous, true)
  assert.equal(match.matchedBy, 'username')
})

test('an ambiguous tier stops the search rather than falling through to a weaker one', () => {
  // Both candidates share the username; only one also carries the display
  // name. Letting the weaker signal break the tie would cache a guess forever.
  const match = resolveSeerrUserMatch(
    profile({ providerUserId: 'not-a-guid', displayName: 'Haris M' }),
    [
      seerrUser({ id: 7, jellyfinUserId: null }),
      seerrUser({ id: 9, jellyfinUserId: null, jellyfinUsername: 'haris' }),
      seerrUser({ id: 11, jellyfinUserId: null, jellyfinUsername: 'Haris M' }),
    ]
  )

  assert.equal(match.userId, null)
  assert.equal(match.ambiguous, true)
})

test('a display name is the last resort, never the first', () => {
  const match = resolveSeerrUserMatch(
    profile({ providerUserId: 'not-a-guid', username: 'nobody', displayName: 'Haris' }),
    [seerrUser({ username: '', jellyfinUsername: 'Haris', jellyfinUserId: null })]
  )

  assert.equal(match.userId, 7)
  assert.equal(match.matchedBy, 'displayName')
})

test('nothing matching yields null rather than an arbitrary account', () => {
  const match = resolveSeerrUserMatch(
    profile({ providerUserId: 'not-a-guid', username: 'stranger' }),
    [seerrUser()]
  )

  assert.equal(match.userId, null)
  assert.equal(match.matchedBy, null)
  assert.equal(match.ambiguous, false)
})

test('a Jellyfin instance keeps working exactly as before', () => {
  const match = resolveSeerrUserMatch(profile({ provider: 'jellyfin' }), [seerrUser()])

  assert.equal(match.userId, 7)
  assert.equal(match.matchedBy, 'mediaServerId')
})

test('normalizeMediaServerId accepts only real media-server GUIDs', () => {
  assert.equal(normalizeMediaServerId('8F4C1D2E-3A4B-5C6D-7E8F-9A0B1C2D3E4F'), GUID)
  assert.equal(normalizeMediaServerId(GUID), GUID)
  assert.equal(normalizeMediaServerId('haris'), null)
  assert.equal(normalizeMediaServerId(''), null)
  assert.equal(normalizeMediaServerId(null), null)
  // Right shape, wrong length: not an id, so it must not be compared as one.
  assert.equal(normalizeMediaServerId('8f4c1d2e'), null)
})

test('the thin reader returns just the id', () => {
  assert.equal(matchApertureProfileToSeerrUser(profile(), [seerrUser()]), 7)
})
