/**
 * What gets written down. The failures here are quiet in both directions: a
 * change nobody recorded cannot be asked about later, and a no-op recorded on
 * every sync buries the handful of rows that matter.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AUDITED_USER_PERMISSIONS,
  diffApiKeyScopes,
  diffUserPermissions,
  type UserPermissionSnapshot,
} from './permissionAudit.js'

const ALL_OFF: UserPermissionSnapshot = Object.fromEntries(
  AUDITED_USER_PERMISSIONS.map((field) => [field, false])
)

test('nothing changed means nothing recorded', () => {
  // The user sync runs on a schedule and rewrites the same values forever.
  assert.deepEqual(diffUserPermissions(ALL_OFF, ALL_OFF), [])
})

test('a grant and a revocation are both recorded, with both values', () => {
  const granted = diffUserPermissions(ALL_OFF, { ...ALL_OFF, discover_enabled: true })
  assert.deepEqual(granted, [
    { field: 'discover_enabled', oldValue: 'false', newValue: 'true' },
  ])

  const revoked = diffUserPermissions({ ...ALL_OFF, discover_enabled: true }, ALL_OFF)
  assert.deepEqual(revoked, [
    { field: 'discover_enabled', oldValue: 'true', newValue: 'false' },
  ])
})

test('a derived column is recorded even though nobody asked for it', () => {
  // This is the whole reason the row is diffed rather than the request: an
  // admin unticking Discover also clears request rights and can also disable
  // the account, and those are the changes nobody remembers making.
  const before = { ...ALL_OFF, discover_enabled: true, discover_request_enabled: true, is_enabled: true }
  const after = ALL_OFF

  const fields = diffUserPermissions(before, after).map((c) => c.field)
  assert.deepEqual(fields.sort(), ['discover_enabled', 'discover_request_enabled', 'is_enabled'])
})

test('a creation records grants and not the switches that stayed off', () => {
  // An account imported with everything off has granted nothing; eleven rows
  // saying so on every import is noise that hides the imports that did grant.
  assert.deepEqual(diffUserPermissions(null, ALL_OFF), [])

  assert.deepEqual(diffUserPermissions(null, { ...ALL_OFF, movies_enabled: true, is_enabled: true }), [
    { field: 'is_enabled', oldValue: null, newValue: 'true' },
    { field: 'movies_enabled', oldValue: null, newValue: 'true' },
  ])
})

test('an absent column reads as false, not as changed', () => {
  // Callers select the audited columns as a group, but a snapshot built from a
  // narrower RETURNING would otherwise report every missing column as revoked.
  assert.deepEqual(diffUserPermissions({}, {}), [])
  assert.deepEqual(diffUserPermissions({ discover_enabled: true }, {}), [
    { field: 'discover_enabled', oldValue: 'true', newValue: 'false' },
  ])
})

test('a null column is false, not a change', () => {
  // ai_explanation_override_allowed is nullable (0046).
  assert.deepEqual(
    diffUserPermissions({ ai_explanation_override_allowed: null }, { ai_explanation_override_allowed: false }),
    []
  )
})

test('changes come out in the declared order, whatever order the row is in', () => {
  const after = { ...ALL_OFF, collections_enabled: true, is_admin: true }
  const fields = diffUserPermissions(ALL_OFF, after).map((c) => c.field)
  assert.deepEqual(fields, ['is_admin', 'collections_enabled'])
})

test('scope lists compare by content, not by order', () => {
  assert.deepEqual(diffApiKeyScopes(['read', 'write'], ['write', 'read']), [])
  assert.deepEqual(diffApiKeyScopes(['read', 'write', 'admin'], ['read']), [
    { field: 'scopes', oldValue: 'admin,read,write', newValue: 'read' },
  ])
  assert.deepEqual(diffApiKeyScopes(null, ['read']), [
    { field: 'scopes', oldValue: null, newValue: 'read' },
  ])
})
