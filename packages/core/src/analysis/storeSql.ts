/**
 * The one statement that writes a `title_analysis` row. Pure and apart from
 * `generate.ts` so its positional binds and its update list are pinned without a
 * database: a column missing from the update list keeps the previous run's value
 * on a re-run, and nothing else would notice.
 */

const BASE_COLUMNS = [
  'media_type',
  'media_id',
  'analysis',
  'decline_reason',
  'sources',
  'source_grade',
  'source_count',
  'retrieved_chars',
  'model',
  'retrieval_mode',
  'paragraph_map',
  'prompt_version',
  'prompt_variant',
]
const TIMING_COLUMNS = ['retrieval_ms', 'write_ms']
const JSONB_COLUMNS = new Set(['sources', 'paragraph_map'])
const KEY_COLUMNS = new Set(['media_type', 'media_id'])

/** Binds, in the order of the columns: the base values, then timing when `withTiming`. */
export function titleAnalysisUpsertSql(withTiming: boolean): string {
  const columns = withTiming ? [...BASE_COLUMNS, ...TIMING_COLUMNS] : BASE_COLUMNS
  const values = columns.map((column, i) =>
    JSONB_COLUMNS.has(column) ? `$${i + 1}::jsonb` : `$${i + 1}`
  )
  const updates = columns
    .filter((column) => !KEY_COLUMNS.has(column))
    .map((column) => `${column} = EXCLUDED.${column}`)
  return `INSERT INTO title_analysis
       (${columns.join(', ')}, analyzed_at)
     VALUES (${values.join(', ')}, NOW())
     ON CONFLICT (media_type, media_id) DO UPDATE SET
       ${updates.join(',\n       ')},
       analyzed_at = NOW(),
       -- A fresh analysis invalidates tags extracted from the previous prose.
       tags_prompt_version = NULL`
}
