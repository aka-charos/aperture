import assert from 'node:assert/strict'
import { test } from 'node:test'

import { pollOutcome } from './analysisPoll.js'

test('a running generation is waited on', () => {
  assert.deepEqual(pollOutcome({ generating: true, attempted: false }), { kind: 'wait' })
})

test('the flag is believed even when a finished row rides with it', () => {
  // The server reads `generating` BEFORE the row so a poll can never stop while
  // the row it describes is uncommitted; the cost is a response carrying both,
  // and one extra poll is the correct price.
  assert.deepEqual(pollOutcome({ generating: true, attempted: true }), { kind: 'wait' })
})

test('a finished analysis stops the poll', () => {
  assert.deepEqual(pollOutcome({ generating: false, attempted: true }), { kind: 'done' })
})

test('a stored decline is an answer, not a failure', () => {
  // `attempted` with no analysis means the model looked and found too little to
  // say. The panel has its own copy for that, and calling it a failure would
  // replace a real answer with an error.
  assert.deepEqual(pollOutcome({ attempted: true }), { kind: 'done' })
})

test("the server's own sentence survives to the caller", () => {
  assert.deepEqual(pollOutcome({ attempted: false, failure: 'Provider said no (HTTP 429)' }), {
    kind: 'failed',
    error: 'Provider said no (HTTP 429)',
  })
})

test('a recorded failure outranks a row left over from an earlier run', () => {
  // A forced re-run that fails leaves the previous analysis in place. The
  // reader asked for a new one and did not get it, so they are told.
  assert.deepEqual(pollOutcome({ attempted: true, failure: 'Could not reach the model' }), {
    kind: 'failed',
    error: 'Could not reach the model',
  })
})

test('finished with nothing at all is a failure, not a quiet return to the button', () => {
  // The API restarted mid-generation and lost both the work and its failure.
  // On the data alone this is identical to "nobody ever asked" - what makes it
  // a failure is that we were waiting, and swallowing it is the exact defect
  // the poll was built to end.
  assert.deepEqual(pollOutcome({ attempted: false }), { kind: 'failed' })
  assert.deepEqual(pollOutcome({}), { kind: 'failed' })
})

test('no error field means the caller supplies the wording', () => {
  const outcome = pollOutcome({ attempted: false })
  assert.equal(outcome.kind, 'failed')
  assert.equal(outcome.kind === 'failed' ? outcome.error : 'unset', undefined)
})
