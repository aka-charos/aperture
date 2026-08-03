/**
 * Pure helpers for the Translations editor and CSV import/export: turning
 * nested `translation.json` trees into dot-path key -> string maps and back,
 * and checking `{{token}}` interpolation variables are preserved across
 * locales. Ports the flatten logic in
 * apps/web/scripts/i18n/sync-missing-from-en.mjs (Node-only tooling) into a
 * runtime-safe module, per the project convention that apps/web never
 * imports @aperture/core and instead duplicates small helpers.
 */

export type TranslationTree = { [key: string]: string | TranslationTree }

/** Dot-joins nested keys down to string leaves. Every leaf in this app's
 *  translation files is a string (no arrays), so anything else is skipped. */
export function flattenTranslation(obj: TranslationTree, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenTranslation(value, path))
    } else if (typeof value === 'string') {
      result[path] = value
    }
  }
  return result
}

const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_]+)/g

/** `{{token}}` names in a string, ignoring i18next formatting suffixes
 *  (e.g. "{{count, number}}" -> "count"). */
export function extractInterpolationTokens(value: string): Set<string> {
  const tokens = new Set<string>()
  for (const match of value.matchAll(TOKEN_RE)) {
    tokens.add(match[1])
  }
  return tokens
}

export interface TokenDiff {
  missing: string[]
  extra: string[]
}

/** Tokens present in `referenceValue` but absent from `otherValue` (missing),
 *  and tokens present in `otherValue` but not `referenceValue` (extra). Both
 *  empty means the two strings' interpolation variables match. */
export function diffInterpolationTokens(referenceValue: string, otherValue: string): TokenDiff {
  const reference = extractInterpolationTokens(referenceValue)
  const other = extractInterpolationTokens(otherValue)
  const missing = [...reference].filter((token) => !other.has(token))
  const extra = [...other].filter((token) => !reference.has(token))
  return { missing, extra }
}
