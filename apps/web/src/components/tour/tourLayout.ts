/**
 * Where a tour step's card goes on a phone. Pure, pinned by tourLayout.test.ts.
 *
 * On a wide screen the card sits beside the element it points at. A phone has
 * no "beside": the card is nearly the screen's width, so placed next to the
 * element it was pushed back over it, and the regions most steps point at (a
 * row of posters, a title's hero, the results grid) are taller than the
 * screen anyway. So on a phone the card is docked to one edge of the screen
 * as a sheet, and the element is scrolled into the part the sheet leaves free.
 */

export type DockEdge = 'top' | 'bottom'

export interface Box {
  top: number
  height: number
}

/** Space kept between the app bar and an element scrolled up under it. */
export const DOCK_SCROLL_GAP = 16

/** Space between a docked card and the edge of the screen it docks to. */
export const DOCK_EDGE_GAP = 12

/**
 * The share of the screen an element may reach down to before it is scrolled
 * up: below it, the docked card would cover it. The card's own height cap is
 * the rest of the screen (TourCard.tsx), so the two cannot disagree.
 */
export const DOCK_FREE_SHARE = 0.5

/**
 * How far to scroll so the element starts just under the app bar, or null to
 * leave it where it is: it already sits whole in the upper part of the screen.
 * An element that cannot move (in the app bar, or otherwise fixed) is never
 * scrolled: scrolling would move the page under it for nothing.
 */
export function dockScrollOffset(box: Box, viewportHeight: number, chromeBottom: number, fixed: boolean): number | null {
  if (fixed) return null
  const top = chromeBottom + DOCK_SCROLL_GAP
  const fitsAbove = box.top >= chromeBottom && box.top + box.height <= viewportHeight * DOCK_FREE_SHARE
  if (fitsAbove) return null
  return box.top - top
}

/** How far the page can scroll from where it is: up to its top, down to its end. */
export interface ScrollRoom {
  up: number
  down: number
}

/**
 * Where the element ends up once the page has scrolled by `offset` (null:
 * not scrolled). A page cannot scroll past its own end, so an element near
 * the bottom of a short page stops short of the app bar, and the edge has to
 * be decided from where it really stops.
 */
export function dockLanding(box: Box, offset: number | null, room: ScrollRoom): Box {
  if (offset == null) return box
  const scrolled = Math.max(-room.up, Math.min(room.down, offset))
  return { top: box.top - scrolled, height: box.height }
}

/**
 * The edge the card docks to: the top only when the element STARTS in the
 * lower half of the screen below the app bar, the bottom otherwise. Its start
 * is what matters because that is the part a scroll brings up and the part a
 * reader looks at first; comparing the room above and below instead put the
 * card over the start of every element taller than the screen, which has no
 * room below at all. The bottom is also where a thumb reaches the buttons.
 * Decided once per step, from where the element WILL be after scrolling, or
 * the card would jump from one edge to the other while the page scrolls.
 */
export function dockEdge(box: Box, viewportHeight: number, chromeBottom: number): DockEdge {
  return box.top > (chromeBottom + viewportHeight) / 2 ? 'top' : 'bottom'
}
