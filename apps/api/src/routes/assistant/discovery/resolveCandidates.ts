/**
 * Resolve web-sourced candidates against the local library.
 *
 * Tiered match: imdb_id → tmdb_id → title+year (±1). ID hits are validated
 * against the matched row's title/year, so a wrong-but-real ID can't silently
 * point at a different library item (it falls back to the title+year tier).
 */
import { query } from '../../../lib/db.js'
import { buildPlayLink } from '../helpers/mediaServer.js'
import type { ContentItem } from '../schemas/index.js'
import type { DiscoveryCandidate, MediaServerInfo, ToolContext } from '../types.js'

interface LibraryRow {
  id: string
  title: string
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
  'id, title, year, genres, overview, community_rating, poster_url, provider_item_id, imdb_id, tmdb_id, directors'

function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** A matched row's title + year must agree with the candidate to trust an ID hit. */
function idMatchValid(row: LibraryRow, cand: DiscoveryCandidate): boolean {
  if (cand.year && row.year && Math.abs(row.year - cand.year) > 1) return false
  const a = normalizeTitle(row.title)
  const b = normalizeTitle(cand.title)
  if (!a || !b) return true // nothing to compare → trust the exact ID match
  return a === b || a.includes(b) || b.includes(a)
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

    // Tier 3 — residual: title ILIKE + year (±1), exact-title preferred
    for (const cand of [...pending]) {
      const res = await query<LibraryRow>(
        `SELECT ${COLUMNS} FROM ${table}
         WHERE title ILIKE $1
         ORDER BY CASE WHEN LOWER(title) = LOWER($2) THEN 0 ELSE 1 END,
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
