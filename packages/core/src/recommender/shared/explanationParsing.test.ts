import test from 'node:test'
import assert from 'node:assert/strict'
import { explanationBatchSettings, parseExplanationResponse } from './explanationParsing.js'

// ============================================================================
// Batch settings
// ============================================================================

test('large-context providers get room for a model that reasons first', () => {
  for (const provider of ['openai', 'anthropic', 'google', 'deepseek', 'openrouter']) {
    const settings = explanationBatchSettings(provider)
    assert.equal(settings.batchSize, 10, `${provider} batch size`)

    // The measured failure: reasoning took up to 2,283 tokens of a 3,000-token
    // ceiling, leaving ~700 for ten explanations that need ~1,200. Anything
    // near the old number reproduces it.
    assert.ok(
      settings.maxTokens >= 8000,
      `${provider} needs headroom above the reasoning+prose sum, got ${settings.maxTokens}`
    )
  }
})

test('small-context providers are left alone', () => {
  // Their ceilings are bounded by the whole context window, not by the output
  // budget, so raising them would trade this bug for a worse one.
  assert.deepEqual(explanationBatchSettings('ollama'), { batchSize: 3, maxTokens: 1000 })
  assert.deepEqual(explanationBatchSettings('groq'), { batchSize: 5, maxTokens: 1500 })
  assert.deepEqual(explanationBatchSettings(null), { batchSize: 3, maxTokens: 1000 })
  assert.deepEqual(explanationBatchSettings(undefined), { batchSize: 3, maxTokens: 1000 })
})

// ============================================================================
// Reading a complete response
// ============================================================================

test('reads the documented object shape', () => {
  const { byIndex, mode } = parseExplanationResponse(
    JSON.stringify({
      explanations: [
        { index: 1, explanation: 'First.' },
        { index: 2, explanation: 'Second.' },
      ],
    })
  )

  assert.equal(mode, 'json')
  assert.equal(byIndex.get(1), 'First.')
  assert.equal(byIndex.get(2), 'Second.')
})

test('reads a bare array too', () => {
  const { byIndex, mode } = parseExplanationResponse('[{"index": 1, "explanation": "Only."}]')
  assert.equal(mode, 'json')
  assert.equal(byIndex.get(1), 'Only.')
})

test('strips a markdown fence and any preamble', () => {
  const raw = 'Sure, here you go:\n```json\n{"explanations":[{"index":1,"explanation":"Fenced."}]}\n```'
  const { byIndex, mode } = parseExplanationResponse(raw)
  assert.equal(mode, 'json')
  assert.equal(byIndex.get(1), 'Fenced.')
})

// ============================================================================
// The bug: a response cut off mid-string
// ============================================================================

/**
 * Shaped like the live failures, which reported "Unterminated string in JSON at
 * position 3068" — a well-formed prefix, then a final entry that stops mid-word
 * with no closing quote, brace or bracket.
 */
const TRUNCATED = `{
  "explanations": [
    {
      "index": 1,
      "explanation": "Given your love for epic WWII dramas, this feels like the perfect next step."
    },
    {
      "index": 2,
      "explanation": "It shares the same commitment to historical authenticity."
    },
    {
      "index": 3,
      "explanation": "You'll recognize the quiet dread that drew you to`

test('keeps the finished explanations when the response is cut off', () => {
  const { byIndex, mode } = parseExplanationResponse(TRUNCATED)

  assert.equal(mode, 'salvaged')
  // This is the whole point: two complete explanations survive where the old
  // JSON.parse discarded the entire batch and templated all ten.
  assert.equal(byIndex.size, 2)
  assert.match(byIndex.get(1) ?? '', /epic WWII dramas/)
  assert.match(byIndex.get(2) ?? '', /historical authenticity/)
})

test('never returns a half-written explanation', () => {
  const { byIndex } = parseExplanationResponse(TRUNCATED)
  // Index 3's string was never closed, so it must not appear at all — a
  // sentence ending mid-word is worse on the page than the template.
  assert.equal(byIndex.has(3), false)
})

test('salvages through an unterminated code fence', () => {
  const raw = '```json\n' + TRUNCATED
  const { byIndex, mode } = parseExplanationResponse(raw)
  assert.equal(mode, 'salvaged')
  assert.equal(byIndex.size, 2)
})

test('salvage decodes escapes rather than leaking them', () => {
  const raw = '{"explanations":[{"index":1,"explanation":"They call it \\"noir\\" — a mood.\\nNot a genre."},{"index":2,"explanation":"cut off here'
  const { byIndex, mode } = parseExplanationResponse(raw)

  assert.equal(mode, 'salvaged')
  assert.equal(byIndex.get(1), 'They call it "noir" — a mood.\nNot a genre.')
  assert.equal(byIndex.has(2), false)
})

test('a quote inside an explanation does not end the entry early', () => {
  // The escaped quote is what a regex-based reader gets wrong if it matches
  // lazily up to the next `"` instead of respecting the escape.
  const raw = '{"explanations":[{"index":1,"explanation":"Like \\"Heat\\", but colder."},{"index":2,"explanation":"truncated'
  const { byIndex } = parseExplanationResponse(raw)
  assert.equal(byIndex.get(1), 'Like "Heat", but colder.')
})

test('handles the reversed key order', () => {
  const raw = '{"explanations":[{"explanation":"Backwards but complete.","index":4},{"explanation":"and this one is cut'
  const { byIndex, mode } = parseExplanationResponse(raw)

  assert.equal(mode, 'salvaged')
  assert.equal(byIndex.get(4), 'Backwards but complete.')
  assert.equal(byIndex.size, 1)
})

// ============================================================================
// Nothing usable
// ============================================================================

test('an empty or unreadable response yields nothing rather than throwing', () => {
  for (const raw of ['', '   ', null, undefined, 'I am unable to help with that.']) {
    const { byIndex, mode } = parseExplanationResponse(raw)
    assert.equal(byIndex.size, 0)
    assert.equal(mode, 'none')
  }
})

test('valid JSON of the wrong shape yields nothing', () => {
  // Falls through to salvage, which finds no entries either — the caller then
  // templates the whole batch, which is the correct outcome here.
  const { byIndex, mode } = parseExplanationResponse('{"result": "ok"}')
  assert.equal(byIndex.size, 0)
  assert.equal(mode, 'none')
})

test('entries missing a usable field are dropped, not defaulted', () => {
  const raw = JSON.stringify({
    explanations: [
      { index: 1, explanation: 'Good.' },
      { index: 2, explanation: '   ' },
      { index: 'three', explanation: 'Bad index.' },
      { explanation: 'No index at all.' },
    ],
  })
  const { byIndex } = parseExplanationResponse(raw)

  assert.equal(byIndex.size, 1)
  assert.equal(byIndex.get(1), 'Good.')
})
