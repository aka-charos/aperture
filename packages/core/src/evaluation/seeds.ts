/**
 * The seed titles the neighbour dump is built from, and how an admin picks them.
 *
 * WHY THIS IS A SETTING AT ALL. `neighbours.ts` is the PRIMARY instrument (see
 * the module header there): someone who knows twenty films can judge a
 * retrieval change from a neighbour dump in a minute and will trust the answer,
 * where every number in `metrics.ts` can only reward more of what the viewer
 * already engaged with. But the instrument is only as good as what it is
 * pointed at, and its default — `popularSeedIds`, whatever the most people
 * finished — is precisely where two embedding spaces AGREE. A canonical,
 * heavily-written-about film is the easy case for every model. Ask the
 * comparison that question and it answers "no difference" whatever the truth.
 *
 * So the discriminating seeds have to be choosable, and until now the only way
 * to choose them was an INSERT into `system_settings` by hand.
 */
import { getSystemSetting, setSystemSetting } from '../settings/systemSettings.js'
import { query } from '../lib/db.js'

export const EVALUATION_SEED_SETTING = 'evaluation_seed_titles'

/**
 * The stored blob split into titles.
 *
 * Newline-separated rather than comma-separated because a film title may
 * contain a comma (*Sex, Lies, and Videotape*), and a wrongly split seed
 * silently becomes two seeds that both miss.
 *
 * Pure and exported because the job executor parsed this inline — the
 * duplicated-predicate shape this repo keeps paying for. One copy, one test.
 */
export function parseSeedTitles(raw: string | null | undefined): string[] {
  return (raw ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

/** The inverse, so what is written can always be read back unchanged. */
export function formatSeedTitles(titles: string[]): string {
  return titles
    .map((t) => t.trim())
    .filter(Boolean)
    .join('\n')
}

export async function getEvaluationSeedTitles(): Promise<string[]> {
  return parseSeedTitles(await getSystemSetting(EVALUATION_SEED_SETTING))
}

/**
 * Store the list, returning what was actually stored.
 *
 * Returns rather than voids so a caller cannot show the admin a list that
 * differs from the one on disk — blanks and whitespace are dropped here, and
 * silently.
 */
export async function setEvaluationSeedTitles(titles: string[]): Promise<string[]> {
  const cleaned = parseSeedTitles(formatSeedTitles(titles))
  await setSystemSetting(
    EVALUATION_SEED_SETTING,
    formatSeedTitles(cleaned),
    'Titles used as seeds for the recommender evaluation neighbour dump'
  )
  return cleaned
}

export interface SeedSuggestion {
  title: string
  year: number | null
  countries: string[]
  voteCount: number | null
}

/**
 * Candidate seeds drawn from this library, biased toward the cases that
 * actually separate two embedding spaces.
 *
 * Three constraints, each earning its place:
 *
 *   WATCHED — a seed nobody here has seen tells you the neighbours exist, not
 *   whether they are any good. The whole value of this instrument is a reader
 *   who can judge the list.
 *
 *   ONE PER COUNTRY — `DISTINCT ON` rather than a plain ascending sort. Sorted
 *   by obscurity alone, a library's forty least-voted watched films come from
 *   two or three traditions, and a seed set inside one tradition cannot show a
 *   nationality effect, which is the specific failure the canonical text is
 *   known to be prone to (six of its fifteen fields are nationality-coded).
 *
 *   LEAST-VOTED WITHIN EACH — obscure titles are where a model's pretrained
 *   knowledge runs out and the embedding has to carry the weight on its own.
 *
 * Deliberately NOT filtered to non-US: that is one way to be discriminating,
 * not the definition, and the country spread already prevents a US-only list.
 */
export async function suggestSeedTitles(
  mediaType: 'movie' | 'series',
  limit = 20
): Promise<SeedSuggestion[]> {
  const rows =
    mediaType === 'movie'
      ? await query<{
          title: string
          year: number | null
          production_countries: string[] | null
          imdb_vote_count: string | null
        }>(
          `SELECT * FROM (
             SELECT DISTINCT ON (m.production_countries[1])
                    m.title, m.year, m.production_countries, m.imdb_vote_count
               FROM movies m
               JOIN watch_history wh ON wh.movie_id = m.id AND wh.played = true
              WHERE m.production_countries IS NOT NULL
                AND array_length(m.production_countries, 1) > 0
              ORDER BY m.production_countries[1], m.imdb_vote_count ASC NULLS LAST
           ) s
           ORDER BY s.imdb_vote_count ASC NULLS LAST
           LIMIT $1`,
          [limit]
        )
      : await query<{
          title: string
          year: number | null
          production_countries: string[] | null
          imdb_vote_count: string | null
        }>(
          `SELECT * FROM (
             SELECT DISTINCT ON (s2.production_countries[1])
                    s2.title, s2.year, s2.production_countries, s2.imdb_vote_count
               FROM series s2
               JOIN episodes e ON e.series_id = s2.id
               JOIN watch_history wh ON wh.episode_id = e.id AND wh.played = true
              WHERE s2.production_countries IS NOT NULL
                AND array_length(s2.production_countries, 1) > 0
              ORDER BY s2.production_countries[1], s2.imdb_vote_count ASC NULLS LAST
           ) s
           ORDER BY s.imdb_vote_count ASC NULLS LAST
           LIMIT $1`,
          [limit]
        )

  return rows.rows.map((r) => ({
    title: r.title,
    year: r.year,
    countries: r.production_countries ?? [],
    // NUMERIC/bigint arrives as a string, and Number(null) is 0 rather than
    // NaN -- which would present an unrated title as having zero votes.
    voteCount: r.imdb_vote_count == null ? null : Number(r.imdb_vote_count),
  }))
}
