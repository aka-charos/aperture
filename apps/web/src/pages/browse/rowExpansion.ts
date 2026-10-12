/**
 * Which cards open when one card's "more" is pressed: the whole row it sits in.
 *
 * A grid row is as tall as its tallest card, so opening one plot alone leaves a
 * hole under each neighbour; opening the row fills it. The row is read off the
 * page (cards sharing a top edge) rather than computed from a column count,
 * because the column count follows the pane's width, which the docked assistant
 * and the sidebar change without the window moving.
 *
 * Pure so the toggle rule is pinned by a test; the DOM read lives in the hook.
 */

export interface CardPosition {
  id: string
  /** The card's top edge, in any consistent frame. */
  top: number
}

/** Cards whose top edge is within a pixel of `id`'s, in the order given. */
export function rowOf(cards: readonly CardPosition[], id: string): string[] {
  const own = cards.find((card) => card.id === id)
  if (!own) return [id]
  return cards.filter((card) => Math.abs(card.top - own.top) < 1).map((card) => card.id)
}

/**
 * Every row holding an open card, opened whole. Infinite scroll appends cards
 * into a partly filled last row, and an open row would otherwise take closed
 * newcomers, which is exactly the hole row expansion exists to prevent. Returns
 * the same set when nothing changes, so a caller can skip the state update.
 */
export function fillOpenRows(cards: readonly CardPosition[], expanded: ReadonlySet<string>): ReadonlySet<string> {
  if (expanded.size === 0) return expanded
  const openTops = cards.filter((card) => expanded.has(card.id)).map((card) => card.top)
  const missing = cards.filter(
    (card) => !expanded.has(card.id) && openTops.some((top) => Math.abs(card.top - top) < 1)
  )
  if (missing.length === 0) return expanded
  const next = new Set(expanded)
  for (const card of missing) next.add(card.id)
  return next
}

/**
 * Pressing "more" opens every card in the row; pressing "less" closes them.
 * Decided by the pressed card's own state, so a row holding a card left open
 * from a different layout (the pane was resized since) still toggles as one.
 */
export function toggleRow(expanded: ReadonlySet<string>, row: readonly string[], id: string): Set<string> {
  const next = new Set(expanded)
  const opening = !expanded.has(id)
  for (const member of row) {
    if (opening) next.add(member)
    else next.delete(member)
  }
  return next
}
