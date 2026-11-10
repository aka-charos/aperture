/**
 * The tools only the newsletter writing assistant has.
 *
 * The chat assistant's tools answer for ONE viewer; a newsletter is written for
 * an audience. So these look at the household and at the newsletter itself:
 * what arrived lately, what people have been playing, what nobody has found,
 * who among this newsletter's recipients can open a title, what earlier issues
 * already featured, and the draft as it stands. `proposeDraft` is how the
 * assistant hands content over (see core newsletter/draft.ts).
 *
 * Household counts are counts. No tool names a person: the assistant writes
 * text that is emailed to the same people it would be counting.
 *
 * Every list is a card list (`{ items }` of `{ id, type, name, … }`), the shape
 * the chat's own tools return, so `withLibraryScope` filters it to the admin's
 * scope and the panel draws it with an Add button. The SQL applies the scope
 * as well, so a limit counts titles the admin can actually see.
 */
import { tool } from 'ai'
import { z } from 'zod'
import {
  WATCH_HISTORY_PLAYED_SQL,
  binderFor,
  buildDraftContent,
  describeDraftForModel,
  displayRatingSql,
  draftTitleRefs,
  insertProblem,
  libraryScopeSql,
  listNewsletters,
  loadAudienceUsers,
  loadGroupDefinitions,
  loadTitleFacts,
  numericOrNull,
  readNewsletterDocument,
  resolveRecipients,
  titleKey,
  titleRefsIn,
  visibleTitlesByUser,
  DRAFT_BLOCK_KINDS,
  type DraftTitleInfo,
  type LibraryScope,
  type TitleRef,
} from '@aperture/core'
import { query } from '../../../lib/db.js'
import { nullSafe } from '../../assistant/tools/utils.js'
import { buildPlayLink } from '../../assistant/helpers/mediaServer.js'
import type { ToolContext } from '../../assistant/types.js'
import { summarizeDraft, type NewsletterDraftContext } from './draftSummary.js'

const OVERVIEW_CHARS = 280

/** How long after a library's first row its titles still count as its first import. */
const IMPORT_GRACE = `interval '1 day'`

/** Accounts that count as the household: anyone who still has access. */
const HOUSEHOLD_SQL = `u.is_enabled = true AND u.provider_disabled = false`

type TitleRow = {
  id: string
  title: string
  year: number | null
  poster_url: string | null
  provider_item_id: string | null
  overview: string | null
  genres: string[] | null
  community_rating: string | number | null
}

function clipOverview(text: string | null): string | null {
  if (!text) return null
  const trimmed = text.trim()
  if (trimmed.length <= OVERVIEW_CHARS) return trimmed
  const cut = trimmed.slice(0, OVERVIEW_CHARS)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), OVERVIEW_CHARS - 40)).trimEnd()}…`
}

/** A shown rating, one decimal; NULL and 0 mean none (core `numericOrNull` reads the NUMERIC text). */
function rating(value: string | number | null): number | null {
  const n = numericOrNull(value)
  return n != null && n > 0 ? Math.round(n * 10) / 10 : null
}

function card(ctx: ToolContext, type: 'movie' | 'series', row: TitleRow, subtitle: string) {
  return {
    id: row.id,
    type,
    name: row.title,
    year: row.year,
    subtitle,
    image: row.poster_url,
    overview: clipOverview(row.overview),
    genres: row.genres ?? [],
    rating: rating(row.community_rating),
    detailsUrl: `/${type === 'movie' ? 'movies' : 'series'}/${row.id}`,
    playUrl: buildPlayLink(ctx.mediaServer, row.provider_item_id, type),
  }
}

const typeParam = z.enum(['movies', 'series', 'both']).default('both').describe('Which kind of title')
const limitParam = (fallback: number) =>
  z.number().int().min(1).max(40).optional().default(fallback).describe(`How many titles (default ${fallback}, max 40)`)
const genreParam = z
  .string()
  .optional()
  .describe('Optional genre as the library names it (see getAvailableGenres), e.g. "Horror"')

/** `EXISTS` over a title's genres, case-insensitive; the pattern is the bound value, never the array. */
function genreClause(alias: string, genre: string | undefined, params: unknown[]): string {
  if (!genre?.trim()) return 'TRUE'
  params.push(genre.trim())
  return `EXISTS (SELECT 1 FROM unnest(${alias}.genres) g WHERE g ILIKE $${params.length})`
}

const kinds = (type: 'movies' | 'series' | 'both') => ({
  movies: type !== 'series',
  series: type !== 'movies',
})

const TITLE_COLUMNS = (alias: string) =>
  `${alias}.id, ${alias}.title, ${alias}.year, ${alias}.poster_url, ${alias}.provider_item_id, ${alias}.overview,
   ${alias}.genres, ${displayRatingSql(alias)} AS community_rating`

/** Titles from a list of refs that this scope can open, with what a card needs. */
async function titleInfoInScope(refs: readonly TitleRef[], scope: LibraryScope): Promise<Map<string, DraftTitleInfo>> {
  const found = new Map<string, DraftTitleInfo>()
  for (const [mediaType, table] of [
    ['movie', 'movies'],
    ['series', 'series'],
  ] as const) {
    const ids = refs.filter((r) => r.mediaType === mediaType).map((r) => r.id)
    if (ids.length === 0) continue
    const params: unknown[] = [ids]
    const inScope = libraryScopeSql(scope, 't', binderFor(params))
    const rows = await query<{ id: string; title: string; year: number | null; poster_url: string | null }>(
      `SELECT t.id, t.title, t.year, t.poster_url FROM ${table} t WHERE t.id = ANY($1::uuid[]) AND ${inScope}`,
      params
    )
    for (const row of rows.rows) {
      found.set(titleKey({ mediaType, id: row.id }), { title: row.title, year: row.year, posterUrl: row.poster_url })
    }
  }
  return found
}

/** Who this newsletter goes to right now, by the rules the send uses. */
async function currentRecipients(groupIds: readonly string[]) {
  if (groupIds.length === 0) return []
  const [users, groups] = await Promise.all([loadAudienceUsers(), loadGroupDefinitions(groupIds)])
  return resolveRecipients(users, groups)
}

export function createNewsletterTools(ctx: ToolContext, draft: NewsletterDraftContext) {
  return {
    getRecentlyAdded: tool({
      description:
        'Titles that arrived in the library recently: new movies, new shows, and shows that got new episodes, newest first. The usual backbone of a "what\'s new" issue. "Added" means first seen by this app; the titles a library brought with it when it was first imported are not counted as new.',
      inputSchema: nullSafe(
        z.object({
          type: typeParam,
          days: z.number().int().min(1).max(365).optional().default(30).describe('How far back, in days (default 30)'),
          genre: genreParam,
          limit: limitParam(20),
        })
      ),
      execute: async ({ type, days = 30, genre, limit = 20 }) => {
        const want = kinds(type)
        // Schema-checked already; interpolated, so held to the range here too.
        const cap = Math.min(40, Math.max(1, Math.trunc(limit)))
        const found: { at: Date; item: ReturnType<typeof card> }[] = []
        let importSkipped = 0
        let importUntil: Date | null = null
        const noteImport = (row: { n: number; until: Date | null } | undefined) => {
          if (!row?.n) return
          importSkipped += row.n
          if (row.until && (!importUntil || row.until > importUntil)) importUntil = row.until
        }
        // `created_at` is when the app first saw a row, so a library's first
        // import reads as one huge arrival. Titles that came within a day of
        // their library's first row are that import, not news.
        const importsCte = (table: 'movies' | 'series') =>
          `imports AS (
             SELECT provider_library_id, MIN(created_at) + ${IMPORT_GRACE} AS import_end
               FROM ${table} GROUP BY provider_library_id
           )`
        const libraryJoin = (alias: string) =>
          `JOIN imports i ON i.provider_library_id IS NOT DISTINCT FROM ${alias}.provider_library_id`

        if (want.movies) {
          const params: unknown[] = [days]
          const genreSql = genreClause('m', genre, params)
          const inScope = libraryScopeSql(ctx.scope, 'm', binderFor(params))
          const window = `m.created_at >= NOW() - make_interval(days => $1::int) AND ${genreSql} AND ${inScope}`
          const [rows, skipped] = await Promise.all([
            query<TitleRow & { created_at: Date }>(
              `WITH ${importsCte('movies')}
               SELECT ${TITLE_COLUMNS('m')}, m.created_at
                 FROM movies m ${libraryJoin('m')}
                WHERE ${window} AND m.created_at > i.import_end
                ORDER BY m.created_at DESC, m.id
                LIMIT ${cap}`,
              params
            ),
            query<{ n: number; until: Date | null }>(
              `WITH ${importsCte('movies')}
               SELECT COUNT(*)::int AS n, MAX(i.import_end) AS until
                 FROM movies m ${libraryJoin('m')}
                WHERE ${window} AND m.created_at <= i.import_end`,
              params
            ),
          ])
          noteImport(skipped.rows[0])
          for (const row of rows.rows) {
            found.push({
              at: row.created_at,
              item: card(ctx, 'movie', row, `New film, added ${row.created_at.toISOString().slice(0, 10)}`),
            })
          }
        }
        if (want.series) {
          const params: unknown[] = [days]
          const genreSql = genreClause('s', genre, params)
          const inScope = libraryScopeSql(ctx.scope, 's', binderFor(params))
          // Specials (season 0) are not "new episodes" anyone is waiting for,
          // and episodes that came with their library's first import are not new.
          const [rows, skipped] = await Promise.all([
            query<TitleRow & { created_at: Date; is_new: boolean; new_episodes: string | null; latest: Date }>(
              `WITH ${importsCte('series')},
               fresh AS (
                 SELECT e.series_id, COUNT(*)::text AS new_episodes, MAX(e.created_at) AS latest
                   FROM episodes e
                   JOIN series es ON es.id = e.series_id
                   JOIN imports ei ON ei.provider_library_id IS NOT DISTINCT FROM es.provider_library_id
                  WHERE e.created_at >= NOW() - make_interval(days => $1::int) AND e.season_number > 0
                    AND e.created_at > ei.import_end
                  GROUP BY e.series_id
               )
               SELECT ${TITLE_COLUMNS('s')}, s.created_at, f.new_episodes,
                      (s.created_at >= NOW() - make_interval(days => $1::int) AND s.created_at > i.import_end) AS is_new,
                      GREATEST(
                        CASE WHEN s.created_at > i.import_end THEN s.created_at END,
                        f.latest
                      ) AS latest
                 FROM series s ${libraryJoin('s')}
                 LEFT JOIN fresh f ON f.series_id = s.id
                WHERE ((s.created_at >= NOW() - make_interval(days => $1::int) AND s.created_at > i.import_end)
                       OR f.series_id IS NOT NULL)
                  AND ${genreSql} AND ${inScope}
                ORDER BY latest DESC, s.id
                LIMIT ${cap}`,
              params
            ),
            query<{ n: number; until: Date | null }>(
              `WITH ${importsCte('series')}
               SELECT COUNT(*)::int AS n, MAX(i.import_end) AS until
                 FROM series s ${libraryJoin('s')}
                WHERE s.created_at >= NOW() - make_interval(days => $1::int) AND s.created_at <= i.import_end
                  AND ${genreSql} AND ${inScope}`,
              params
            ),
          ])
          noteImport(skipped.rows[0])
          for (const row of rows.rows) {
            const episodes = row.new_episodes != null ? Number.parseInt(row.new_episodes, 10) : 0
            const subtitle = row.is_new
              ? `New show, added ${row.created_at.toISOString().slice(0, 10)}`
              : `${episodes} new episode${episodes === 1 ? '' : 's'}, latest ${row.latest.toISOString().slice(0, 10)}`
            found.push({ at: row.latest, item: card(ctx, 'series', row, subtitle) })
          }
        }
        // One list, newest first, at most `limit` however many kinds were asked for.
        const items = found
          .sort((a, b) => b.at.getTime() - a.at.getTime())
          .slice(0, limit)
          .map((entry) => entry.item)
        const notes: string[] = []
        if (items.length === 0) notes.push(`Nothing was added in the last ${days} days.`)
        if (importSkipped > 0 && importUntil) {
          notes.push(
            `${importSkipped} titles first seen when their library was imported (until ${(importUntil as Date)
              .toISOString()
              .slice(0, 10)}) are left out: they were already there, not newly added.`
          )
        }
        return {
          id: `recently-added-${Date.now()}`,
          days,
          count: items.length,
          items,
          ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
        }
      },
    }),

    getHouseholdFavourites: tool({
      description:
        'What the household has been playing most: titles ranked by how many different people played them in a recent window. Counts only, never who. Use for "what everyone is watching" sections.',
      inputSchema: nullSafe(
        z.object({
          type: typeParam,
          days: z.number().int().min(1).max(365).optional().default(30).describe('Window in days (default 30)'),
          limit: limitParam(15),
        })
      ),
      execute: async ({ type, days = 30, limit = 15 }) => {
        const want = kinds(type)
        const ranked: { viewers: number; item: ReturnType<typeof card> }[] = []
        const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`
        // An approximately dated watch has no place on a time axis (F-108).
        const recent = `wh.last_played_at >= NOW() - make_interval(days => $1::int) AND wh.approximate_played_at IS NULL`
        if (want.movies) {
          const params: unknown[] = [days]
          const inScope = libraryScopeSql(ctx.scope, 'm', binderFor(params))
          params.push(limit)
          const rows = await query<TitleRow & { viewers: string }>(
            `SELECT ${TITLE_COLUMNS('m')}, w.viewers
               FROM (SELECT wh.movie_id, COUNT(DISTINCT wh.user_id)::text AS viewers, MAX(wh.last_played_at) AS latest
                       FROM watch_history wh JOIN users u ON u.id = wh.user_id
                      WHERE wh.movie_id IS NOT NULL AND ${WATCH_HISTORY_PLAYED_SQL} AND ${recent} AND ${HOUSEHOLD_SQL}
                      GROUP BY wh.movie_id) w
               JOIN movies m ON m.id = w.movie_id
              WHERE ${inScope}
              ORDER BY w.viewers::int DESC, w.latest DESC, m.id
              LIMIT $${params.length}`,
            params
          )
          for (const row of rows.rows) {
            const viewers = Number.parseInt(row.viewers, 10)
            ranked.push({ viewers, item: card(ctx, 'movie', row, `Played by ${people(viewers)}`) })
          }
        }
        if (want.series) {
          const params: unknown[] = [days]
          const inScope = libraryScopeSql(ctx.scope, 's', binderFor(params))
          params.push(limit)
          const rows = await query<TitleRow & { viewers: string }>(
            `SELECT ${TITLE_COLUMNS('s')}, w.viewers
               FROM (SELECT e.series_id, COUNT(DISTINCT wh.user_id)::text AS viewers, MAX(wh.last_played_at) AS latest
                       FROM watch_history wh
                       JOIN episodes e ON e.id = wh.episode_id
                       JOIN users u ON u.id = wh.user_id
                      WHERE ${WATCH_HISTORY_PLAYED_SQL} AND ${recent} AND ${HOUSEHOLD_SQL}
                      GROUP BY e.series_id) w
               JOIN series s ON s.id = w.series_id
              WHERE ${inScope}
              ORDER BY w.viewers::int DESC, w.latest DESC, s.id
              LIMIT $${params.length}`,
            params
          )
          for (const row of rows.rows) {
            const viewers = Number.parseInt(row.viewers, 10)
            ranked.push({ viewers, item: card(ctx, 'series', row, `Watched by ${people(viewers)}`) })
          }
        }
        // One list of at most `limit`, whichever kinds were asked for. Stable:
        // films and shows tied on viewers keep their own order.
        const items = ranked
          .sort((a, b) => b.viewers - a.viewers)
          .slice(0, limit)
          .map((r) => r.item)
        return {
          id: `household-favourites-${Date.now()}`,
          days,
          count: items.length,
          items,
          ...(items.length === 0 ? { note: `Nobody played anything in the last ${days} days.` } : {}),
        }
      },
    }),

    getHiddenGems: tool({
      description:
        'Well-rated titles almost nobody in the household has played. Good for "you might have missed" sections.',
      inputSchema: nullSafe(
        z.object({
          type: typeParam,
          minRating: z.number().min(0).max(10).optional().default(7.5).describe('Lowest rating, 0–10 (default 7.5)'),
          maxViewers: z
            .number()
            .int()
            .min(0)
            .max(20)
            .optional()
            .default(1)
            .describe('Most people who may have played it (default 1)'),
          genre: genreParam,
          limit: limitParam(15),
        })
      ),
      execute: async ({ type, minRating = 7.5, maxViewers = 1, genre, limit = 15 }) => {
        const want = kinds(type)
        const ranked: { rating: number; item: ReturnType<typeof card> }[] = []
        const push = (type: 'movie' | 'series', row: TitleRow & { viewers: string }, subtitle: string) => {
          const item = card(ctx, type, row, subtitle)
          ranked.push({ rating: item.rating ?? 0, item })
        }
        if (want.movies) {
          const params: unknown[] = [minRating, maxViewers]
          const genreSql = genreClause('m', genre, params)
          const inScope = libraryScopeSql(ctx.scope, 'm', binderFor(params))
          params.push(limit)
          // Grouped once and joined (as watcherFilter.ts): LEFT JOIN + COALESCE so
          // a title nobody played counts as 0, which is the point.
          const rows = await query<TitleRow & { viewers: string }>(
            `SELECT ${TITLE_COLUMNS('m')}, COALESCE(w.viewers, 0)::text AS viewers
               FROM movies m
               LEFT JOIN (SELECT wh.movie_id, COUNT(DISTINCT wh.user_id) AS viewers
                            FROM watch_history wh JOIN users u ON u.id = wh.user_id
                           WHERE wh.movie_id IS NOT NULL AND ${WATCH_HISTORY_PLAYED_SQL} AND ${HOUSEHOLD_SQL}
                           GROUP BY wh.movie_id) w ON w.movie_id = m.id
              WHERE ${displayRatingSql('m')} >= $1 AND COALESCE(w.viewers, 0) <= $2 AND ${genreSql} AND ${inScope}
              ORDER BY ${displayRatingSql('m')} DESC NULLS LAST, m.id
              LIMIT $${params.length}`,
            params
          )
          for (const row of rows.rows) push('movie', row, `Played by ${row.viewers}`)
        }
        if (want.series) {
          const params: unknown[] = [minRating, maxViewers]
          const genreSql = genreClause('s', genre, params)
          const inScope = libraryScopeSql(ctx.scope, 's', binderFor(params))
          params.push(limit)
          const rows = await query<TitleRow & { viewers: string }>(
            `SELECT ${TITLE_COLUMNS('s')}, COALESCE(w.viewers, 0)::text AS viewers
               FROM series s
               LEFT JOIN (SELECT e.series_id, COUNT(DISTINCT wh.user_id) AS viewers
                            FROM watch_history wh
                            JOIN episodes e ON e.id = wh.episode_id
                            JOIN users u ON u.id = wh.user_id
                           WHERE ${WATCH_HISTORY_PLAYED_SQL} AND ${HOUSEHOLD_SQL}
                           GROUP BY e.series_id) w ON w.series_id = s.id
              WHERE ${displayRatingSql('s')} >= $1 AND COALESCE(w.viewers, 0) <= $2 AND ${genreSql} AND ${inScope}
              ORDER BY ${displayRatingSql('s')} DESC NULLS LAST, s.id
              LIMIT $${params.length}`,
            params
          )
          for (const row of rows.rows) push('series', row, `Watched by ${row.viewers}`)
        }
        // One list of at most `limit`, best rated first, whichever kinds were asked for.
        const items = ranked
          .sort((a, b) => b.rating - a.rating)
          .slice(0, limit)
          .map((r) => r.item)
        return { id: `hidden-gems-${Date.now()}`, count: items.length, items }
      },
    }),

    checkAudienceReach: tool({
      description:
        "How many of THIS newsletter's recipients can open each title. A reader whose libraries do not hold a title gets the email without that card, so check before building an issue around a title. Without titleIds it checks every title card in the current draft.",
      inputSchema: nullSafe(
        z.object({
          titles: z
            .array(z.object({ id: z.string(), type: z.enum(['movie', 'series']) }))
            .max(40)
            .optional()
            .describe('Titles to check, ids and types from search results'),
        })
      ),
      execute: async ({ titles }) => {
        const refs: TitleRef[] =
          titles && titles.length > 0
            ? draftTitleRefs(titles.map((t) => ({ kind: 'title', titleId: t.id, mediaType: t.type })))
            : titleRefsIn(readNewsletterDocument(draft.content))
        const recipients = await currentRecipients(draft.groupIds)
        if (draft.groupIds.length === 0) {
          return { id: `reach-${Date.now()}`, note: 'No send groups are chosen for this newsletter yet, so there is no audience to check.' }
        }
        if (refs.length === 0) return { id: `reach-${Date.now()}`, note: 'No titles to check.' }
        const [visible, facts] = await Promise.all([
          visibleTitlesByUser(
            recipients.map((r) => r.id),
            refs
          ),
          loadTitleFacts(refs),
        ])
        return {
          id: `reach-${Date.now()}`,
          recipients: recipients.length,
          titles: refs.map((ref) => {
            const key = titleKey(ref)
            let canOpen = 0
            for (const set of visible.values()) if (set.has(key)) canOpen += 1
            return { id: ref.id, type: ref.mediaType, title: facts.get(key)?.title ?? 'unknown title', canOpen, of: recipients.length }
          }),
        }
      },
    }),

    getPastIssues: tool({
      description:
        'Earlier newsletters that were sent: subject, date and the titles they featured. Use it to avoid featuring the same titles again.',
      inputSchema: nullSafe(
        z.object({ count: z.number().int().min(1).max(12).optional().default(5).describe('How many issues (default 5)') })
      ),
      execute: async ({ count = 5 }) => {
        // Anything that reached anyone, a send that failed partway included: its
        // readers have seen those titles. A failed send has no `sentAt`, so it
        // is dated by when sending started. ISO strings sort as dates.
        const sentOn = (n: { sentAt: string | null; sendStartedAt: string | null; updatedAt: string }) =>
          n.sentAt ?? n.sendStartedAt ?? n.updatedAt
        const sent = (await listNewsletters())
          .filter((n) => n.sentCount > 0)
          .sort((a, b) => sentOn(b).localeCompare(sentOn(a)))
          .slice(0, count)
        const perIssue = sent.map((issue) => ({ issue, refs: titleRefsIn(readNewsletterDocument(issue.content)) }))
        const facts = await loadTitleFacts(perIssue.flatMap((p) => p.refs))
        return {
          id: `past-issues-${Date.now()}`,
          issues: perIssue.map(({ issue, refs }) => ({
            subject: issue.subject,
            sentAt: sentOn(issue),
            ...(issue.status === 'failed' ? { partlySent: true } : {}),
            titles: refs.map((ref) => {
              const fact = facts.get(titleKey(ref))
              return fact ? `${fact.title}${fact.year ? ` (${fact.year})` : ''}` : 'a title no longer in the library'
            }),
          })),
          ...(sent.length === 0 ? { note: 'No newsletter has been sent yet.' } : {}),
        }
      },
    }),

    readCurrentDraft: tool({
      description:
        'The newsletter as it stands in the editor: subject, preheader, its text in order and its title cards. Read it before writing an intro, a summary or anything that must fit what is already there.',
      inputSchema: nullSafe(z.object({})),
      execute: async () => ({ id: `draft-${Date.now()}`, ...(await summarizeDraft(draft)) }),
    }),

    proposeDraft: tool({
      description:
        'Hand content to the admin. They see it as a preview with Insert buttons; nothing reaches the newsletter until they insert it. Put ALL newsletter text here, never only in chat. Blocks: heading, subheading, paragraph (blank line = new paragraph), bullets/numbered (items), quote, rule, title (a library title card: titleId and mediaType from a search result, optional fields and analysisParts). Inline styling: **bold**, *italic*, [label](https://…).',
      inputSchema: nullSafe(
        z.object({
          subject: z.string().max(200).optional().describe('A suggested subject line, when one was asked for or fits'),
          preheader: z.string().max(200).optional().describe('A suggested preview line shown after the subject in inboxes'),
          blocks: z
            .array(
              z.object({
                kind: z.enum(DRAFT_BLOCK_KINDS),
                text: z.string().optional().describe('heading, subheading, paragraph, quote'),
                items: z.array(z.string()).optional().describe('bullets, numbered'),
                titleId: z.string().optional().describe('title: the id from a search result'),
                mediaType: z.enum(['movie', 'series']).optional().describe('title: movie or series'),
                fields: z
                  .array(z.string())
                  .optional()
                  .describe('title: what the card shows; omit for the defaults'),
                analysisParts: z
                  .array(z.string())
                  .optional()
                  .describe('title: which analysis parts, only with the "analysis" field'),
              })
            )
            .max(120)
            .describe('The content, in reading order'),
        })
      ),
      execute: async ({ subject, preheader, blocks }) => {
        const refs = draftTitleRefs(blocks)
        const titles = await titleInfoInScope(refs, ctx.scope)
        const result = buildDraftContent(blocks, titles)
        return {
          id: `proposal-${Date.now()}`,
          proposal: {
            subject: subject?.trim() || null,
            preheader: preheader?.trim() || null,
            content: result.content,
            titles: result.titles,
            dropped: result.dropped,
            problem: result.problem,
            // Inserted beside what the newsletter holds now, would it still save?
            // The panel checks titles again at the moment of inserting.
            insertProblem: insertProblem(draft.content, result.content),
          },
        }
      },
      // The model reads a summary back, not the editor nodes: they are for the
      // panel, and would be resent on every later turn.
      toModelOutput: (output: unknown) => {
        const proposal = (
          output as {
            proposal?: Parameters<typeof describeDraftForModel>[0] & { subject: string | null; insertProblem?: string | null }
          }
        ).proposal
        return {
          type: 'text',
          value: proposal
            ? describeDraftForModel(proposal, proposal.subject, proposal.insertProblem ?? null)
            : JSON.stringify(output),
        }
      },
    }),
  }
}
