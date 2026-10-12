import { useEffect, useState, type ReactNode } from 'react'
import { Box, Button, Collapse } from '@mui/material'
import TuneIcon from '@mui/icons-material/Tune'
import { WeightSliderRow, WeightSummary } from './WeightControls'
import { orderWithNewFirst, summarizeWeights, weightTone, type WeightScale, type WeightTone } from './weights'

export interface WeightItem {
  name: string
  value: number
}

interface WeightListProps {
  items: WeightItem[]
  /** Names the last scan found. They go to the top, marked, and open the list. */
  newNames: string[]
  scale: WeightScale
  toneLabels: Record<WeightTone, string>
  adjustLabel: string
  onChange: (name: string, value: number) => void
  onRemove: (name: string) => void
  /** Extra controls shown under the sliders while the list is open. */
  footer?: ReactNode
}

/**
 * A weight list the way the Emby home screen tab shows a row's placement: what
 * it amounts to up front, the editor one click away. Twenty-seven sliders in a
 * scroll box were the first thing on the old page whether or not anything in
 * them had been touched.
 */
export function WeightList({ items, newNames, scale, toneLabels, adjustLabel, onChange, onRemove, footer }: WeightListProps) {
  const [open, setOpen] = useState(false)
  // A scan that found something opens the list, so its finds are on screen.
  useEffect(() => {
    if (newNames.length > 0) setOpen(true)
  }, [newNames])

  // Ordered by what the last scan found, not by live values: re-sorting while
  // a slider is being dragged would move the row out from under the pointer.
  const ordered = orderWithNewFirst(items, newNames, (item) => item.name)
  const { up, down } = summarizeWeights(items, scale, (item) => item.name, (item) => item.value)
  const fresh = new Set(newNames)

  return (
    <Box>
      <WeightSummary up={up} down={down} total={items.length} />
      <Button
        size="small"
        startIcon={<TuneIcon />}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        sx={{ mt: 1.5, textTransform: 'none' }}
      >
        {adjustLabel}
      </Button>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ mt: 1, maxHeight: 360, overflowY: 'auto', pr: 0.5 }}>
          {ordered.map((item) => {
            const tone = weightTone(item.value, scale)
            return (
              <WeightSliderRow
                key={item.name}
                name={item.name}
                isNew={fresh.has(item.name)}
                value={item.value}
                scale={scale}
                tone={tone}
                toneLabel={toneLabels[tone]}
                onChange={(value) => onChange(item.name, value)}
                onRemove={() => onRemove(item.name)}
              />
            )
          })}
        </Box>
        {footer && <Box sx={{ mt: 1.5 }}>{footer}</Box>}
      </Collapse>
    </Box>
  )
}
