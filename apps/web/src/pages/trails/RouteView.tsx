import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { Box, Typography } from '@mui/material'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import { LinkCard } from './LinkCard'
import { TitleTile } from './TitleTile'
import { useTrailText } from './useTrailText'
import type { TrailRoute, TrailTitle } from './types'

interface RouteViewProps {
  route: TrailRoute
  onOpen: (title: TrailTitle) => void
  onFollow: (title: TrailTitle) => void
}

/**
 * One trail, read left to right: a title, the named thing it shares with the
 * next, that title, and so on. Each link also lists the other things the two
 * titles share, so a step that could have gone several ways says so. Wraps
 * onto further lines in a narrow pane rather than scrolling sideways.
 */
export function RouteView({ route, onOpen, onFollow }: RouteViewProps) {
  const { t } = useTranslation()
  const { stepText } = useTrailText()
  if (route.steps.length === 0) return null
  const first = route.steps[0].from
  const last = route.steps[route.steps.length - 1].to

  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5, rowGap: 2.5 }}>
      <TitleTile title={first} onOpen={onOpen} onFollow={onFollow} emphasised />
      {route.steps.map((step, index) => (
        <Fragment key={`${step.from.ref}-${step.to.ref}-${index}`}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, maxWidth: 260 }}>
            <ArrowForwardIcon
              fontSize="small"
              sx={{ color: 'text.disabled', flexShrink: 0, '[dir="rtl"] &': { transform: 'scaleX(-1)' } }}
            />
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <LinkCard entity={step.via} caption={stepText(step.via)} />
              {step.alsoShared.length > 0 && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  component="div"
                  sx={{ mt: 0.5, px: 0.5, overflowWrap: 'anywhere' }}
                  title={step.alsoShared.map((link) => `${link.name} — ${stepText(link)}`).join('\n')}
                >
                  {t('trails.route.alsoShared', { names: step.alsoShared.map((link) => link.name).join(', ') })}
                </Typography>
              )}
            </Box>
            <ArrowForwardIcon
              fontSize="small"
              sx={{ color: 'text.disabled', flexShrink: 0, '[dir="rtl"] &': { transform: 'scaleX(-1)' } }}
            />
          </Box>
          <TitleTile title={step.to} onOpen={onOpen} onFollow={onFollow} emphasised={step.to.ref === last.ref} />
        </Fragment>
      ))}
    </Box>
  )
}
