/**
 * The short-text outcome rules.
 *
 * The regression these exist for: every playlist text surface checked only for an EMPTY answer.
 * A reasoning model that ran out of allowance mid-sentence handed back a half-written description
 * that was stored and reported as a success, with nothing on screen saying it was cut.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { SHORT_TEXT_MAX_OUTPUT_TOKENS, shortTextFailure } from './shortTextPolicy.js'

test('a finished answer is usable', () => {
  assert.equal(shortTextFailure({ text: 'Neon Noir Nights', finishReason: 'stop' }), null)
})

test('a cut-off answer is refused even though it has text', () => {
  const message = shortTextFailure({
    text: 'Dark, atmospheric thrillers where nothing is',
    finishReason: 'length',
  })
  assert.ok(message)
  assert.match(message, /partial answer was discarded/)
})

test('a limit reached before writing anything is named as the scratchpad problem', () => {
  const message = shortTextFailure({ text: '', finishReason: 'length' })
  assert.ok(message)
  assert.match(message, /spent the whole budget thinking/)
})

test('whitespace is empty', () => {
  assert.match(shortTextFailure({ text: '  \n ', finishReason: 'stop' }) ?? '', /empty response/)
})

test('a content filter is named as such', () => {
  assert.match(
    shortTextFailure({ text: '', finishReason: 'content-filter' }) ?? '',
    /content filter/
  )
})

test('an empty answer names its finish reason', () => {
  assert.match(shortTextFailure({ text: '', finishReason: 'other' }) ?? '', /finish reason: other/)
})

test('the ceiling leaves room for a reasoning scratchpad', () => {
  // The old budgets (600/1200/1500, 110 per note) were sized for the visible answer and a
  // reasoning model spent all of them thinking. Anything in that range is the old defect.
  assert.ok(SHORT_TEXT_MAX_OUTPUT_TOKENS >= 4000)
})
