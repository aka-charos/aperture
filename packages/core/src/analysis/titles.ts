/**
 * Loading titles for analysis: one subject at a time for the on-demand path,
 * and the pending selection for the batch job.
 *
 * Every query here routes through `pending.ts` for its predicate so the count
 * and the selection cannot drift — see the note there for why that matters more
 * than it looks.
 */
import { query, queryOne } from '../lib/db.js'
import { ANALYSIS_PROMPT_VERSION, type AnalysisSubject } from './prompt.js'
import {
  analysisPriorityOrderSql,
  pendingAnalysisFromSql,
} from './pending.js'

/**
 * pg returns NUMERIC as a string, so `imdb_rating` arrives as '8.2'. Parsed
 * here rather than at the call site because a bare Number() on null yields 0,
 * and an unrated title presented as rated 0 is worse than one presented as
 * unrated.
 */
function numOrNull(value: string | number | null): number | null {
  if (value == null) return null
  const n = typeof value === 'number' ? value : Number.parseFloat(value)
  return Number.isFinite(n) ? n : null
}

interface TitleRow {
  id: string
  title: string
  year: number | null
  directors: string[] | null
  metacritic_score: number | null
  rt_critic_score: number | null
  imdb_rating: string | number | null
  imdb_vote_count: number | null
  awards_summary: string | null
}

/**
 * Columns every analysis subject needs, identical for both media types.
 * An array rather than a string so the aliased form below is built rather than
 * parsed — and note `title_analysis` has no `id` or `title` column, so an
 * unqualified list happens to resolve today and would break the moment it does.
 */
const SUBJECT_COLUMNS = [
  'id',
  'title',
  'year',
  'directors',
  'metacritic_score',
  'rt_critic_score',
  'imdb_rating',
  'imdb_vote_count',
  'awards_summary',
] as const

const subjectColumns = (alias?: string) =>
  SUBJECT_COLUMNS.map((c) => (alias ? `${alias}.${c}` : c)).join(', ')

function toSubject(row: TitleRow, mediaType: 'movie' | 'series'): AnalysisSubject {
  return {
    title: row.title,
    year: row.year,
    mediaType,
    directors: row.directors,
    reception: {
      metacriticScore: row.metacritic_score,
      rtCriticScore: row.rt_critic_score,
      imdbRating: numOrNull(row.imdb_rating),
      imdbVoteCount: row.imdb_vote_count,
      awardsSummary: row.awards_summary,
    },
  }
}

/** The subject for one title, or null when the id doesn't exist. */
export async function loadAnalysisSubject(
  mediaType: 'movie' | 'series',
  mediaId: string
): Promise<AnalysisSubject | null> {
  const table = mediaType === 'movie' ? 'movies' : 'series'
  const row = await queryOne<TitleRow>(
    `SELECT ${subjectColumns()} FROM ${table} WHERE id = $1`,
    [mediaId]
  )
  return row ? toSubject(row, mediaType) : null
}

export interface PendingTitle {
  mediaType: 'movie' | 'series'
  mediaId: string
  subject: AnalysisSubject
}

/** How many titles of this type still need a pass. Shares the predicate below. */
export async function countPendingAnalysis(mediaType: 'movie' | 'series'): Promise<number> {
  const row = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count ${pendingAnalysisFromSql(mediaType, '$1')}`,
    [ANALYSIS_PROMPT_VERSION]
  )
  return row ? Number.parseInt(row.count, 10) : 0
}

/**
 * The next titles to analyse, best first.
 *
 * `excludeIds` is how the job avoids re-attempting a row it has already tried
 * this run. That guard is not optional: a transport failure deliberately writes
 * no row, so the title stays pending, and a loop that reads until the selection
 * empties would otherwise spin on it forever. The same shape once made
 * `enrichMetadata`'s `while (true)` loops non-terminating.
 */
export async function selectPendingTitles(
  mediaType: 'movie' | 'series',
  limit: number,
  excludeIds: string[] = []
): Promise<PendingTitle[]> {
  const params: unknown[] = [ANALYSIS_PROMPT_VERSION]
  let exclusion = ''
  if (excludeIds.length > 0) {
    params.push(excludeIds)
    exclusion = ` AND m.id <> ALL($${params.length}::uuid[])`
  }
  params.push(limit)

  const rows = await query<TitleRow>(
    `SELECT ${subjectColumns('m')}
     ${pendingAnalysisFromSql(mediaType, '$1', { withPicks: true })}${exclusion}
     ${analysisPriorityOrderSql()}
     LIMIT $${params.length}`,
    params
  )

  return rows.rows.map((row) => ({
    mediaType,
    mediaId: row.id,
    subject: toSubject(row, mediaType),
  }))
}
