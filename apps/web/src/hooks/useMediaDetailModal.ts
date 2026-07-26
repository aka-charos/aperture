import { useContext } from 'react'
import { MediaDetailModalContext } from './media-detail-modal-context'

/**
 * Opener for the in-place item detail view, or null when the surrounding
 * surface has no modal host and the caller should navigate instead.
 */
export function useMediaDetailModal() {
  return useContext(MediaDetailModalContext)
}
