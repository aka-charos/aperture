/**
 * Placement shapes for managed Emby home rows, as the API sends them. Types and
 * a label only: every rule about where a row lands lives in core
 * (`homeSections/placement.ts`), and the vocabulary itself arrives in each
 * response, so nothing here can drift from what the server does.
 */
import type { TFunction } from 'i18next'

export type PlacementMode = 'top' | 'bottom' | 'position' | 'after' | 'before'
export type FallbackMode = 'top' | 'bottom' | 'position'

export interface PlacementAnchor {
  id: string
  type: string | null
  name: string | null
}

export interface PlacementValue {
  mode: PlacementMode
  position: number
  anchor: PlacementAnchor | null
}

export interface FeaturePlacementValue extends PlacementValue {
  fallbackMode: FallbackMode
  fallbackPosition: number
}

export interface HomeRowOption {
  id: string
  type: string | null
  name: string
  /** Several per-library rows Emby stores as one section (Latest Media). */
  group?: boolean
  /** Admin anchor list only: accounts showing this row. */
  accounts?: number
  /** Admin anchor list only: accounts where an anchor on this row resolves. */
  accountsWithType?: number
  /** Admin anchor list only: the accounts it does not resolve for, by username. */
  missingAccounts?: string[]
}

export function isAnchorMode(mode: string): mode is 'after' | 'before' {
  return mode === 'after' || mode === 'before'
}

/** An anchor placement with no row chosen cannot be saved; the server would refuse it. */
export function isPlacementComplete(placement: PlacementValue): boolean {
  return !isAnchorMode(placement.mode) || !!placement.anchor?.id
}

/**
 * A row's name. A group (Latest Media) has no name of its own in Emby's read,
 * so its label is translated here and the server's English name is the fallback.
 */
export function rowName(t: TFunction, row: { id: string; name: string | null; group?: boolean }): string {
  const name = row.name ?? row.id
  return row.group ? t(`homeScreenPlacement.groups.${row.id}`, { defaultValue: name }) : name
}

/** "After My Media", "Position 3", "Top". */
export function describePlacement(t: TFunction, placement: PlacementValue): string {
  switch (placement.mode) {
    case 'position':
      return t('homeScreenPlacement.describe.position', { position: placement.position })
    case 'after':
    case 'before': {
      const anchor = placement.anchor
      // A stored anchor carries no group flag; a group's id is its section type.
      const name = anchor
        ? rowName(t, { id: anchor.id, name: anchor.name, group: anchor.type === anchor.id && anchor.id === 'latestmedia' })
        : ''
      return t(`homeScreenPlacement.describe.${placement.mode}`, { name })
    }
    default:
      return t(`homeScreenPlacement.describe.${placement.mode}`)
  }
}
