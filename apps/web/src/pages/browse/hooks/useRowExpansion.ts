import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { fillOpenRows, rowOf, toggleRow, type CardPosition } from '../rowExpansion'

/** The attribute each grid cell carries (set to its id) so its row can be read off the page. */
const ROW_CARD_ATTRIBUTE = 'data-row-card'

/**
 * Plot expansion for a poster grid, a row at a time (see `rowExpansion.ts`).
 * The container ref goes on the grid; each cell carries `data-row-card={id}`.
 * `itemCount` is how many cards the grid holds, so cards appended by infinite
 * scroll into an open row open with it.
 */
export function useRowExpansion(itemCount: number) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())

  const readCards = useCallback((): CardPosition[] => {
    const cells = containerRef.current?.querySelectorAll<HTMLElement>(`[${ROW_CARD_ATTRIBUTE}]`) ?? []
    return Array.from(cells, (cell) => ({
      id: cell.getAttribute(ROW_CARD_ATTRIBUTE) ?? '',
      top: cell.getBoundingClientRect().top,
    }))
  }, [])

  const toggle = useCallback(
    (id: string) => {
      const cards = readCards()
      setExpanded((prev) => toggleRow(prev, rowOf(cards, id), id))
    },
    [readCards]
  )

  // Layout effect, so a newcomer opens before the browser paints it closed.
  // Keyed on the count only: the layout is read once per page of results, and
  // only while something is open.
  useLayoutEffect(() => {
    setExpanded((prev) => (prev.size === 0 ? prev : fillOpenRows(readCards(), prev)))
  }, [itemCount, readCards])

  /** Closes everything, for when the list underneath is replaced. */
  const reset = useCallback(() => setExpanded(new Set()), [])

  const isExpanded = useCallback((id: string) => expanded.has(id), [expanded])

  return { containerRef, isExpanded, toggle, reset }
}
