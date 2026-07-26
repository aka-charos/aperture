import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { MediaDetailModal, type MediaDetailTarget } from '../components/MediaDetailModal'
import { MediaDetailModalContext, type OpenMediaDetail } from './media-detail-modal-context'

interface MediaDetailModalProviderProps {
  /**
   * Whether descendants should open item details here rather than navigate.
   * False where the surrounding surface survives navigation and showing the item
   * next to it is better — the docked assistant routes the main pane instead.
   */
  enabled?: boolean
  children: ReactNode
}

/**
 * Hosts the item detail dialog for a subtree and hands descendants the opener.
 *
 * When disabled the context value is null, which is how consumers know to fall
 * back to routing — that keeps the decision with the surface that knows its own
 * layout instead of spreading surface checks through the card components.
 */
export function MediaDetailModalProvider({
  enabled = true,
  children,
}: MediaDetailModalProviderProps) {
  const [target, setTarget] = useState<MediaDetailTarget | null>(null)

  const openMediaDetail = useCallback<OpenMediaDetail>(
    (mediaType, id) => setTarget({ mediaType, id }),
    []
  )

  const value = useMemo(() => (enabled ? openMediaDetail : null), [enabled, openMediaDetail])

  // Docking mid-view flips this off; the dialog must not linger over a surface
  // that would rather route.
  useEffect(() => {
    if (!enabled) setTarget(null)
  }, [enabled])

  return (
    <MediaDetailModalContext.Provider value={value}>
      {children}
      <MediaDetailModal
        target={target}
        onClose={() => setTarget(null)}
        onOpenMedia={openMediaDetail}
      />
    </MediaDetailModalContext.Provider>
  )
}
