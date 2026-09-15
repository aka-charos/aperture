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
  /** Admin anchor list only: accounts showing this row. */
  accounts?: number
  /** Admin anchor list only: accounts where an anchor on this row resolves. */
  accountsWithType?: number
}

export function isAnchorMode(mode: string): mode is 'after' | 'before' {
  return mode === 'after' || mode === 'before'
}

/** An anchor placement with no row chosen cannot be saved; the server would refuse it. */
export function isPlacementComplete(placement: PlacementValue): boolean {
  return !isAnchorMode(placement.mode) || !!placement.anchor?.id
}

/** "After My Media", "Position 3", "Top". */
export function describePlacement(t: TFunction, placement: PlacementValue): string {
  switch (placement.mode) {
    case 'position':
      return t('homeScreenPlacement.describe.position', { position: placement.position })
    case 'after':
    case 'before':
      return t(`homeScreenPlacement.describe.${placement.mode}`, {
        name: placement.anchor?.name ?? placement.anchor?.id ?? '',
      })
    default:
      return t(`homeScreenPlacement.describe.${placement.mode}`)
  }
}
