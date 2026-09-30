import type { ReactNode } from 'react'

export interface CarouselProps {
  /** Carousel title */
  title: string
  /** Optional subtitle/description */
  subtitle?: string
  /** Loading state - shows skeletons */
  loading?: boolean
  /** Message to show when empty (if not provided, carousel hides when empty) */
  emptyMessage?: string
  /** Number of skeleton items to show while loading */
  skeletonCount?: number
  /** Custom skeleton renderer */
  renderSkeleton?: () => ReactNode
  /** Children are the carousel items */
  children: ReactNode
  /** Whether the carousel has items (used for empty state) */
  hasItems?: boolean
  /**
   * Size the items so a whole number of them fills the row exactly — no half
   * poster at the edge — and page by exactly one screenful. The items must
   * then be fluid (a `responsive` MoviePoster, or a box at `width: 100%`);
   * a fixed-width child sits in a wider slot instead of filling it.
   */
  fitItems?: boolean
  /** With `fitItems`: the narrowest an item may get. Defaults to 150px. */
  itemMinWidth?: number
}

export interface CarouselItemProps {
  /** Unique key for the item */
  id: string
  /** Item content */
  children: ReactNode
}

