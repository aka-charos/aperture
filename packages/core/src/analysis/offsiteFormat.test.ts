import test from 'node:test'
import assert from 'node:assert/strict'

import {
  OFFSITE_FORMAT,
  buildExportFile,
  buildExportLine,
  exportFileName,
  importPrecheck,
  parseOffsiteResults,
} from './offsiteFormat.js'

const settings = {
  promptVersion: 18,
  promptVariant: null,
  maxOutputTokens: 8000,
}

test('an exported line carries everything a runner needs, and the format', () => {
  const line = JSON.parse(
    buildExportLine(
      { id: 'abc', mediaType: 'movie', title: 'Suspiria', year: 1977, attempt: 2, prompt: 'P' },
      settings
    )
  )
  assert.deepEqual(line, {
    custom_id: 'abc',
    attempt: 2,
    format: OFFSITE_FORMAT,
    media_type: 'movie',
    title: 'Suspiria',
    year: 1977,
    prompt_version: 18,
    prompt_variant: null,
    max_tokens: 8000,
    prompt: 'P',
  })
})

test('the file is one line per title, newline-terminated, and survives newlines in a prompt', () => {
  const file = buildExportFile(
    [
      { id: 'a', mediaType: 'movie', title: 'A', year: null, attempt: 0, prompt: 'line one\nline two' },
      { id: 'b', mediaType: 'series', title: 'B', year: 2001, attempt: 0, prompt: 'x' },
    ],
    settings
  )
  assert.ok(file.endsWith('\n'))
  const lines = file.trimEnd().split('\n')
  assert.equal(lines.length, 2)
  assert.equal(JSON.parse(lines[0]).prompt, 'line one\nline two')
})

test('results: answers and errors are read, blank and broken lines are reported, not fatal', () => {
  const file = [
    JSON.stringify({ custom_id: 'a', model: 'qwen', text: 'ANSWER', finish_reason: 'stop', usage: { completion_tokens: 12 } }),
    '',
    JSON.stringify({ custom_id: 'b', error: 'HTTP 500: boom' }),
    '{"custom_id": "c", "text": "half wri',
    JSON.stringify({ text: 'no id' }),
    JSON.stringify({ custom_id: 'd' }),
  ].join('\n')
  const parsed = parseOffsiteResults(file)
  assert.deepEqual(parsed.badLines, [4, 5, 6])
  assert.deepEqual(parsed.results, [
    { kind: 'answer', customId: 'a', attempt: 0, model: 'qwen', text: 'ANSWER', finishReason: 'stop', outputTokens: 12 },
    { kind: 'error', customId: 'b', attempt: 0, error: 'HTTP 500: boom' },
  ])
})

test('a rerun appends the answer after the error; the answer wins and keeps its place', () => {
  const file = [
    JSON.stringify({ custom_id: 'a', error: 'timeout' }),
    JSON.stringify({ custom_id: 'b', text: 'B' }),
    JSON.stringify({ custom_id: 'a', text: 'A' }),
  ].join('\r\n')
  const parsed = parseOffsiteResults(file)
  assert.deepEqual(
    parsed.results.map((r) => [r.customId, r.kind]),
    [
      ['a', 'answer'],
      ['b', 'answer'],
    ]
  )
})

test('an error never replaces an answer for the same id', () => {
  const file = [
    JSON.stringify({ custom_id: 'a', text: 'A' }),
    JSON.stringify({ custom_id: 'a', error: 'later failure' }),
  ].join('\n')
  const [only] = parseOffsiteResults(file).results
  assert.equal(only.kind, 'answer')
})

test('another runner\'s max_tokens is read as length, so a cut-off answer reports the ceiling', () => {
  const [r] = parseOffsiteResults(JSON.stringify({ custom_id: 'a', text: 'x', finish_reason: 'max_tokens' })).results
  assert.equal(r.kind === 'answer' && r.finishReason, 'length')
})

test('an empty text is still an answer — the contract check rejects it, not the parser', () => {
  const [r] = parseOffsiteResults(JSON.stringify({ custom_id: 'a', text: '' })).results
  assert.equal(r.kind, 'answer')
})

const base = {
  itemStatus: 'ready',
  batchPromptVersion: 18,
  staleBelow: 17,
  analysedAt: null,
  batchCreatedAt: new Date('2026-10-01T00:00:00Z'),
  resultKind: 'answer' as const,
  resultAttempt: 0,
  itemAttempt: 0,
}

test('precheck: a ready or rejected item with a fresh batch is read', () => {
  assert.deepEqual(importPrecheck(base), { action: 'read' })
  assert.deepEqual(importPrecheck({ ...base, itemStatus: 'rejected' }), { action: 'read' })
})

test('precheck: an already imported item is a duplicate, whatever the row says', () => {
  for (const itemStatus of ['stored', 'declined', 'skipped']) {
    assert.deepEqual(
      importPrecheck({ ...base, itemStatus, analysedAt: new Date('2026-10-02T00:00:00Z') }),
      { action: 'skip', outcome: 'duplicate' }
    )
  }
})

test('precheck: an item that never got a prompt was not exported', () => {
  for (const itemStatus of ['pending', 'retrieval_failed']) {
    assert.deepEqual(importPrecheck({ ...base, itemStatus }), { action: 'skip', outcome: 'notExported' })
  }
})

test('precheck: a batch below the staleness floor is refused, or the title would requeue at once', () => {
  assert.deepEqual(importPrecheck({ ...base, batchPromptVersion: 16 }), { action: 'skip', outcome: 'stale' })
  assert.deepEqual(importPrecheck({ ...base, batchPromptVersion: 17 }), { action: 'read' })
})

test('precheck: a row written after the batch wins; one written before it is what the batch replaces', () => {
  assert.deepEqual(
    importPrecheck({ ...base, analysedAt: new Date('2026-10-02T00:00:00Z') }),
    { action: 'skip', outcome: 'superseded' }
  )
  assert.deepEqual(importPrecheck({ ...base, analysedAt: new Date('2026-09-01T00:00:00Z') }), {
    action: 'read',
  })
})

test('precheck: a runner error is recorded, never read as an answer', () => {
  assert.deepEqual(importPrecheck({ ...base, resultKind: 'error' }), { action: 'skip', outcome: 'runnerError' })
})

test('the file name names the batch', () => {
  assert.equal(exportFileName('7f3c1a2b-0000-0000-0000-000000000000'), 'aperture-analysis-7f3c1a2b.jsonl')
})

test('results: the newest attempt for an id wins, in either order', () => {
  // The rerun's answer to attempt 1 must replace the rejected answer to
  // attempt 0, and a stale attempt-0 line read after it must not win back.
  const rerunLast = parseOffsiteResults(
    [
      JSON.stringify({ custom_id: 'a', attempt: 0, text: 'old' }),
      JSON.stringify({ custom_id: 'a', attempt: 1, error: 'boom' }),
    ].join('\n')
  ).results
  assert.deepEqual(rerunLast.map((r) => [r.kind, r.attempt]), [['error', 1]])

  const staleLast = parseOffsiteResults(
    [
      JSON.stringify({ custom_id: 'a', attempt: 1, text: 'new' }),
      JSON.stringify({ custom_id: 'a', attempt: 0, text: 'old' }),
    ].join('\n')
  ).results
  assert.equal(staleLast[0].kind === 'answer' && staleLast[0].text, 'new')
})

test('results: a line with no attempt is attempt 0', () => {
  const [r] = parseOffsiteResults(JSON.stringify({ custom_id: 'a', text: 'x', attempt: -3 })).results
  assert.equal(r.attempt, 0)
})

test('precheck: an answer to an attempt the import already rejected is not judged again', () => {
  assert.deepEqual(
    importPrecheck({ ...base, itemStatus: 'rejected', resultAttempt: 0, itemAttempt: 1 }),
    { action: 'skip', outcome: 'olderAttempt' }
  )
  assert.deepEqual(importPrecheck({ ...base, itemStatus: 'rejected', resultAttempt: 1, itemAttempt: 1 }), {
    action: 'read',
  })
})
