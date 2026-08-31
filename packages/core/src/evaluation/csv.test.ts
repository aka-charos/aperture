import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CSV_BOM, csvCell, toCsv } from './csv.js'

test('the document opens with a BOM, or Excel mangles every accented title', () => {
  const out = toCsv(['title'], [['Utøya: July 22']])
  assert.ok(out.startsWith(CSV_BOM))
  assert.ok(out.includes('Utøya: July 22'))
})

test('separators inside a value are quoted, not escaped away', () => {
  // Real rows from this library: a comma in a title, a slash-joined country
  // list, and a quoted nickname.
  assert.equal(csvCell('Argentina, 1985'), '"Argentina, 1985"')
  assert.equal(csvCell('Germany/United States'), 'Germany/United States')
  assert.equal(csvCell('The "Human" Condition'), '"The ""Human"" Condition"')
})

test('a negative number stays a number', () => {
  // The formula guard must not reach the numeric columns: a cosine can be
  // negative, and an apostrophe in front of it makes the column text, which
  // silently breaks the pivot the export exists for.
  assert.equal(csvCell(-0.1234), '-0.1234')
  assert.equal(csvCell(0), '0')
})

test('a text cell that looks like a formula is defused', () => {
  assert.equal(csvCell('=1+1'), "'=1+1")
  assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)")
  assert.equal(csvCell('+cmd|calc'), "'+cmd|calc")
})

test('a NUMERIC column arriving as text is left alone', () => {
  // pg returns NUMERIC as a string, so every cosine and share in these exports
  // takes the string path. A negative one opens with the same character a
  // formula does, and defusing it would make the column text — which is the
  // one thing that breaks the pivot these files exist for.
  assert.equal(csvCell('-0.5'), '-0.5')
  assert.equal(csvCell('0.8604'), '0.8604')
  assert.equal(csvCell('-1.5e-7'), '-1.5e-7')
  // Still a formula, because a digit does not follow the operator.
  assert.equal(csvCell('-A1'), "'-A1")
})

test('null is empty, never the string null', () => {
  assert.equal(csvCell(null), '')
  assert.equal(csvCell(undefined), '')
  assert.equal(toCsv(['a', 'b'], [[null, 1]]), CSV_BOM + 'a,b\r\n,1\r\n')
})

test('rows are CRLF terminated, including the last one', () => {
  const out = toCsv(['a'], [['x'], ['y']])
  assert.equal(out, CSV_BOM + 'a\r\nx\r\ny\r\n')
})
