import { test } from 'node:test'
import assert from 'node:assert/strict'
import { answersDuringRestore } from './restoreGate.js'

test('the restore can still be watched', () => {
  assert.equal(answersDuringRestore('/api/jobs/progress/abc'), true)
  assert.equal(answersDuringRestore('/api/jobs/progress/abc?x=1'), true)
})

test('files and the health check pass: they are not API routes', () => {
  for (const url of ['/', '/assets/index-abc.js', '/health', '/live', '/settings']) {
    assert.equal(answersDuringRestore(url), true, url)
  }
})

test('every other API route waits, signing in included', () => {
  for (const url of [
    '/api/auth/login',
    '/api/auth/check',
    '/api/movies?page=1',
    '/api/jobs/active',
    '/api/jobs/progressive',
    '/api/backup/restore',
    '/api/setup/status',
  ]) {
    assert.equal(answersDuringRestore(url), false, url)
  }
})
