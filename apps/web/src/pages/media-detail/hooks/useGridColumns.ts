import { useLayoutEffect, useState } from 'react'
import { trackCount } from '../wholeRows'

/**
 * How many columns an auto-filling grid has laid out, read from the grid
 * itself so it agrees with the browser whatever the gap, track width or
 * container. Attach the returned ref to the grid. 0 until measured; a grid
 * that is hidden keeps its last answer.
 */
export function useGridColumns(): [(element: HTMLElement | null) => void, number] {
  const [element, setElement] = useState<HTMLElement | null>(null)
  const [columns, setColumns] = useState(0)

  useLayoutEffect(() => {
    if (!element) return
    const measure = () => {
      const count = trackCount(getComputedStyle(element).gridTemplateColumns)
      if (count > 0) setColumns(count)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])

  return [setElement, columns]
}
