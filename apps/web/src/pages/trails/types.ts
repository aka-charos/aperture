/**
 * The Trails API's shapes, mirrored by hand from core's `trails/index.ts`
 * (the bundle never imports core). Change the two together.
 */

export type TrailEntityKind = 'person' | 'franchise' | 'company' | 'keyword'

export type TrailRole =
  | 'franchise'
  | 'director'
  | 'creator'
  | 'writer'
  | 'lead'
  | 'cinematographer'
  | 'composer'
  | 'editor'
  | 'actor'
  | 'keyword'
  | 'studio'
  | 'network'

export interface TrailTitle {
  /** `movie:<id>` or `series:<id>`. */
  ref: string
  type: 'movie' | 'series'
  id: string
  title: string
  year: number | null
  posterUrl: string | null
}

export interface TrailEntity {
  /** Stable across index rebuilds: how a thread is asked for again. */
  key: string
  kind: TrailEntityKind
  name: string
  photo: string | null
  /** Titles in the viewer's library carrying it. */
  titleCount: number
}

export interface TrailLink extends TrailEntity {
  rolesFrom: TrailRole[]
  rolesTo: TrailRole[]
}

export interface ThreadMember {
  title: TrailTitle
  roles: TrailRole[]
}

export interface Thread extends TrailEntity {
  roles: TrailRole[]
  others: ThreadMember[]
  more: number
}

export interface ThreadsResponse {
  title: TrailTitle
  threads: Thread[]
  /** Every thread out of the title, also when `limit` asked for fewer. */
  total: number
}

export interface ThreadResponse {
  title: TrailTitle
  /** Null when the thread leads nowhere (everything on it hidden, or gone). */
  thread: Thread | null
}

export interface TrailResponse {
  /** The trail's titles in the viewer's library, in order. */
  titles: TrailTitle[]
  /** links[i] joins titles[i] to titles[i + 1]: the strongest thing they share, or null. */
  links: (TrailLink | null)[]
}

export interface WalkResponse {
  start: TrailTitle
  steps: Array<{ title: TrailTitle; via: TrailLink }>
}
