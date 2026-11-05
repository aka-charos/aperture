import { useCallback, useEffect, useMemo, useState } from 'react'
import en from '../../../i18n/locales/en/translation.json'
import enOverrides from '../../../i18n/overrides.en.json'
import { flattenTranslation, type TranslationTree } from '../../../i18n/flatten'
import { LAZY_LOCALES, loadLocaleTree } from '../../../i18n/localeLoaders'

export interface LocaleOption {
  code: string
  label: string
}

type FlatStrings = Record<string, Record<string, string>>

/** English, which is in the entry chunk anyway, so the key list is there at once. */
function englishDefaults(): FlatStrings {
  return {
    en: {
      ...flattenTranslation(en as TranslationTree),
      ...flattenTranslation(enOverrides as TranslationTree),
    },
  }
}

let defaultsLoad: Promise<FlatStrings> | null = null

/**
 * Bundled default strings (build-time layers only: translation.json, plus
 * apps/web's own overrides.en.json for en) — NOT what a real user sees at
 * runtime (that also includes the operator file layer and DB overrides).
 * This is the baseline "Reset to default" reverts to.
 *
 * Fetches every locale chunk, so only the editors ask, and once per tab; a failed
 * load is not kept, so opening the page again retries.
 *
 * Deliberately reads the locale files rather than the live i18next instance, so
 * this stays correct independent of i18next's internal state (which locales have
 * been activated this session, etc). This only stays pristine because i18next
 * never holds these objects: config.ts and the locale backend clone what they
 * hand it, since addResourceBundle(..., true, true) (used for the runtime
 * overrides) mutates its stored object in place, and JSON modules are singletons.
 */
export function loadBundledDefaults(): Promise<FlatStrings> {
  defaultsLoad ??= (async () => {
    const result = englishDefaults()
    await Promise.all(
      LAZY_LOCALES.map(async (locale) => {
        const tree = await loadLocaleTree(locale)
        if (tree) result[locale] = flattenTranslation(tree)
      })
    )
    return result
  })().catch((err: unknown) => {
    defaultsLoad = null
    throw err
  })
  return defaultsLoad
}

interface AdminOverrideRow {
  locale: string
  key: string
  value: string
  updatedAt: string
}

export interface TranslationCatalog {
  loading: boolean
  error: string | null
  locales: LocaleOption[]
  defaults: Record<string, Record<string, string>>
  overrides: Record<string, Record<string, string>>
  effective: Record<string, Record<string, string>>
  keys: string[]
  namespaces: string[]
  refetchOverrides: () => Promise<void>
  saveOverride: (locale: string, key: string, value: string | null) => Promise<void>
}

function buildEffective(
  defaults: Record<string, Record<string, string>>,
  overrides: Record<string, Record<string, string>>
): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {}
  for (const locale of Object.keys(defaults)) {
    result[locale] = { ...defaults[locale], ...(overrides[locale] || {}) }
  }
  return result
}

export function useTranslationCatalog(): TranslationCatalog {
  const [locales, setLocales] = useState<LocaleOption[]>([])
  const [overrides, setOverrides] = useState<Record<string, Record<string, string>>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [defaults, setDefaults] = useState<FlatStrings>(englishDefaults)
  const keys = useMemo(() => Object.keys(defaults.en || {}), [defaults])
  const namespaces = useMemo(
    () => [...new Set(keys.map((key) => key.split('.')[0]))].sort(),
    [keys]
  )

  const fetchOverrides = useCallback(async () => {
    const res = await fetch('/api/i18n/admin/overrides', { credentials: 'include' })
    if (!res.ok) throw new Error('Failed to load translation overrides')
    const data: { overrides: AdminOverrideRow[] } = await res.json()
    const grouped: Record<string, Record<string, string>> = {}
    for (const row of data.overrides) {
      if (!grouped[row.locale]) grouped[row.locale] = {}
      grouped[row.locale][row.key] = row.value
    }
    setOverrides(grouped)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [localesRes, bundled] = await Promise.all([
        fetch('/api/settings/locales', { credentials: 'include' }),
        loadBundledDefaults(),
        fetchOverrides(),
      ])
      setDefaults(bundled)
      if (localesRes.ok) {
        const data = await localesRes.json()
        setLocales(data.locales || [])
      }
    } catch {
      setError('translationsFailedToLoad')
    } finally {
      setLoading(false)
    }
  }, [fetchOverrides])

  useEffect(() => {
    void load()
  }, [load])

  const saveOverride = useCallback(async (locale: string, key: string, value: string | null) => {
    const res = await fetch(`/api/i18n/admin/overrides/${encodeURIComponent(locale)}/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ value }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as { error?: string }).error || 'Failed to save translation override')
    }
    setOverrides((prev) => {
      const next = { ...prev, [locale]: { ...(prev[locale] || {}) } }
      if (value === null || value === '') {
        delete next[locale][key]
      } else {
        next[locale][key] = value
      }
      return next
    })
  }, [])

  const effective = useMemo(() => buildEffective(defaults, overrides), [defaults, overrides])

  return {
    loading,
    error,
    locales,
    defaults,
    overrides,
    effective,
    keys,
    namespaces,
    refetchOverrides: fetchOverrides,
    saveOverride,
  }
}
