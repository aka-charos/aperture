/**
 * A newsletter, built into one recipient's email.
 *
 * The admin writes one document; each recipient gets it in THEIR language and
 * within THEIR library scope:
 *
 * - The words around the admin's text (fact labels, the footer, the link to a
 *   title) come from core `email/strings.ts` in the recipient's language. The
 *   admin's own text is sent as written — a group per language is how an
 *   operator writes to Greek and English readers separately.
 * - A title's plot and analysis are the machine translation into the
 *   recipient's language where one exists (core translation/store.ts), else
 *   the original, exactly as the title's page shows them. Genres go through
 *   TMDb's own names for that language.
 * - A title from a library the recipient may not open is LEFT OUT of their
 *   copy (lib/libraryScope.ts). An email is a place a title is shown, and
 *   "what a viewer is shown is their library scope" holds here too — a card
 *   for a film the server hides from someone would tell them it exists.
 *
 * Posters are fetched once per send and carried inside the message (never
 * linked: clients block remote images, and a remote image reports the open).
 * They are added in order of appearance until the per-message image budget is
 * spent; a card past it is sent without its poster rather than failing the
 * message.
 */
import { appLink } from '../email/links.js'
import type { EmailContext } from '../email/send.js'
import { fetchEmailImage } from '../email/images.js'
import { EMAIL_IMAGES_MAX_TOTAL_BYTES, type EmailImage } from '../email/rules.js'
import { emailText, type EmailStringKey } from '../email/strings.js'
import type { EmailBlock, EmailContent, EmailFact, EmailPassage } from '../email/template.js'
import { getStoredAnalysis } from '../analysis/generate.js'
import { splitAnalysisParagraphs } from '../analysis/paragraphMap.js'
import { query } from '../lib/db.js'
import {
  binderFor,
  getLibraryScopeForUser,
  libraryScopeSql,
  loadConfiguredLibraries,
  type LibraryScope,
} from '../lib/libraryScope.js'
import { appLocaleToTmdbLanguage, type AppLocaleCode } from '../lib/locales.js'
import { createChildLogger } from '../lib/logger.js'
import { getLocalizedGenreNames } from '../tmdb/genres.js'
import { resolveLocalizedAnalysis, resolveLocalizedSynopsis } from '../translation/store.js'
import { titleKey, titleRefsIn, type NewsletterPart, type TitleField, type TitleRef } from './document.js'

const logger = createChildLogger('newsletter')

/** Poster width asked of the media server; the card draws it at 120px, so this is 2x. */
const POSTER_MAX_WIDTH = 240
const MAX_CAST = 4

/** What a title's row holds, language-independent. */
export interface TitleFacts {
  ref: TitleRef
  title: string
  year: number | null
  endYear: number | null
  runtimeMinutes: number | null
  genres: string[]
  rating: { source: 'imdb' | 'community'; value: number } | null
  directors: string[]
  cast: string[]
  network: string | null
  languages: string[]
  countries: string[]
  overview: string | null
  plotFull: string | null
  posterUrl: string | null
}

const num = (value: unknown): number | null => {
  // NUMERIC arrives as text; NULL must stay absent, never become 0.
  if (value == null) return null
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value))
  return Number.isFinite(n) ? n : null
}

const names = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map((entry) => (typeof entry === 'string' ? entry : (entry as { name?: unknown })?.name))
        .filter((name): name is string => typeof name === 'string' && name.trim() !== '')
    : []

/** The facts for every title the document shows, keyed by `titleKey`. Missing titles are absent. */
export async function loadTitleFacts(refs: readonly TitleRef[]): Promise<Map<string, TitleFacts>> {
  const facts = new Map<string, TitleFacts>()
  const movieIds = refs.filter((r) => r.mediaType === 'movie').map((r) => r.id)
  const seriesIds = refs.filter((r) => r.mediaType === 'series').map((r) => r.id)
  type Row = Record<string, unknown> & { id: string; title: string }
  const [movies, series] = await Promise.all([
    movieIds.length
      ? query<Row>(
          `SELECT id, title, year, NULL::int AS end_year, runtime_minutes, genres, imdb_rating, community_rating,
                  directors, actors, NULL::text AS network, languages, production_countries, overview, plot_full,
                  poster_url
             FROM movies WHERE id = ANY($1::uuid[])`,
          [movieIds]
        )
      : Promise.resolve({ rows: [] as Row[] }),
    seriesIds.length
      ? query<Row>(
          `SELECT id, title, year, end_year, NULL::int AS runtime_minutes, genres, imdb_rating, community_rating,
                  COALESCE(NULLIF(directors, '{}'), tmdb_creators, '{}') AS directors, actors, network,
                  languages, production_countries, overview, plot_full, poster_url
             FROM series WHERE id = ANY($1::uuid[])`,
          [seriesIds]
        )
      : Promise.resolve({ rows: [] as Row[] }),
  ])
  const add = (mediaType: 'movie' | 'series', row: Row) => {
    const imdb = num(row.imdb_rating)
    const community = num(row.community_rating)
    const ref = { mediaType, id: row.id }
    facts.set(titleKey(ref), {
      ref,
      title: row.title,
      year: num(row.year),
      endYear: num(row.end_year),
      runtimeMinutes: num(row.runtime_minutes),
      genres: names(row.genres),
      rating:
        imdb != null && imdb > 0
          ? { source: 'imdb', value: imdb }
          : community != null && community > 0
            ? { source: 'community', value: community }
            : null,
      directors: names(row.directors),
      cast: names(row.actors).slice(0, MAX_CAST),
      network: typeof row.network === 'string' && row.network.trim() ? row.network : null,
      languages: names(row.languages),
      countries: names(row.production_countries),
      overview: typeof row.overview === 'string' && row.overview.trim() ? row.overview.trim() : null,
      plotFull: typeof row.plot_full === 'string' && row.plot_full.trim() ? row.plot_full.trim() : null,
      posterUrl: typeof row.poster_url === 'string' ? row.poster_url : null,
    })
  }
  for (const row of movies.rows) add('movie', row)
  for (const row of series.rows) add('series', row)
  return facts
}

/** What changes with the reader's language: plot, full plot, analysis, genre names. */
export interface LocalizedTitleText {
  overview: string | null
  plotFull: string | null
  analysis: string[]
}

export interface LanguageEdition {
  language: AppLocaleCode
  text: Map<string, LocalizedTitleText>
  genreNames: Record<string, string>
}

/**
 * The language-dependent text of every title, for one language. Reads only
 * what the document asks for: an analysis lookup is skipped for a title whose
 * card does not show one.
 */
export async function loadLanguageEdition(
  parts: readonly NewsletterPart[],
  facts: ReadonlyMap<string, TitleFacts>,
  language: AppLocaleCode
): Promise<LanguageEdition> {
  const wanted = new Map<string, Set<TitleField>>()
  for (const part of parts) {
    if (part.type !== 'titleRef') continue
    const set = wanted.get(titleKey(part)) ?? new Set<TitleField>()
    part.fields.forEach((f) => set.add(f))
    wanted.set(titleKey(part), set)
  }
  const anyGenres = [...wanted.values()].some((set) => set.has('genres'))
  const [genreNames, entries] = await Promise.all([
    anyGenres ? getLocalizedGenreNames(appLocaleToTmdbLanguage(language)) : Promise.resolve({}),
    Promise.all(
      [...wanted].map(async ([key, fields]): Promise<[string, LocalizedTitleText]> => {
        const fact = facts.get(key)
        if (!fact) return [key, { overview: null, plotFull: null, analysis: [] }]
        const { mediaType, id } = fact.ref
        // The language is always a valid locale here, so the viewer id the
        // resolvers take for their fallback is never read.
        const synopsis =
          fields.has('plot') || fields.has('fullPlot') ? await resolveLocalizedSynopsis(mediaType, id, language, '') : null
        let analysis: string[] = []
        if (fields.has('analysis')) {
          const localized = await resolveLocalizedAnalysis(mediaType, id, language, '')
          if (localized) {
            analysis = splitAnalysisParagraphs(localized.text)
          } else {
            const stored = await getStoredAnalysis(mediaType, id).catch(() => null)
            if (stored?.analysis) analysis = splitAnalysisParagraphs(stored.analysis)
          }
        }
        return [
          key,
          {
            overview: synopsis?.overview ?? fact.overview,
            plotFull: synopsis?.plot_full ?? fact.plotFull,
            analysis,
          },
        ]
      })
    ),
  ])
  return { language, text: new Map(entries), genreNames }
}

/**
 * Posters already fetched, by request URL. The editor's preview rebuilds the
 * whole newsletter after every pause in typing, and without this each rebuild
 * fetched every poster from the media server again. The URL carries the
 * server's image tag, so a changed poster is a different key; misses are not
 * remembered, so a poster that failed once is tried again next time.
 */
const POSTER_CACHE_TTL_MS = 10 * 60_000
const POSTER_CACHE_MAX = 200
const posterCache = new Map<string, { at: number; content: Buffer; contentType: EmailImage['contentType'] }>()

async function cachedPoster(url: string, cid: string): Promise<EmailImage | null> {
  const hit = posterCache.get(url)
  if (hit && Date.now() - hit.at < POSTER_CACHE_TTL_MS) return { cid, content: hit.content, contentType: hit.contentType }
  const image = await fetchEmailImage(url, cid)
  if (image) {
    posterCache.delete(url)
    posterCache.set(url, { at: Date.now(), content: image.content, contentType: image.contentType })
    // Oldest first: a Map iterates in insertion order.
    while (posterCache.size > POSTER_CACHE_MAX) posterCache.delete(posterCache.keys().next().value!)
  }
  return image
}

/** Posters for the titles that show one, cid by title key, within the per-message budget. */
export async function loadPosterImages(
  parts: readonly NewsletterPart[],
  facts: ReadonlyMap<string, TitleFacts>
): Promise<Map<string, EmailImage>> {
  const images = new Map<string, EmailImage>()
  const keys = [
    ...new Set(parts.filter((p) => p.type === 'titleRef' && p.fields.includes('poster')).map((p) => titleKey(p as TitleRef))),
  ]
  const fetched = await Promise.all(
    keys.map(async (key, index) => {
      const url = posterRequestUrl(facts.get(key)?.posterUrl ?? null)
      return url ? ([key, await cachedPoster(url, `poster-${index + 1}`)] as const) : ([key, null] as const)
    })
  )
  let total = 0
  for (const [key, image] of fetched) {
    if (!image) continue
    if (total + image.content.length > EMAIL_IMAGES_MAX_TOTAL_BYTES) {
      logger.info({ key }, 'Newsletter poster left out: the message image budget is spent')
      continue
    }
    total += image.content.length
    images.set(key, image)
  }
  return images
}

/** The media server's poster address with a width asked for, or null when there is none. */
export function posterRequestUrl(posterUrl: string | null): string | null {
  if (!posterUrl) return null
  try {
    const url = new URL(posterUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!url.searchParams.has('maxWidth') && !url.searchParams.has('width')) {
      url.searchParams.set('maxWidth', String(POSTER_MAX_WIDTH))
    }
    return url.toString()
  } catch {
    return null
  }
}

function scopeKey(scope: LibraryScope): string {
  return JSON.stringify([scope.libraryIds, scope.maxParentalRating])
}

/**
 * For each user, the title keys of the document they may see. Users sharing a
 * scope share one query.
 */
export async function visibleTitlesByUser(
  userIds: readonly string[],
  refs: readonly TitleRef[]
): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>()
  if (refs.length === 0) {
    for (const id of userIds) result.set(id, new Set())
    return result
  }
  const libraries = await loadConfiguredLibraries()
  const scopes = await Promise.all(userIds.map(async (id) => [id, await getLibraryScopeForUser(id, libraries)] as const))
  const byScope = new Map<string, Promise<Set<string>>>()
  const visibleFor = (scope: LibraryScope): Promise<Set<string>> => {
    const key = scopeKey(scope)
    let pending = byScope.get(key)
    if (!pending) {
      pending = (async () => {
        const visible = new Set<string>()
        for (const [mediaType, table] of [
          ['movie', 'movies'],
          ['series', 'series'],
        ] as const) {
          const ids = refs.filter((r) => r.mediaType === mediaType).map((r) => r.id)
          if (ids.length === 0) continue
          const params: unknown[] = [ids]
          const clause = libraryScopeSql(scope, 't', binderFor(params))
          const rows = await query<{ id: string }>(
            `SELECT t.id FROM ${table} t WHERE t.id = ANY($1::uuid[]) AND ${clause}`,
            params
          )
          for (const row of rows.rows) visible.add(titleKey({ mediaType, id: row.id }))
        }
        return visible
      })()
      byScope.set(key, pending)
    }
    return pending
  }
  for (const [id, scope] of scopes) result.set(id, await visibleFor(scope))
  return result
}

export interface NewsletterEnvelope {
  subject: string
  preheader: string
}

export interface RecipientCopy {
  /** Title keys this reader may see; null shows every title (an admin preview). */
  visibleTitles: ReadonlySet<string> | null
  /** Where their unsubscribe link points, or null (a preview or a test). */
  unsubscribeUrl: string | null
}

/**
 * The email content for one reader, plus the images it actually uses. Pure
 * given its inputs: everything looked up is passed in.
 */
export function buildNewsletterContent(input: {
  envelope: NewsletterEnvelope
  parts: readonly NewsletterPart[]
  facts: ReadonlyMap<string, TitleFacts>
  edition: LanguageEdition
  images: ReadonlyMap<string, EmailImage>
  context: EmailContext
  copy: RecipientCopy
}): { content: EmailContent; images: EmailImage[] } {
  const { envelope, parts, facts, edition, images, context, copy } = input
  const locale = context.locale
  const appName = context.frame.appName
  const text = (key: EmailStringKey, vars: Record<string, string> = {}) =>
    emailText(locale, key, { appName, ...vars })
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 })

  const used = new Map<string, EmailImage>()
  const blocks: EmailBlock[] = []
  for (const part of parts) {
    if (part.type !== 'titleRef') {
      blocks.push(part)
      continue
    }
    const key = titleKey(part)
    const fact = facts.get(key)
    if (!fact) continue
    if (copy.visibleTitles && !copy.visibleTitles.has(key)) continue
    const localized = edition.text.get(key)
    const has = (field: TitleField) => part.fields.includes(field)

    const meta: string[] = []
    if (has('year') && fact.year != null) {
      meta.push(
        fact.ref.mediaType === 'series'
          ? fact.endYear != null && fact.endYear !== fact.year
            ? `${fact.year}–${fact.endYear}`
            : String(fact.year)
          : String(fact.year)
      )
    }
    if (has('runtime') && fact.runtimeMinutes != null) {
      meta.push(text('newsletter.runtime', { minutes: String(Math.round(fact.runtimeMinutes)) }))
    }

    const facts_: EmailFact[] = []
    const addFact = (label: EmailStringKey, values: readonly string[]) => {
      if (values.length > 0) facts_.push({ label: text(label), value: values.join(', ') })
    }
    if (has('genres')) addFact('newsletter.fact.genres', fact.genres.map((g) => edition.genreNames[g] ?? g))
    if (has('rating') && fact.rating) {
      const value = number.format(fact.rating.value)
      addFact('newsletter.fact.rating', [fact.rating.source === 'imdb' ? `IMDb ${value}` : `${value} / 10`])
    }
    if (has('director')) {
      addFact(fact.ref.mediaType === 'series' ? 'newsletter.fact.creator' : 'newsletter.fact.director', fact.directors)
    }
    if (has('cast')) addFact('newsletter.fact.cast', fact.cast)
    if (has('network') && fact.network) addFact('newsletter.fact.network', [fact.network])
    if (has('languages')) addFact('newsletter.fact.languages', fact.languages)
    if (has('countries')) addFact('newsletter.fact.countries', fact.countries)

    const passages: EmailPassage[] = []
    const plot = has('fullPlot') && localized?.plotFull ? localized.plotFull : has('plot') ? localized?.overview : null
    if (plot) passages.push({ label: text('newsletter.passage.plot'), paragraphs: splitAnalysisParagraphs(plot) })
    if (has('analysis') && localized && localized.analysis.length > 0) {
      passages.push({ label: text('newsletter.passage.analysis'), paragraphs: localized.analysis })
    }

    const image = has('poster') ? images.get(key) : undefined
    if (image) used.set(key, image)
    const url = has('link')
      ? appLink(context.linkBase, `/${fact.ref.mediaType === 'series' ? 'series' : 'movies'}/${fact.ref.id}`)
      : null

    blocks.push({
      type: 'title',
      title: fact.title,
      meta: meta.length ? meta.join(' · ') : undefined,
      url,
      imageCid: image?.cid,
      facts: facts_,
      passages,
      linkLabel: url ? text('newsletter.open') : undefined,
    })
  }

  return {
    content: {
      subject: envelope.subject,
      preheader: envelope.preheader || undefined,
      heading: envelope.subject,
      paragraphs: [],
      blocks,
      footer: [text('newsletter.footer.why')],
      footerLink: copy.unsubscribeUrl ? { label: text('newsletter.unsubscribe'), url: copy.unsubscribeUrl } : undefined,
    },
    images: [...used.values()],
  }
}

/** Everything a send or a preview looks up once, whatever the reader. */
export async function prepareNewsletter(parts: readonly NewsletterPart[]) {
  const refs = titleRefsIn(parts)
  const facts = await loadTitleFacts(refs)
  const images = await loadPosterImages(parts, facts)
  return { refs, facts, images }
}
