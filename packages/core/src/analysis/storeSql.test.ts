import { test } from 'node:test'
import assert from 'node:assert/strict'
import { titleAnalysisUpsertSql } from './storeSql.js'

function insertedColumns(sql: string): string[] {
  const list = /INSERT INTO title_analysis\s+\(([^)]+)\)/.exec(sql)?.[1] ?? ''
  return list.split(',').map((column) => column.trim())
}

for (const withTiming of [true, false]) {
  test(`every column gets its own bind, in order (timing ${withTiming})`, () => {
    const sql = titleAnalysisUpsertSql(withTiming)
    const columns = insertedColumns(sql).filter((column) => column !== 'analyzed_at')
    // NOW() holds its own parentheses, so the list is read up to it.
    const values = /VALUES \((.+), NOW\(\)\)/.exec(sql)?.[1].split(',').map((v) => v.trim()) ?? []
    assert.deepEqual(
      values.map((value) => value.replace('::jsonb', '')),
      columns.map((_, i) => `$${i + 1}`)
    )
  })

  test(`a re-run replaces every column but the key (timing ${withTiming})`, () => {
    const sql = titleAnalysisUpsertSql(withTiming)
    const replaced = insertedColumns(sql).filter(
      (column) => !['media_type', 'media_id', 'analyzed_at'].includes(column)
    )
    for (const column of replaced) {
      assert.match(sql, new RegExp(`\\b${column} = EXCLUDED\\.${column}\\b`))
    }
    assert.match(sql, /analyzed_at = NOW\(\)/)
    assert.match(sql, /tags_prompt_version = NULL/)
  })
}

test('JSON columns stay cast, wherever they land', () => {
  const sql = titleAnalysisUpsertSql(true)
  assert.match(sql, /\$5::jsonb/)
  assert.match(sql, /\$11::jsonb/)
})

test('timing binds come after the base ones, so one params list serves both', () => {
  const columns = insertedColumns(titleAnalysisUpsertSql(true))
  assert.equal(columns.indexOf('retrieval_ms'), 13)
  assert.equal(columns.indexOf('write_ms'), 14)
  assert.doesNotMatch(titleAnalysisUpsertSql(false), /retrieval_ms|write_ms/)
})
