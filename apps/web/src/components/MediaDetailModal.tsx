/**
 * The library item detail view, in a dialog.
 *
 * Renders the same `MediaDetailPage` the /movies/:id and /series/:id routes do —
 * hero, info, seasons, insights, related — so there is one item view to
 * maintain. Used where routing to the item would destroy the surface the user
 * clicked from: the assistant chat, whose scroll position and in-flight
 * conversation don't survive a round trip through the router.
 */
import { useEffect, useRef } from 'react'
import { Dialog, DialogContent, IconButton } from '@mui/material'
import { useIsPhone } from '@/hooks/useIsPhone'
import CloseIcon from '@mui/icons-material/Close'
import { useTranslation } from 'react-i18next'
import { MediaDetailPage } from '../pages/media-detail'
import type { MediaType } from '../pages/media-detail/types'
import type { OpenMediaDetail } from '../hooks/media-detail-modal-context'

export interface MediaDetailTarget {
  mediaType: MediaType
  id: string
}

interface MediaDetailModalProps {
  /** The item to show; null closes the dialog. */
  target: MediaDetailTarget | null
  onClose: () => void
  /** Swap to another item (related titles, recommendation evidence) in place. */
  onOpenMedia: OpenMediaDetail
}

export function MediaDetailModal({ target, onClose, onOpenMedia }: MediaDetailModalProps) {
  const { t } = useTranslation()
  const contentRef = useRef<HTMLDivElement>(null)
  const fullScreen = useIsPhone()

  // Swapping to a related title reuses this dialog, so the scroll position
  // carries over — without this the new item opens partway down the page.
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 })
  }, [target])

  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      maxWidth="lg"
      fullScreen={fullScreen}
      fullWidth
      PaperProps={{
        sx: {
          height: fullScreen ? '100%' : '95vh',
          maxHeight: fullScreen ? '100%' : '90vh',
          bgcolor: 'rgba(15, 15, 15, 0.96)',
          backgroundImage: 'none',
          borderRadius: fullScreen ? 0 : 3,
          border: '1px solid rgba(255, 255, 255, 0.1)',
        },
      }}
    >
      <IconButton
        onClick={onClose}
        aria-label={t('common.close')}
        sx={{
          position: 'absolute',
          top: 12,
          insetInlineEnd: 12,
          zIndex: 2,
          bgcolor: 'rgba(0, 0, 0, 0.5)',
          color: 'white',
          '&:hover': { bgcolor: 'rgba(0, 0, 0, 0.7)' },
        }}
      >
        <CloseIcon />
      </IconButton>
      {/* This padding is load-bearing: the page's backdrop bleeds to the edges with
          negative margins sized against the route layout's own padding, and
          follows it per breakpoint (2 on phones, 3 above). */}
      <DialogContent ref={contentRef} sx={{ p: { xs: 2, sm: 3 }, minHeight: '60vh' }}>
        {target && (
          // Keyed so switching items remounts rather than mixing the previous
          // item's component state (graph focus, expanded seasons) into the new one.
          <MediaDetailPage
            key={`${target.mediaType}:${target.id}`}
            mediaType={target.mediaType}
            id={target.id}
            onBack={onClose}
            onOpenMedia={onOpenMedia}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
