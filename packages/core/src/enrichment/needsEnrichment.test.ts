import test from 'node:test'
import assert from 'node:assert/strict'
import { needsEnrichmentSql } from './pending.js'

/**
 * `enrichment_version` records which schema version was current when a row was
 * touched, not which sources answered it. Every pass stamps it — including a
 * pass where OMDb was disabled, keyless, skipped for a missing imdb_id, or
 * erroring — and the selection then excludes the row forever. A library
 * enriched before OMDb was configured is stamped complete and adding the key
 * later does nothing: 88 of 12,584 movies carried languages on the instance
 * where this was found, while the version counter reported nothing outdated.
 *
 * The query itself needs a database. What is pinned here is the policy: which
 * rows a pass is willing to look at, and — the part that can silently cost a
 * whole library its metadata — when the OMDb backfill clause is allowed to
 * exist at all.
 */

// ============================================================================
// The OMDb clause is conditional, and both directions matter
// ============================================================================

test('a version-current row is selectable when OMDb has never been asked', () => {
  const sql = needsEnrichmentSql('movies', '$2', true)
  assert.match(sql, /omdb_enriched_at IS NULL AND imdb_id IS NOT NULL/)
})

test('the OMDb clause is absent when OMDb cannot be asked', () => {
  const sql = needsEnrichmentSql('movies', '$2', false)
  assert.doesNotMatch(sql, /omdb_enriched_at/)
})

test('with OMDb off, only the version and never-enriched clauses remain', () => {
  // Without this guard a disabled OMDb leaves every row permanently pending:
  // nothing would ever satisfy the clause, so each pass would re-run TMDb over
  // the entire library and the job would never reach "nothing to do".
  const sql = needsEnrichmentSql('series', '$1', false)
  const stale = sql.slice(0, sql.indexOf(')\n'))
  assert.equal(stale.split(' OR ').length, 2)
})

// ============================================================================
// Shape
// ============================================================================

test('both staleness reasons survive alongside the OMDb clause', () => {
  const sql = needsEnrichmentSql('movies', '$2', true)
  assert.match(sql, /enriched_at IS NULL/)
  assert.match(sql, /COALESCE\(enrichment_version, 0\) < \$2/)
})

test('the version placeholder is whatever the caller numbered it', () => {
  // The four call sites bind it at different positions; passing the wrong one
  // silently compares a version against a row limit.
  assert.match(needsEnrichmentSql('movies', '$1', true), /< \$1/)
  assert.match(needsEnrichmentSql('movies', '$2', true), /< \$2/)
})

test('series accept a tvdb_id as identification and movies do not', () => {
  assert.match(needsEnrichmentSql('series', '$1', true), /tvdb_id IS NOT NULL/)
  assert.doesNotMatch(needsEnrichmentSql('movies', '$1', true), /tvdb_id/)
})

test('the staleness reasons are OR-ed but the id requirement is AND-ed', () => {
  // A row with no id at all can never be enriched by anyone, so it must not be
  // selectable however stale it looks.
  const sql = needsEnrichmentSql('movies', '$1', true)
  const [staleGroup, idGroup] = sql.split('AND (imdb_id')
  assert.ok(staleGroup.startsWith('('), 'staleness reasons must be parenthesised')
  assert.ok(idGroup !== undefined, 'the id predicate must be AND-ed onto the group')
})
