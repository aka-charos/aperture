import { useEffect, useRef, useState } from 'react'
import { createStripQueue } from './stripQueue'

export function useStripLoadQueue(processItem: (key: string, signal: AbortSignal) => Promise<void>) {
  const processItemRef = useRef(processItem)
  processItemRef.current = processItem

  const [queue] = useState(() =>
    createStripQueue((key, signal) => processItemRef.current(key, signal))
  )

  useEffect(() => queue.reset, [queue])

  return queue
}
