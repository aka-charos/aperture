import { query, queryOne, transaction } from './lib/db.js'
import { isValidAppLocale } from './lib/locales.js'

export interface I18nOverrideRow {
  locale: string
  key: string
  value: string
  updatedAt: string
}

export interface BulkOverrideInput {
  locale: string
  key: string
  value: string | null
}

export interface BulkOverrideResult {
  upserted: number
  deleted: number
}

/** Reserved property names that must never appear as a key segment — unflattenToTree
 *  below builds plain object trees out of admin-controlled strings, so this blocks
 *  prototype pollution. */
const UNSAFE_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])
const SEGMENT_RE = /^[A-Za-z0-9_]+$/

export function isValidOverrideKey(key: string): boolean {
  if (!key) return false
  const segments = key.split('.')
  return segments.every((segment) => SEGMENT_RE.test(segment) && !UNSAFE_SEGMENTS.has(segment))
}

function unflattenToTree(flat: Record<string, string>): Record<string, unknown> {
  const root: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(flat)) {
    if (!isValidOverrideKey(key)) continue
    const segments = key.split('.')
    let node = root
    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i]
      const existing = node[segment]
      if (existing === null || typeof existing !== 'object' || Array.isArray(existing)) {
        node[segment] = {}
      }
      node = node[segment] as Record<string, unknown>
    }
    node[segments[segments.length - 1]] = value
  }
  return root
}

/** Deep merge where `overlay` wins on leaves and on any type mismatch — matches
 *  i18next's own `addResourceBundle(lng, ns, data, true, true)` semantics. */
function deepMergeOverwrite(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base }
  for (const [key, overlayValue] of Object.entries(overlay)) {
    const baseValue = result[key]
    const bothObjects =
      overlayValue !== null &&
      typeof overlayValue === 'object' &&
      !Array.isArray(overlayValue) &&
      baseValue !== null &&
      typeof baseValue === 'object' &&
      !Array.isArray(baseValue)
    result[key] = bothObjects
      ? deepMergeOverwrite(baseValue as Record<string, unknown>, overlayValue as Record<string, unknown>)
      : overlayValue
  }
  return result
}

/** Merges file-sourced overrides (already nested) with the DB tree; DB wins. */
export function mergeFileAndDbOverrides(
  fileOverrides: Record<string, unknown>,
  dbTree: Record<string, unknown>
): Record<string, unknown> {
  return deepMergeOverwrite(fileOverrides, dbTree)
}

/** Flat {key: value} for one locale. */
export async function getOverridesForLocale(locale: string): Promise<Record<string, string>> {
  if (!isValidAppLocale(locale)) return {}
  const result = await query<{ key: string; value: string }>(
    'SELECT key, value FROM i18n_overrides WHERE locale = $1',
    [locale]
  )
  const flat: Record<string, string> = {}
  for (const row of result.rows) {
    flat[row.key] = row.value
  }
  return flat
}

/** Nested tree for one locale, ready to merge into the file-based overrides
 *  object and hand back from GET /api/i18n/overrides/:lng. */
export async function getOverridesTreeForLocale(locale: string): Promise<Record<string, unknown>> {
  const flat = await getOverridesForLocale(locale)
  return unflattenToTree(flat)
}

/** All override rows, every locale — the admin UI's one bulk load. */
export async function listAllOverrides(): Promise<I18nOverrideRow[]> {
  const result = await query<{ locale: string; key: string; value: string; updated_at: string }>(
    'SELECT locale, key, value, updated_at FROM i18n_overrides ORDER BY key, locale'
  )
  return result.rows.map((row) => ({
    locale: row.locale,
    key: row.key,
    value: row.value,
    updatedAt: row.updated_at,
  }))
}

/** `value === null` or `''` deletes the row (reset to default) and returns `null`.
 *  Otherwise upserts and returns the resulting row. Throws on an invalid locale/key —
 *  callers (the route handlers) are expected to validate first and treat a throw here
 *  as a bug, not bad input. */
export async function upsertOverride(
  locale: string,
  key: string,
  value: string | null
): Promise<I18nOverrideRow | null> {
  if (!isValidAppLocale(locale)) throw new Error(`Invalid locale: ${locale}`)
  if (!isValidOverrideKey(key)) throw new Error(`Invalid override key: ${key}`)

  if (value === null || value === '') {
    await query('DELETE FROM i18n_overrides WHERE locale = $1 AND key = $2', [locale, key])
    return null
  }

  const row = await queryOne<{ locale: string; key: string; value: string; updated_at: string }>(
    `INSERT INTO i18n_overrides (locale, key, value, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (locale, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
     RETURNING locale, key, value, updated_at`,
    [locale, key, value]
  )
  if (!row) throw new Error('Failed to upsert i18n override')
  return { locale: row.locale, key: row.key, value: row.value, updatedAt: row.updated_at }
}

/** Transactional bulk upsert/delete for CSV import. Callers must pre-validate every
 *  entry's locale/key (e.g. via isValidAppLocale/isValidOverrideKey) — this function
 *  trusts its input and is only as safe as that pre-validation. */
export async function bulkUpsertOverrides(items: BulkOverrideInput[]): Promise<BulkOverrideResult> {
  return transaction(async (client) => {
    let upserted = 0
    let deleted = 0
    for (const item of items) {
      if (item.value === null || item.value === '') {
        await client.query('DELETE FROM i18n_overrides WHERE locale = $1 AND key = $2', [
          item.locale,
          item.key,
        ])
        deleted++
      } else {
        await client.query(
          `INSERT INTO i18n_overrides (locale, key, value, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (locale, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [item.locale, item.key, item.value]
        )
        upserted++
      }
    }
    return { upserted, deleted }
  })
}
