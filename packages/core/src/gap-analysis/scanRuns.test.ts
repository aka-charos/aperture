import test from 'node:test'
import assert from 'node:assert/strict'

process.env.DATABASE_URL ??= 'postgres://unused:unused@127.0.0.1/unused'

const {
  INTERRUPTED_MESSAGE,
  MAX_UNANSWERED_BATCHES,
  MIN_UNREADABLE_ALLOWED,
  TMDB_PARTIAL_MESSAGE,
  TMDB_SILENT_MESSAGE,
  scanFailureReason,
  tmdbSilenceGuard,
  unreadableAllowed,
} = await import('./scanRuns.js')

test('silence stops a scan only after enough whole batches in a row', () => {
  const guard = tmdbSilenceGuard()
  for (let i = 0; i < MAX_UNANSWERED_BATCHES - 1; i++) guard.afterBatch(0)
  guard.afterBatch(1) // one answer starts the count again
  for (let i = 0; i < MAX_UNANSWERED_BATCHES - 1; i++) guard.afterBatch(0)
  assert.throws(() => guard.afterBatch(0), /TMDb stopped answering/)
})

test('a scan that never had an answer fails at the end, however few batches it took', () => {
  const guard = tmdbSilenceGuard()
  guard.afterBatch(0)
  assert.throws(() => guard.atEnd(), /TMDb stopped answering/)
})

test('one answer anywhere, or nothing to ask, is not silence', () => {
  const answered = tmdbSilenceGuard()
  answered.afterBatch(0)
  answered.afterBatch(1)
  assert.doesNotThrow(() => answered.atEnd())
  assert.doesNotThrow(() => tmdbSilenceGuard().atEnd(), 'an empty library asked TMDb nothing')
})

test('too little read is a partial answer only if TMDb answered at all', () => {
  const silent = tmdbSilenceGuard()
  silent.afterBatch(0)
  assert.equal(silent.tooLittleRead().message, TMDB_SILENT_MESSAGE)

  const partial = tmdbSilenceGuard()
  partial.afterBatch(1)
  assert.equal(partial.tooLittleRead().message, TMDB_PARTIAL_MESSAGE)
})

test('the allowance is a share of the library, with a floor for a small one', () => {
  assert.equal(unreadableAllowed(2), MIN_UNREADABLE_ALLOWED)
  assert.equal(unreadableAllowed(100), 10)
  assert.equal(unreadableAllowed(1234), 123)
})

test('only the messages the scans write have a reason the page can word', () => {
  assert.equal(scanFailureReason(INTERRUPTED_MESSAGE), 'interrupted')
  assert.equal(scanFailureReason(TMDB_SILENT_MESSAGE), 'tmdbSilent')
  assert.equal(scanFailureReason(TMDB_PARTIAL_MESSAGE), 'tmdbPartial')
  assert.equal(scanFailureReason('connection refused'), null)
  assert.equal(scanFailureReason(null), null)
})
