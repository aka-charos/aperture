import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TextIndex, candidateTexts, chooseCompareLocale, matchTexts, normalizeText } from './textIndex'

test('normalizeText strips Trans markup and zero-width characters and collapses whitespace', () => {
  assert.equal(normalizeText('  Hello <1>there</1>,\n  <strong>you</strong>  '), 'Hello there, you')
  assert.equal(normalizeText('a\u200Bb\uFEFF'), 'ab')
  // A comparison sign in prose is not markup.
  assert.equal(normalizeText('1 < 2 and 3 > 2'), '1 < 2 and 3 > 2')
})

test('lookup returns every key that rendered the text, most recent first', () => {
  const index = new TextIndex()
  index.record('common.cancel', 'Cancel', 'en')
  index.record('dialog.cancel', 'Cancel', 'en')
  index.record('common.save', 'Save', 'en')
  index.record('common.cancel', 'Cancel', 'en')
  assert.deepEqual(
    index.lookup(' Cancel ').map((m) => m.key),
    ['common.cancel', 'dialog.cancel']
  )
  assert.deepEqual(index.lookup('Nope'), [])
})

test('rendered lists each key once in first-seen order and clear empties both views', () => {
  const index = new TextIndex()
  index.record('a', 'One', 'en')
  index.record('b', 'Two', 'en')
  index.record('a', 'One', 'en')
  assert.deepEqual(index.rendered().map((m) => m.key), ['b', 'a'])
  assert.equal(index.size, 2)
  index.clear()
  assert.equal(index.size, 0)
  assert.deepEqual(index.lookup('One'), [])
})

test('an empty string is never recorded', () => {
  const index = new TextIndex()
  index.record('a', '  ', 'en')
  assert.equal(index.size, 0)
})

test('a key that renders a new value moves to the new text and leaves the old', () => {
  const index = new TextIndex()
  assert.equal(index.record('count', '3 items', 'en'), true)
  assert.equal(index.record('count', '4 items', 'en'), false)
  assert.equal(index.rendered()[0].value, '4 items')
  assert.deepEqual(index.lookup('4 items').map((m) => m.key), ['count'])
  assert.deepEqual(index.lookup('3 items'), [])
})

test('moving one key off a shared text leaves the other key on it', () => {
  const index = new TextIndex()
  index.record('a', 'Same', 'en')
  index.record('b', 'Same', 'en')
  index.record('a', 'Different', 'en')
  assert.deepEqual(index.lookup('Same').map((m) => m.key), ['b'])
})

test('candidateTexts orders own text, whole text, then attributes and skips long containers', () => {
  assert.deepEqual(
    candidateTexts({ ownText: 'Save', fullText: 'Save changes', attributes: ['Save', null, 'Tooltip'] }),
    ['Save', 'Save changes', 'Tooltip']
  )
  assert.deepEqual(
    candidateTexts({ ownText: '', fullText: 'x'.repeat(401), attributes: [] }),
    []
  )
})

test('matchTexts takes the first candidate with a match', () => {
  const index = new TextIndex()
  index.record('label', 'Search', 'en')
  assert.equal(matchTexts(index, ['Nothing', 'Search'])?.matches[0].key, 'label')
  assert.equal(matchTexts(index, ['Nothing']), null)
})

test('chooseCompareLocale prefers the stored choice, then the app language, then the first other', () => {
  assert.equal(chooseCompareLocale('fr', 'el', ['en', 'el', 'fr']), 'fr')
  assert.equal(chooseCompareLocale('de', 'el-GR', ['en', 'el', 'fr']), 'el')
  assert.equal(chooseCompareLocale(null, 'en', ['en', 'el']), 'el')
  assert.equal(chooseCompareLocale(null, 'en', ['en']), null)
})
