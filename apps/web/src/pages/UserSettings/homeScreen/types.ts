/**
 * The Emby home screen page as `GET /api/home-sections/me` sends it. Shapes
 * only: every decision — whether a row reaches the viewer and why not, what it
 * holds, where it lands — arrives decided (core `homeSections/userHomeScreen.ts`),
 * so nothing here can disagree with what the sync writes.
 */
import type { FeaturePlacementValue, HomeRowOption, PlacementValue } from '@/components/homeSections/placement'

export type RowUnavailableReason =
  | 'feature-off'
  | 'no-access'
  | 'admin-off'
  | 'top-picks-off'
  | 'recommendations-off'
  | 'no-library'

export type RowState =
  | { status: 'on' }
  | { status: 'off' }
  | { status: 'unavailable'; reason: RowUnavailableReason }

export interface RowTitle {
  id: string
  type: 'movie' | 'series'
  title: string
  year: number | null
  posterUrl: string | null
}

export interface HomeRowContents {
  /** Null when it could not be read just now. */
  count: number | null
  sample: RowTitle[]
}

export interface UserHomeRow {
  feature: string
  name: string | null
  state: RowState
  switchable: boolean
  enabled: boolean
  contents: HomeRowContents | null
  onScreen: boolean
  defaultPlacement: FeaturePlacementValue
  override: PlacementValue | null
}

export interface UserHomePlaylist {
  source: 'channel' | 'chat'
  id: string
  name: string
  outputType: 'playlist' | 'collection'
  onHomeScreen: boolean
  generated: boolean
  contents: HomeRowContents | null
  onScreen: boolean
}

export interface ProjectedRow {
  id: string
  name: string
  feature: string | null
  group?: boolean
  pending?: boolean
}

export interface UserHomeScreen {
  available: boolean
  unavailableReason: 'feature-off' | 'unsupported' | 'no-account' | null
  rows: UserHomeRow[]
  playlists: UserHomePlaylist[]
  preview: ProjectedRow[] | null
  anchors: HomeRowOption[]
  screenUnavailable: boolean
  sortBy: string
  maxPosition: number
  modes: string[]
}

/** What an instant write answered: applied now, or saved for the next sync. */
export type InstantOutcome =
  | { applied: true; moved: number }
  | { applied: false; reason: string; message?: string }

export type Notice = { severity: 'success' | 'info' | 'error'; text: string }
