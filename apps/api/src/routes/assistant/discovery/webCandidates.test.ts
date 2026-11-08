/**
 * The free-text fallback for chat models without structured output: one
 * model-style `\'` must not throw away every web pick.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

process.env.DATABASE_URL ??= 'postgres://unused:unused@127.0.0.1/unused'

const { parseCandidatesJson } = await import('./webCandidates.js')

test("a JavaScript-style \\' in a reason keeps every candidate", () => {
  const text = String.raw`Here are my picks:
[{"title":"Heat","year":1995,"mediaType":"movie","reason":"Mann\'s best crime film"},
 {"title":"The Wire","year":2002,"mediaType":"series","reason":"Baltimore from every side"}]`

  assert.deepEqual(parseCandidatesJson(text), [
    { title: 'Heat', year: 1995, mediaType: 'movie', reason: "Mann's best crime film" },
    { title: 'The Wire', year: 2002, mediaType: 'series', reason: 'Baltimore from every side' },
  ])
})

test('an answer that is still not JSON yields no candidates rather than throwing', () => {
  assert.deepEqual(parseCandidatesJson(String.raw`[{"title":"Heat","reason":"Mann\'s"}, {]`), [])
  assert.deepEqual(parseCandidatesJson('no list here'), [])
})
