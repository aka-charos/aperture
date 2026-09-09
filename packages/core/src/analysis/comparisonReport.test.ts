import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  renderComparisonReport,
  type ComparisonEntry,
  type ComparisonReport,
} from './comparisonReport.js'

const entry = (over: Partial<ComparisonEntry> = {}): ComparisonEntry => ({
  provider: 'lmstudio',
  model: 'ornith-1.5-9b',
  status: 'ok',
  analysis: 'The film is built around a black-and-white image.',
  grade: 'substantial',
  problem: null,
  finishReason: 'stop',
  inputTokens: 18000,
  outputTokens: 600,
  reasoningTokens: 0,
  durationMs: 42_000,
  error: null,
  sections: [['work']],
  ...over,
})

const report = (over: Partial<ComparisonReport> = {}): ComparisonReport => ({
  title: 'The Girl With The Needle',
  year: 2024,
  mediaType: 'movie',
  promptVersion: 7,
  sources: [{ title: 'Review', domain: 'sensesofcinema.com', chars: 8000 }],
  retrievedChars: 8000,
  prompt: 'THE PROMPT BODY',
  entries: [entry()],
  startedAt: '2026-09-09T10:00:00Z',
  finishedAt: '2026-09-09T10:05:00Z',
  ...over,
})

test('states the shared control before any answer', () => {
  const text = renderComparisonReport(report())
  const sourcesAt = text.indexOf('sensesofcinema.com')
  const answerAt = text.indexOf('The film is built around')
  assert.ok(sourcesAt > -1 && answerAt > -1)
  assert.ok(sourcesAt < answerAt, 'sources must be stated above the answers')
  assert.match(text, /Prompt version: 7/)
  assert.match(text, /answered the SAME prompt/)
})

/**
 * The whole point of a bench is that a model which cannot produce an answer has
 * told you something. A report listing only the successes would present a
 * three-model comparison as a one-model one.
 */
test('prints failed and unusable entries rather than dropping them', () => {
  const text = renderComparisonReport(
    report({
      entries: [
        entry(),
        entry({
          model: 'broken-model',
          status: 'error',
          analysis: null,
          error: 'Connection refused',
        }),
        entry({
          model: 'runaway-model',
          status: 'unusable',
          analysis: null,
          problem: 'truncated',
          error: null,
        }),
      ],
    })
  )

  assert.match(text, /broken-model/)
  assert.match(text, /\[failed\] Connection refused/)
  assert.match(text, /runaway-model/)
  assert.match(text, /\[unusable\].*truncated/)
})

test('a model not yet reached says so instead of looking empty', () => {
  const text = renderComparisonReport({
    ...report(),
    entries: [entry({ status: 'pending', analysis: null, error: null, durationMs: null })],
  })
  assert.match(text, /\[not run\]/)
})

test('keeps the requested order and numbers the entries', () => {
  const text = renderComparisonReport(
    report({
      entries: [entry({ model: 'first' }), entry({ model: 'second' }), entry({ model: 'third' })],
    })
  )
  assert.ok(text.indexOf('[1] lmstudio / first') < text.indexOf('[2] lmstudio / second'))
  assert.ok(text.indexOf('[2] lmstudio / second') < text.indexOf('[3] lmstudio / third'))
})

/**
 * The prompt is long and identical on every run, so it must not sit between the
 * reader and the prose they opened the report to compare.
 */
test('the prompt goes last, below every answer', () => {
  const text = renderComparisonReport(report())
  assert.ok(text.indexOf('The film is built around') < text.indexOf('THE PROMPT BODY'))
  assert.ok(text.indexOf('THE PROMPT EVERY MODEL RECEIVED') < text.indexOf('THE PROMPT BODY'))
})

test('a run with no prompt yet omits the prompt section entirely', () => {
  const text = renderComparisonReport(report({ prompt: null }))
  assert.doesNotMatch(text, /THE PROMPT EVERY MODEL RECEIVED/)
})

/**
 * Zero reasoning tokens and a provider that reports none are different facts,
 * and neither is worth a column that reads "0 reasoning" on every row.
 */
test('reasoning tokens appear only when some were spent', () => {
  assert.doesNotMatch(renderComparisonReport(report()), /reasoning/)
  const spent = renderComparisonReport({
    ...report(),
    entries: [entry({ reasoningTokens: 10_010 })],
  })
  assert.match(spent, /10010 reasoning/)
})

test('reports the shape of the answer from the labels the model wrote', () => {
  const text = renderComparisonReport({
    ...report(),
    entries: [entry({ sections: [['work'], ['tradition', 'dispute'], []] })],
  })
  assert.match(text, /sections: 1\. work {3}2\. tradition\+dispute {3}3\. —/)
})

test('an unmapped analysis prints no sections line rather than an empty one', () => {
  const text = renderComparisonReport({ ...report(), entries: [entry({ sections: [] })] })
  assert.doesNotMatch(text, /sections:/)
})
