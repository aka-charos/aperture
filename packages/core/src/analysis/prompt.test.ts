/**
 * The search query and the header that has to agree with it.
 *
 * Both read `distinctOriginalTitle`, and the failure this pins is silent in
 * both directions: a query missing the original title quietly retrieves and
 * analyses a different film, while one that adds a name the row already
 * carries spends a search term on nothing.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { buildAnalysisQuery, buildAnalysisPrompt, distinctOriginalTitle } from './prompt.js'
import type { AnalysisSubject } from './prompt.js'

const subject = (over: Partial<AnalysisSubject> = {}): AnalysisSubject => ({
  title: 'Sentimental Value',
  year: 2025,
  mediaType: 'movie',
  reception: {},
  ...over,
})

test('no original title, the query is unchanged', () => {
  const q = buildAnalysisQuery(subject())
  assert.equal(q, 'Sentimental Value 2025 film analysis criticism production history themes style')
})

test('a different original title rides beside the localized one, before the year', () => {
  const q = buildAnalysisQuery(subject({ originalTitle: 'Affeksjonsverdi' }))
  assert.equal(
    q,
    'Sentimental Value Affeksjonsverdi 2025 film analysis criticism production history themes style'
  )
})

test('a series query keeps its kind', () => {
  const q = buildAnalysisQuery(
    subject({ title: 'Dark', originalTitle: 'Dunkel', mediaType: 'series' })
  )
  assert.ok(q.startsWith('Dark Dunkel 2025 TV series '), q)
})

test('the same name spelled the same way is not repeated', () => {
  assert.equal(distinctOriginalTitle(subject({ originalTitle: 'Sentimental Value' })), null)
})

// The three ways a row carries an original title that is not a second name:
// the sync copies the localized one verbatim, the provider stores it in caps,
// or the two differ only by the accents an engine folds away anyway.
test('case and accents alone are not a different name', () => {
  assert.equal(distinctOriginalTitle(subject({ originalTitle: 'SENTIMENTAL VALUE' })), null)
  assert.equal(
    distinctOriginalTitle(subject({ title: 'Amelie', originalTitle: 'Amélie' })),
    null
  )
  assert.equal(
    distinctOriginalTitle(subject({ title: 'Amélie', originalTitle: 'Amelie' })),
    null
  )
})

test('surrounding whitespace is not a different name', () => {
  assert.equal(distinctOriginalTitle(subject({ originalTitle: '  Sentimental Value ' })), null)
})

test('absent, null and empty all read as no original title', () => {
  assert.equal(distinctOriginalTitle(subject()), null)
  assert.equal(distinctOriginalTitle(subject({ originalTitle: null })), null)
  assert.equal(distinctOriginalTitle(subject({ originalTitle: '   ' })), null)
})

// A subtitle variant IS worth searching for, unlike the assistant's
// titlesOverlap, which folds one into the other because it is answering a
// different question - see the note on distinctOriginalTitle.
test('a longer original title is kept', () => {
  assert.equal(
    distinctOriginalTitle(
      subject({ title: 'Amélie', originalTitle: "Le Fabuleux Destin d'Amélie Poulain" })
    ),
    "Le Fabuleux Destin d'Amélie Poulain"
  )
})

test('a non-Latin original title is kept', () => {
  assert.equal(
    distinctOriginalTitle(subject({ title: 'Drive My Car', originalTitle: 'ドライブ・マイ・カー' })),
    'ドライブ・マイ・カー'
  )
})

test('the prompt names the original title, and only when there is one', () => {
  const withOriginal = buildAnalysisPrompt(subject({ originalTitle: 'Affeksjonsverdi' }), {
    mode: 'grounding',
  })
  assert.ok(withOriginal.includes('Original title: Affeksjonsverdi'), withOriginal.slice(0, 200))

  const without = buildAnalysisPrompt(subject(), { mode: 'grounding' })
  assert.ok(!without.includes('Original title:'), without.slice(0, 200))
})
