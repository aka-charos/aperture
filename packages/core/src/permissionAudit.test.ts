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

  // And over a narrow one: an INSERT returning three columns claims nothing
  // about the eight it did not select.
  assert.deepEqual(diffUserPermissions(null, { is_admin: true }), [
    { field: 'is_admin', oldValue: null, newValue: 'true' },
  ])
})

test('a column missing from either side is not compared', () => {
  // Callers build snapshots from whatever their query returned, and the two
  // sides are routinely different widths. Reading an absent column as false
  // made that asymmetry fabricate changes in both directions.
  assert.deepEqual(diffUserPermissions({}, {}), [])
  assert.deepEqual(diffUserPermissions({ discover_enabled: true }, {}), [])
  assert.deepEqual(diffUserPermissions({}, { discover_enabled: true }), [])
})

test('a login does not record the permissions it never touched', () => {
  // Measured on the live shape: the login route knows the two columns it
  // writes, and the row it writes them to comes back with every permission on
  // it. Reading absent-as-false made an ordinary sign-in record SIX invented
  // grants, on every single sign-in.
  const before = { is_admin: false, provider_disabled: false }
  const wholeRow = {
    is_admin: false,
    is_enabled: true,
    provider_disabled: false,
    collections_enabled: true,
    discover_enabled: true,
    discover_request_enabled: true,
    can_manage_watch_history: true,
    email_notifications_allowed: true,
  }
  assert.deepEqual(diffUserPermissions(before, wholeRow), [])
})

test('a narrow RETURNING does not revoke what it failed to select', () => {
  // Measured on the live shape: the setup wizard reads the full row before its
  // write and returns five columns after it, which recorded `is_admin` as
  // revoked for every imported administrator whose switches it touched.
  const before = { ...ALL_OFF, is_admin: true }
  const narrow = { is_enabled: true, movies_enabled: true, series_enabled: false }

  assert.deepEqual(diffUserPermissions(before, narrow), [
    { field: 'is_enabled', oldValue: 'false', newValue: 'true' },
    { field: 'movies_enabled', oldValue: 'false', newValue: 'true' },
  ])
})

test('a selected column holding null is an opinion, and it means false', () => {
  // ai_explanation_override_allowed is nullable (0046), so `in` decides
  // presence rather than `!== undefined`.
  assert.deepEqual(
    diffUserPermissions(
      { ai_explanation_override_allowed: null },
      { ai_explanation_override_allowed: false }
    ),
    []
  )
  assert.deepEqual(
    diffUserPermissions(
      { ai_explanation_override_allowed: null },
      { ai_explanation_override_allowed: true }
    ),
    [{ field: 'ai_explanation_override_allowed', oldValue: 'false', newValue: 'true' }]
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
