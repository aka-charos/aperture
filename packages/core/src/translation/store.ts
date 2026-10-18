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
import {
  currentAnalysisTranslationSql,
  currentOverviewTranslationsSql,
  currentTranslationsSql,
  pendingAnalysisTranslationsFromSql,
  pendingTranslationsFromSql,
} from './pending.js'
import { analysisParagraphs } from './analysisText.js'
import { buildAnalysisSegments, type AnalysisSegment } from '../analysis/segments.js'
import type { ParagraphMap } from '../analysis/paragraphMap.js'
import {
  ANALYSIS_TRANSLATION_FIELD,
  enabledFields,
  isTranslatableField,
  resolveTranslationLanguages,
  type TranslatableField,
  type TranslationConfig,
  type TranslationField,
  type TranslationKind,
} from './rules.js'

const logger = createChildLogger('translation-store')

export interface StoredTranslation {
  mediaType: 'movie' | 'series'
  mediaId: string
  language: AppLocaleCode
  field: TranslationField
  /** md5 of the source exactly as selected — from SQL, never computed here. */
  sourceHash: string
  text: string
  model: string
}

/**
 * Store a translation. The same statement deletes any failure recorded for
 * this field, so a pair that finally translates leaves the back of the queue
 * in the write that proves it can.
 */
export async function storeTranslation(row: StoredTranslation): Promise<void> {
  await query(
    `WITH cleared AS (
       DELETE FROM title_translation_failures
        WHERE media_type = $1 AND media_id = $2 AND language = $3 AND field = $4
     )
     INSERT INTO title_translations
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
 * Record that a field failed, which moves its pair to the back of every later
 * run's queue (`translationPriorityOrderSql`). The count restarts when the
 * source text is not the one that failed before. Never throws: the failure is
 * already being reported, and losing this record only costs the ordering.
 */
export async function recordTranslationFailure(row: {
  mediaType: 'movie' | 'series'
  mediaId: string
  language: AppLocaleCode
  field: TranslationField
  sourceHash: string
  error: string
}): Promise<void> {
  try {
    await query(
      `INSERT INTO title_translation_failures
         (media_type, media_id, language, field, source_hash, last_error)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (media_type, media_id, language, field) DO UPDATE
         SET failures = CASE WHEN title_translation_failures.source_hash = EXCLUDED.source_hash
                             THEN title_translation_failures.failures + 1 ELSE 1 END,
             first_failed_at = CASE WHEN title_translation_failures.source_hash = EXCLUDED.source_hash
                                    THEN title_translation_failures.first_failed_at ELSE NOW() END,
             source_hash = EXCLUDED.source_hash,
             last_error = EXCLUDED.last_error,
             last_failed_at = NOW()`,
      [row.mediaType, row.mediaId, row.language, row.field, row.sourceHash, row.error.slice(0, 1000)]
    )
  } catch (err) {
    logger.warn({ err, ...row }, 'Could not record a failed synopsis translation')
  }
}

/**
 * What the detail page shows in place of the original: the current
 * translations of one title into one language, or null when there are none.
 * `plot_full` is null when only the overview has been translated, and the page
 * then shows the original long synopsis under its own caption.
 */
export interface LocalizedSynopsis {
  language: AppLocaleCode
  /**
   * What was translated FROM — the overview's language when it was translated,
   * else the full synopsis's. They can differ: a Greek film's plot can arrive
   * from the media server in Greek while its IMDb synopsis is English.
   */
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
 * viewer's effective UI language. A reader in the configured source language
 * is asked like everyone else: a Greek plot has an English translation for
 * them, and the SQL never returns a "translation" into the language a text is
 * already written in, so an English plot simply has none.
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

    const rows = await query<{ field: string; translated_text: string; source_language: string }>(
      currentTranslationsSql(mediaType),
      [mediaId, language, config.sourceLanguage]
    )
    if (rows.rows.length === 0) return null

    const result: LocalizedSynopsis = {
      language,
      source_language: config.sourceLanguage,
      overview: null,
      plot_full: null,
    }
    const from: Partial<Record<TranslatableField, AppLocaleCode>> = {}
    for (const row of rows.rows) {
      if (!isTranslatableField(row.field)) continue
      result[row.field] = row.translated_text
      if (isValidAppLocale(row.source_language)) from[row.field] = row.source_language
    }
    result.source_language = from.overview ?? from.plot_full ?? config.sourceLanguage
    return result.overview || result.plot_full ? result : null
  } catch (err) {
    logger.warn({ err, mediaType, mediaId }, 'Could not read synopsis translations; showing the original')
    return null
  }
}

/**
 * The translated overviews of the cards on a page: id → text per media type,
 * with a title that has no current translation simply absent (the card then
 * shows its original). Same language rule and same NEVER-THROWS contract as
 * {@link resolveLocalizedSynopsis} — a grid must not fail over an optional
 * caption — and the ids must already be validated uuids the viewer may see.
 */
export async function resolveLocalizedOverviews(
  ids: { movie: readonly string[]; series: readonly string[] },
  requested: string | null | undefined,
  userId: string
): Promise<{ movies: Record<string, string>; series: Record<string, string> }> {
  const result = { movies: {} as Record<string, string>, series: {} as Record<string, string> }
  if (ids.movie.length === 0 && ids.series.length === 0) return result
  try {
    const config = await getTranslationConfig()
    const language = isValidAppLocale(requested) ? requested : await resolveEffectiveUiLanguage(userId)
    const read = async (mediaType: 'movie' | 'series', list: readonly string[], into: Record<string, string>) => {
      if (list.length === 0) return
      const rows = await query<{ media_id: string; translated_text: string }>(
        currentOverviewTranslationsSql(mediaType),
        [list, language, config.sourceLanguage]
      )
      for (const row of rows.rows) {
        if (row.translated_text) into[row.media_id] = row.translated_text
      }
    }
    await Promise.all([read('movie', ids.movie, result.movies), read('series', ids.series, result.series)])
    return result
  } catch (err) {
    logger.warn(
      { err, movies: ids.movie.length, series: ids.series.length },
      'Could not read overview translations; showing the originals'
    )
    return { movies: {}, series: {} }
  }
}

/**
 * The localized analysis for a viewer: the translated text cut into the same
 * labelled sections as the original, or null when there is none.
 *
 * THE ORIGINAL'S PARAGRAPH INDEX IS REUSED, and that is only sound because the
 * job never stores a translation with a different paragraph count
 * (`translateAnalysisText`). It is checked again here anyway: a translation
 * stored by anything else, or a count that somehow disagrees, is shown as one
 * unlabelled run rather than with headings over the wrong prose.
 *
 * Same contract as {@link resolveLocalizedSynopsis}: `requested` is the
 * language the page is displayed in, there is never a translation into the
 * language the analysis is already in, and it NEVER THROWS — an optional
 * translation must not cost a reader the analysis.
 */
export interface LocalizedAnalysis {
  language: AppLocaleCode
  source_language: AppLocaleCode
  text: string
  paragraphs: AnalysisSegment[]
}

export async function resolveLocalizedAnalysis(
  mediaType: 'movie' | 'series',
  mediaId: string,
  requested: string | null | undefined,
  userId: string
): Promise<LocalizedAnalysis | null> {
  try {
    const config = await getTranslationConfig()
    const language = isValidAppLocale(requested) ? requested : await resolveEffectiveUiLanguage(userId)

    const rows = await query<{
      translated_text: string
      paragraph_map: ParagraphMap | null
      analysis: string
      source_language: string
    }>(currentAnalysisTranslationSql(), [mediaType, mediaId, language, config.sourceLanguage])
    const row = rows.rows[0]
    if (!row?.translated_text) return null
    const sameShape =
      analysisParagraphs(row.translated_text).length === analysisParagraphs(row.analysis).length
    return {
      language,
      source_language: isValidAppLocale(row.source_language) ? row.source_language : config.sourceLanguage,
      text: row.translated_text,
      paragraphs: buildAnalysisSegments(row.translated_text, sameShape ? row.paragraph_map : null),
    }
  } catch (err) {
    logger.warn({ err, mediaType, mediaId }, 'Could not read the analysis translation; showing the original')
    return null
  }
}

export interface TranslationLanguageStatus {
  language: AppLocaleCode
  /** Title × language pairs still needing at least one field. */
  pendingMovies: number
  pendingSeries: number
  /** Stored synopsis rows (fields), current or not. */
  storedMovies: number
  storedSeries: number
  /** Analyses still needing a translation into this language. */
  analysisPendingMovies: number
  analysisPendingSeries: number
  /** Stored analysis translations, current or not. */
  analysisStoredMovies: number
  analysisStoredSeries: number
}

/** Pending pairs per language for one media type, from the job's own predicate. */
export async function countPendingByLanguage(
  mediaType: 'movie' | 'series',
  fields: readonly TranslatableField[],
  languages: readonly AppLocaleCode[],
  sourceLanguage: AppLocaleCode
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (languages.length === 0 || fields.length === 0) return counts
  const rows = await query<{ code: string; count: string }>(
    `SELECT lang.code AS code, COUNT(*)::text AS count
     ${pendingTranslationsFromSql(mediaType, fields, '$1', sourceLanguage)}
     GROUP BY lang.code`,
    [languages]
  )
  for (const row of rows.rows) counts.set(row.code, Number.parseInt(row.count, 10))
  return counts
}

/** Pending analysis translations per language for one media type, from the job's own predicate. */
export async function countPendingAnalysesByLanguage(
  mediaType: 'movie' | 'series',
  languages: readonly AppLocaleCode[],
  sourceLanguage: AppLocaleCode
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (languages.length === 0) return counts
  const rows = await query<{ code: string; count: string }>(
    `SELECT lang.code AS code, COUNT(*)::text AS count
     ${pendingAnalysisTranslationsFromSql(mediaType, '$1', sourceLanguage)}
     GROUP BY lang.code`,
    [languages]
  )
  for (const row of rows.rows) counts.set(row.code, Number.parseInt(row.count, 10))
  return counts
}

/**
 * Pending and stored per target language, for synopses and analyses — and per
 * language that holds rows but is no longer a target, so translations left
 * behind by a removed language are visible (and clearable) rather than silent.
 */
export async function getTranslationStatus(config?: TranslationConfig): Promise<{
  targets: AppLocaleCode[]
  languages: TranslationLanguageStatus[]
}> {
  const cfg = config ?? (await getTranslationConfig())
  const { enabledUiLanguages } = await getSystemLanguageDefaults()
  // The source language is in here: a Greek plot is pending into English.
  const targets = resolveTranslationLanguages(cfg, enabledUiLanguages)
  const fields = enabledFields(cfg)
  const source = cfg.sourceLanguage

  const [pendingMovies, pendingSeries, analysisMovies, analysisSeries, stored] = await Promise.all([
    countPendingByLanguage('movie', fields, targets, source),
    countPendingByLanguage('series', fields, targets, source),
    countPendingAnalysesByLanguage('movie', targets, source),
    countPendingAnalysesByLanguage('series', targets, source),
    query<{ language: string; media_type: string; is_analysis: boolean; count: string }>(
      `SELECT language, media_type, (field = $1) AS is_analysis, COUNT(*)::text AS count
         FROM title_translations GROUP BY language, media_type, (field = $1)`,
      [ANALYSIS_TRANSLATION_FIELD]
    ),
  ])

  type Stored = { movie: number; series: number; analysisMovie: number; analysisSeries: number }
  const storedBy = new Map<string, Stored>()
  for (const row of stored.rows) {
    const entry = storedBy.get(row.language) ?? { movie: 0, series: 0, analysisMovie: 0, analysisSeries: 0 }
    const n = Number.parseInt(row.count, 10)
    if (row.media_type === 'movie') entry[row.is_analysis ? 'analysisMovie' : 'movie'] = n
    if (row.media_type === 'series') entry[row.is_analysis ? 'analysisSeries' : 'series'] = n
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
      analysisPendingMovies: analysisMovies.get(language) ?? 0,
      analysisPendingSeries: analysisSeries.get(language) ?? 0,
      analysisStoredMovies: storedBy.get(language)?.analysisMovie ?? 0,
      analysisStoredSeries: storedBy.get(language)?.analysisSeries ?? 0,
    })),
  }
}

/**
 * Forget stored translations of ONE KIND — one language, or all of them.
 * Returns rows removed. Per kind because the two share a table and a card:
 * clearing synopses must never take the analyses with it (each analysis is
 * many paced requests to rebuild), nor the reverse.
 */
export async function clearTranslations(
  language?: AppLocaleCode,
  kind: TranslationKind = 'synopsis'
): Promise<number> {
  const fieldClause = kind === 'analysis' ? 'field = $1' : 'field <> $1'
  const params: unknown[] = [ANALYSIS_TRANSLATION_FIELD]
  const languageClause = language ? ` AND language = $2` : ''
  if (language) params.push(language)
  // Failure records go too: after a clear the pairs start over, and keeping
  // them would queue those titles last for a reason nobody can see any more.
  await query(`DELETE FROM title_translation_failures WHERE ${fieldClause}${languageClause}`, params)
  const result = await query(`DELETE FROM title_translations WHERE ${fieldClause}${languageClause}`, params)
  logger.info(
    { language: language ?? 'all', kind, cleared: result.rowCount },
    'Cleared stored translations'
  )
  return result.rowCount ?? 0
}
