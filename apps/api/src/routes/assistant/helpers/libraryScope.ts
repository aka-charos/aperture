/**
 * "Only what I may open" — enforced on every tool's output.
 *
 * The fifth cross-cutting wrapper, beside `withUnwatchedFilter`,
 * `withToolErrorHandling`, `withStatusEvents` and `withRequestContext`, and the
 * only one that is never optional. The media server lets each account into some
 * libraries and not others; the assistant used to answer from all of them, so a
 * viewer kept out of a library could have its titles named, carded and linked to
 * in chat (F-136).
 *
 * Built on output rather than taught to each of ~18 tools for the reason the
 * unwatched filter is: a card list is the one shape every tool shares, and a rule
 * each tool has to remember is the rule the next tool forgets. The search tools
 * ALSO scope their SQL (`ctx.scope`), because their `brief` format returns text
 * with no card list for this to inspect — which is also why a new tool that
 * returns titles as text needs the same.
 *
 * Unlike the unwatched filter nothing is exempt by name except the viewer's own
 * record — watch history and ratings, which they could open when they made it.
 * An episode card is judged by its series.
 */
import type { ToolSet } from 'ai'
import type { LibraryScope } from '@aperture/core'
import { binderFor, libraryScopeSql } from '@aperture/core'
import { query } from '../../../lib/db.js'
import type { ContentItem } from '../schemas/index.js'
import { mapToolResult } from './toolStream.js'

/** The viewer's own record: every title in it was one they could open. */
const EXEMPT_TOOLS = new Set(['getWatchHistory', 'getUserRatings'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Card lists in a result: `{ items }` and each `{ carousels: [{ items }] }`. */
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

/** The library row a card stands for: a series for an episode card. */
function cardKey(item: ContentItem): { table: 'movies' | 'series'; id: string } | null {
  const episode = (item as { episode?: { seriesId?: unknown } }).episode
  if (isRecord(episode) && typeof episode.seriesId === 'string') {
    return { table: 'series', id: episode.seriesId }
  }
  if (item.type === 'movie') return { table: 'movies', id: item.id }
  if (item.type === 'series') return { table: 'series', id: item.id }
  return null
}

async function visibleIds(
  scope: LibraryScope,
  table: 'movies' | 'series',
  ids: string[]
): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const params: unknown[] = [ids]
  const inScope = libraryScopeSql(scope, 't', binderFor(params))
  const rows = await query<{ id: string }>(
    `SELECT t.id FROM ${table} t WHERE t.id = ANY($1) AND ${inScope}`,
    params
  )
  return new Set(rows.rows.map((row) => row.id))
}

/**
 * Drop the cards the viewer may not open. Fails CLOSED: this is a permission,
 * so a lookup that throws removes every card rather than showing them all —
 * the opposite of the unwatched filter, which is a preference.
 */
export async function filterItemsToScope(scope: LibraryScope, items: ContentItem[]): Promise<ContentItem[]> {
  if (items.length === 0) return items
  try {
    const keys = items.map(cardKey)
    const movieIds = keys.flatMap((key) => (key?.table === 'movies' ? [key.id] : []))
    const seriesIds = keys.flatMap((key) => (key?.table === 'series' ? [key.id] : []))
    const [movies, series] = await Promise.all([
      visibleIds(scope, 'movies', movieIds),
      visibleIds(scope, 'series', seriesIds),
    ])
    return items.filter((_, i) => {
      const key = keys[i]
      // Not a library title (a person, a web-only pick with no id match): the
      // scope has nothing to say about it.
      if (!key) return true
      return key.table === 'movies' ? movies.has(key.id) : series.has(key.id)
    })
  } catch {
    return []
  }
}

export function withLibraryScope<T extends ToolSet>(tools: T, scope: LibraryScope): T {
  return Object.fromEntries(
    Object.entries(tools).map(([name, toolDef]) => {
      const execute = toolDef.execute
      if (!execute || EXEMPT_TOOLS.has(name)) return [name, toolDef]
      // Not `async`: a streaming tool hands back an async iterable, and every
      // result has to go through mapToolResult (see toolStream.ts).
      const scoped: typeof execute = (input, options) =>
        mapToolResult(execute(input, options), async (result) => {
          // A single-title result (getContentDetails) names what it opened.
          if (isRecord(result) && typeof result.contentId === 'string') {
            const table = result.type === 'series' ? 'series' : result.type === 'movie' ? 'movies' : null
            if (table) {
              const visible = await visibleIds(scope, table, [result.contentId]).catch(() => new Set<string>())
              if (!visible.has(result.contentId)) return { error: 'Not found in your library' }
            }
          }

          const containers = cardContainers(result)
          if (containers.length === 0) return result

          await Promise.all(
            containers.map(async (container) => {
              const items = container.items as ContentItem[]
              const kept = await filterItemsToScope(scope, items)
              if (kept.length === items.length) return
              items.splice(0, items.length, ...kept)
              const params = container.descriptionParams
              if (isRecord(params) && typeof params.count === 'number') {
                params.count = kept.length
              }
            })
          )
          return result
        })
      return [name, { ...toolDef, execute: scoped }]
    })
  ) as T
}
