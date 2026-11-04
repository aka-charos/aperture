import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { TFunction } from 'i18next'
import { describeProvenance, type AnalysisProvenance } from './analysisProvenance'
import { formatDurationMs } from '../../lib/formatDuration'

const STRINGS: Record<string, string> = {
  'common.duration.ms': '{{ms}}ms',
  'common.duration.sec': '{{sec}}s',
  'common.duration.minSec': '{{min}}m {{sec}}s',
  'common.duration.hrMin': '{{hr}}h {{min}}m',
  'mediaDetail.analysis.admin.timeTaken': 'took {{total}} (writing {{writing}})',
  'mediaDetail.analysis.admin.writingTime': 'writing {{writing}}',
  'mediaDetail.analysis.admin.promptVersion': 'prompt v{{version}}',
}

const t = ((key: string, values: Record<string, unknown> = {}) =>
  (STRINGS[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name) =>
    String(values[name])
  )) as unknown as TFunction

const base: AnalysisProvenance = {
  model: null,
  retrievalMode: null,
  sourceCount: null,
  retrievedChars: null,
  promptVersion: 18,
}
const line = (timing: Partial<AnalysisProvenance>) =>
  describeProvenance({ provenance: { ...base, ...timing } }, t)

test('both phases show the total and the writing', () => {
  assert.equal(
    line({ retrievalMs: 62_000, writeMs: 130_000 }),
    'prompt v18 · took 3m 12s (writing 2m 10s)'
  )
})

test('with no fetching figure the time is named as writing, never as the total', () => {
  assert.equal(line({ retrievalMs: null, writeMs: 84_000 }), 'prompt v18 · writing 1m 24s')
})

test('an older row, sent or not, shows no time at all', () => {
  assert.equal(line({ retrievalMs: null, writeMs: null }), 'prompt v18')
  assert.equal(line({}), 'prompt v18')
  assert.equal(line({ retrievalMs: 5000, writeMs: null }), 'prompt v18')
})

test('zero is a measurement', () => {
  assert.equal(line({ retrievalMs: 0, writeMs: 0 }), 'prompt v18 · took 0ms (writing 0ms)')
})

test('no provenance means no line: the API sends it to admins only', () => {
  assert.equal(describeProvenance({}, t), null)
})

test('durations step up through their units', () => {
  assert.equal(formatDurationMs(999, t), '999ms')
  assert.equal(formatDurationMs(59_999, t), '59s')
  assert.equal(formatDurationMs(60_000, t), '1m 0s')
  assert.equal(formatDurationMs(3_660_000, t), '1h 1m')
})
