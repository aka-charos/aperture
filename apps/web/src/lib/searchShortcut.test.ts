import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, relative, resolve } from 'node:path'
import { matchSearchShortcut, type SearchShortcutEvent } from './searchShortcut'

/**
 * What keeps the two search palettes off each other.
 *
 * The bug this pins: with Caps Lock on, Shift and Caps cancel, so Ctrl+Shift+K
 * arrives as lowercase `'k'`. The content search matched `key === 'k'` and the
 * settings palette matched either case, so both fired on the one keystroke and
 * both dialogs opened, stacked. Measured in a browser before the fix.
 */

const press = (over: Partial<SearchShortcutEvent>): SearchShortcutEvent => ({
  key: 'k',
  code: 'KeyK',
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...over,
})

test('Ctrl+K and Cmd+K open the content search', () => {
  assert.equal(matchSearchShortcut(press({ ctrlKey: true })), 'global')
  assert.equal(matchSearchShortcut(press({ metaKey: true })), 'global')
})

test('adding Shift opens the settings palette instead, never as well', () => {
  assert.equal(matchSearchShortcut(press({ ctrlKey: true, shiftKey: true, key: 'K' })), 'admin')
  assert.equal(matchSearchShortcut(press({ metaKey: true, shiftKey: true, key: 'K' })), 'admin')
})

test('Caps Lock does not turn the settings shortcut into both', () => {
  // The reported failure. Caps on + Shift held reports the letter lowercase,
  // which is indistinguishable from an unshifted press by letter case alone —
  // so the answer has to come from `shiftKey`.
  assert.equal(matchSearchShortcut(press({ ctrlKey: true, shiftKey: true, key: 'k' })), 'admin')
})

test('a bare or unmodified K is not a shortcut', () => {
  assert.equal(matchSearchShortcut(press({})), null)
  assert.equal(matchSearchShortcut(press({ shiftKey: true })), null)
})

test('AltGr is not a shortcut', () => {
  // Ctrl+Alt is how a Windows layout types a character; treating it as Ctrl
  // would steal the keystroke from whoever is writing an API key.
  assert.equal(matchSearchShortcut(press({ ctrlKey: true, altKey: true })), null)
})

test('another letter is not a shortcut', () => {
  assert.equal(matchSearchShortcut(press({ ctrlKey: true, key: 'j', code: 'KeyJ' })), null)
})

test('a non-Latin layout reaches the palettes by physical key', () => {
  // Russian and Hebrew report their own letter, which would otherwise leave
  // both palettes unreachable in two of the fifteen shipped locales.
  assert.equal(matchSearchShortcut(press({ ctrlKey: true, key: 'л' })), 'global')
  assert.equal(matchSearchShortcut(press({ ctrlKey: true, shiftKey: true, key: 'ק' })), 'admin')
})

test('a Latin layout is never resolved by physical key', () => {
  // Dvorak types 'v' on the key QWERTY calls K. Consulting `code` first would
  // make Ctrl+V open the search palette.
  assert.equal(matchSearchShortcut(press({ ctrlKey: true, key: 'v', code: 'KeyK' })), null)
})

test('a missing code is tolerated', () => {
  // Synthetic events, and some remote-desktop clients, send no `code`.
  assert.equal(matchSearchShortcut(press({ ctrlKey: true, code: undefined })), 'global')
  assert.equal(matchSearchShortcut(press({ ctrlKey: true, key: 'л', code: undefined })), null)
})

/**
 * Nothing may decide the search shortcut for itself.
 *
 * This is the shape of the original bug — two listeners, each with its own
 * idea of what the K key is — and it is not a type error, does not fail lint,
 * and only shows up on a keyboard nobody testing it happened to be using. A
 * convention was already in place here and did not hold, so it is scanned.
 */
test('no other module matches the K key by hand', () => {
  const src = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const offenders: string[] = []

  const walk = (dir: string) => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, item.name)
      if (item.isDirectory()) {
        if (item.name !== 'node_modules') walk(full)
        continue
      }
      if (!/\.tsx?$/.test(item.name)) continue
      if (full.includes('searchShortcut')) continue

      const source = readFileSync(full, 'utf8')
      if (/\bkey\s*===\s*['"][kK]['"]/.test(source) || /\bcode\s*===\s*['"]KeyK['"]/.test(source)) {
        offenders.push(relative(src, full))
      }
    }
  }
  walk(src)

  assert.deepEqual(
    offenders,
    [],
    `these compare the K key by hand instead of calling matchSearchShortcut: ${offenders.join(', ')}`
  )
})
