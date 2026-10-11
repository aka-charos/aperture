import { test } from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_SMTP_CONFIG, type SmtpConfig } from './rules.js'
import {
  mergeSmtpSettings,
  publicSmtpConfig,
  smtpUpdateTypeError,
  storedPasswordFor,
  storedPasswordScope,
} from './settings.js'

const saved: SmtpConfig = {
  ...DEFAULT_SMTP_CONFIG,
  enabled: true,
  host: 'smtp.example.com',
  security: 'starttls',
  username: 'aperture@example.com',
  password: 'secret',
  fromAddress: 'aperture@example.com',
}

// ---------------------------------------------------------------- where the stored password may go

test('the stored password is sent only to the host it was saved for', () => {
  assert.equal(storedPasswordFor(saved, saved), 'secret')
  // DNS names are case-insensitive, and a pasted space is not a different host.
  assert.equal(storedPasswordFor(saved, { ...saved, host: ' SMTP.Example.com ' }), 'secret')
  assert.equal(storedPasswordFor(saved, { ...saved, host: 'attacker.example.net' }), '')
  assert.equal(storedPasswordFor(saved, { ...saved, host: '' }), '')
  // Nothing stored means nothing to hand over, whatever the target.
  assert.equal(storedPasswordFor({ ...saved, host: '' }, { ...saved, host: '' }), '')
  assert.equal(storedPasswordFor({ ...saved, password: '' }, saved), '')
})

test('the stored password never goes over a weaker transport than it was saved with', () => {
  // Clear text, and an unchecked certificate, both expose it on the wire.
  assert.equal(storedPasswordFor(saved, { ...saved, security: 'none' }), '')
  assert.equal(storedPasswordFor(saved, { ...saved, allowSelfSigned: true }), '')
  assert.equal(storedPasswordFor(saved, { ...saved, security: 'tls', allowSelfSigned: true }), '')
  // Between the two verified modes it follows — the commonest fix to try.
  assert.equal(storedPasswordFor(saved, { ...saved, security: 'tls' }), 'secret')
})

test('a password saved over a weaker transport may move to a stronger one', () => {
  const plain: SmtpConfig = { ...saved, security: 'none' }
  assert.equal(storedPasswordFor(plain, { ...plain, security: 'starttls' }), 'secret')
  assert.equal(storedPasswordFor(plain, { ...plain, security: 'starttls', allowSelfSigned: true }), 'secret')
  const unverified: SmtpConfig = { ...saved, allowSelfSigned: true }
  assert.equal(storedPasswordFor(unverified, { ...unverified, allowSelfSigned: false }), 'secret')
  assert.equal(storedPasswordFor(unverified, { ...unverified, security: 'none' }), '')
})

test('the scope the card receives says exactly what storedPasswordFor will allow', () => {
  assert.deepEqual(storedPasswordScope(saved), { host: 'smtp.example.com', transports: ['starttls', 'tls'] })
  assert.deepEqual(storedPasswordScope({ ...saved, security: 'none' })?.transports, [
    'starttls',
    'starttls-unverified',
    'tls',
    'tls-unverified',
    'none',
  ])
  assert.equal(storedPasswordScope({ ...saved, password: '' }), null)
  // Bracket notation and case are not part of the host.
  assert.equal(storedPasswordScope({ ...saved, host: 'SMTP.Example.com' })?.host, 'smtp.example.com')
})

// ---------------------------------------------------------------- what an update changes

test('saving without a password keeps the stored one, within its scope', () => {
  assert.equal(mergeSmtpSettings(saved, { fromName: 'Movies' }, 'save').password, 'secret')
  assert.equal(mergeSmtpSettings(saved, { host: 'other.example.com' }, 'save').password, '')
  assert.equal(mergeSmtpSettings(saved, { security: 'none' }, 'save').password, '')
  assert.equal(mergeSmtpSettings(saved, { security: 'tls', port: 465 }, 'save').password, 'secret')
})

test('saving an empty password clears it; testing with one means the stored one', () => {
  assert.equal(mergeSmtpSettings(saved, { password: '' }, 'save').password, '')
  assert.equal(mergeSmtpSettings(saved, { password: '' }, 'test').password, 'secret')
  // ...but still only within its scope.
  assert.equal(mergeSmtpSettings(saved, { password: '', host: 'attacker.example.net' }, 'test').password, '')
})

test('a typed password is used as typed, wherever it is going', () => {
  assert.equal(mergeSmtpSettings(saved, { password: ' new ' }, 'save').password, 'new')
  assert.equal(mergeSmtpSettings(saved, { password: 'new', host: 'other.example.com' }, 'test').password, 'new')
})

test('no username keeps no password, since nothing would ever send it', () => {
  assert.equal(mergeSmtpSettings(saved, { username: '' }, 'save').password, '')
  assert.equal(mergeSmtpSettings(saved, { username: '  ', password: 'typed' }, 'test').password, '')
})

test('absent fields keep their stored values, and an unknown mode is not applied', () => {
  const next = mergeSmtpSettings({ ...saved, ehloName: 'mail.example.com' }, {}, 'save')
  assert.deepEqual(next, { ...saved, ehloName: 'mail.example.com' })
  assert.equal(mergeSmtpSettings(saved, { security: 'ssl' }, 'save').security, 'starttls')
})

test('a wrongly typed field is refused, not coerced into a default', () => {
  assert.equal(smtpUpdateTypeError(undefined), null)
  assert.equal(smtpUpdateTypeError({}), null)
  assert.equal(smtpUpdateTypeError({ host: 'smtp.example.com', port: 587, enabled: true }), null)
  assert.notEqual(smtpUpdateTypeError({ port: '587' }), null)
  assert.notEqual(smtpUpdateTypeError({ port: 0 }), null)
  assert.notEqual(smtpUpdateTypeError({ port: 2.5 }), null)
  assert.notEqual(smtpUpdateTypeError({ enabled: 'true' }), null)
  assert.notEqual(smtpUpdateTypeError({ security: 'ssl' }), null)
  assert.notEqual(smtpUpdateTypeError({ sendTo: 42 }), null)
  assert.notEqual(smtpUpdateTypeError([]), null)
  assert.notEqual(smtpUpdateTypeError('host'), null)
})

test('the public config never carries the password', () => {
  const pub = publicSmtpConfig(saved)
  assert.equal(pub.hasPassword, true)
  assert.ok(!('password' in pub))
  assert.ok(!JSON.stringify(pub).includes('secret'))
})
