import test from 'node:test'
import assert from 'node:assert/strict'

import {
  analysisJoinSql,
  analysisPriorityOrderSql,
  isAnalysisStale,
  needsAnalysisSql,
  pendingAnalysisFromSql,
} from './pending.js'
import { ANALYSIS_PROMPT_VERSION } from './prompt.js'

/** Collapse whitespace so assertions are about SQL, not indentation. */
const flat = (sql: string) => sql.replace(/\s+/g, ' ').trim()

/**
 * The OUTER filter. Split on the LAST `WHERE`, not the first: the picks
 * subquery carries its own, so a naive split compares a subquery predicate
 * against the real one.
 */
const outerWhere = (sql: string) => {
  const s = flat(sql)
  return s.slice(s.lastIndexOf(' WHERE ') + ' WHERE '.length)
}

test('the count and the selection share one FROM/JOIN/WHERE core', () => {
  // This is the whole reason the module exists. The enrichment predicate once
  // lived in four places and they agreed only by being wrong identically — the
  // progress counter said nothing was pending and the selection returned
  // nothing, in agreement, so nothing looked broken.
  const count = pendingAnalysisFromSql('movie', '$1')
  const selection = pendingAnalysisFromSql('movie', '$1', { withPicks: true })

  assert.equal(
    outerWhere(count),
    outerWhere(selection),
    'the two must filter on identical conditions'
  )
  // The selection is the count plus the ordering join, never a different query.
  const countPrefix = flat(count).slice(0, flat(count).lastIndexOf(' WHERE '))
  assert.ok(flat(selection).startsWith(countPrefix))
})

test('media_type is fixed in the JOIN, never in the WHERE', () => {
  // In the WHERE it would turn the outer join into an inner one and silently
  // drop every never-analysed title — the exact set the query exists to find.
  const sql = flat(pendingAnalysisFromSql('series', '$1'))
  assert.match(sql.slice(0, sql.lastIndexOf(' WHERE ')), /media_type = 'series'/)
  assert.doesNotMatch(outerWhere(sql), /media_type/)
})

test('a declined row is not pending, but a never-attempted one is', () => {
  // `analysis IS NULL` is a stored decline: re-asking spends a grounded request
  // to get the same answer forever. Only a missing row or an older prompt
  // version qualifies.
  const predicate = needsAnalysisSql('$1')
  assert.match(predicate, /ta\.media_id IS NULL/)
  assert.match(predicate, /ta\.prompt_version < \$1/)
  assert.doesNotMatch(predicate, /analysis IS NULL/)
})

test('both media types resolve to their own table and id column', () => {
  assert.match(flat(pendingAnalysisFromSql('movie', '$1')), /FROM movies m/)
  assert.match(flat(pendingAnalysisFromSql('series', '$1')), /FROM series m/)

  assert.match(
    flat(pendingAnalysisFromSql('movie', '$1', { withPicks: true })),
    /rc\.movie_id AS id/
  )
  assert.match(
    flat(pendingAnalysisFromSql('series', '$1', { withPicks: true })),
    /rc\.series_id AS id/
  )
})

test('the picks join is a single scan, not a per-row correlated lookup', () => {
  // A correlated EXISTS in the ORDER BY ran one indexed lookup per library row
  // — ~12,500 per execution, and the job re-runs the selection every batch.
  const sql = flat(pendingAnalysisFromSql('movie', '$1', { withPicks: true }))
  assert.match(sql, /LEFT JOIN \( SELECT DISTINCT/)
  assert.doesNotMatch(sql, /EXISTS/)
  assert.doesNotMatch(sql, /rc\.movie_id = m\.id/)
})

test('the count omits the picks join it would not use', () => {
  assert.doesNotMatch(flat(pendingAnalysisFromSql('movie', '$1')), /picks/)
})

test('priority puts current picks first, then newest', () => {
  const order = flat(analysisPriorityOrderSql())
  assert.equal(order, 'ORDER BY (picks.id IS NOT NULL) DESC, m.created_at DESC NULLS LAST')
})

test('the order clause depends on the join, so they must be used together', () => {
  // Pinned because using the order without `withPicks` is a runtime error, not
  // a type error — `picks` would be an unknown relation.
  assert.match(analysisPriorityOrderSql(), /picks\.id/)
  assert.match(
    flat(pendingAnalysisFromSql('movie', '$1', { withPicks: true })),
    /\) picks ON picks\.id = m\.id/
  )
})

test('custom aliases flow through the join and the predicate together', () => {
  const aliases = { media: 'mv', analysis: 'an' }
  assert.match(flat(analysisJoinSql('movie', aliases)), /an\.media_id = mv\.id/)
  assert.match(needsAnalysisSql('$2', aliases), /an\.media_id IS NULL/)
})

test('the JS staleness check agrees with the SQL predicate above it', () => {
  // The batch job asks this in SQL, the detail page and the on-demand POST ask
  // it in TypeScript. Drift means a title is obsolete to one and current to the
  // other: the job rewrites rows the page thinks are fine, or the page offers a
  // rewrite for something the job has already redone.
  assert.ok(needsAnalysisSql('$1').includes('prompt_version < $1'))

  // Strictly below, on both sides. The other off-by-one would rewrite the whole
  // library on every run, forever.
  assert.equal(isAnalysisStale(ANALYSIS_PROMPT_VERSION - 1), true)
  assert.equal(isAnalysisStale(ANALYSIS_PROMPT_VERSION), false)
  assert.equal(isAnalysisStale(ANALYSIS_PROMPT_VERSION + 1), false)
})
