/**
 * How many carousel items fit a row EXACTLY, and how wide each must be.
 *
 * A row of fixed-width posters shows however many happen to fit plus a slice
 * of the next — two and a third on one window, five and a half on another —
 * which reads as a layout mistake rather than as "there is more". Sizing the
 * items off the row instead means the edge is always a whole poster, and a
 * press of the arrow moves exactly one screenful.
 *
 * Pure so `fit.test.ts` pins it: the arithmetic is two lines, and both of its
 * failures are silent (a sliver at the edge, or a count of zero).
 */

export interface CarouselFit {
  /** Whole items visible at once. Never below 1. */
  count: number
  /** Each item's width in px, so `count` items and their gaps fill the row. */
  itemWidth: number
}

/**
 * `null` until there is a width to measure (first render, a hidden tab), so
 * the caller falls back to its natural layout rather than to zero-width items.
 * A row narrower than one minimum item still shows one item, at the row's width.
 */
export function fitCarouselItems(
  containerWidth: number,
  minItemWidth: number,
  gap: number
): CarouselFit | null {
  if (!(containerWidth > 0) || !(minItemWidth > 0) || !(gap >= 0)) return null
  const count = Math.max(1, Math.floor((containerWidth + gap) / (minItemWidth + gap)))
  // Floored to a hundredth of a pixel: a width rounded UP makes the row a hair
  // wider than the viewport, and a sliver of the next item is the one thing
  // this exists to prevent.
  const itemWidth = Math.floor(((containerWidth - gap * (count - 1)) / count) * 100) / 100
  return { count, itemWidth }
}
