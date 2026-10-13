/**
 * What the Translations table shows and what an inline edit saves. Pure, so
 * the rules are pinned by a test rather than living inside the page — the
 * table, the CSV export and the inline cell all read them, and an export
 * that disagreed with the table is what the export exists to prevent.
 */

export interface CatalogFilter {
  /** Lower-cased, trimmed search text; empty matches everything. */
  query: string
  /** A key-prefix namespace, or null for every namespace. */
  namespace: string | null
  /** One locale to work in, or null for all of them. */
  locale: string | null
  onlyOverridden: boolean
  /** Only keys whose text in `locale` still reads as the English. Ignored
   *  without a locale, since "untranslated" is a question about one. */
  onlyUntranslated: boolean
}

export interface CatalogFilterData {
  english: Record<string, string>
  effective: Record<string, Record<string, string>>
  overrides: Record<string, Record<string, string>>
}

/**
 * A string is untranslated when it is empty or still reads exactly as the
 * English. Some strings legitimately equal the English (a product name, "OK"),
 * so this is a worklist, not a verdict — which is why the page calls it
 * "same as English" rather than "untranslated".
 */
export function isUntranslated(englishValue: string, localeValue: string | undefined): boolean {
  const value = localeValue ?? ''
  return value.trim() === '' || value === englishValue
}

export function keyMatchesFilter(key: string, filter: CatalogFilter, data: CatalogFilterData): boolean {
  const { query, namespace, locale, onlyOverridden, onlyUntranslated } = filter
  if (namespace !== null && !key.startsWith(`${namespace}.`)) return false

  if (onlyOverridden) {
    // With a language chosen, "overridden" means overridden in THAT language;
    // a key overridden only in Japanese is not on a Greek translator's list.
    const overridden =
      locale !== null
        ? data.overrides[locale]?.[key] !== undefined
        : Object.values(data.overrides).some((byKey) => key in byKey)
    if (!overridden) return false
  }

  const english = data.english[key] ?? ''
  const localeValue = locale !== null ? data.effective[locale]?.[key] : undefined
  if (locale !== null && onlyUntranslated && !isUntranslated(english, localeValue)) return false

  if (query) {
    const haystacks = [key, english]
    if (localeValue !== undefined) haystacks.push(localeValue)
    if (!haystacks.some((text) => text.toLowerCase().includes(query))) return false
  }
  return true
}

export type InlineSave =
  /** Nothing to send: the text did not change, or it changed back to the
   *  bundled default with no override standing. */
  | { kind: 'none' }
  /** Delete the override, so the bundled default shows again. */
  | { kind: 'reset' }
  | { kind: 'save'; value: string }

/**
 * The Edit dialog's rule, shared: typing the bundled default back is a reset
 * rather than an override that happens to equal it (which would then stop
 * following a corrected default), and clearing the box is a reset too.
 */
export function decideInlineSave(input: {
  draft: string
  current: string
  bundledDefault: string
  hasOverride: boolean
}): InlineSave {
  const { draft, current, bundledDefault, hasOverride } = input
  if (draft === current) return { kind: 'none' }
  if (draft.trim() === '' || draft === bundledDefault) {
    return hasOverride ? { kind: 'reset' } : { kind: 'none' }
  }
  return { kind: 'save', value: draft }
}
