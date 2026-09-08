import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ANALYSIS_BEGIN_MARKER, parseAnalysisResponse } from './prompt.js'
import {
  describeResponseProblem,
  describeResponseShape,
  findResponseProblem,
  stripReasoningBlocks,
} from './response.js'

/**
 * Read a raw completion exactly as generate.ts does, so these tests exercise
 * the real path rather than a paraphrase of it.
 */
function read(raw: string, finishReason?: string) {
  const parsed = parseAnalysisResponse(stripReasoningBlocks(raw))
  return {
    ...parsed,
    problem: findResponseProblem({
      text: parsed.text,
      grade: parsed.grade,
      hadBeginMarker: parsed.hadBeginMarker,
      finishReason,
    }),
  }
}

// The shape that actually shipped: a reasoning model narrating the task as
// ordinary content, cut off mid-sentence with the budget spent. Long, fluent,
// and about the right film - which is why every length- and content-based
// check waved it through.
const LIVE_THINKING = [
  "Here's a thinking process:",
  '',
  '1.  **Analyze User Input:**',
  '   - **Film:** Spring, Summer, Fall, Winter... And Spring (2003)',
  '   - **Director:** Kim Ki-duk',
  '2.  **Analyze Source Documents:**',
  '   **[5] Yale University Library Film Notes:**',
  '   - Kim: "In my other films, there has been a lot of brutality and anger inside',
].join('\n')

test('the live incident is rejected rather than stored', () => {
  const result = read(LIVE_THINKING)
  assert.deepEqual(result.problem, { kind: 'no_begin_marker' })
})

test('a preamble above the marker is discarded, the answer survives', () => {
  const raw = [
    LIVE_THINKING,
    ANALYSIS_BEGIN_MARKER,
    'The floating temple is a built set on a real lake, and the camera stays outside it.',
    'SOURCES: substantial',
  ].join('\n')

  const result = read(raw)
  assert.equal(result.problem, null)
  assert.equal(result.hadBeginMarker, true)
  assert.equal(result.grade, 'substantial')
  assert.match(result.text, /floating temple/)
  // The whole point: none of the scratchpad reaches the stored analysis.
  assert.doesNotMatch(result.text, /thinking process/)
  assert.doesNotMatch(result.text, /Kim Ki-duk/)
})

test('a model that echoes the instruction lands on the real marker', () => {
  const raw = [
    'First I will write ' + ANALYSIS_BEGIN_MARKER + ' and then the prose.',
    ANALYSIS_BEGIN_MARKER,
    'The seasons are the cutting pattern, not a metaphor laid over one.',
    'SOURCES: reviews-only',
  ].join('\n')

  const result = read(raw)
  assert.equal(result.problem, null)
  assert.doesNotMatch(result.text, /First I will write/)
})

test('truncation is reported even when the text reads like an answer', () => {
  const raw = [
    ANALYSIS_BEGIN_MARKER,
    'A patient, formally symmetrical film whose seasons structure the cutting.',
    'SOURCES: substantial',
  ].join('\n')

  assert.deepEqual(read(raw, 'length').problem, { kind: 'truncated' })
})

test('a marked answer with no closing line is rejected', () => {
  const raw = [ANALYSIS_BEGIN_MARKER, 'Prose with no grade beneath it.'].join('\n')
  assert.deepEqual(read(raw).problem, { kind: 'no_contract_line' })
})

test('delimited reasoning is stripped before anything else looks at it', () => {
  const raw = [
    '<think>Let me consider the sources one by one.</think>',
    ANALYSIS_BEGIN_MARKER,
    'The answer.',
    'SOURCES: almost-nothing',
  ].join('\n')

  const result = read(raw)
  assert.equal(result.problem, null)
  assert.equal(result.text, 'The answer.')
})

test('an unclosed reasoning tag means the budget went on the scratchpad', () => {
  const result = read('<think>Let me consider the sources one by')
  assert.deepEqual(result.problem, { kind: 'reasoning_only' })
})

test('prose preambles are NOT guessed at - that was the salvage-regex mistake', () => {
  // No delimiter, so any boundary would be invention. The marker check rejects
  // it instead of trying to find one.
  assert.equal(stripReasoningBlocks(LIVE_THINKING), LIVE_THINKING.trim())
})

test('the operator-facing message names the model, because the model is the fix', () => {
  const message = describeResponseProblem(
    { kind: 'no_begin_marker' },
    { title: 'Stalker', modelId: 'nvidia/nemotron-3.5-lightning:free' }
  )
  assert.match(message, /Stalker/)
  assert.match(message, /nemotron/)
  assert.match(message, /Title Analysis role/)
})

/**
 * A truncation is a fact about the SETTING, not about the model's ability to
 * follow a format, and the message has to say so.
 *
 * Measured live: an analysis was cut off at the 8,000-token default and the
 * message told the operator their model could not follow the output format —
 * so the one number that needed changing was never mentioned, and the log line
 * carrying `finishReason: "length"` did not carry the ceiling either. Fixing
 * it took reading a "Writing analysis" line thirteen minutes earlier.
 */
test('a truncation names the limit and tells you to raise it', () => {
  const message = describeResponseProblem(
    { kind: 'truncated' },
    {
      title: "A Gangster's Life",
      modelId: 'nvidia/nemotron-3.5-lightning:free',
      maxOutputTokens: 8000,
      outputTokens: 8000,
    }
  )
  assert.match(message, /8,000/)
  assert.match(message, /Raise it/)
  assert.match(message, /Max output tokens/)
  // The wrong advice, explicitly excluded: this is what sent an operator
  // looking for a better model when the fix was one field.
  assert.doesNotMatch(message, /cannot follow the prompt's output format/)
})

test('a truncation still reads sensibly with no counts to report', () => {
  // A provider that reports no usage must not produce "the limit is currently
  // undefined tokens"; absent stays absent, as everywhere else here.
  const message = describeResponseProblem(
    { kind: 'truncated' },
    { title: 'Stalker', modelId: 'local/model' }
  )
  assert.doesNotMatch(message, /undefined|NaN/)
  assert.match(message, /Raise it/)
})

test('the other problems keep the change-your-model advice', () => {
  // For these the format really is the fault, so the suffix is right and must
  // not have been lost when truncation stopped using it.
  for (const kind of ['reasoning_only', 'no_begin_marker', 'no_contract_line'] as const) {
    const message = describeResponseProblem({ kind }, { title: 'Stalker', modelId: 'local/model' })
    assert.match(message, /Title Analysis role/, `${kind} lost its advice`)
  }
})

// The live case this was written for. OpenRouter recorded status 200,
// finish_reason "stop", cancelled false -- a wholly successful generation --
// while Aperture rejected it three times and stored nothing. Both were right.
// The number that explained it was in the provider's dashboard and nowhere in
// ours: native_tokens_reasoning 10010, i.e. the answer went to the reasoning
// channel and the content channel came back empty.
test('a reasoning-channel answer is measurable, not just absent', () => {
  const shape = describeResponseShape({
    text: '',
    reasoningText: 'Let me work through the sources one at a time. Source [1] is the Wikipedia entry',
  })

  assert.equal(shape.textChars, 0)
  assert.ok(shape.reasoningChars > 0)
  assert.match(shape.reasoningHead ?? '', /work through the sources/)
  // And it is still a rejection - the shape explains it, it does not excuse it.
  assert.deepEqual(
    findResponseProblem({ text: '', grade: null, hadBeginMarker: false }),
    { kind: 'reasoning_only' }
  )
})

// "This model does not separate its thinking" and "it thought about nothing"
// are different facts, and only one is worth a log field.
test('no reasoning channel omits the field rather than reporting zero', () => {
  const shape = describeResponseShape({ text: 'Some prose.' })
  assert.equal(shape.reasoningChars, 0)
  assert.equal('reasoningHead' in shape, false)
})

// A head is for recognising what the model was doing, not for reading its
// output back - and never for finding a marker in it and splicing an answer
// together, which is the salvage-regex mistake this module records.
test('heads are clipped so a log line cannot carry the whole response', () => {
  const shape = describeResponseShape({
    text: 'x'.repeat(9000),
    reasoningText: 'y'.repeat(9000),
  })

  assert.equal(shape.textChars, 9000)
  assert.equal(shape.textHead.length, 240)
  assert.equal(shape.reasoningHead?.length, 240)
})
