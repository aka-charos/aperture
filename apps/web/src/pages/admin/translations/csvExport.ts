import Papa from 'papaparse'
import type { LocaleOption } from './useTranslationCatalog'

/**
 * One wide CSV: row = key, columns = key + every locale code (en first). With
 * `onlyLocale`, the columns are key, en and that locale — what one translator
 * needs. The import reads any set of locale columns, so either file goes back
 * in unchanged.
 */
export function buildOverridesCsv(
  locales: LocaleOption[],
  keys: string[],
  effective: Record<string, Record<string, string>>,
  onlyLocale: string | null = null
): string {
  const en = locales.find((l) => l.code === 'en')
  const rest = locales.filter((l) => l.code !== 'en' && (onlyLocale === null || l.code === onlyLocale))
  const orderedLocales = en ? [en, ...rest] : rest

  const fields = ['key', ...orderedLocales.map((l) => l.code)]
  const data = keys.map((key) => {
    const row: Record<string, string> = { key }
    for (const locale of orderedLocales) {
      row[locale.code] = effective[locale.code]?.[key] ?? ''
    }
    return row
  })

  return Papa.unparse({ fields, data })
}

export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
