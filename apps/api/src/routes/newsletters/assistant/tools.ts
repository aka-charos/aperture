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
import {
  MAX_LIST_LIMIT,
  TITLE_COLUMNS,
  genreClause,
  issueSentOn,
  mergeRanked,
  recentMoviesQuery,
  recentSeriesQuery,
  recentlyAddedNote,
  sentIssues,
  type RecentlyAddedQuery,
} from './lists.js'

const OVERVIEW_CHARS = 280

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
  z
    .number()
    .int()
    .min(1)
    .max(MAX_LIST_LIMIT)
    .optional()
    .default(fallback)
    .describe(`How many titles (default ${fallback}, max ${MAX_LIST_LIMIT})`)
const genreParam = z
  .string()
  .optional()
  .describe('Optional genre as the library names it (see getAvailableGenres), e.g. "Horror"')

const kinds = (type: 'movies' | 'series' | 'both') => ({
  movies: type !== 'series',
  series: type !== 'movies',
})

/** A recently-added row: a title (NULL columns when none qualified) plus the query's import summary. */
type RecentRow = TitleRow & {
  created_at: Date
  latest: Date | null
  is_new?: boolean
  new_episodes?: number | null
  skipped: number
  import_until: Date | null
}

async function runRecent({ sql, params }: RecentlyAddedQuery): Promise<RecentRow[]> {
  return (await query<RecentRow>(sql, params)).rows
}

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
        const input = { days, genre, scope: ctx.scope, limit }
        const found: { score: number; item: ReturnType<typeof card> }[] = []
        let skipped = 0
        let importUntil: Date | null = null
        const readSummary = (row: RecentRow | undefined) => {
          if (!row?.skipped) return
          skipped += row.skipped
          if (row.import_until && (!importUntil || row.import_until > importUntil)) importUntil = row.import_until
        }
        const day = (date: Date) => date.toISOString().slice(0, 10)

        const [movies, series] = await Promise.all([
          want.movies ? runRecent(recentMoviesQuery(input)) : Promise.resolve([]),
          want.series ? runRecent(recentSeriesQuery(input)) : Promise.resolve([]),
        ])
        readSummary(movies[0])
        readSummary(series[0])
        for (const row of movies) {
          if (!row.id || !row.latest) continue
          found.push({ score: row.latest.getTime(), item: card(ctx, 'movie', row, `New film, added ${day(row.created_at)}`) })
        }
        for (const row of series) {
          if (!row.id || !row.latest) continue
          const episodes = row.new_episodes ?? 0
          const subtitle = row.is_new
            ? `New show, added ${day(row.created_at)}`
            : `${episodes} new episode${episodes === 1 ? '' : 's'}, latest ${day(row.latest)}`
          found.push({ score: row.latest.getTime(), item: card(ctx, 'series', row, subtitle) })
        }
        const items = mergeRanked(found, limit)
        const note = recentlyAddedNote({ days, count: items.length, skipped, importUntil })
        return {
          id: `recently-added-${Date.now()}`,
          days,
          count: items.length,
          items,
          ...(note ? { note } : {}),
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
        const ranked: { score: number; item: ReturnType<typeof card> }[] = []
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
            ranked.push({ score: viewers, item: card(ctx, 'movie', row, `Played by ${people(viewers)}`) })
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
            ranked.push({ score: viewers, item: card(ctx, 'series', row, `Watched by ${people(viewers)}`) })
          }
        }
        // One list of at most `limit`, most played first, whichever kinds were asked for.
        const items = mergeRanked(ranked, limit)
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
        const ranked: { score: number; item: ReturnType<typeof card> }[] = []
        const push = (mediaType: 'movie' | 'series', row: TitleRow & { viewers: string }, subtitle: string) => {
          const item = card(ctx, mediaType, row, subtitle)
          ranked.push({ score: item.rating ?? 0, item })
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
        const items = mergeRanked(ranked, limit)
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
        // Anything that reached anyone, a send that failed partway included:
        // its readers have seen those titles (`sentIssues`, lists.ts).
        const sent = sentIssues(await listNewsletters(), count)
        const perIssue = sent.map((issue) => ({ issue, refs: titleRefsIn(readNewsletterDocument(issue.content)) }))
        const facts = await loadTitleFacts(perIssue.flatMap((p) => p.refs))
        return {
          id: `past-issues-${Date.now()}`,
          issues: perIssue.map(({ issue, refs }) => ({
            subject: issue.subject,
            sentAt: issueSentOn(issue),
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
            // For the model (toModelOutput): beside the newsletter as it was sent
            // with this turn, would it still save? The panel never relies on it,
            // since it goes stale with the first edit: it asks
            // /api/newsletters/assistant/insert-check when Insert is pressed.
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
