import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMediaDetailModal } from './useMediaDetailModal'
import type { MediaType } from '../pages/media-detail/types'

/**
 * Opens a library title: in the detail dialog when the surrounding surface
 * hosts one (MediaDetailModalProvider), so closing it returns the reader to
 * where they were, and otherwise by routing to the title's page.
 */
export function useOpenMedia() {
  const openMediaDetail = useMediaDetailModal()
  const navigate = useNavigate()

  return useCallback(
    (mediaType: MediaType, id: string) => {
      if (openMediaDetail) openMediaDetail(mediaType, id)
      else navigate(`/${mediaType === 'movie' ? 'movies' : 'series'}/${id}`)
    },
    [openMediaDetail, navigate]
  )
}
