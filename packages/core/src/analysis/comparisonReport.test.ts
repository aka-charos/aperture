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

test('every answer carries its habit counts, and the table lists every entry', () => {
  const text = renderComparisonReport(
    report({
      entries: [
        entry({ analysis: 'It is inherited rather than borrowed.' }),
        entry({ model: 'broken-model', status: 'error', analysis: null, error: 'Refused' }),
      ],
    })
  )
  assert.match(text, /SIGNALS/)
  assert.match(text, /"rather than" 1/)
  // A failed entry still gets its row, with a dash instead of numbers.
  assert.match(text, /\[2\] lmstudio \/ broken-model\s+—/)
  assert.ok(text.indexOf('SIGNALS') < text.indexOf('It is inherited'), 'table above the prose')
})

/**
 * A replay is two runs in one document. The baseline's answers must follow this
 * run's, the pair must sit on adjacent rows of the table, and a baseline model
 * this run did not repeat must still be printed.
 */
test('a replay prints the baseline after its own answers and pairs the table rows', () => {
  const text = renderComparisonReport(
    report({
      promptVersion: 9,
      entries: [entry({ model: 'deepseek', analysis: 'Version nine prose.' })],
      replayOf: {
        runId: 'run-8',
        promptVersion: 8,
        startedAt: '2026-09-10T10:00:00Z',
        entries: [
          entry({ model: 'dropped-model', analysis: 'Only in the old run.' }),
          entry({ model: 'deepseek', analysis: 'Version eight prose, rather than nine.' }),
        ],
      },
    })
  )

  assert.match(text, /PROMPT REPLAY/)
  assert.match(text, /Replaying run run-8 \(prompt version 8/)
  assert.match(text, /reused unchanged/)

  const table = text.slice(text.indexOf('SIGNALS'), text.indexOf('Version nine prose.'))
  const lines = table.split('\n')
  const v9 = lines.findIndex((line) => line.startsWith('v9 [1] lmstudio / deepseek'))
  assert.ok(v9 > -1, table)
  assert.ok(lines[v9 + 1].startsWith('v8 [b2] lmstudio / deepseek'), table)
  assert.ok(lines[v9 + 2].startsWith('v8 [b1] lmstudio / dropped-model'), table)

  assert.ok(text.indexOf('Version nine prose.') < text.indexOf('BASELINE — run run-8'))
  assert.ok(text.indexOf('BASELINE — run run-8') < text.indexOf('Version eight prose'))
  assert.ok(text.indexOf('Only in the old run.') < text.indexOf('THE PROMPT BODY'))
})

test('an ordinary run says nothing about replaying', () => {
  const text = renderComparisonReport(report())
  assert.match(text, /MODEL COMPARISON/)
  assert.doesNotMatch(text, /BASELINE|Replaying|reused unchanged/)
})

test('an unmapped analysis prints no sections line rather than an empty one', () => {
  const text = renderComparisonReport({ ...report(), entries: [entry({ sections: [] })] })
  assert.doesNotMatch(text, /sections:/)
})
