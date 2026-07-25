/**
 * "Only suggest things I haven't watched" — enforced on tool output.
 *
 * The user opts in from the chat composer; the request arrives with the
 * `x-exclude-watched` header. Rather than teaching each of ~18 tools a new
 * parameter (and trusting the model to pass it), the filter is applied to
 * whatever the tools return: any card list is stripped of watched titles before
 * the model ever sees it. The model is told about the mode too, but the cards
 * are guaranteed either way.
 *
 * A watched *series* means the user has played at least one of its episodes —
 * the same definition getUnwatched uses.
 */
import type { ToolSet } from 'ai'
import { query } from '../../../lib/db.js'
import type { ContentItem } from '../schemas/index.js'

/** Ids the user has already watched, out of the ones asked about. */
async function watchedIds(
  userId: string,
  movieIds: string[],
  seriesIds: string[]
): Promise<Set<string>> {
  const watched = new Set<string>()

  if (movieIds.length > 0) {
    const res = await query<{ movie_id: string }>(
      `SELECT DISTINCT movie_id FROM watch_history
       WHERE user_id = $1 AND movie_id = ANY($2)`,
      [userId, movieIds]
    )
    for (const row of res.rows) watched.add(row.movie_id)
  }

  if (seriesIds.length > 0) {
    const res = await query<{ series_id: string }>(
      `SELECT DISTINCT ep.series_id FROM watch_history wh
       JOIN episodes ep ON ep.id = wh.episode_id
       WHERE wh.user_id = $1 AND ep.series_id = ANY($2)`,
      [userId, seriesIds]
    )
    for (const row of res.rows) watched.add(row.series_id)
  }

  return watched
}

/**
 * Drop the items the user has already watched. Returns the list unchanged if
 * the lookup fails — a filter this cheap must never cost the user their results.
 */
export async function filterUnwatchedItems(
  userId: string,
  items: ContentItem[]
): Promise<ContentItem[]> {
  if (items.length === 0) return items
  try {
    const watched = await watchedIds(
      userId,
      items.filter((i) => i.type === 'movie').map((i) => i.id),
      items.filter((i) => i.type === 'series').map((i) => i.id)
    )
    if (watched.size === 0) return items
    return items.filter((item) => !watched.has(item.id))
  } catch {
    return items
  }
}

/**
 * Tools the filter must leave alone. Each one answers a question *about* things
 * the user has already watched or asked for by name — stripping watched titles
 * would empty the watch history, blank the ratings list, or answer "is the
 * longest film in the library" with the longest one nobody has played.
 */
const EXEMPT_TOOLS = new Set([
  'getWatchHistory',
  'getUserRatings',
  'getFranchiseProgress',
  'getContentDetails',
  'getContentRankings',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Every object in a tool result that carries a card list — the result itself
 * (`{ items }`) and/or each entry of `{ carousels: [{ items }] }`.
 */
function cardContainers(result: unknown): Record<string, unknown>[] {
  if (!isRecord(result)) return []
  const containers: Record<string, unknown>[] = []
  if (Array.isArray(result.items)) containers.push(result)
  if (Array.isArray(result.carousels)) {
    for (const carousel of result.carousels) {
      if (isRecord(carousel) && Array.isArray(carousel.items)) containers.push(carousel)
    }
  }
  return containers
}

/**
 * Wrap every tool so watched titles are stripped from its card lists. Results
 * without cards (stats, help, person lookups) pass through untouched.
 */
export function withUnwatchedFilter<T extends ToolSet>(tools: T, userId: string): T {
  return Object.fromEntries(
    Object.entries(tools).map(([name, toolDef]) => {
      const execute = toolDef.execute
      if (!execute || EXEMPT_TOOLS.has(name)) return [name, toolDef]
      const filtered: typeof execute = async (input, options) => {
        const result = await execute(input, options)
        const containers = cardContainers(result)
        if (containers.length === 0) return result

        await Promise.all(
          containers.map(async (container) => {
            const items = container.items as ContentItem[]
            const unwatched = await filterUnwatchedItems(userId, items)
            if (unwatched.length === items.length) return
            // Mutate in place: every other field (titles, i18n keys, layout)
            // stays exactly as the tool built it, whatever its result shape.
            items.splice(0, items.length, ...unwatched)
            // Several carousels caption themselves with a count computed before
            // this ran ("Found 15 …"); keep it honest.
            const params = container.descriptionParams
            if (isRecord(params) && typeof params.count === 'number') {
              params.count = unwatched.length
            }
          })
        )
        return result
      }
      return [name, { ...toolDef, execute: filtered }]
    })
  ) as T
}
