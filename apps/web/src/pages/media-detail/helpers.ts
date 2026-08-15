/**
 * Small derivations the hero and the info card both need.
 *
 * They live outside either component file because the hero and the info card
 * now share them — and because a module that exports both a component and a
 * plain function trips the react-refresh lint rule, which this repo runs at
 * --max-warnings 0.
 */
import type { Media } from './types'

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
