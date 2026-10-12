/**
 * Whether the floating assistant button shows, given how the page just
 * scrolled. Scrolling down is reading, and the button sits over whatever is
 * in the bottom corner, so it gets out of the way; scrolling up is looking for
 * something, so it comes back. Near the top of the page there is nothing for
 * it to cover yet, so it always shows there.
 *
 * Pure so the thresholds are pinned by a test: a one-pixel jitter (trackpads
 * and smooth scrolling emit plenty) must not make it flicker.
 */

/** Movement smaller than this keeps the current state. */
export const FAB_SCROLL_DEADBAND_PX = 12

/** Within this distance of the top the button always shows. */
export const FAB_TOP_ZONE_PX = 80

/**
 * `anchorY` is where the last decision was made, NOT the previous scroll
 * event: smooth scrolling arrives as many small steps, each under the
 * deadband, and compared event to event the button would never move. The
 * caller advances the anchor only once a move clears the deadband.
 */
export function nextFabVisible(visible: boolean, anchorY: number, currentY: number): boolean {
  if (currentY <= FAB_TOP_ZONE_PX) return true
  const delta = currentY - anchorY
  if (Math.abs(delta) < FAB_SCROLL_DEADBAND_PX) return visible
  return delta < 0
}
