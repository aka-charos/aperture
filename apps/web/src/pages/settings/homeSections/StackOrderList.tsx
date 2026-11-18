/**
 * The order row kinds take when several land on the same spot of a home screen,
 * as a list to drag. Dragging rather than up/down buttons: a button that moves
 * its own row leaves the pointer over the neighbour's button, so a second click
 * moved a different row. The handle also works from the keyboard (Space to pick
 * a row up, arrow keys to move it, Space to drop).
 */
import { useTranslation } from 'react-i18next'
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Box, IconButton, Stack, Typography } from '@mui/material'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'

interface StackOrderListProps {
  /** Feature ids, first on top. */
  order: readonly string[]
  labelFor: (feature: string) => string
  /** A note after a row's name, such as "switched off above". */
  noteFor?: (feature: string) => string | null
  disabled?: boolean
  onChange: (order: string[]) => void
}

function StackOrderRow({
  feature,
  position,
  label,
  note,
  disabled,
}: {
  feature: string
  position: number
  label: string
  note: string | null
  disabled: boolean
}) {
  const { t } = useTranslation()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: feature,
    disabled,
  })
  return (
    <Box
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1,
        py: 0.25,
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        bgcolor: 'background.paper',
        position: 'relative',
        zIndex: isDragging ? 2 : undefined,
        boxShadow: isDragging ? 4 : undefined,
      }}
    >
      <IconButton
        size="small"
        disabled={disabled}
        aria-label={t('settingsHomeSections.stackDrag', { name: label })}
        sx={{ cursor: disabled ? 'default' : 'grab', touchAction: 'none' }}
        {...attributes}
        {...listeners}
      >
        <DragIndicatorIcon fontSize="small" />
      </IconButton>
      <Typography variant="caption" color="text.secondary" sx={{ minWidth: '1.5em' }}>
        {position}
      </Typography>
      <Typography variant="body2" color={disabled ? 'text.disabled' : 'text.primary'}>
        {label}
        {note && (
          <Typography component="span" variant="caption" color="text.disabled" sx={{ ml: 1 }}>
            {note}
          </Typography>
        )}
      </Typography>
    </Box>
  )
}

export function StackOrderList({ order, labelFor, noteFor, disabled = false, onChange }: StackOrderListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const from = order.indexOf(String(active.id))
    const to = order.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    onChange(arrayMove([...order], from, to))
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={[...order]} strategy={verticalListSortingStrategy}>
        <Stack spacing={0.75} sx={{ maxWidth: 480 }}>
          {order.map((feature, index) => (
            <StackOrderRow
              key={feature}
              feature={feature}
              position={index + 1}
              label={labelFor(feature)}
              note={noteFor?.(feature) ?? null}
              disabled={disabled}
            />
          ))}
        </Stack>
      </SortableContext>
    </DndContext>
  )
}
