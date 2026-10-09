/**
 * Reading and writing `title_translations`, and the per-language status the
 * settings card shows. Every predicate comes from ./pending.ts.
 */
import { query } from '../lib/db.js'
import { createChildLogger } from '../lib/logger.js'
import { isValidAppLocale, type AppLocaleCode } from '../lib/locales.js'
import { resolveEffectiveUiLanguage } from '../lib/userSettings.js'
import { getSystemLanguageDefaults } from '../settings/systemSettings.js'
import { getTranslationConfig } from './client.js'
import { currentTranslationsSql, pendingTranslationsFromSql } from './pending.js'
import {
  enabledFields,
  isTranslatableField,
  resolveTargetLanguages,
  type TranslatableField,
  type TranslationConfig,
} from './rules.js'

const logger = createChildLogger('translation-store')

export interface StoredTranslation {
  mediaType: 'movie' | 'series'
  mediaId: string
  language: AppLocaleCode
  field: TranslatableField
  /** md5 of the source exactly as selected — from SQL, never computed here. */
  sourceHash: string
  text: string
  model: string
}

export async function storeTranslation(row: StoredTranslation): Promise<void> {
  await query(
    `INSERT INTO title_translations
       (media_type, media_id, language, field, source_hash, translated_text, model)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (media_type, media_id, language, field) DO UPDATE
       SET source_hash = EXCLUDED.source_hash,
           translated_text = EXCLUDED.translated_text,
           model = EXCLUDED.model,
           updated_at = NOW()`,
    [row.mediaType, row.mediaId, row.language, row.field, row.sourceHash, row.text, row.model]
  )
}

/**
 * What the detail page shows in place of the original: the current
 * translations of one title into one language, or null when there are none.
 * `plot_full` is null when only the overview has been translated, and the page
 * then shows the original long synopsis under its own caption.
 */
export interface LocalizedSynopsis {
  language: AppLocaleCode
  source_language: AppLocaleCode
  overview: string | null
  plot_full: string | null
}

/**
 * The localized synopsis for a viewer.
 *
 * `requested` is the language the page is DISPLAYED in, which the client sends
 * because only it knows (a browser-detected language may differ from the
 * stored preference). Anything that is not a valid app locale falls back to the
 * viewer's effective UI language. The source language answers null at once —
 * there is nothing to swap.
 *
 * NEVER THROWS. A detail page must not fail over an optional caption: a
 * missing table on a half-migrated instance, or any read error, is logged and
 * answers null, which renders the original text exactly as before.
 */
export async function resolveLocalizedSynopsis(
  mediaType: 'movie' | 'series',
  mediaId: string,
  requested: string | null | undefined,
  userId: string
): Promise<LocalizedSynopsis | null> {
  try {
    const config = await getTranslationConfig()
    const language = isValidAppLocale(requested) ? requested : await resolveEffectiveUiLanguage(userId)
    if (language === config.sourceLanguage) return null

    const rows = await query<{ field: string; translated_text: string }>(
      currentTranslationsSql(mediaType),
      [mediaId, language]
    )
    if (rows.rows.length === 0) return null

    const result: LocalizedSynopsis = {
      language,
      source_language: config.sourceLanguage,
      overview: null,
      plot_full: null,
    }
    for (const row of rows.rows) {
      if (isTranslatableField(row.field)) result[row.field] = row.translated_text
    }
    return result.overview || result.plot_full ? result : null
  } catch (err) {
    logger.warn({ err, mediaType, mediaId }, 'Could not read synopsis translations; showing the original')
    return null
  }
}

export interface TranslationLanguageStatus {
  language: AppLocaleCode
  /** Title × language pairs still needing at least one field. */
  pendingMovies: number
  pendingSeries: number
  /** Stored rows (fields), current or not. */
  storedMovies: number
  storedSeries: number
}

/** Pending pairs per language for one media type, from the job's own predicate. */
export async function countPendingByLanguage(
  mediaType: 'movie' | 'series',
  fields: readonly TranslatableField[],
  languages: readonly AppLocaleCode[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (languages.length === 0 || fields.length === 0) return counts
  const rows = await query<{ code: string; count: string }>(
    `SELECT lang.code AS code, COUNT(*)::text AS count
     ${pendingTranslationsFromSql(mediaType, fields, '$1')}
     GROUP BY lang.code`,
    [languages]
  )
  for (const row of rows.rows) counts.set(row.code, Number.parseInt(row.count, 10))
  return counts
}

/**
 * Pending and stored per target language — and per language that holds rows
 * but is no longer a target, so translations left behind by a removed language
 * are visible (and clearable) rather than silent.
 */
export async function getTranslationStatus(config?: TranslationConfig): Promise<{
  targets: AppLocaleCode[]
  languages: TranslationLanguageStatus[]
}> {
  const cfg = config ?? (await getTranslationConfig())
  const { enabledUiLanguages } = await getSystemLanguageDefaults()
  const targets = resolveTargetLanguages(cfg, enabledUiLanguages)
  const fields = enabledFields(cfg)

  const [pendingMovies, pendingSeries, stored] = await Promise.all([
    countPendingByLanguage('movie', fields, targets),
    countPendingByLanguage('series', fields, targets),
    query<{ language: string; media_type: string; count: string }>(
      `SELECT language, media_type, COUNT(*)::text AS count
         FROM title_translations GROUP BY language, media_type`
    ),
  ])

  const storedBy = new Map<string, { movie: number; series: number }>()
  for (const row of stored.rows) {
    const entry = storedBy.get(row.language) ?? { movie: 0, series: 0 }
    if (row.media_type === 'movie' || row.media_type === 'series') {
      entry[row.media_type] = Number.parseInt(row.count, 10)
    }
    storedBy.set(row.language, entry)
  }

  const languages = new Set<string>([...targets, ...storedBy.keys()])
  return {
    targets,
    languages: [...languages].filter(isValidAppLocale).map((language) => ({
      language,
      pendingMovies: pendingMovies.get(language) ?? 0,
      pendingSeries: pendingSeries.get(language) ?? 0,
      storedMovies: storedBy.get(language)?.movie ?? 0,
      storedSeries: storedBy.get(language)?.series ?? 0,
    })),
  }
}

/** Forget stored translations — one language, or all of them. Returns rows removed. */
export async function clearTranslations(language?: AppLocaleCode): Promise<number> {
  const result = language
    ? await query('DELETE FROM title_translations WHERE language = $1', [language])
    : await query('DELETE FROM title_translations')
  logger.info({ language: language ?? 'all', cleared: result.rowCount }, 'Cleared synopsis translations')
  return result.rowCount ?? 0
}
