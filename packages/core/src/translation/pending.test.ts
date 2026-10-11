import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  currentTranslationsSql,
  enabledLibrarySql,
  localeLiteral,
  textLanguageSql,
  failedPairJoinSql,
  fieldPendingSql,
  pendingTranslationsFromSql,
  sourceColumnsSql,
  sourceTextSql,
  translationPriorityOrderSql,
} from './pending.js'
import { TRANSLATABLE_FIELDS, resolveTranslationLanguages } from './rules.js'

test('the pending check, the stored hash and the read all hash the SAME expression', () => {
  // The whole design rests on this: a row is current only when its hash equals
  // md5 of the live source expression. If any reader spelled the expression
  // differently, a translation would be stale to one and current to another.
  for (const field of TRANSLATABLE_FIELDS) {
    const src = sourceTextSql(field)
    assert.ok(fieldPendingSql('movie', field, 'lang.code', 'en').includes(`md5(${src})`), `pending: ${field}`)
    assert.ok(sourceColumnsSql([field], 'en').includes(`md5(${src}) AS ${field}_hash`), `selection: ${field}`)
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
  assert.match(pendingTranslationsFromSql('series', [], '$1', 'en'), /WHERE \(FALSE\)\s+AND /)
})

test('a title in a switched-off library is never pending (the embedding jobs\' rule)', () => {
  for (const mediaType of ['movie', 'series'] as const) {
    const sql = pendingTranslationsFromSql(mediaType, ['overview'], '$1', 'en')
    assert.ok(sql.includes(enabledLibrarySql(mediaType)), mediaType)
  }
  assert.match(enabledLibrarySql('movie'), /NOT EXISTS \(SELECT 1 FROM library_config\)/)
  assert.match(enabledLibrarySql('movie'), /lc\.is_enabled = true/)
  // A movie library's row must not switch every show off.
  assert.match(enabledLibrarySql('series'), /NOT EXISTS \(SELECT 1 FROM library_config WHERE collection_type = 'tvshows'\)/)
})

test('pending crosses every title with every language and scopes rows by media type', () => {
  const sql = pendingTranslationsFromSql('series', ['overview'], '$1', 'en', { withPicks: true })
  assert.match(sql, /FROM series m/)
  assert.match(sql, /CROSS JOIN unnest\(\$1::text\[\]\) AS lang\(code\)/)
  assert.match(sql, /tt\.media_type = 'series'/)
  assert.match(sql, /tt\.language = lang\.code/)
  assert.match(sql, /\) picks ON picks\.id = m\.id/)
  assert.doesNotMatch(pendingTranslationsFromSql('series', ['overview'], '$1', 'en'), /picks/)
})

test('the detail read joins the right table for each media type', () => {
  assert.match(currentTranslationsSql('movie'), /JOIN movies m ON m\.id = tt\.media_id/)
  assert.match(currentTranslationsSql('series'), /JOIN series m ON m\.id = tt\.media_id/)
})

test('a pair that failed before is queued after every pair that has not', () => {
  // The failure flag leads the ORDER BY, ahead of the picks priority: a pair
  // failing every run must never open the next one.
  const order = translationPriorityOrderSql()
  assert.match(order, /^ORDER BY \(failed\.last_failed_at IS NOT NULL\), failed\.last_failed_at ASC NULLS FIRST,/)
  assert.ok(order.indexOf('failed.last_failed_at') < order.indexOf('picks.id'))
  const sql = pendingTranslationsFromSql('movie', ['overview'], '$1', 'en', { withPicks: true, withFailures: true })
  assert.ok(sql.includes(failedPairJoinSql('movie')))
})

test('a failure applies only to the text that failed', () => {
  // Once the synopsis changes, the pair is new work and queues as such.
  const join = failedPairJoinSql('series')
  assert.match(join, /f\.media_type = 'series'/)
  for (const field of TRANSLATABLE_FIELDS) {
    assert.ok(join.includes(`WHEN '${field}' THEN ${sourceTextSql(field)}`), field)
  }
  assert.match(join, /f\.source_hash = md5\(CASE f\.field/)
})

// ---------------------------------------------------------------- the text's own language

test('a text is never pending into the language it is already written in', () => {
  // A Greek plot asked "from English into Greek" came back unchanged, failed
  // the echo check and was retried at the back of the queue forever.
  for (const field of TRANSLATABLE_FIELDS) {
    const src = sourceTextSql(field)
    assert.ok(
      fieldPendingSql('movie', field, 'lang.code', 'en').includes(`lang.code <> aperture_text_language(${src}, 'en')`),
      field
    )
  }
})

test('the pending check, the selection and the read detect a language with the SAME call on the SAME text', () => {
  for (const field of TRANSLATABLE_FIELDS) {
    const src = sourceTextSql(field)
    const call = textLanguageSql(src, localeLiteral('en'))
    assert.ok(fieldPendingSql('movie', field, 'lang.code', 'en').includes(call), `pending: ${field}`)
    // The selection returns it, so the prompt names the language the text is in.
    assert.ok(sourceColumnsSql([field], 'en').includes(`${call} AS ${field}_language`), `selection: ${field}`)
  }
  // The read takes the source language as a parameter and refuses a row "into"
  // the text's own language (one left from before detection existed).
  const read = currentTranslationsSql('movie')
  assert.match(read, /AND tt\.language <> aperture_text_language\(CASE tt\.field/)
  assert.match(read, /aperture_text_language\(CASE tt\.field[\s\S]*?END, \$3\)/)
  assert.match(read, /AS source_language/)
})

test('the source language is interpolated only after validation', () => {
  assert.equal(localeLiteral('el'), "'el'")
  assert.throws(() => localeLiteral("en'; DROP TABLE movies; --" as never))
  assert.throws(() => fieldPendingSql('movie', 'overview', 'lang.code', 'xx' as never))
})

test('the source language is a translation language too, so a Greek plot reaches English readers', () => {
  const config = { targetLanguages: null, sourceLanguage: 'en' as const }
  assert.deepEqual(resolveTranslationLanguages(config, ['en', 'el']), ['en', 'el'])
  // Never a language the interface does not offer: nobody could be shown it.
  assert.deepEqual(resolveTranslationLanguages(config, ['el']), ['el'])
  // A narrowed target list still gets the source language added.
  assert.deepEqual(
    resolveTranslationLanguages({ targetLanguages: ['el'], sourceLanguage: 'en' }, ['en', 'el', 'de']),
    ['en', 'el']
  )
  // An English-only instance still has something to translate into: English,
  // for the plots that are not in it.
  assert.deepEqual(resolveTranslationLanguages(config, ['en']), ['en'])
})
