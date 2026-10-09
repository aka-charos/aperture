import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  currentTranslationsSql,
  fieldPendingSql,
  pendingTranslationsFromSql,
  sourceColumnsSql,
  sourceTextSql,
} from './pending.js'
import { TRANSLATABLE_FIELDS } from './rules.js'

test('the pending check, the stored hash and the read all hash the SAME expression', () => {
  // The whole design rests on this: a row is current only when its hash equals
  // md5 of the live source expression. If any reader spelled the expression
  // differently, a translation would be stale to one and current to another.
  for (const field of TRANSLATABLE_FIELDS) {
    const src = sourceTextSql(field)
    assert.ok(fieldPendingSql('movie', field, 'lang.code').includes(`md5(${src})`), `pending: ${field}`)
    assert.ok(sourceColumnsSql([field]).includes(`md5(${src}) AS ${field}_hash`), `selection: ${field}`)
    assert.ok(currentTranslationsSql('movie').includes(`WHEN '${field}' THEN ${src}`), `read: ${field}`)
  }
})

test('the full synopsis is only a source when it is longer than the overview', () => {
  // OMDb returns the short blurb as plot=full when IMDb has none; the page
  // only offers the long synopsis when it is longer, so only then is it worth
  // a call.
  const src = sourceTextSql('plot_full')
  assert.match(src, /length\(btrim\(m\.plot_full\)\) > length\(btrim\(m\.overview\)\)/)
  assert.match(src, /m\.overview IS NULL/)
})

test('a blank overview is no source at all', () => {
  assert.equal(sourceTextSql('overview'), "NULLIF(btrim(m.overview), '')")
})

test('no field switched on is FALSE, not a syntax error', () => {
  assert.match(pendingTranslationsFromSql('series', [], '$1'), /WHERE \(FALSE\)$/)
})

test('pending crosses every title with every language and scopes rows by media type', () => {
  const sql = pendingTranslationsFromSql('series', ['overview'], '$1', { withPicks: true })
  assert.match(sql, /FROM series m/)
  assert.match(sql, /CROSS JOIN unnest\(\$1::text\[\]\) AS lang\(code\)/)
  assert.match(sql, /tt\.media_type = 'series'/)
  assert.match(sql, /tt\.language = lang\.code/)
  assert.match(sql, /\) picks ON picks\.id = m\.id/)
  assert.doesNotMatch(pendingTranslationsFromSql('series', ['overview'], '$1'), /picks/)
})

test('the detail read joins the right table for each media type', () => {
  assert.match(currentTranslationsSql('movie'), /JOIN movies m ON m\.id = tt\.media_id/)
  assert.match(currentTranslationsSql('series'), /JOIN series m ON m\.id = tt\.media_id/)
})
