import { useCallback, useRef, useState } from 'react'
import { rowOf, toggleRow, type CardPosition } from '../rowExpansion'

/** The attribute each grid cell carries (set to its id) so its row can be read off the page. */
const ROW_CARD_ATTRIBUTE = 'data-row-card'

/**
 * Plot expansion for a poster grid, a row at a time (see `rowExpansion.ts`).
 * The container ref goes on the grid; each cell carries `data-row-card={id}`.
 */
export function useRowExpansion() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())

  const toggle = useCallback((id: string) => {
    const cells = containerRef.current?.querySelectorAll<HTMLElement>(`[${ROW_CARD_ATTRIBUTE}]`) ?? []
    const cards: CardPosition[] = Array.from(cells, (cell) => ({
      id: cell.getAttribute(ROW_CARD_ATTRIBUTE) ?? '',
      top: cell.getBoundingClientRect().top,
    }))
    setExpanded((prev) => toggleRow(prev, rowOf(cards, id), id))
  }, [])

  /** Closes everything, for when the list underneath is replaced. */
  const reset = useCallback(() => setExpanded(new Set()), [])

  const isExpanded = useCallback((id: string) => expanded.has(id), [expanded])

  return { containerRef, isExpanded, toggle, reset }
}
