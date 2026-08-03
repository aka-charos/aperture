import { useCallback, useEffect, useMemo, useState } from 'react'
import en from '../../../i18n/locales/en/translation.json'
import es from '../../../i18n/locales/es/translation.json'
import de from '../../../i18n/locales/de/translation.json'
import fr from '../../../i18n/locales/fr/translation.json'
import it from '../../../i18n/locales/it/translation.json'
import pt from '../../../i18n/locales/pt/translation.json'
import nl from '../../../i18n/locales/nl/translation.json'
import ru from '../../../i18n/locales/ru/translation.json'
import ja from '../../../i18n/locales/ja/translation.json'
import zh from '../../../i18n/locales/zh/translation.json'
import ko from '../../../i18n/locales/ko/translation.json'
import hi from '../../../i18n/locales/hi/translation.json'
import ar from '../../../i18n/locales/ar/translation.json'
import he from '../../../i18n/locales/he/translation.json'
import el from '../../../i18n/locales/el/translation.json'
import enOverrides from '../../../i18n/overrides.en.json'
import { flattenTranslation, type TranslationTree } from '../../../i18n/flatten'

export interface LocaleOption {
  code: string
  label: string
}

const BUNDLED_TREES: Record<string, TranslationTree> = {
  en: en as TranslationTree,
  es: es as TranslationTree,
  de: de as TranslationTree,
  fr: fr as TranslationTree,
  it: it as TranslationTree,
  pt: pt as TranslationTree,
  nl: nl as TranslationTree,
  ru: ru as TranslationTree,
  ja: ja as TranslationTree,
  zh: zh as TranslationTree,
  ko: ko as TranslationTree,
  hi: hi as TranslationTree,
  ar: ar as TranslationTree,
  he: he as TranslationTree,
  el: el as TranslationTree,
}

let cachedDefaults: Record<string, Record<string, string>> | null = null

/**
 * Bundled default strings (build-time layers only: translation.json, plus
 * apps/web's own overrides.en.json for en) — NOT what a real user sees at
 * runtime (that also includes the operator file layer and DB overrides).
 * This is the baseline "Reset to default" reverts to.
 *
 * Deliberately imports the locale JSON directly rather than reading the live
 * i18next instance, so this stays correct independent of i18next's internal
 * state (init order, which locales have been activated this session, etc).
 * This only stays pristine because i18n/config.ts clones each locale tree
 * before handing it to i18next.init() — addResourceBundle(..., true, true)
 * (used by applyRuntimeOverrides) mutates its stored resource object in
 * place, and JSON module imports are singletons, so an unlocked clone there
 * would corrupt the same object this file imports.
 */
export function getBundledDefaults(): Record<string, Record<string, string>> {
  if (cachedDefaults) return cachedDefaults
  const result: Record<string, Record<string, string>> = {}
  for (const [locale, tree] of Object.entries(BUNDLED_TREES)) {
    const flat = flattenTranslation(tree)
    if (locale === 'en') {
      Object.assign(flat, flattenTranslation(enOverrides as TranslationTree))
    }
    result[locale] = flat
  }
  cachedDefaults = result
  return result
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

  const defaults = useMemo(() => getBundledDefaults(), [])
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
      const [localesRes] = await Promise.all([
        fetch('/api/settings/locales', { credentials: 'include' }),
        fetchOverrides(),
      ])
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
