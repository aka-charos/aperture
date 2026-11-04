import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isMissingTimingColumn,
  phaseMs,
  readElapsedMs,
  totalAnalysisMs,
  withAnalysisTiming,
} from './timing.js'

test('a phase takes its pauses out and rounds to whole milliseconds', () => {
  assert.equal(phaseMs(100, 5100.4), 5000)
  assert.equal(phaseMs(0, 90_000, 60_000), 30_000)
})

test('a phase never reads as negative', () => {
  assert.equal(phaseMs(0, 100, 250), 0)
  assert.equal(phaseMs(500, 100), 0)
})

test('the total is both phases, or the writing when no fetching was timed', () => {
  assert.equal(totalAnalysisMs({ retrievalMs: 1000, writeMs: 2000 }), 3000)
  assert.equal(totalAnalysisMs({ retrievalMs: null, writeMs: 2000 }), 2000)
  assert.equal(totalAnalysisMs({ retrievalMs: 0, writeMs: 0 }), 0)
})

test('with no writing figure there is no total, even with a fetching figure', () => {
  assert.equal(totalAnalysisMs({ retrievalMs: null, writeMs: null }), null)
  assert.equal(totalAnalysisMs({ retrievalMs: 1000, writeMs: null }), null)
})

test('a runner figure is kept only when the column can hold it', () => {
  assert.equal(readElapsedMs(84210), 84210)
  assert.equal(readElapsedMs(84210.6), 84211)
  assert.equal(readElapsedMs(0), 0)
  for (const junk of [undefined, null, '84210', -1, NaN, Infinity, 2_147_483_648]) {
    assert.equal(readElapsedMs(junk), null)
  }
})

test('only a missing timing column counts as missing', () => {
  const missing = (column: string) => ({
    code: '42703',
    message: `column "${column}" of relation "title_analysis" does not exist`,
  })
  assert.equal(isMissingTimingColumn(missing('retrieval_ms')), true)
  assert.equal(isMissingTimingColumn(missing('write_ms')), true)
  assert.equal(isMissingTimingColumn(missing('prompt_variant')), false)
  assert.equal(isMissingTimingColumn({ code: '23505', message: 'write_ms' }), false)
  assert.equal(isMissingTimingColumn(null), false)
})

test('a database behind the image gets the statement again, without timing', async () => {
  const seen: boolean[] = []
  let told = 0
  const answer = await withAnalysisTiming(
    async (withTiming) => {
      seen.push(withTiming)
      if (withTiming) {
        throw Object.assign(new Error('column "write_ms" does not exist'), { code: '42703' })
      }
      return 'stored'
    },
    () => told++
  )
  assert.equal(answer, 'stored')
  assert.deepEqual(seen, [true, false])
  assert.equal(told, 1)
})

test('any other failure is not retried', async () => {
  const seen: boolean[] = []
  await assert.rejects(
    withAnalysisTiming(
      async (withTiming) => {
        seen.push(withTiming)
        throw new Error('connection lost')
      },
      () => assert.fail('not a missing column')
    ),
    /connection lost/
  )
  assert.deepEqual(seen, [true])
})
