import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isDatabaseRestoringAnswer } from './databaseRestoring'

test("the restore gate's answer is recognised", () => {
  assert.equal(isDatabaseRestoringAnswer(503, { error: 'x', code: 'DATABASE_RESTORING' }), true)
})

test('any other failure still means what it did', () => {
  assert.equal(isDatabaseRestoringAnswer(503, null), false)
  assert.equal(isDatabaseRestoringAnswer(503, { error: 'Bad gateway' }), false)
  assert.equal(isDatabaseRestoringAnswer(503, 'DATABASE_RESTORING'), false)
  assert.equal(isDatabaseRestoringAnswer(401, { code: 'DATABASE_RESTORING' }), false)
})
