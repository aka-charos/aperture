/**
 * Which (title, language) pairs still need a translation, and what text a
 * translation is of — as SQL builders with no database, pinned by
 * `pending.test.ts`.
 *
 * ONE SOURCE EXPRESSION, THREE READERS. The pending count, the job's selection
 * and the detail page's read all ask "what is the source text of this field?"
 * through {@link sourceTextSql}, and a stored row is current only when its
 * `source_hash` equals `md5()` of that same expression. Three copies of the
 * expression would agree until someone trimmed whitespace in one of them — and
 * then every row would read as stale to one reader and current to another, the
 * count-versus-selection drift `enrichment/pending.ts` exists to prevent.
 *
 * ONE LANGUAGE DETECTOR, THE SAME READERS. A text is never translated into the
 * language it is already written in, and that language is decided by ONE SQL
 * function, `aperture_text_language` (migration 0198), through
 * {@link textLanguageSql}: the pending check, the selection (which returns it,
 * so the prompt names the real source language) and the read all call it. A
 * Greek plot is therefore pending into English and never into Greek, and the
 * configured source language is only the FALLBACK for text whose alphabet does
 * not say otherwise.
 */
import { selectedPicksJoinSql } from '../analysis/pending.js'
import { isValidAppLocale, type AppLocaleCode } from '../lib/locales.js'
import { ANALYSIS_TRANSLATION_FIELD, TRANSLATABLE_FIELDS, type TranslatableField } from './rules.js'

const MEDIA_TABLE = { movie: 'movies', series: 'series' } as const

/**
 * The text a field's translation is OF, or NULL when there is nothing to
 * translate.
 *
 * `plot_full` counts only when it is genuinely longer than the overview. OMDb
 * answers `plot=full` with the short blurb whenever IMDb has no long synopsis,
 * so for many titles the two are the same string — and the detail page only
 * offers the long synopsis when it is longer (`hasLongerPlot` in MediaHero).
 * Translating it anyway would spend a call on text nobody can open.
 */
export function sourceTextSql(field: TranslatableField, alias = 'm'): string {
  if (field === 'overview') return `NULLIF(btrim(${alias}.overview), '')`
  return `CASE WHEN NULLIF(btrim(${alias}.plot_full), '') IS NOT NULL
                AND (${alias}.overview IS NULL
                     OR length(btrim(${alias}.plot_full)) > length(btrim(${alias}.overview)))
           THEN btrim(${alias}.plot_full) END`
}

/**
 * A locale code as a SQL literal. Builders interpolate the configured source
 * language rather than binding it (it is one of a fixed set of codes), so it is
 * validated here — anything else throws rather than reaching a query.
 */
export function localeLiteral(code: AppLocaleCode): string {
  if (!isValidAppLocale(code)) throw new Error(`Not an app locale: ${String(code)}`)
  return `'${code}'`
}

/**
 * The language `expr` is written in: its alphabet's when that says (Greek,
 * Cyrillic, Arabic, Devanagari, Hangul, kana, Han), else `fallbackSql` — the
 * configured source language, as {@link localeLiteral} or a bound parameter.
 * The only way any reader asks; see the module comment and migration 0198.
 */
export function textLanguageSql(expr: string, fallbackSql: string): string {
  return `aperture_text_language(${expr}, ${fallbackSql})`
}

/**
 * True when this field of this title has text, is not already written in
 * `langExpr`, and has no translation of exactly that text into it. A missing
 * row and a row of an older source text are the same answer: pending.
 */
export function fieldPendingSql(
  mediaType: 'movie' | 'series',
  field: TranslatableField,
  langExpr: string,
  sourceLanguage: AppLocaleCode,
  alias = 'm'
): string {
  const src = sourceTextSql(field, alias)
  return `(${src} IS NOT NULL
         AND ${langExpr} <> ${textLanguageSql(src, localeLiteral(sourceLanguage))}
         AND NOT EXISTS (
            SELECT 1 FROM title_translations tt
             WHERE tt.media_type = '${mediaType}'
               AND tt.media_id = ${alias}.id
               AND tt.language = ${langExpr}
               AND tt.field = '${field}'
               AND tt.source_hash = md5(${src})))`
}

/**
 * Titles in a library the operator switched off are not translated — the same
 * rule the embedding jobs apply: once any library is configured, only enabled
 * ones count; with none configured, everything does. Series look only at TV
 * library rows, exactly as `recommender/series/embeddings.ts` does, so a movie
 * library's row cannot switch every show off.
 */
export function enabledLibrarySql(mediaType: 'movie' | 'series', alias = 'm'): string {
  const scope = mediaType === 'series' ? ` WHERE collection_type = 'tvshows'` : ''
  return `(NOT EXISTS (SELECT 1 FROM library_config${scope})
           OR EXISTS (SELECT 1 FROM library_config lc
                       WHERE lc.provider_library_id = ${alias}.provider_library_id
                         AND lc.is_enabled = true))`
}

/**
 * FROM/JOIN/WHERE for pending pairs: every title crossed with every target
 * language, kept where any switched-on field is pending. Shared by the count
 * and the selection so the progress bar describes the total the loop reaches.
 *
 * With no field switched on nothing is pending — `FALSE`, not an empty `()`,
 * which would be a syntax error the first time someone unticks both.
 */
export function pendingTranslationsFromSql(
  mediaType: 'movie' | 'series',
  fields: readonly TranslatableField[],
  languagesParam: string,
  sourceLanguage: AppLocaleCode,
  options: { withPicks?: boolean; withFailures?: boolean } = {}
): string {
  const predicate =
    fields.length === 0
      ? 'FALSE'
      : fields.map((f) => fieldPendingSql(mediaType, f, 'lang.code', sourceLanguage)).join('\n       OR ')
  const picks = options.withPicks ? `\n    ${selectedPicksJoinSql(mediaType, 'm')}` : ''
  const failures = options.withFailures ? `\n    ${failedPairJoinSql(mediaType)}` : ''
  return `FROM ${MEDIA_TABLE[mediaType]} m
    CROSS JOIN unnest(${languagesParam}::text[]) AS lang(code)${picks}${failures}
    WHERE (${predicate})
      AND ${enabledLibrarySql(mediaType)}`
}

/**
 * The most recent failure recorded for this (title, language) pair, as
 * `failed.last_failed_at` — NULL when none applies. A failure counts only while
 * its `source_hash` is still the live text's: once the synopsis changes, the
 * pair is a new piece of work and queues as one. The CASE is built from
 * TRANSLATABLE_FIELDS like the read's, so it hashes the expression the pending
 * check hashes.
 */
export function failedPairJoinSql(mediaType: 'movie' | 'series', alias = 'm'): string {
  return `LEFT JOIN LATERAL (
      SELECT MAX(f.last_failed_at) AS last_failed_at
        FROM title_translation_failures f
       WHERE f.media_type = '${mediaType}'
         AND f.media_id = ${alias}.id
         AND f.language = lang.code
         AND f.source_hash = md5(${sourceTextByFieldSql('f.field', alias)})
    ) failed ON true`
}

/**
 * Work order: pairs that have never failed first — titles somebody is being
 * recommended right now, then the newest additions, the same priority title
 * analysis uses — and pairs that failed before LAST, oldest failure first so
 * the tail rotates rather than retrying the same few. Without the failure
 * term a pair that fails on every attempt opened every run, and five of them
 * tripped the job's consecutive-failure stop before anything else was tried.
 * The id and language tail make the order total, so a batch boundary cannot
 * skip or repeat a pair. Requires `withPicks` and `withFailures`.
 */
export function translationPriorityOrderSql(): string {
  return `ORDER BY (failed.last_failed_at IS NOT NULL), failed.last_failed_at ASC NULLS FIRST,
           (picks.id IS NOT NULL) DESC, m.created_at DESC NULLS LAST, m.id, lang.code`
}

/**
 * The columns a selection returns for each field: its source text, that text's
 * hash and the language it is written in, under `<field>_source` /
 * `<field>_hash` / `<field>_language`. Hash and language are computed here, in
 * SQL, from the same expression the pending check uses — the job stores the
 * hash back verbatim and names the language in its prompt, and never works
 * either out itself, so JS and Postgres cannot disagree about them.
 */
export function sourceColumnsSql(
  fields: readonly TranslatableField[],
  sourceLanguage: AppLocaleCode,
  alias = 'm'
): string {
  return fields
    .map((f) => {
      const src = sourceTextSql(f, alias)
      return (
        `${src} AS ${f}_source, md5(${src}) AS ${f}_hash, ` +
        `${textLanguageSql(src, localeLiteral(sourceLanguage))} AS ${f}_language`
      )
    })
    .join(',\n           ')
}

/**
 * The live source text of whichever field `fieldExpr` names, as one CASE built
 * from TRANSLATABLE_FIELDS — so a row keyed by field (a stored translation, a
 * recorded failure) is compared against exactly the expression the pending
 * check uses. A field outside the list (an analysis row) reads as NULL here,
 * which is what keeps it invisible to every synopsis reader.
 */
function sourceTextByFieldSql(fieldExpr: string, alias = 'm'): string {
  return `CASE ${fieldExpr}
                   ${TRANSLATABLE_FIELDS.map((f) => `WHEN '${f}' THEN ${sourceTextSql(f, alias)}`).join('\n                   ')}
                 END`
}

/**
 * The stored translations of one title into one language that are still
 * current — translations of the text the title carries NOW, and never "into"
 * the language that text is already written in (a row left from before
 * languages were detected would otherwise show a Greek reader a paraphrase of
 * the Greek plot as a machine translation). `$1` is the media id, `$2` the
 * language, `$3` the configured source language. Each row also says which
 * language it was translated FROM. The CASE is built from TRANSLATABLE_FIELDS,
 * so a new field is readable the moment it can be written.
 */
export function currentTranslationsSql(mediaType: 'movie' | 'series'): string {
  const src = sourceTextByFieldSql('tt.field')
  return `SELECT tt.field, tt.translated_text, ${textLanguageSql(src, '$3')} AS source_language
            FROM title_translations tt
            JOIN ${MEDIA_TABLE[mediaType]} m ON m.id = tt.media_id
           WHERE tt.media_type = '${mediaType}'
             AND tt.media_id = $1
             AND tt.language = $2
             AND tt.source_hash = md5(${src})
             AND tt.language <> ${textLanguageSql(src, '$3')}`
}

/**
 * The current overview translations of MANY titles into one language — what a
 * poster grid shows on each card. The same three tests as
 * {@link currentTranslationsSql} (the stored text is of the overview the title
 * carries now, and never "into" the language it is already written in), over
 * the overview alone, since a card never shows the long synopsis. `$1` is a
 * uuid array, `$2` the language, `$3` the configured source language.
 */
export function currentOverviewTranslationsSql(mediaType: 'movie' | 'series'): string {
  const src = sourceTextSql('overview')
  return `SELECT tt.media_id, tt.translated_text
            FROM title_translations tt
            JOIN ${MEDIA_TABLE[mediaType]} m ON m.id = tt.media_id
           WHERE tt.media_type = '${mediaType}'
             AND tt.media_id = ANY($1::uuid[])
             AND tt.language = $2
             AND tt.field = 'overview'
             AND tt.source_hash = md5(${src})
             AND tt.language <> ${textLanguageSql(src, '$3')}`
}

// ---------------------------------------------------------------- film analyses

/**
 * The text an analysis translation is OF: the stored analysis, or NULL for a
 * declined row (which has none). Read from `title_analysis`, aliased `ta`.
 *
 * Same contract as {@link sourceTextSql}: the pending check, the job's
 * selection (which returns the hash) and the read all hash THIS expression, so
 * a rewritten analysis hides its old translation at once and is translated
 * again on the next run — no version bump, no sweep.
 */
export function analysisSourceSql(alias = 'ta'): string {
  return `NULLIF(btrim(${alias}.analysis), '')`
}

/**
 * The most recent failure recorded for this analysis × language, as
 * `failed.last_failed_at`, applying only while it is a failure of the text the
 * title carries now. Same shape and alias as {@link failedPairJoinSql}, so the
 * synopsis ORDER BY ({@link translationPriorityOrderSql}) serves both.
 */
export function failedAnalysisJoinSql(mediaType: 'movie' | 'series'): string {
  return `LEFT JOIN LATERAL (
      SELECT f.last_failed_at
        FROM title_translation_failures f
       WHERE f.media_type = '${mediaType}'
         AND f.media_id = ta.media_id
         AND f.language = lang.code
         AND f.field = '${ANALYSIS_TRANSLATION_FIELD}'
         AND f.source_hash = md5(${analysisSourceSql()})
    ) failed ON true`
}

/**
 * FROM/JOIN/WHERE for pending analysis translations: every stored analysis
 * crossed with every target language, kept where there is no translation of
 * exactly this text. Joined to the title so the library switch applies and the
 * order can use the same picks-first priority synopses use. Shared by the count
 * and the selection.
 */
export function pendingAnalysisTranslationsFromSql(
  mediaType: 'movie' | 'series',
  languagesParam: string,
  sourceLanguage: AppLocaleCode,
  options: { withPicks?: boolean; withFailures?: boolean } = {}
): string {
  const src = analysisSourceSql()
  const picks = options.withPicks ? `\n    ${selectedPicksJoinSql(mediaType, 'm')}` : ''
  const failures = options.withFailures ? `\n    ${failedAnalysisJoinSql(mediaType)}` : ''
  return `FROM title_analysis ta
    JOIN ${MEDIA_TABLE[mediaType]} m ON m.id = ta.media_id
    CROSS JOIN unnest(${languagesParam}::text[]) AS lang(code)${picks}${failures}
    WHERE ta.media_type = '${mediaType}'
      AND ${src} IS NOT NULL
      AND lang.code <> ${textLanguageSql(src, localeLiteral(sourceLanguage))}
      AND NOT EXISTS (
            SELECT 1 FROM title_translations tt
             WHERE tt.media_type = '${mediaType}'
               AND tt.media_id = ta.media_id
               AND tt.language = lang.code
               AND tt.field = '${ANALYSIS_TRANSLATION_FIELD}'
               AND tt.source_hash = md5(${src}))
      AND ${enabledLibrarySql(mediaType)}`
}

/**
 * The current translation of one analysis into one language, with the paragraph
 * index it is shown under and the language it was translated from. `$1` media
 * type, `$2` media id, `$3` language, `$4` the configured source language.
 * "Current" means a translation of the analysis the title carries NOW, never
 * into the language it is already written in.
 */
export function currentAnalysisTranslationSql(): string {
  const src = analysisSourceSql()
  return `SELECT tt.translated_text, ta.paragraph_map, ta.analysis,
                 ${textLanguageSql(src, '$4')} AS source_language
            FROM title_translations tt
            JOIN title_analysis ta
              ON ta.media_type = tt.media_type AND ta.media_id = tt.media_id
           WHERE tt.media_type = $1
             AND tt.media_id = $2
             AND tt.language = $3
             AND tt.field = '${ANALYSIS_TRANSLATION_FIELD}'
             AND tt.source_hash = md5(${src})
             AND tt.language <> ${textLanguageSql(src, '$4')}`
}
