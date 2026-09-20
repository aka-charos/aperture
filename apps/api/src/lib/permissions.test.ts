/**
 * Who may use which feature. Both ways this goes wrong are quiet: a capability
 * granted too widely spends someone else's Seerr quota, and one granted too
 * narrowly hides a feature an admin believes they switched on.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CAPABILITIES,
  can,
  discoverRequestSql,
  refusalFor,
  type Capability,
  type PermissionSubject,
} from './permissions.js'

const NOBODY: PermissionSubject = {
  isAdmin: false,
  discoverEnabled: false,
  discoverRequestEnabled: false,
  collectionsEnabled: false,
  canManageWatchHistory: false,
  emailNotificationsAllowed: false,
}

const EVERYTHING: PermissionSubject = {
  isAdmin: false,
  discoverEnabled: true,
  discoverRequestEnabled: true,
  collectionsEnabled: true,
  canManageWatchHistory: true,
  emailNotificationsAllowed: true,
}

test('a user with no flags holds nothing', () => {
  for (const capability of CAPABILITIES) {
    assert.equal(can(NOBODY, capability), false, capability)
  }
})

test('a user with every flag holds everything', () => {
  for (const capability of CAPABILITIES) {
    assert.equal(can(EVERYTHING, capability), true, capability)
  }
})

test('content requests need Discover as well as the request flag', () => {
  // The rule lived only in the browser: the API wrote the two columns
  // independently and routes/seerr checked the request flag alone, so a user
  // with Discover off could still file requests through the HTTP API.
  assert.equal(
    can({ ...NOBODY, discoverRequestEnabled: true }, 'discover:request'),
    false,
    'request rights alone are not enough'
  )
  assert.equal(can({ ...NOBODY, discoverEnabled: true }, 'discover:request'), false)
  assert.equal(
    can({ ...NOBODY, discoverEnabled: true, discoverRequestEnabled: true }, 'discover:request'),
    true
  )
})

test('an admin bypasses exactly the two capabilities that always bypassed', () => {
  // Collections and watch-history management read `isAdmin` at their old call
  // sites; Discover never did, and an admin with Discover off has always been
  // refused. Granting it here would be a behaviour change disguised as a move.
  const admin = { ...NOBODY, isAdmin: true }
  const bypassed = CAPABILITIES.filter((capability) => can(admin, capability))
  assert.deepEqual(bypassed, ['collections', 'watchHistory:manage'])
})

test('every capability refuses with its own words', () => {
  // These strings are what the user reads; a generic "Forbidden" would be the
  // only user-visible regression this module could cause.
  const seen = new Set<string>()
  for (const capability of CAPABILITIES) {
    const { error } = refusalFor(capability)
    assert.ok(error.length > 0, capability)
    assert.ok(!seen.has(error), `duplicate refusal text for ${capability}`)
    seen.add(error)
  }
})

test('a refusal body cannot be mutated through the shared rule table', () => {
  const first = refusalFor('discover')
  first.error = 'tampered'
  assert.notEqual(refusalFor('discover').error, 'tampered')
})

test('a column written by the same UPDATE is read from its new value', () => {
  assert.equal(
    discoverRequestSql({ discover_enabled: '$2' }),
    '(discover_request_enabled AND $2)'
  )
  assert.equal(
    discoverRequestSql({ discover_request_enabled: '$1', discover_enabled: '$2' }),
    '($1 AND $2)'
  )
  assert.equal(discoverRequestSql(), '(discover_request_enabled AND discover_enabled)')
})

test('the SQL and the capability agree on every row', () => {
  // The write derives the column and the read re-checks the dependency. They
  // are two copies of one rule and must not drift.
  for (const discover of [false, true]) {
    for (const request of [false, true]) {
      const stored = evaluateAnd(discoverRequestSql(), {
        discover_enabled: discover,
        discover_request_enabled: request,
      })
      const granted = can(
        { ...NOBODY, discoverEnabled: discover, discoverRequestEnabled: request },
        'discover:request'
      )
      assert.equal(stored, granted, `discover=${discover} request=${request}`)
    }
  }
})

/** Evaluates discoverRequestSql's shape — one parenthesised AND of columns. */
function evaluateAnd(sql: string, row: Record<string, boolean>): boolean {
  return sql
    .slice(1, -1)
    .split(' AND ')
    .every((name) => {
      if (!(name in row)) throw new Error(`unknown column ${name}`)
      return row[name]
    })
}

test('every capability in the list has a rule', () => {
  // The list is what routes import from; a member with no rule would throw at
  // request time rather than at build time.
  for (const capability of CAPABILITIES as readonly Capability[]) {
    assert.doesNotThrow(() => can(NOBODY, capability), capability)
  }
})
