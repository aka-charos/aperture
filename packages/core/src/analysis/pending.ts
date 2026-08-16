/**
 * Which titles still need a grounded analysis pass, and in what order.
 *
 * Split out so it can be tested without a database, the same way
 * `enrichment/pending.ts` and `watchedExclusion.ts` are — and for the same
 * reason those exist. The enrichment predicate once lived in four places, two
 * counts and two selections, and they agreed only by being wrong identically:
 * the progress counter said nothing was pending and the selection returned
 * nothing, in perfect agreement, so nothing looked broken. One definition here,
 * used by both the count and the selection, or the job's progress bar will
 * describe a total the loop never reaches.
 */

/** Table and id column for each media type. */
const MEDIA_TABLE = { movie: 'movies', series: 'series' } as const

export interface AnalysisSqlAliases {
  /** Alias for the movies/series row. */
  media: string
  /** Alias for the joined title_analysis row. */
  analysis: string
}

const DEFAULT_ALIASES: AnalysisSqlAliases = { media: 'm', analysis: 'ta' }

/**
 * The LEFT JOIN a pending query needs. Paired with {@link needsAnalysisSql} so
 * the predicate and the join it depends on cannot drift apart at two call
 * sites. `media_type` is fixed here rather than in the predicate because it
 * belongs to the join condition — putting it in the WHERE clause would turn the
 * outer join into an inner one and silently drop every never-analysed title,
 * which is the exact set the query exists to find.
 */
export function analysisJoinSql(
  mediaType: 'movie' | 'series',
  aliases: AnalysisSqlAliases = DEFAULT_ALIASES
): string {
  return `LEFT JOIN title_analysis ${aliases.analysis}
              ON ${aliases.analysis}.media_id = ${aliases.media}.id
             AND ${aliases.analysis}.media_type = '${mediaType}'`
}

/**
 * A title is pending when we have never asked about it, or when we asked with
 * an older prompt.
 *
 * Note what is deliberately NOT here: a row whose `analysis` is NULL is a
 * DECLINE, not a gap. The model was asked and answered "there is nothing
 * substantive to say", or the web had too little to ground on, and re-asking
 * every pass would spend grounded requests to receive the same answer forever.
 * Declines clear when `ANALYSIS_PROMPT_VERSION` is bumped — exactly the
 * situation where re-asking is worth paying for.
 *
 * A transport failure (429, 5xx, timeout) writes no row at all, so it falls
 * into the first clause and retries on the next run. That split — the attempt
 * recorded distinctly from its result — is the whole point of the table shape.
 */
export function needsAnalysisSql(
  versionParam: string,
  aliases: AnalysisSqlAliases = DEFAULT_ALIASES
): string {
  return `(${aliases.analysis}.media_id IS NULL OR ${aliases.analysis}.prompt_version < ${versionParam})`
}

/**
 * The set of titles currently shown as somebody's recommendation, as a joinable
 * subquery.
 *
 * Written as a join rather than a correlated `EXISTS` in the ORDER BY, which is
 * what this started as. That form runs one indexed lookup PER LIBRARY ROW —
 * ~12,500 of them per execution, and the job re-runs the selection every batch,
 * against a `recommendation_candidates` table that now holds the entire scored
 * pool per user rather than a top slice. This form scans the selected rows once
 * (they are a few hundred, and `is_selected = TRUE` has a partial index) and
 * hashes them.
 */
function selectedPicksJoinSql(mediaType: 'movie' | 'series', mediaAlias: string): string {
  const idColumn = mediaType === 'movie' ? 'movie_id' : 'series_id'
  return `LEFT JOIN (
              SELECT DISTINCT rc.${idColumn} AS id
                FROM recommendation_candidates rc
                JOIN recommendation_runs rr ON rr.id = rc.run_id
               WHERE rc.is_selected = true
                 AND rr.status = 'completed'
                 AND rc.${idColumn} IS NOT NULL
            ) picks ON picks.id = ${mediaAlias}.id`
}

/**
 * Priority order for the job.
 *
 * Grounded requests are capped per day, so this decides what gets analysed in
 * the first week and what waits a month. Current recommendation picks first —
 * someone is being shown those right now — then most recently added.
 * Unordered would spend the first day's budget on titles nobody opens.
 *
 * Depends on the join {@link pendingAnalysisFromSql} adds, so the two are only
 * correct together; that is why neither is exported separately for callers to
 * assemble by hand.
 */
export function analysisPriorityOrderSql(
  aliases: AnalysisSqlAliases = DEFAULT_ALIASES
): string {
  return `ORDER BY (picks.id IS NOT NULL) DESC,
             ${aliases.media}.created_at DESC NULLS LAST`
}

/**
 * Count and selection share this FROM/JOIN/WHERE core so they cannot disagree.
 *
 * `withPicks` adds the priority join. The count leaves it out — it would not
 * change the total, and joining a few hundred rows to compute a number nobody
 * orders by is pure work.
 */
export function pendingAnalysisFromSql(
  mediaType: 'movie' | 'series',
  versionParam: string,
  options: { withPicks?: boolean; aliases?: AnalysisSqlAliases } = {}
): string {
  const aliases = options.aliases ?? DEFAULT_ALIASES
  const picks = options.withPicks ? `\n    ${selectedPicksJoinSql(mediaType, aliases.media)}` : ''
  return `FROM ${MEDIA_TABLE[mediaType]} ${aliases.media}
    ${analysisJoinSql(mediaType, aliases)}${picks}
    WHERE ${needsAnalysisSql(versionParam, aliases)}`
}
