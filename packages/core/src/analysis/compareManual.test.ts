import { test } from 'node:test'
import assert from 'node:assert/strict'

import { manualCustomId, readManualCustomId } from './compare.js'
import { buildExportLine, parseOffsiteResults } from './offsiteFormat.js'

const RUN = '7c9b1f2e-4d3a-4e5b-8c6d-0a1b2c3d4e5f'
const OTHER = '11111111-2222-3333-4444-555555555555'

/**
 * A LINE NAMES ITS RUN AS WELL AS ITS POSITION.
 *
 * The bench's manual lane stores an imported answer against a row by position.
 * A bare position would be a valid id in every run this build has ever made,
 * so a results file pasted into the wrong run would be matched silently and
 * one model's answers would be written over another run's rows. The id carries
 * both, and anything that is not this run's is reported back rather than
 * guessed at.
 */
test('a manual custom id round-trips, and only for its own run', () => {
  for (const position of [0, 1, 7, 42]) {
    const id = manualCustomId(RUN, position)
    assert.equal(readManualCustomId(RUN, id), position)
    assert.equal(readManualCustomId(OTHER, id), null, 'another run does not match')
  }
})

test('anything that is not this run position reads as null', () => {
  const cases = [
    '', // an empty custom_id
    '3', // a bare position, which a hand-written line is likeliest to carry
    RUN, // the run with no position
    `${RUN}:`, // a trailing colon and nothing after it
    `${RUN}:x`, // not a number
    `${RUN}:1.5`, // not a whole number
    `${RUN}:-1`, // negative
    `:3`, // no run
    `${OTHER}:3`, // somebody else's run
  ]
  for (const customId of cases) {
    assert.equal(readManualCustomId(RUN, customId), null, JSON.stringify(customId))
  }
})

/**
 * A uuid contains no colon, but the reader must not assume that: it splits on
 * the LAST colon, so an id is read correctly whatever the run id turns out to
 * hold.
 */
test('the position is read from the last colon', () => {
  const odd = 'run:with:colons'
  assert.equal(readManualCustomId(odd, `${odd}:12`), 12)
})

/**
 * THE FILE FORMAT IS OFFSITE'S, AND A HAND-MADE ANSWER IS A FIRST-CLASS INPUT.
 *
 * The whole point of the manual lane is that somebody pastes a prompt into an
 * interface this instance cannot call and types the answer back. That file is
 * written by a person, so the only fields it can be relied on to carry are the
 * id and the text - `model`, `finish_reason`, `usage` and `attempt` are what a
 * runner adds, and all four are optional.
 */
test('an exported prompt line carries the whole prompt under its own id', () => {
  const line = buildExportLine(
    {
      id: manualCustomId(RUN, 3),
      mediaType: 'movie',
      title: 'The Seed of the Sacred Fig',
      year: 2024,
      attempt: 0,
      prompt: 'SOURCE DOCUMENTS\n\n[1] A review - example.com\nThe corridors are red.',
    },
    { promptVersion: 18, promptVariant: null, maxOutputTokens: 4000 }
  )
  const row = JSON.parse(line) as Record<string, unknown>
  assert.equal(row.custom_id, manualCustomId(RUN, 3))
  assert.equal(row.prompt_version, 18)
  assert.equal(row.max_tokens, 4000)
  assert.ok(String(row.prompt).includes('The corridors are red.'))
})

test('two fields are enough to import an answer by hand', () => {
  const jsonl =
    JSON.stringify({ custom_id: manualCustomId(RUN, 0), text: '===ANALYSIS===\nFirst.' }) +
    '\n' +
    JSON.stringify({ custom_id: manualCustomId(RUN, 1), text: '===ANALYSIS===\nSecond.' }) +
    '\n'

  const parsed = parseOffsiteResults(jsonl)
  assert.equal(parsed.badLines.length, 0)
  assert.equal(parsed.results.length, 2)
  for (const result of parsed.results) {
    assert.equal(result.kind, 'answer')
    assert.equal(readManualCustomId(RUN, result.customId) != null, true)
  }
})

/**
 * What a person's file actually looks like: a stray blank line, a trailing
 * newline, and one answer pasted twice because they fixed a copy. The later
 * line wins, which is what somebody re-pasting a corrected answer means.
 */
test('a hand-stitched file survives its own untidiness', () => {
  const id = manualCustomId(RUN, 0)
  const jsonl = [
    '',
    JSON.stringify({ custom_id: id, text: 'first paste' }),
    '   ',
    JSON.stringify({ custom_id: id, text: 'corrected paste' }),
    '',
  ].join('\n')

  const parsed = parseOffsiteResults(jsonl)
  assert.equal(parsed.results.length, 1)
  assert.equal(parsed.results[0].kind, 'answer')
  assert.equal(parsed.results[0].kind === 'answer' && parsed.results[0].text, 'corrected paste')
  assert.deepEqual(parsed.badLines, [])
})
