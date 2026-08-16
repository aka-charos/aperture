import test from 'node:test'
import assert from 'node:assert/strict'
import {
  describeExplanationBatch,
  explanationBatchSettings,
  parseExplanationResponse,
} from './explanationParsing.js'

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
  const { byIndex, mode, rejected } = parseExplanationResponse(
    JSON.stringify({
      explanations: [
        { index: 1, explanation: 'First.' },
        { index: 2, explanation: 'Second.' },
      ],
    })
  )

  assert.equal(mode, 'json')
  assert.equal(rejected, 0)
  assert.equal(byIndex.get(1), 'First.')
  assert.equal(byIndex.get(2), 'Second.')
})

test('a strictly parsed entry is never length-checked', () => {
  // The completeness guard belongs to salvage alone. Valid JSON returns exactly
  // what the model wrote, so a terse explanation there is its judgement, not a
  // reading error, and second-guessing it would drop good text.
  const { byIndex, mode } = parseExplanationResponse(
    '{"explanations":[{"index":1,"explanation":"Short"}]}'
  )
  assert.equal(mode, 'json')
  assert.equal(byIndex.get(1), 'Short')
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
// The second incident: unescaped quotes inside the prose
// ============================================================================

/**
 * The shape that shipped fragments to the page. The model writes film titles in
 * double quotes -- which is what the prompt does on every line -- and does not
 * escape them, so the document is not valid JSON and salvage has to read it.
 *
 * The first salvage matched a string body as `(?:[^"\\]|\\.)*`, which stops
 * dead at the quote before Parasite. Every explanation became the words leading
 * up to its first title, and because ten of ten entries "matched", the
 * short-batch warning never fired.
 */
const UNESCAPED_QUOTES = `{
  "explanations": [
    {
      "index": 1,
      "explanation": "If you were pulled into the moral murk of "Parasite", this one works the same nerve — a family bound together by something none of them will say out loud."
    },
    {
      "index": 2,
      "explanation": "Given how much you loved the quiet human connection of "Shoplifters", this is the closest thing in your library to spending another evening with those characters."
    }
  ]
}`

test('recovers the whole explanation when the model leaves a title unescaped', () => {
  const { byIndex, mode, rejected } = parseExplanationResponse(UNESCAPED_QUOTES)

  assert.equal(mode, 'salvaged')
  assert.equal(rejected, 0)
  assert.equal(byIndex.size, 2)

  const first = byIndex.get(1) ?? ''
  // The exact regression: this used to end at "the moral murk of".
  assert.match(first, /^If you were pulled into the moral murk of "Parasite", this one works/)
  assert.match(first, /will say out loud\.$/)

  const second = byIndex.get(2) ?? ''
  assert.match(second, /^Given how much you loved the quiet human connection of "Shoplifters"/)
  assert.match(second, /with those characters\.$/)
})

test('a quoted title followed by a comma does not end the value', () => {
  // The reason `"\s*[,}\]]` is not a sufficient test for a closing quote: in
  // prose, a quoted title is followed by a comma constantly. Only a comma that
  // introduces the next `"key":` ends the value.
  const raw =
    '{"explanations":[{"index":1,"explanation":"It has the same restraint as "Drive", "Collateral" and the other night-drive films you keep coming back to."}]}'
  const { byIndex, mode } = parseExplanationResponse(raw)

  assert.equal(mode, 'salvaged')
  assert.equal(
    byIndex.get(1),
    'It has the same restraint as "Drive", "Collateral" and the other night-drive films you keep coming back to.'
  )
})

test('the entry after an unescaped quote is still found', () => {
  // Recovery resumes past the value it just read, so quotes inside the prose
  // cannot be mistaken for the start of the next token.
  const raw =
    '{"explanations":[' +
    '{"index":1,"explanation":"The same slow dread that made "Hereditary" work is the engine here, and it never once raises its voice."},' +
    '{"index":2,"explanation":"A gentler pick, but it shares the same eye for small domestic detail that runs through your favourites."}]}'
  const { byIndex } = parseExplanationResponse(raw)

  assert.equal(byIndex.size, 2)
  assert.match(byIndex.get(2) ?? '', /^A gentler pick/)
})

// ============================================================================
// The first incident: a response cut off mid-string
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
      "explanation": "Given your love for epic WWII dramas, this feels like the natural next step after the ones you have already finished."
    },
    {
      "index": 2,
      "explanation": "It shares the same commitment to historical authenticity that kept you watching the others to the end."
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

test('a complete final entry survives a document cut off after it', () => {
  // Cut after the closing quote rather than inside the string: the value did
  // finish, so it should be kept even though the object never closes.
  const raw =
    '{"explanations":[{"index":1,"explanation":"A tight, unshowy thriller that trusts you to keep up with it, much like the ones you rated highest."}'
  const { byIndex } = parseExplanationResponse(raw)
  assert.match(byIndex.get(1) ?? '', /rated highest\.$/)
})

test('salvage decodes escapes rather than leaking them', () => {
  const raw =
    '{"explanations":[{"index":1,"explanation":"They call it \\"noir\\" — a mood rather than a genre.\\nThis one earns the label twice over."},{"index":2,"explanation":"cut off here'
  const { byIndex, mode } = parseExplanationResponse(raw)

  assert.equal(mode, 'salvaged')
  assert.equal(
    byIndex.get(1),
    'They call it "noir" — a mood rather than a genre.\nThis one earns the label twice over.'
  )
  assert.equal(byIndex.has(2), false)
})

test('handles the reversed key order', () => {
  const raw =
    '{"explanations":[{"explanation":"Backwards but complete, and long enough to read as a finished thought.","index":4},{"explanation":"and this one is cut'
  const { byIndex, mode } = parseExplanationResponse(raw)

  assert.equal(mode, 'salvaged')
  assert.match(byIndex.get(4) ?? '', /^Backwards but complete/)
  assert.equal(byIndex.size, 1)
})

// ============================================================================
// Fragments must lose to the template
// ============================================================================

test('a salvaged fragment is rejected rather than rendered', () => {
  // The case the reader genuinely cannot call: the response stops immediately
  // after a quoted title, so the last quote is both a plausible terminator (the
  // document simply ends) and plausibly the close of a title mid-sentence. It
  // reads the value, and the completeness check is the only thing standing
  // between that half-sentence and the page.
  //
  // Note it is 67 characters, comfortably past the length floor — the terminal
  // punctuation check is what has to catch this one, and the exact text is what
  // shipped.
  const raw =
    '{"explanations":[' +
    '{"index":1,"explanation":"A complete one, comfortably past the floor and ending as a sentence should."},' +
    '{"index":2,"explanation":"Given how much you loved the quiet human connection of "Shoplifters"'
  const { byIndex, rejected } = parseExplanationResponse(raw)

  assert.equal(byIndex.has(2), false)
  assert.equal(rejected, 1)
  // The good entry beside it is untouched — rejection is per entry.
  assert.match(byIndex.get(1) ?? '', /^A complete one/)
})

test('a one-word fragment is rejected', () => {
  // The worst of them rendered as the single word "If".
  const raw = '{"explanations":[{"index":1,"explanation":"If"},{"index":2,"explanation":"cut'
  const { byIndex, rejected, mode } = parseExplanationResponse(raw)

  assert.equal(byIndex.size, 0)
  assert.equal(rejected, 1)
  // Salvage still ran, and saying so is the point: a batch that recovered
  // nothing usable must not look the same as one that was never broken.
  assert.equal(mode, 'salvaged')
})

test('an explanation ending on a quoted title is not mistaken for a fragment', () => {
  const raw =
    '{"explanations":[{"index":1,"explanation":"Somewhere between the two halves of your watchlist sits "Stalker."" },{"index":2,"explanation":"cut'
  const { byIndex } = parseExplanationResponse(raw)
  assert.match(byIndex.get(1) ?? '', /"Stalker\."$/)
})

// ============================================================================
// Nothing usable
// ============================================================================

test('an empty or unreadable response yields nothing rather than throwing', () => {
  for (const raw of ['', '   ', null, undefined, 'I am unable to help with that.']) {
    const { byIndex, mode, rejected } = parseExplanationResponse(raw)
    assert.equal(byIndex.size, 0)
    assert.equal(rejected, 0)
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

// ============================================================================
// What gets logged
// ============================================================================

test('a clean batch says nothing', () => {
  assert.equal(
    describeExplanationBatch({ mode: 'json', parsed: 10, rejected: 0, expected: 10 }),
    null
  )
})

test('a full batch of salvaged entries still reports', () => {
  // The condition that let the incident through: ten recovered entries against
  // ten expected is not a short batch, and used to log nothing at all.
  const message = describeExplanationBatch({
    mode: 'salvaged',
    parsed: 10,
    rejected: 0,
    expected: 10,
  })
  assert.ok(message)
  assert.match(message, /not valid JSON/)
})

test('the token cap is reported ahead of the symptoms', () => {
  const message = describeExplanationBatch({
    mode: 'salvaged',
    parsed: 4,
    rejected: 2,
    expected: 10,
    finishReason: 'length',
  })
  assert.ok(message)
  assert.match(message, /token cap/)
})

test('discarded fragments are called out', () => {
  const message = describeExplanationBatch({
    mode: 'salvaged',
    parsed: 8,
    rejected: 2,
    expected: 10,
  })
  assert.ok(message)
  assert.match(message, /incomplete/)
})

test('an unreadable response is distinguished from a short one', () => {
  const unreadable = describeExplanationBatch({
    mode: 'none',
    parsed: 0,
    rejected: 0,
    expected: 10,
  })
  assert.ok(unreadable)
  assert.match(unreadable, /could not be read/)

  const short = describeExplanationBatch({ mode: 'json', parsed: 7, rejected: 0, expected: 10 })
  assert.ok(short)
  assert.match(short, /short/)
})
