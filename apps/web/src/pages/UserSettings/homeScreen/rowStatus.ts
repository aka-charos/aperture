/**
 * Which sentence a row shows about itself. Pure, so the one mapping from the
 * server's decided values to what a viewer reads is pinned rather than spread
 * through JSX. Every input is a value the server decided; this only picks the
 * words for it.
 */
import type { HomeRowContents, RowState, RowUnavailableReason, UserHomePlaylist } from './types'

export type RowStatus =
  /** It cannot reach this viewer; the reason says who can change that. */
  | { kind: 'unavailable'; reason: RowUnavailableReason }
  /** They switched it off. */
  | { kind: 'off' }
  /** On, but what it holds could not be read just now. */
  | { kind: 'unknown'; onScreen: boolean }
  /** On, and empty — Emby shows no row for an empty tag. */
  | { kind: 'empty' }
  /** On their home screen now. */
  | { kind: 'showing'; count: number }
  /** On and holding titles, not on their screen yet: the next write creates it. */
  | { kind: 'arriving'; count: number }

export function rowStatus(state: RowState, contents: HomeRowContents | null, onScreen: boolean): RowStatus {
  if (state.status === 'unavailable') return { kind: 'unavailable', reason: state.reason }
  if (state.status === 'off') return { kind: 'off' }
  if (!contents || contents.count === null) return { kind: 'unknown', onScreen }
  if (contents.count === 0) return { kind: 'empty' }
  return onScreen ? { kind: 'showing', count: contents.count } : { kind: 'arriving', count: contents.count }
}

/** The colour a status line is drawn in. */
export function statusColor(status: RowStatus): string {
  switch (status.kind) {
    case 'showing':
      return 'success.main'
    case 'arriving':
      return 'info.main'
    case 'unavailable':
      return 'text.disabled'
    default:
      return 'text.secondary'
  }
}

/** A playlist's key on the page: channels and chat playlists are two tables, so an id alone could name either. */
export function playlistKey(playlist: Pick<UserHomePlaylist, 'source' | 'id'>): string {
  return `${playlist.source}:${playlist.id}`
}
