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
 */
import { selectedPicksJoinSql } from '../analysis/pending.js'
import { TRANSLATABLE_FIELDS, type TranslatableField } from './rules.js'

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
 * True when this field of this title has text and no translation of exactly
 * that text into `langExpr`. A missing row and a row of an older source text
 * are the same answer: pending.
 */
export function fieldPendingSql(
  mediaType: 'movie' | 'series',
  field: TranslatableField,
  langExpr: string,
  alias = 'm'
): string {
  const src = sourceTextSql(field, alias)
  return `(${src} IS NOT NULL AND NOT EXISTS (
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
  options: { withPicks?: boolean; withFailures?: boolean } = {}
): string {
  const predicate =
    fields.length === 0
      ? 'FALSE'
      : fields.map((f) => fieldPendingSql(mediaType, f, 'lang.code')).join('\n       OR ')
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
         AND f.source_hash = md5(CASE f.field
               ${TRANSLATABLE_FIELDS.map((f) => `WHEN '${f}' THEN ${sourceTextSql(f, alias)}`).join('\n               ')}
             END)
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
 * The columns a selection returns for each field: its source text and that
 * text's hash, under `<field>_source` / `<field>_hash`. The hash is computed
 * here, in SQL, from the same expression the pending check hashes — the job
 * stores it back verbatim and never hashes anything itself, so a JS/Postgres
 * disagreement about encoding cannot arise.
 */
export function sourceColumnsSql(fields: readonly TranslatableField[], alias = 'm'): string {
  return fields
    .map((f) => {
      const src = sourceTextSql(f, alias)
      return `${src} AS ${f}_source, md5(${src}) AS ${f}_hash`
    })
    .join(',\n           ')
}

/**
 * The stored translations of one title into one language that are still
 * current — translations of the text the title carries NOW. `$1` is the media
 * id and `$2` the language. The CASE is built from TRANSLATABLE_FIELDS, so a
 * new field is readable the moment it can be written.
 */
export function currentTranslationsSql(mediaType: 'movie' | 'series'): string {
  return `SELECT tt.field, tt.translated_text
            FROM title_translations tt
            JOIN ${MEDIA_TABLE[mediaType]} m ON m.id = tt.media_id
           WHERE tt.media_type = '${mediaType}'
             AND tt.media_id = $1
             AND tt.language = $2
             AND tt.source_hash = md5(CASE tt.field
                   ${TRANSLATABLE_FIELDS.map((f) => `WHEN '${f}' THEN ${sourceTextSql(f)}`).join('\n                   ')}
                 END)`
}
