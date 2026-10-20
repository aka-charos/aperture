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

export interface TrailStep {
  from: TrailTitle
  to: TrailTitle
  via: TrailLink
  alsoShared: TrailLink[]
}

export interface TrailRoute {
  steps: TrailStep[]
}

export type TrailResult =
  | { status: 'notFound' }
  | { status: 'same'; from: TrailTitle }
  | { status: 'found'; from: TrailTitle; to: TrailTitle; paths: TrailRoute[] }
  | { status: 'none'; from: TrailTitle; to: TrailTitle; isolated: string[] }

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
}

export interface CommonLink extends TrailEntity {
  carriers: Array<{ ref: string; roles: TrailRole[] }>
}

export interface CommonResponse {
  titles: TrailTitle[]
  links: CommonLink[]
}
