/**
 * Small derivations the hero and the info card both need.
 *
 * They live outside either component file because the hero and the info card
 * now share them — and because a module that exports both a component and a
 * plain function trips the react-refresh lint rule, which this repo runs at
 * --max-warnings 0.
 */
import type { Media } from './types'
import { isMovie, isSeries } from './types'

/**
 * Whether any external score exists, so the hero can skip the rating line
 * entirely.
 *
 * `!= null` rather than a truthiness test: pg hands NUMERIC back as a string,
 * so a stored 0 arrives as '0.0' and passes a truthy test, while a genuine 0
 * arriving as a number fails one. Both directions are wrong, and the panel this
 * replaced had one guard of each kind.
 */
export function hasCriticRatings(media: Media): boolean {
  return (
    media.rt_critic_score != null ||
    media.rt_audience_score != null ||
    media.metacritic_score != null ||
    media.letterboxd_score != null ||
    media.imdb_rating != null ||
    media.tmdb_rating != null
  )
}

/**
 * Routes to the pages a detail view links out to. Shared because the hero and
 * the info card both link people now that the director and writer credits sit
 * at the top: two copies of an encodeURIComponent call is exactly the kind of
 * near-duplicate that drifts once one of them gains a query parameter.
 */
export function personPath(name: string): string {
  return `/person/${encodeURIComponent(name)}`
}

export function studioPath(name: string): string {
  return `/studio/${encodeURIComponent(name)}`
}

/**
 * The external page for a title on each service we hold an identifier for, or
 * null where we hold none.
 *
 * Built here rather than in either component because the hero's score badges
 * and the info card's link row both need them now, and because the TMDb path
 * differs by media type — a detail worth getting right once instead of twice.
 *
 * There is deliberately nothing here for Rotten Tomatoes, Metacritic or
 * Letterboxd. We store their SCORES and nothing else: `db/migrations/0059`
 * adds `rt_critic_score`, `rt_audience_score` and `metacritic_score` as bare
 * INTEGERs, and MDBList's per-rating `url` is dropped at extraction rather
 * than persisted. Their URLs cannot be derived from anything we do hold —
 * every one of those sites keys off its own slug — so a link would have to be
 * a guess, and a guessed link that 404s is worse than no link.
 */
export function imdbUrl(media: Media): string | null {
  return media.imdb_id ? `https://www.imdb.com/title/${media.imdb_id}` : null
}

export function tmdbUrl(media: Media): string | null {
  if (!media.tmdb_id) return null
  return `https://www.themoviedb.org/${isMovie(media) ? 'movie' : 'tv'}/${media.tmdb_id}`
}

export function tvdbUrl(media: Media): string | null {
  if (!isSeries(media) || !media.tvdb_id) return null
  return `https://thetvdb.com/?id=${media.tvdb_id}&tab=series`
}

/**
 * Whether the hero's score badge for a service is already a link to it.
 *
 * The badges exist wherever we hold a SCORE, which is most titles and not all
 * — an un-enriched film has an imdb_id and no imdb_rating, so it gets an IMDb
 * page but no badge to hang the link on. That is why the info card still
 * carries a link row, and why it asks this rather than assuming: one predicate,
 * so the two files cannot drift into showing a link twice or not at all.
 */
export function badgeLinksTo(media: Media, service: 'imdb' | 'tmdb'): boolean {
  if (service === 'imdb') return media.imdb_rating != null && imdbUrl(media) != null
  return media.tmdb_rating != null && tmdbUrl(media) != null
}
