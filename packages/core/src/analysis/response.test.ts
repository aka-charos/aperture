import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  describeResponseProblem,
  findResponseProblem,
  stripReasoningBlocks,
} from './response.js'

// The shape that actually shipped: a reasoning model narrating the task as
// ordinary text, cut off mid-sentence with the budget spent. Kept verbatim in
// spirit because the failure was invisible to every length- and content-based
// check — it is long, fluent, and about the right film.
const LIVE_THINKING = `Here's a thinking process:

1.  **Analyze User Input:**
   - **Film:** Spring, Summer, Fall, Winter... And Spring (2003)
   - **Director:** Kim Ki-duk
2.  **Analyze Source Documents:**
   **[5] Yale University Library Film Notes:**
   - Kim: "In my other films, there has been a lot of brutality and cruelty and anger inside`

test('the live incident is rejected rather than stored', () => {
  // No SOURCES line and no reasoning tags to strip — the contract is the only
  // thing standing between this and the detail page.
  const problem = findResponseProblem({ text: LIVE_THINKING, grade: null })
  assert.deepEqual(problem, { kind: 'no_contract_line' })
})

test('truncation is reported even when the text looks like an answer', () => {
  const problem = findResponseProblem({
    text: 'A patient, formally symmetrical film whose seasons structure the cutting.',
    grade: 'substantial',
    finishReason: 'length',
  })
  assert.deepEqual(problem, { kind: 'truncated' })
})

test('a well-formed answer has no problem', () => {
  const problem = findResponseProblem({
    text: 'The floating temple is a built set on a real lake, and the camera stays outside it.',
    grade: 'reviews-only',
    finishReason: 'stop',
  })
  assert.equal(problem, null)
})

test('delimited reasoning is stripped, the answer survives', () => {
  const raw = '<think>Let me consider the sources one by one.</think>\nThe answer.'
  assert.equal(stripReasoningBlocks(raw), 'The answer.')
})

test('an unclosed reasoning tag means the budget went on the scratchpad', () => {
  const raw = '<think>Let me consider the sources one by'
  const text = stripReasoningBlocks(raw)
  assert.equal(text, '')
  assert.deepEqual(findResponseProblem({ text, grade: null }), { kind: 'reasoning_only' })
})

test('prose preambles are NOT guessed at — that was the salvage-regex mistake', () => {
  // Nothing is cut: there is no delimiter, so any boundary would be a guess.
  // The contract check rejects it instead of inventing an answer.
  assert.equal(stripReasoningBlocks(LIVE_THINKING), LIVE_THINKING.trim())
})

test('the operator-facing message names the model, because the model is the fix', () => {
  const message = describeResponseProblem(
    { kind: 'no_contract_line' },
    { title: 'Stalker', modelId: 'nvidia/nemotron-3.5-lightning:free' }
  )
  assert.match(message, /Stalker/)
  assert.match(message, /nemotron/)
  assert.match(message, /Title Analysis role/)
})
