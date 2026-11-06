/**
 * What `getUpcomingEpisodes` tells the viewer, decided without a database.
 *
 * Two distinctions are the point of this file, because the model will state
 * whatever it is handed as fact:
 *
 * - **Expected is not playable.** A TMDb forecast says when an episode should
 *   air somewhere; it says nothing about this library having it then. A future
 *   date on the media server is no better, since a listed episode need not have
 *   a file yet. Only an aired episode the server holds is "in your library".
 * - **Nothing announced is not "could not ask".** A missing TMDb key, a failed
 *   lookup and a show TMDb does not know all leave a show with no date, and only
 *   TMDb answering says nothing is scheduled (the `tmdbLookup` rule in CLAUDE.md).
 *
 * No horizon here, unlike the Watching page: a premiere announced for next
 * summer crowds that page, but it IS the answer to "what's coming next".
 */
import type {
  AiredEpisode,
  SeasonProgress,
  UpcomingEpisode,
  UpcomingEpisodesReport,
  UpcomingGap,
} from '@aperture/core/watching'
import type {
  ContentCarouselI18nKey,
  ContentItem,
  UpcomingAired,
  UpcomingInfo,
} from '../schemas/index.js'

export const UPCOMING_DEFAULT_LIMIT = 20
export const UPCOMING_MAX_LIMIT = 50
/** Most titles named in each no-date list. The counts still cover every show. */
export const UPCOMING_MAX_LISTED_TITLES = 40

/** One row of the viewer's followed shows, already narrowed to their scope. */
export interface FollowedShow {
  id: string
  title: string
  year: number | null
  poster_url: string | null
  genres: string[] | null
  /** NUMERIC: arrives as a string. */
  community_rating: number | string | null
  tmdb_status: string | null
}

/** Why a followed show could not be checked. */
export type UncheckedReason = Exclude<UpcomingGap, 'noneAnnounced' | 'notAsked'>

export type UpcomingAnswerKind =
  | 'scheduled'
  | 'nothingAnnounced'
  | 'notFollowing'
  | 'noTmdbKey'
  | 'lookupFailed'
  | 'noTmdbEntry'

export interface UpcomingAnswer {
  id: string
  titleKey: ContentCarouselI18nKey
  descriptionKey: ContentCarouselI18nKey
  descriptionParams: Record<string, string | number>
  items: ContentItem[]
  /** The tool's verdict. Read this first: an empty `items` has several meanings. */
  answer: UpcomingAnswerKind
  today: string
  counts: { followed: number; scheduled: number; nothingAnnounced: number; couldNotCheck: number }
  nothingAnnounced: Array<{ title: string; ended: boolean; latestAired: UpcomingAired | null }>
  couldNotCheck: Array<{ title: string; reason: UncheckedReason; latestAired: UpcomingAired | null }>
}

/**
 * A calendar day as `YYYY-MM-DD`. `UpcomingEpisode.airDate` is typed a string,
 * but the media-server path reads a bare DATE column and node-pg turns that into
 * a Date at the server's local midnight, so its local parts are the stored day
 * and `toISOString` would read a day early east of UTC.
 */
export function airDay(value: string | Date): string {
  if (typeof value === 'string') return value.slice(0, 10)
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${value.getFullYear()}-${month}-${day}`
}

/**
 * A show's latest aired episode and where it stands for this viewer. `inLibrary`
 * also holds for a TMDb date the server has caught up with: TMDb wins the
 * "latest" comparison on a same-numbered episode the server holds undated.
 */
export function describeLatestAired(
  latest: AiredEpisode | undefined,
  seasons: ReadonlyMap<number, SeasonProgress> | undefined
): UpcomingAired | null {
  if (!latest) return null
  const progress = seasons?.get(latest.seasonNumber)
  const serverLast = progress?.serverLastEpisode
  const playedLast = progress?.playedLastEpisode
  return {
    season: latest.seasonNumber,
    number: latest.episodeNumber,
    title: latest.title,
    airDate: airDay(latest.airDate),
    inLibrary: latest.source === 'emby' || (serverLast != null && serverLast >= latest.episodeNumber),
    played: playedLast != null && playedLast >= latest.episodeNumber,
  }
}

export function describeNext(episode: UpcomingEpisode, today: string): UpcomingInfo['next'] {
  const date = airDay(episode.airDate)
  return {
    season: episode.seasonNumber,
    number: episode.episodeNumber,
    title: episode.title,
    airDate: date,
    // Only a forecast can be in the past: the server path asks for today onward.
    status: date < today ? 'pastDue' : 'expected',
    basis: episode.source === 'tmdb' ? 'tmdbForecast' : 'serverListing',
  }
}

/** TMDb's word on a show being over. The media server's status is often stale. */
function hasEnded(tmdbStatus: string | null): boolean {
  return tmdbStatus === 'Ended' || tmdbStatus === 'Canceled'
}

/**
 * The verdict. With no dates at all, a reason nothing could be asked outranks
 * "nothing announced": telling someone nothing is coming because TMDb timed out
 * is the failure this exists to prevent.
 */
export function upcomingAnswerKind(counts: {
  followed: number
  scheduled: number
  nothingAnnounced: number
  reasons: ReadonlySet<UncheckedReason>
}): UpcomingAnswerKind {
  if (counts.followed === 0) return 'notFollowing'
  if (counts.scheduled > 0) return 'scheduled'
  if (counts.reasons.has('noTmdbKey')) return 'noTmdbKey'
  if (counts.reasons.has('lookupFailed')) return 'lookupFailed'
  return counts.nothingAnnounced > 0 ? 'nothingAnnounced' : 'noTmdbEntry'
}

function caption(
  answer: UpcomingAnswerKind,
  counts: UpcomingAnswer['counts']
): Pick<UpcomingAnswer, 'descriptionKey' | 'descriptionParams'> {
  const unchecked = counts.couldNotCheck
  switch (answer) {
    case 'notFollowing':
      return { descriptionKey: 'carouselUpcomingNotFollowing', descriptionParams: {} }
    case 'noTmdbKey':
      return { descriptionKey: 'carouselUpcomingNoTmdbKey', descriptionParams: {} }
    case 'lookupFailed':
      return { descriptionKey: 'carouselUpcomingLookupFailed', descriptionParams: { unchecked } }
    case 'noTmdbEntry':
      return { descriptionKey: 'carouselUpcomingNoTmdbEntry', descriptionParams: { unchecked } }
    case 'nothingAnnounced':
      return {
        descriptionKey: unchecked > 0 ? 'carouselUpcomingNothingPartial' : 'carouselUpcomingNothing',
        descriptionParams: { count: counts.nothingAnnounced, unchecked },
      }
    case 'scheduled':
      return {
        descriptionKey: unchecked > 0 ? 'carouselUpcomingDescPartial' : 'carouselUpcomingDesc',
        descriptionParams: { count: counts.scheduled, unchecked },
      }
  }
}

function upcomingItem(show: FollowedShow, upcoming: UpcomingInfo): ContentItem {
  return {
    // The show, not the episode: the card opens the show, and an unaired episode
    // has no page. So no `episode` ref, which would also offer Play.
    id: show.id,
    type: 'series',
    name: show.title,
    subtitle: [show.year, (show.genres ?? []).slice(0, 2).join(', ')].filter(Boolean).join(' · '),
    image: show.poster_url,
    rating: show.community_rating != null ? Number(show.community_rating) : null,
    upcoming,
    actions: [{ id: 'details', label: 'Details', href: `/series/${show.id}`, variant: 'secondary' }],
  }
}

/** Soonest first; a date shared by several shows reads alphabetically. */
function bySoonest(
  a: { item: ContentItem; day: string },
  b: { item: ContentItem; day: string }
): number {
  return a.day.localeCompare(b.day) || a.item.name.localeCompare(b.item.name)
}

export function buildUpcomingAnswer(input: {
  id: string
  shows: FollowedShow[]
  report: UpcomingEpisodesReport
  latestAired: ReadonlyMap<string, AiredEpisode>
  seasonProgress: ReadonlyMap<string, ReadonlyMap<number, SeasonProgress>>
  today: string
  limit: number
}): UpcomingAnswer {
  const scheduled: Array<{ item: ContentItem; day: string }> = []
  const nothingAnnounced: UpcomingAnswer['nothingAnnounced'] = []
  const couldNotCheck: UpcomingAnswer['couldNotCheck'] = []
  const reasons = new Set<UncheckedReason>()

  for (const show of input.shows) {
    const latestAired = describeLatestAired(
      input.latestAired.get(show.id),
      input.seasonProgress.get(show.id)
    )
    const episode = input.report.episodes.get(show.id)
    if (episode) {
      const next = describeNext(episode, input.today)
      scheduled.push({ item: upcomingItem(show, { next, latestAired }), day: next.airDate })
      continue
    }
    const gap = input.report.gaps.get(show.id)
    if (gap === 'noneAnnounced') {
      nothingAnnounced.push({ title: show.title, ended: hasEnded(show.tmdb_status), latestAired })
      continue
    }
    // Nothing recorded means nothing was learned, so it reads as a failure.
    const reason: UncheckedReason = gap && gap !== 'notAsked' ? gap : 'lookupFailed'
    reasons.add(reason)
    couldNotCheck.push({ title: show.title, reason, latestAired })
  }

  const counts: UpcomingAnswer['counts'] = {
    followed: input.shows.length,
    scheduled: scheduled.length,
    nothingAnnounced: nothingAnnounced.length,
    couldNotCheck: couldNotCheck.length,
  }
  const answer = upcomingAnswerKind({ ...counts, reasons })
  const items = scheduled.sort(bySoonest).slice(0, input.limit).map(({ item }) => item)

  return {
    id: input.id,
    titleKey: 'carouselUpcomingTitle',
    // The caption describes the cards under it; `counts` keeps the whole figure.
    ...caption(answer, { ...counts, scheduled: items.length }),
    items,
    answer,
    today: input.today,
    counts,
    nothingAnnounced: nothingAnnounced.slice(0, UPCOMING_MAX_LISTED_TITLES),
    couldNotCheck: couldNotCheck.slice(0, UPCOMING_MAX_LISTED_TITLES),
  }
}
