import { test } from 'node:test'
import assert from 'node:assert/strict'

import { appLink, emailLinkBase, isReachablePublicUrl, normalizePublicUrl, publicUrlProblem } from './links.js'

test('a public address is stored without trailing slashes', () => {
  assert.equal(normalizePublicUrl(' https://aperture.example.com/ '), 'https://aperture.example.com')
  assert.equal(normalizePublicUrl('https://example.com/aperture//'), 'https://example.com/aperture')
})

test('a public address must be a plain http(s) address', () => {
  assert.equal(publicUrlProblem(''), null)
  assert.equal(publicUrlProblem('https://aperture.example.com'), null)
  assert.equal(publicUrlProblem('http://192.168.1.10:3456/aperture'), null)
  for (const bad of ['aperture.example.com', 'http://localhost:3456', 'http://127.0.0.1', 'ftp://example.com', 'https://user:pass@example.com', 'https://example.com/?a=1', 'https://example.com/#x']) {
    assert.notEqual(publicUrlProblem(bad), null, bad)
  }
})

test('a loopback address is never one a recipient can reach', () => {
  for (const local of ['http://localhost:3456', 'http://127.0.0.1:3456', 'http://[::1]:3456', 'http://0.0.0.0', 'http://aperture.localhost']) {
    assert.equal(isReachablePublicUrl(local), false, local)
  }
  assert.equal(isReachablePublicUrl('http://192.168.1.10:3456'), true)
  assert.equal(isReachablePublicUrl('https://aperture.example.com'), true)
  assert.equal(isReachablePublicUrl(''), false)
})

test('links use the setting, then APP_BASE_URL, then nothing — and never a loopback', () => {
  assert.equal(emailLinkBase('https://a.example.com/', 'https://b.example.com'), 'https://a.example.com')
  assert.equal(emailLinkBase('', 'https://b.example.com/'), 'https://b.example.com')
  // APP_BASE_URL's own default.
  assert.equal(emailLinkBase('', 'http://localhost:3456'), null)
  // An admin who typed localhost does not get it used, nor the env behind it.
  assert.equal(emailLinkBase('http://localhost:3456', 'https://b.example.com'), null)
  assert.equal(emailLinkBase('', null), null)
})

test('a path joins the base and keeps a sub-path the app is served under', () => {
  assert.equal(appLink('https://example.com/aperture', '/movies/1'), 'https://example.com/aperture/movies/1')
  assert.equal(appLink('https://example.com', '/'), 'https://example.com/')
  assert.equal(appLink(null, '/movies/1'), null)
})
