import { useRef, useState, useEffect, useCallback, type ReactNode } from 'react'
import { Box, Typography, IconButton, Skeleton, useTheme } from '@mui/material'
import type { CarouselProps } from './types.js'
import { fitCarouselItems, type CarouselFit } from './fit.js'

const DEFAULT_SKELETON_COUNT = 5
const DEFAULT_ITEM_MIN_WIDTH = 150
/** The row's gap, in theme spacing units; the fit arithmetic needs it in px. */
const GAP_UNITS = 2

function DefaultSkeleton({ width }: { width?: number }) {
  return (
    <Box sx={{ width: width ?? 160 }}>
      <Skeleton
        variant="rectangular"
        width="100%"
        height="auto"
        sx={{ borderRadius: 2, aspectRatio: '2 / 3' }}
      />
      <Skeleton width="80%" sx={{ mt: 1 }} />
      <Skeleton width="40%" />
    </Box>
  )
}

/**
 * The row's own width, kept current. A ResizeObserver rather than the window's
 * resize event, because the row changes width without the window doing so —
 * the assistant dock opening beside it, or the sidebar collapsing.
 *
 * A callback ref, not a ref object: the loading, empty and loaded states each
 * render their own root element, and an effect keyed on a ref object would go
 * on observing the skeleton row after it was replaced.
 */
function useFit(enabled: boolean, minWidth: number, gap: number) {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const [fit, setFit] = useState<CarouselFit | null>(null)

  useEffect(() => {
    if (!enabled || !el) {
      setFit(null)
      return
    }
    const measure = () => {
      const next = fitCarouselItems(el.clientWidth, minWidth, gap)
      // Same answer, same object: a resize that changes nothing re-renders nothing.
      setFit((prev) =>
        prev && next && prev.count === next.count && prev.itemWidth === next.itemWidth ? prev : next
      )
    }
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [el, enabled, minWidth, gap])

  return { ref: setEl, fit }
}

// Simple arrow icons as fallback (no MUI icons dependency)
function LeftArrow() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
    </svg>
  )
}

function RightArrow() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
    </svg>
  )
}

export function BaseCarousel({
  title,
  subtitle,
  loading = false,
  emptyMessage,
  skeletonCount = DEFAULT_SKELETON_COUNT,
  renderSkeleton,
  children,
  hasItems = true,
  fitItems = false,
  itemMinWidth = DEFAULT_ITEM_MIN_WIDTH,
}: CarouselProps) {
  const theme = useTheme()
  const rtl = theme.direction === 'rtl'
  const gap = parseFloat(theme.spacing(GAP_UNITS)) || 16
  const { ref: rowRef, fit } = useFit(fitItems, itemMinWidth, gap)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const updateScrollButtons = useCallback(() => {
    if (!scrollRef.current) return
    const el = scrollRef.current
    const { scrollLeft, scrollWidth, clientWidth } = el
    const maxScroll = scrollWidth - clientWidth
    if (rtl) {
      setCanScrollLeft(scrollLeft < maxScroll - 1)
      setCanScrollRight(scrollLeft > 1)
    } else {
      setCanScrollLeft(scrollLeft > 0)
      setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 10)
    }
  }, [rtl])

  useEffect(() => {
    updateScrollButtons()
    window.addEventListener('resize', updateScrollButtons)
    return () => window.removeEventListener('resize', updateScrollButtons)
  }, [updateScrollButtons, children, fit])

  const scroll = (direction: 'left' | 'right') => {
    if (!scrollRef.current) return
    // Fitted: exactly one screenful, so the next page starts on a whole item
    // and ends on one. Otherwise most of a screenful, not a fixed 400px: on a
    // phone 400 is wider than the strip, so a press skipped titles nobody had seen.
    const step = fit
      ? fit.count * (fit.itemWidth + gap)
      : Math.max(200, Math.round(scrollRef.current.clientWidth * 0.8))
    let delta = direction === 'left' ? -step : step
    if (rtl) delta = -delta
    scrollRef.current.scrollBy({ left: delta, behavior: 'smooth' })
    setTimeout(updateScrollButtons, 300)
  }

  // Loading state. Fitted, the skeletons are exactly the posters that will
  // replace them, so nothing jumps when the row loads.
  if (loading) {
    const count = fit ? fit.count : skeletonCount
    return (
      <Box ref={rowRef}>
        <Typography variant="h6" fontWeight={600} mb={2}>
          {title}
        </Typography>
        <Box sx={{ display: 'flex', gap: GAP_UNITS, overflow: 'hidden' }}>
          {Array.from({ length: count }).map((_, i) => (
            <Box key={i} sx={{ flexShrink: 0 }}>
              {renderSkeleton ? renderSkeleton() : <DefaultSkeleton width={fit?.itemWidth} />}
            </Box>
          ))}
        </Box>
      </Box>
    )
  }

  // Empty state
  if (!hasItems) {
    // If no empty message, don't render anything
    if (!emptyMessage) {
      return null
    }

    return (
      <Box>
        <Typography variant="h6" fontWeight={600} mb={2}>
          {title}
        </Typography>
        <Box
          sx={{
            py: 4,
            textAlign: 'center',
            backgroundColor: 'background.paper',
            borderRadius: 2,
            border: '1px dashed',
            borderColor: 'divider',
          }}
        >
          <Typography color="text.secondary">{emptyMessage}</Typography>
        </Box>
      </Box>
    )
  }

  return (
    <Box ref={rowRef}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 2 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h6" fontWeight={600}>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="caption" color="text.secondary">
              {subtitle}
            </Typography>
          )}
        </Box>
        <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
          <IconButton
            size="small"
            onClick={() => scroll('left')}
            disabled={!canScrollLeft}
            sx={{ opacity: canScrollLeft ? 1 : 0.3 }}
          >
            <LeftArrow />
          </IconButton>
          <IconButton
            size="small"
            onClick={() => scroll('right')}
            disabled={!canScrollRight}
            sx={{ opacity: canScrollRight ? 1 : 0.3 }}
          >
            <RightArrow />
          </IconButton>
        </Box>
      </Box>

      {/* Scrollable container */}
      <Box
        ref={scrollRef}
        onScroll={updateScrollButtons}
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: GAP_UNITS,
          // Read by CarouselItem; absent unless fitted, where it falls back to auto.
          ...(fit && { '--carousel-item-width': `${fit.itemWidth}px` }),
          overflowX: 'auto',
          scrollSnapType: 'x mandatory',
          pb: 1,
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        }}
      >
        {children}
      </Box>
    </Box>
  )
}

/**
 * Wrapper for individual carousel items with proper scroll snap behavior.
 * In a fitted carousel its width is the one the row decided; otherwise it is
 * as wide as its content.
 */
export function CarouselItem({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        scrollSnapAlign: 'start',
        flexShrink: 0,
        position: 'relative',
        width: 'var(--carousel-item-width, auto)',
      }}
    >
      {children}
    </Box>
  )
}
