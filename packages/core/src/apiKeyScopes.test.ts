/**
 * What a key may do. Every way this goes wrong is quiet: a key keeps authority
 * it was narrowed out of, or a running integration loses one it still needs.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  API_KEY_SCOPES,
  DEFAULT_API_KEY_SCOPES,
  LEGACY_API_KEY_SCOPES,
  describeApiKeyScopes,
  isApiKeyScope,
  keyAllowsAdmin,
  keyAllowsWrite,
  normalizeApiKeyScopes,
} from './apiKeyScopes.js'

test('a new key is read-only and never admin', () => {
  assert.equal(keyAllowsWrite(DEFAULT_API_KEY_SCOPES), false)
  assert.equal(keyAllowsAdmin(DEFAULT_API_KEY_SCOPES), false)
})

test('a key from before scopes existed keeps everything it had', () => {
  // 0182 backfills this. Narrowing a running integration silently is worse
  // than leaving the authority visible and narrowable.
  assert.equal(keyAllowsWrite(LEGACY_API_KEY_SCOPES), true)
  assert.equal(keyAllowsAdmin(LEGACY_API_KEY_SCOPES), true)
  assert.deepEqual([...LEGACY_API_KEY_SCOPES], [...API_KEY_SCOPES])
})

test('read is always present and cannot be given up', () => {
  // An empty array must not read as "everything" by accident, and a key that
  // may do nothing is a revoked key.
  assert.deepEqual(normalizeApiKeyScopes([]), ['read'])
  assert.deepEqual(normalizeApiKeyScopes(['write']), ['read', 'write'])
})

test('an unrecognised scope is dropped, never forwarded', () => {
  // The column is a plain TEXT[]; nothing in Postgres constrains it.
  assert.deepEqual(normalizeApiKeyScopes(['write', 'root', 'ADMIN']), ['read', 'write'])
  assert.equal(isApiKeyScope('root'), false)
  assert.equal(isApiKeyScope('ADMIN'), false)
  assert.equal(isApiKeyScope('admin'), true)
})

test('a row with no scopes at all reads as the default, not as full authority', () => {
  // A pre-0182 row the migration somehow missed. The safe side of that mistake
  // is a key that stops working and gets reported.
  for (const missing of [null, undefined, 'admin', 42, {}]) {
    assert.deepEqual(normalizeApiKeyScopes(missing), ['read'], JSON.stringify(missing))
    assert.equal(keyAllowsAdmin(normalizeApiKeyScopes(missing)), false)
  }
})

test('normalizing is idempotent and order-stable', () => {
  // Two equal sets must compare equal, whatever order they were stored in.
  assert.deepEqual(normalizeApiKeyScopes(['admin', 'write']), ['read', 'write', 'admin'])
  assert.deepEqual(
    normalizeApiKeyScopes(normalizeApiKeyScopes(['admin', 'write'])),
    normalizeApiKeyScopes(['write', 'admin', 'write'])
  )
})

test('every scope in the vocabulary is decidable', () => {
  for (const scope of API_KEY_SCOPES) {
    assert.equal(isApiKeyScope(scope), true, scope)
    assert.ok(describeApiKeyScopes([scope]).includes(scope), scope)
  }
})
