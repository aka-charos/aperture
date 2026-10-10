import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { ParagraphMap } from '../analysis/paragraphMap.js'
import {
  analysisFitsOneRequest,
  analysisParagraphs,
  analysisSectionKeys,
  analysisTranslationGroups,
  joinAnalysisParagraphs,
} from './analysisText.js'
import {
  ANALYSIS_TRANSLATION_FIELD,
  TRANSLATABLE_FIELDS,
  TRANSLATION_CHUNK_CHARS,
} from './rules.js'
import {
  analysisSourceSql,
  currentAnalysisTranslationSql,
  currentTranslationsSql,
  failedAnalysisJoinSql,
  pendingAnalysisTranslationsFromSql,
  translationPriorityOrderSql,
} from './pending.js'

const para = (n: number, chars = 400) => `Paragraph ${n}. ${'x'.repeat(chars)}.`

const map = (...labels: Array<string[]>): ParagraphMap =>
  labels.map((questions, i) => ({ paragraph: i + 1, questions: questions as ParagraphMap[number]['questions'] }))

// ---------------------------------------------------------------- paragraphs

test('paragraphs are counted exactly as the paragraph index counts them', () => {
  // `splitAnalysisParagraphs` splits on two or more newlines; a single newline
  // stays inside a paragraph. The translation is checked against this count.
  assert.deepEqual(analysisParagraphs('One.\n\nTwo\nstill two.\n\n\nThree.'), ['One.', 'Two\nstill two.', 'Three.'])
  assert.equal(joinAnalysisParagraphs(['a', 'b']), 'a\n\nb')
})

test('a full-length analysis is one request', () => {
  const twelve = Array.from({ length: 12 }, (_, i) => para(i, 380))
  assert.ok(joinAnalysisParagraphs(twelve).length > 4500)
  assert.equal(analysisFitsOneRequest(twelve), true)
  assert.equal(analysisFitsOneRequest([para(0, TRANSLATION_CHUNK_CHARS)]), false)
})

// ---------------------------------------------------------------- sections

test('sections follow the paragraph index: same labels in a row are one section', () => {
  const keys = analysisSectionKeys(5, map(['tradition'], ['work'], ['work'], ['circumstances'], ['reception']))
  assert.deepEqual(keys, ['tradition', 'work', 'work', 'circumstances', 'reception'])
  // No map: one section.
  assert.deepEqual(analysisSectionKeys(3, null), ['', '', ''])
})

test('the fallback never crosses a section boundary, and packs a section of short paragraphs into one request', () => {
  const paragraphs = [para(1), para(2), para(3), para(4), para(5)]
  const groups = analysisTranslationGroups(
    paragraphs,
    map(['tradition'], ['work'], ['work'], ['work'], ['reception'])
  )
  assert.deepEqual(groups, [[0], [1, 2, 3], [4]])
})

test('a section larger than one request is cut between paragraphs, in order, losing none', () => {
  const paragraphs = Array.from({ length: 10 }, (_, i) => para(i, 900))
  const groups = analysisTranslationGroups(paragraphs, null, 2000)
  assert.ok(groups.length > 1)
  assert.deepEqual(groups.flat(), paragraphs.map((_, i) => i))
  for (const g of groups) {
    const size = joinAnalysisParagraphs(g.map((i) => paragraphs[i])).length
    assert.ok(g.length === 1 || size <= 2000, `group ${g} is ${size}`)
  }
})

test('a single paragraph over the limit is its own group (translateText splits it further)', () => {
  const groups = analysisTranslationGroups([para(1, 50), para(2, 5000), para(3, 50)], null, 1000)
  assert.deepEqual(groups, [[0], [1], [2]])
})

// ---------------------------------------------------------------- storage contract

test('the pending check, the stored hash and the read hash the SAME analysis expression', () => {
  const src = analysisSourceSql()
  assert.equal(src, "NULLIF(btrim(ta.analysis), '')")
  assert.ok(pendingAnalysisTranslationsFromSql('movie', '$1').includes(`tt.source_hash = md5(${src})`))
  assert.ok(currentAnalysisTranslationSql().includes(`tt.source_hash = md5(${src})`))
  assert.ok(failedAnalysisJoinSql('movie').includes(`f.source_hash = md5(${src})`))
})

test('analysis rows share the table but are invisible to every synopsis reader', () => {
  assert.equal((TRANSLATABLE_FIELDS as readonly string[]).includes(ANALYSIS_TRANSLATION_FIELD), false)
  // The synopsis read hashes a CASE over TRANSLATABLE_FIELDS only, so an
  // 'analysis' row hashes NULL there and never matches.
  assert.doesNotMatch(currentTranslationsSql('movie'), /'analysis'/)
  for (const sql of [
    pendingAnalysisTranslationsFromSql('series', '$1'),
    currentAnalysisTranslationSql(),
    failedAnalysisJoinSql('series'),
  ]) {
    assert.match(sql, /field = 'analysis'/)
  }
})

test('a declined analysis (no text) is never pending, and the library switch applies', () => {
  const sql = pendingAnalysisTranslationsFromSql('movie', '$1')
  assert.match(sql, /NULLIF\(btrim\(ta\.analysis\), ''\) IS NOT NULL/)
  assert.match(sql, /FROM title_analysis ta\s+JOIN movies m ON m\.id = ta\.media_id/)
  assert.match(sql, /ta\.media_type = 'movie'/)
  assert.match(sql, /library_config/)
})

test('an analysis that failed before is queued after the rest, like a synopsis', () => {
  const sql = pendingAnalysisTranslationsFromSql('movie', '$1', { withPicks: true, withFailures: true })
  assert.ok(sql.includes(failedAnalysisJoinSql('movie')))
  assert.match(sql, /\) picks ON picks\.id = m\.id/)
  // The shared ORDER BY reads `failed.last_failed_at` first.
  assert.match(translationPriorityOrderSql(), /^ORDER BY \(failed\.last_failed_at IS NOT NULL\)/)
  assert.match(failedAnalysisJoinSql('movie'), /\) failed ON true$/)
})
