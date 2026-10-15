/**
 * Helpers for the source-scanning tests (the "call sites" tests), which read
 * the repository's own TypeScript to enforce a rule no type can carry.
 *
 * Shared so every scan agrees on what a source file is. A scan that forgot to
 * skip `dist` would read the compiled copy of every file as well, and for a
 * scan that COUNTS (one statement against one helper call) that doubles both
 * sides in a way that can hide a missing call.
 */

import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Every `.ts` file under `dir`, skipping `node_modules` and `dist`. Test files are included. */
export function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      yield* sourceFiles(full)
    } else if (entry.endsWith('.ts')) {
      yield full
    }
  }
}

/**
 * The source with comments removed, for scans that count occurrences: a
 * mention of a statement or a helper in prose must not count as one.
 *
 * Block comments, whole-line `//` comments, and SQL `--` comments (a `--`
 * after whitespace, to end of line). A `//` after code is left alone, since it
 * may sit inside a string (`https://`), so a scan should also match a CODE
 * shape (`= ${helper(`, not the bare name) that a trailing comment is unlikely
 * to contain.
 */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/(^|\s)--\s.*$/gm, '$1')
}
