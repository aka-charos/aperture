import assert from 'node:assert/strict'
import { test } from 'node:test'

import { readMinutes, sectionHeading } from './analysisText.js'

test('a short text reads as one minute, never zero', () => {
  assert.equal(readMinutes(''), 1)
  assert.equal(readMinutes('A few words.'), 1)
})

test('English is timed by words', () => {
  assert.equal(readMinutes('word '.repeat(220)), 1)
  assert.equal(readMinutes('word '.repeat(221)), 2)
  assert.equal(readMinutes('word '.repeat(880)), 4)
})

test('Japanese and Chinese are timed by characters, not by spaces', () => {
  // No spaces, so a whitespace count would call this one word.
  assert.equal(readMinutes('映'.repeat(1800)), 4)
  assert.equal(readMinutes('あ'.repeat(450)), 1)
  assert.equal(readMinutes('あ'.repeat(451)), 2)
})

test('mixed text adds both counts', () => {
  assert.equal(readMinutes(`${'word '.repeat(220)}${'映'.repeat(450)}`), 2)
})

test('a heading joins the labels of every question a run answers, in order', () => {
  const labels: Record<string, string> = { work: 'The work', tradition: 'Context' }
  const label = (q: string) => labels[q] ?? ''
  assert.equal(sectionHeading(['tradition', 'work'], label), 'Context · The work')
})

test('a question with no label contributes nothing, and no labels means no heading', () => {
  const label = (q: string) => (q === 'work' ? 'The work' : '')
  assert.equal(sectionHeading(['dispute', 'work'], label), 'The work')
  assert.equal(sectionHeading(['dispute'], label), '')
  assert.equal(sectionHeading([], label), '')
})
