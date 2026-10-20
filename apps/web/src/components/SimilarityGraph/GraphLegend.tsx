import { Box, ButtonBase, Link, Tooltip, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { CONNECTION_COLORS } from './types'
import { CONNECTION_TYPES } from './connectionHighlight'
import { useLegendHighlight } from './connectionHighlightStore'
import { connectionTypeLabel } from '../../i18n/connectionTypeLabel'

interface GraphLegendProps {
  compact?: boolean
  /** A wrapping row under a graph, or a list in a side panel. */
  orientation?: 'row' | 'column'
}

/**
 * The connection colours, and a highlight for each: hover a type to preview
 * its lines, click it to keep them highlighted (several may be), Clear to go
 * back. Nothing is removed and nothing moves; every legend and every graph on
 * screen share one highlight (connectionHighlightStore.ts), which lasts while
 * some legend is mounted.
 */
export function GraphLegend({ compact = false, orientation = 'row' }: GraphLegendProps) {
  const { t } = useTranslation()
  const { highlighted, toggle, clear, setPreview } = useLegendHighlight()
  const fontSize = orientation === 'column' ? '11px' : compact ? '9px' : '10px'
  const anyChosen = highlighted.size > 0

  return (
    <Box
      role="group"
      aria-label={t('graphExplorer.connectionHighlightLabel')}
      onPointerLeave={() => setPreview(null)}
      sx={{
        display: 'flex',
        flexDirection: orientation === 'column' ? 'column' : 'row',
        flexWrap: orientation === 'column' ? 'nowrap' : 'wrap',
        alignItems: orientation === 'column' ? 'stretch' : 'center',
        gap: orientation === 'column' ? 0.25 : compact ? 0.5 : 1,
        p: orientation === 'column' ? 0 : 1,
      }}
    >
      {CONNECTION_TYPES.map((type) => {
        const chosen = highlighted.has(type)
        // Faded only while something else is chosen, so at rest the legend
        // reads as a plain key.
        const faded = anyChosen && !chosen
        return (
          <Tooltip key={type} title={t('graphExplorer.connectionHighlightTooltip')} enterDelay={700}>
            <ButtonBase
              aria-pressed={chosen}
              onClick={() => toggle(type)}
              // Mouse only: a tap fires pointerenter and never pointerleave, and
              // a preview left behind would override what the tap chose.
              onPointerEnter={(event) => {
                if (event.pointerType === 'mouse') setPreview(type)
              }}
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-start',
                gap: 0.75,
                px: 0.75,
                py: orientation === 'column' ? 0.5 : 0.25,
                borderRadius: 1,
                opacity: faded ? 0.45 : 1,
                bgcolor: chosen ? 'action.selected' : 'transparent',
                '&:hover': { bgcolor: chosen ? 'action.selected' : 'action.hover' },
                '&.Mui-focusVisible': { outline: 2, outlineColor: 'primary.main' },
              }}
            >
              <Box
                sx={{
                  width: 14,
                  height: chosen ? 4 : 3,
                  borderRadius: 1,
                  bgcolor: CONNECTION_COLORS[type],
                  flexShrink: 0,
                }}
              />
              <Typography
                variant="caption"
                color={faded ? 'text.secondary' : 'text.primary'}
                fontWeight={chosen ? 600 : 400}
                sx={{ fontSize }}
              >
                {connectionTypeLabel(type, t)}
              </Typography>
            </ButtonBase>
          </Tooltip>
        )
      })}
      {anyChosen && (
        <Link
          component="button"
          variant="caption"
          onClick={clear}
          sx={{ fontSize, px: 0.75, alignSelf: orientation === 'column' ? 'flex-start' : 'center' }}
        >
          {t('graphExplorer.connectionHighlightClear')}
        </Link>
      )}
    </Box>
  )
}
