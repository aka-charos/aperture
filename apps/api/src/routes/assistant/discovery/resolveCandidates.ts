/**
 * Resolve web-sourced candidates against the local library.
 *
 * Tiered match: imdb_id → tmdb_id → title+year (±1). ID hits are validated
 * against the matched row's title/year, so a wrong-but-real ID can't silently
 * point at a different library item (it falls back to the title+year tier).
 *
 * EVERY title comparison here considers `original_title` and `sort_title`, not
 * just `title`. On a real 12.5k-film library 3,739 rows (30%) carry a differing
 * original title, and web sources name foreign films either way — so matching
 * `title` alone made a third of the library unreachable by its real name. That
 * cost more than the fuzzy tier: validating an *exact* IMDb hit compared the
 * row's English title against the candidate's French one, found no overlap, and
 * threw the correct row away.
 */
import { query } from '../../../lib/db.js'
import { normalizeTitle, anyTitleMatchesSql, titleMatchRankSql } from '../helpers/titleMatch.js'
import { buildPlayLink } from '../helpers/mediaServer.js'
import type { ContentItem } from '../schemas/index.js'
import type { DiscoveryCandidate, MediaServerInfo, ToolContext } from '../types.js'

interface LibraryRow {
  id: string
  title: string
  original_title: string | null
  sort_title: string | null
  year: number | null
  genres: string[] | null
  overview: string | null
  community_rating: number | null
  poster_url: string | null
  provider_item_id: string | null
  imdb_id: string | null
  tmdb_id: string | null
  directors: string[] | null
}

const COLUMNS =
  'id, title, original_title, sort_title, year, genres, overview, community_rating, poster_url, provider_item_id, imdb_id, tmdb_id, directors'

/** Every name a library row is known by: localized, original, and sort. */
function rowTitles(row: LibraryRow): string[] {
  return [row.title, row.original_title, row.sort_title].filter((t): t is string => !!t?.trim())
}

/** A matched row's title + year must agree with the candidate to trust an ID hit. */
function idMatchValid(row: LibraryRow, cand: DiscoveryCandidate): boolean {
  if (cand.year && row.year && Math.abs(row.year - cand.year) > 1) return false
  const candidate = normalizeTitle(cand.title)
  const known = rowTitles(row).map(normalizeTitle).filter(Boolean)
  if (!candidate || known.length === 0) return true // nothing to compare → trust the exact ID match
  return known.some((t) => t === candidate || t.includes(candidate) || candidate.includes(t))
}

function toContentItem(
  row: LibraryRow,
  type: 'movie' | 'series',
  mediaServer: MediaServerInfo | null,
  reason?: string | null
): ContentItem {
  const genres = (row.genres ?? []).slice(0, 2).join(', ')
  const subtitle = [row.year, genres].filter(Boolean).join(' · ')
  const playLink = buildPlayLink(mediaServer, row.provider_item_id, type)
  return {
    id: row.id,
    type,
    name: row.title,
    subtitle,
    image: row.poster_url,
    overview: row.overview,
    // On `series` this column holds the creators — the card labels it accordingly.
    director: (row.directors ?? []).slice(0, 2).join(', ') || null,
    reason: reason ?? null,
    rating: row.community_rating,
    actions: [
      {
        id: 'details',
        label: 'Details',
        href: `/${type === 'movie' ? 'movies' : 'series'}/${row.id}`,
        variant: 'secondary',
      },
      ...(playLink
        ? [{ id: 'play', label: 'Play', href: playLink, variant: 'primary' as const }]
        : []),
    ],
  }
}

/**
 * Match candidates to library items. Returns rendered cards for the matches and
 * the leftover candidates (so the model can mention what's not in the library).
 */
export async function resolveCandidates(
  candidates: DiscoveryCandidate[],
  ctx: ToolContext
): Promise<{ items: ContentItem[]; notInLibrary: DiscoveryCandidate[] }> {
  const items: ContentItem[] = []
  const notInLibrary: DiscoveryCandidate[] = []
  const usedRowIds = new Set<string>()

  for (const mediaType of ['movie', 'series'] as const) {
    const table = mediaType === 'movie' ? 'movies' : 'series'
    const pending = new Set(candidates.filter((c) => c.mediaType === mediaType))
    if (pending.size === 0) continue

    const claim = (row: LibraryRow, cand: DiscoveryCandidate) => {
      if (!usedRowIds.has(row.id)) {
        usedRowIds.add(row.id)
        items.push(toContentItem(row, mediaType, ctx.mediaServer, cand.reason))
      }
      pending.delete(cand)
    }

    // Tier 1 — imdb_id (exact, indexed)
    const imdbIds = [...pending].map((c) => c.imdbId).filter((x): x is string => !!x)
    if (imdbIds.length) {
      const res = await query<LibraryRow>(
        `SELECT ${COLUMNS} FROM ${table} WHERE imdb_id = ANY($1::text[])`,
        [imdbIds]
      )
      for (const cand of [...pending]) {
        const row = res.rows.find((r) => !!r.imdb_id && r.imdb_id === cand.imdbId)
        if (row && idMatchValid(row, cand)) claim(row, cand)
      }
    }

    // Tier 2 — tmdb_id (exact, indexed) for the still-unmatched
    const tmdbIds = [...pending].map((c) => c.tmdbId).filter((x): x is string => !!x)
    if (tmdbIds.length) {
      const res = await query<LibraryRow>(
        `SELECT ${COLUMNS} FROM ${table} WHERE tmdb_id = ANY($1::text[])`,
        [tmdbIds]
      )
      for (const cand of [...pending]) {
        const row = res.rows.find((r) => !!r.tmdb_id && r.tmdb_id === cand.tmdbId)
        if (row && idMatchValid(row, cand)) claim(row, cand)
      }
    }

    // Tier 3 — residual: title ILIKE + year (±1), exact-title preferred.
    //
    // Searches all three name columns, and through unaccent() so a source that
    // writes "Ascenseur pour l'echafaud" still matches the accented row. That
    // costs the trigram index from 0060 and falls back to a sequential scan,
    // which is a few milliseconds at this table size — inside a tool call that
    // already takes tens of seconds. Localized title wins, then original, then
    // sort, so an exact hit on the name the user sees is never outranked.
    for (const cand of [...pending]) {
      const res = await query<LibraryRow>(
        `SELECT ${COLUMNS} FROM ${table}
         WHERE ${anyTitleMatchesSql('$1')}
         ORDER BY ${titleMatchRankSql('$2')},
                  ABS(COALESCE(year, 0) - $3)
         LIMIT 5`,
        [`%${cand.title}%`, cand.title, cand.year ?? 0]
      )
      const row = res.rows.find((r) => {
        if (usedRowIds.has(r.id)) return false
        if (cand.year && r.year && Math.abs(r.year - cand.year) > 1) return false
        return true
      })
      if (row) claim(row, cand)
    }

    for (const cand of pending) notInLibrary.push(cand)
  }

  return { items, notInLibrary }
}
