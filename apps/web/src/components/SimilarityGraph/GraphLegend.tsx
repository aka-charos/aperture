import { Box, ButtonBase, Link, Tooltip, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { CONNECTION_COLORS } from './types'
import { CONNECTION_TYPES } from './connectionFilter'
import { useHiddenConnectionTypes } from './connectionFilterStore'
import { connectionTypeLabel } from '../../i18n/connectionTypeLabel'

interface GraphLegendProps {
  compact?: boolean
  /** A wrapping row under a graph, or a list in a side panel. */
  orientation?: 'row' | 'column'
}

/**
 * The connection colours, and the switch for each: click a type to hide or
 * show its lines, Shift+click to show it alone. Every legend and every graph
 * share one selection (connectionFilterStore.ts).
 */
export function GraphLegend({ compact = false, orientation = 'row' }: GraphLegendProps) {
  const { t } = useTranslation()
  const { hidden, toggle, showOnly, showAll } = useHiddenConnectionTypes()
  const fontSize = orientation === 'column' ? '11px' : compact ? '9px' : '10px'

  return (
    <Box
      role="group"
      aria-label={t('graphExplorer.connectionFilterLabel')}
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
        const shown = !hidden.has(type)
        // The store refuses to hide the last shown type; say so rather than
        // let the click look broken.
        const lastShown = shown && hidden.size === CONNECTION_TYPES.length - 1
        return (
          <Tooltip
            key={type}
            title={t(lastShown ? 'graphExplorer.connectionFilterLastShown' : 'graphExplorer.connectionFilterTooltip')}
            enterDelay={lastShown ? 0 : 600}
          >
            <ButtonBase
              aria-pressed={shown}
              onClick={(event) => (event.shiftKey ? showOnly(type) : toggle(type))}
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-start',
                gap: 0.75,
                px: 0.75,
                py: orientation === 'column' ? 0.5 : 0.25,
                borderRadius: 1,
                opacity: shown ? 1 : 0.45,
                '&:hover': { bgcolor: 'action.hover' },
                '&.Mui-focusVisible': { outline: 2, outlineColor: 'primary.main' },
              }}
            >
              <Box
                sx={{
                  width: 14,
                  height: 3,
                  borderRadius: 1,
                  bgcolor: shown ? CONNECTION_COLORS[type] : 'transparent',
                  border: shown ? 'none' : `1px solid ${CONNECTION_COLORS[type]}`,
                  flexShrink: 0,
                }}
              />
              <Typography
                variant="caption"
                color={shown ? 'text.primary' : 'text.secondary'}
                sx={{ fontSize, textDecoration: shown ? 'none' : 'line-through' }}
              >
                {connectionTypeLabel(type, t)}
              </Typography>
            </ButtonBase>
          </Tooltip>
        )
      })}
      {hidden.size > 0 && (
        <Link
          component="button"
          variant="caption"
          onClick={showAll}
          sx={{ fontSize, px: 0.75, alignSelf: orientation === 'column' ? 'flex-start' : 'center' }}
        >
          {t('graphExplorer.connectionFilterShowAll')}
        </Link>
      )}
    </Box>
  )
}
