/**
 * Rows to a CSV a spreadsheet opens correctly.
 *
 * Separate from `store.ts` and free of any database import so it can be
 * pinned by a test, which is the house rule for a predicate that would
 * otherwise be copied into each export route and drift.
 *
 * Two details decide whether the file is readable on the machine it lands on:
 *
 *   A UTF-8 BOM. Excel on Windows reads a BOM-less UTF-8 file in the system
 *   codepage, and this library is full of accented and non-Latin titles —
 *   Utøya, Aniara, Alice In The Cities — so without it the export opens as
 *   mojibake and looks like a data bug rather than an encoding one.
 *
 *   A guard on text cells opening with a formula character. Excel and
 *   LibreOffice evaluate those on open. It is applied to STRINGS ONLY and
 *   deliberately not to numbers: a cosine is legitimately negative, and
 *   quoting every leading minus would turn the whole column into text and
 *   break exactly the pivot the export exists for.
 */

export type CsvCell = string | number | null | undefined

/** Byte order mark. Its own constant so a test can assert it rather than match a literal. */
export const CSV_BOM = '﻿'

/**
 * A string that is just a number.
 *
 * This exclusion is load-bearing rather than tidy. pg returns NUMERIC as TEXT,
 * so every score, share and cosine in these exports reaches here as a string —
 * and a negative one opens with a minus, which is also the first character of
 * a formula. Guarding it would prefix an apostrophe and turn the entire cosine
 * column into text, breaking the pivot the export exists for. A leading minus
 * followed only by digits is a number; a formula needs an operator after it.
 */
const NUMERIC_TEXT = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/

export function csvCell(value: CsvCell): string {
  if (value == null) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''

  const risky = /^[=+\-@\t\r]/.test(value) && !NUMERIC_TEXT.test(value)
  const text = risky ? "'" + value : value
  return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text
}

export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [headers.join(','), ...rows.map((row) => row.map(csvCell).join(','))]
  return CSV_BOM + lines.join('\r\n') + '\r\n'
}
