import { test } from 'node:test'
import assert from 'node:assert/strict'

import { directoryUsernameKey, lldapEmailState } from './rules.js'

test('usernames match ignoring case, and nothing else', () => {
  assert.equal(directoryUsernameKey('Alice'), directoryUsernameKey('alice'))
  assert.notEqual(directoryUsernameKey('alice '), directoryUsernameKey('alice'))
  assert.notEqual(directoryUsernameKey('José'), directoryUsernameKey('jose'))
})

test('an LLDAP email field is none, unusable or one usable address', () => {
  assert.deepEqual(lldapEmailState(''), { state: 'none' })
  assert.deepEqual(lldapEmailState('   '), { state: 'none' })
  assert.deepEqual(lldapEmailState(null), { state: 'none' })
  assert.deepEqual(lldapEmailState(undefined), { state: 'none' })
  assert.deepEqual(lldapEmailState(' bob@example.com '), { state: 'usable', email: 'bob@example.com' })
  assert.deepEqual(lldapEmailState('a@x.com, b@x.com'), { state: 'unusable', raw: 'a@x.com, b@x.com' })
  assert.deepEqual(lldapEmailState('not an address'), { state: 'unusable', raw: 'not an address' })
})
