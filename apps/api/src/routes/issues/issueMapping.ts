/**
 * Seerr issue -> Aperture issue.
 *
 * Imports nothing at runtime (types only), so the mapping can be pinned by a
 * test without pulling the core barrel and its database pool into the test
 * process — the same reason `seerr/sources/seerrMapping.ts` is split out.
 *
 * The shape that matters here is not obvious from the API docs: Seerr has no
 * "description" column on an issue. `POST /issue` stores the reporter's
 * message as the issue's FIRST COMMENT, so a faithful thread reads as a report
 * followed by replies, and rendering every comment uniformly would show the
 * report twice — once as the summary and once as the opening reply.
 */
import type { SeerrIssue, SeerrIssueComment, SeerrUser } from '@aperture/core'

/** Decided values, never Seerr's integers — the bundle must not learn its enums. */
export type IssueKind = 'video' | 'audio' | 'subtitles' | 'other'
export type IssueState = 'open' | 'resolved'

const KIND_BY_CODE: Record<number, IssueKind> = {
  1: 'video',
  2: 'audio',
  3: 'subtitles',
  4: 'other',
}

const STATE_BY_CODE: Record<number, IssueState> = {
  1: 'open',
  2: 'resolved',
}

export interface IssueCommentView {
  id: number
  message: string
  author: string | null
  authorSeerrUserId: number | null
  createdAt: string
}

export interface IssueView {
  id: number
  kind: IssueKind
  state: IssueState
  mediaType: 'movie' | 'series'
  tmdbId: number
  /** The reporter's own words — Seerr's first comment. Null if it has none. */
  description: string | null
  /** Null means the whole title; Seerr stores 0 for that, which is not a season. */
  problemSeason: number | null
  problemEpisode: number | null
  reportedBy: string | null
  reportedBySeerrUserId: number | null
  /** Replies only. The opening comment is `description` and is not repeated here. */
  comments: IssueCommentView[]
  createdAt: string
  updatedAt: string
}

/**
 * Seerr sets `displayName` on load (username || plexUsername ||
 * jellyfinUsername || email). The fallback chain is repeated rather than
 * trusted, because an Emby-imported user has an EMPTY `username` and their
 * name in `jellyfinUsername` — so picking the wrong field shows a blank
 * author, or an email address, next to every comment.
 */
export function displayNameOf(user: SeerrUser | undefined): string | null {
  if (!user) return null
  const candidates = [user.displayName, user.username, user.jellyfinUsername, user.email]
  for (const candidate of candidates) {
    const trimmed = (candidate ?? '').trim()
    if (trimmed) return trimmed
  }
  return null
}

function mapComment(comment: SeerrIssueComment): IssueCommentView {
  return {
    id: comment.id,
    message: comment.message ?? '',
    author: displayNameOf(comment.user),
    authorSeerrUserId: comment.user?.id ?? null,
    createdAt: comment.createdAt,
  }
}

/** A 0 season/episode is Seerr's column default meaning "the whole title". */
function positiveOrNull(value: number | undefined): number | null {
  return typeof value === 'number' && value > 0 ? value : null
}

export function mapSeerrIssue(issue: SeerrIssue): IssueView {
  const comments = issue.comments ?? []
  const [opening, ...replies] = comments

  return {
    id: issue.id,
    kind: KIND_BY_CODE[issue.issueType] ?? 'other',
    state: STATE_BY_CODE[issue.status] ?? 'open',
    mediaType: issue.media?.mediaType === 'tv' ? 'series' : 'movie',
    tmdbId: issue.media?.tmdbId ?? 0,
    description: opening?.message?.trim() ? opening.message : null,
    problemSeason: positiveOrNull(issue.problemSeason),
    problemEpisode: positiveOrNull(issue.problemEpisode),
    reportedBy: displayNameOf(issue.createdBy),
    reportedBySeerrUserId: issue.createdBy?.id ?? null,
    comments: replies.map(mapComment),
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
  }
}

/** The issue types a client may ask for, and their Seerr codes. */
export const ISSUE_KIND_CODES: Record<IssueKind, 1 | 2 | 3 | 4> = {
  video: 1,
  audio: 2,
  subtitles: 3,
  other: 4,
}

/** Reject anything that is not one of the four, rather than defaulting to `other`. */
export function toIssueKindCode(raw: string | undefined): 1 | 2 | 3 | 4 | null {
  if (raw && raw in ISSUE_KIND_CODES) return ISSUE_KIND_CODES[raw as IssueKind]
  return null
}
