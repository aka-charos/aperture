import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createJobProgressToken, verifyJobProgressToken } from './jobProgressToken.js'

process.env.SESSION_SECRET = 'test-secret-that-is-at-least-32-characters-long'

const JOB = '3f0c9a54-1111-4222-8333-444455556666'

test('a token opens the job it was made for', () => {
  assert.equal(verifyJobProgressToken(createJobProgressToken(JOB), JOB), true)
})

test('and no other job', () => {
  assert.equal(verifyJobProgressToken(createJobProgressToken(JOB), 'another-job'), false)
})

test('a missing or malformed token opens nothing', () => {
  for (const token of [undefined, '', 'nonsense', 'a.b.c', 'a.b.c.d.e']) {
    assert.equal(verifyJobProgressToken(token, JOB), false, String(token))
  }
})

test('an expired token opens nothing', () => {
  assert.equal(verifyJobProgressToken(createJobProgressToken(JOB, -1000), JOB), false)
})

test('extending the expiry without signing it opens nothing', () => {
  const [version, jobId, , signature] = createJobProgressToken(JOB, -1000).split('.')
  const forged = [version, jobId, String(Date.now() + 1_000_000), signature].join('.')
  assert.equal(verifyJobProgressToken(forged, JOB), false)
})

test('a tampered signature opens nothing, whatever its length', () => {
  const token = createJobProgressToken(JOB)
  assert.equal(verifyJobProgressToken(`${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`, JOB), false)
  assert.equal(verifyJobProgressToken(`${token}A`, JOB), false)
})

test('a token signed with another secret opens nothing', () => {
  const token = createJobProgressToken(JOB)
  const original = process.env.SESSION_SECRET
  process.env.SESSION_SECRET = 'a-different-secret-that-is-also-32-characters'
  try {
    assert.equal(verifyJobProgressToken(token, JOB), false)
  } finally {
    process.env.SESSION_SECRET = original
  }
})
