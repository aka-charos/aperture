import { useTranslation } from 'react-i18next'
import { Box, Tooltip, Typography } from '@mui/material'
import { REACH_LEVELS, reachStep } from '../reachScale'

interface ReachScaleProps {
  /** The level as the server decided it. */
  level?: string
}

/**
 * Household reach as a name and a row of steps. Steps rather than a continuous
 * bar, because a bar's length reads as a proportion of people and this is a rank
 * among titles.
 *
 * The hint is what says so, which is why it opens on focus and on a tap too. The
 * row wraps, since this renders in a dialog and beside the chat dock as well as
 * on a phone, and a long translation of the two words won't fit on one line.
 */
export function ReachScale({ level }: ReachScaleProps) {
  const { t } = useTranslation()
  const scale = reachStep(level)
  if (!scale) return null

  return (
    <Tooltip title={t(scale.hintKey)} describeChild enterTouchDelay={0} leaveTouchDelay={5000}>
      <Box
        role="group"
        tabIndex={0}
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          columnGap: 1,
          rowGap: 0.5,
          minWidth: 0,
          maxWidth: '100%',
          borderRadius: 1,
          '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
        }}
      >
        <Typography variant="body2" color="text.secondary">
          {t('mediaDetail.infoCard.householdReach')}
        </Typography>
        <Typography variant="body2" fontWeight={700} color="primary.main">
          {t(scale.nameKey)}
        </Typography>
        <Box aria-hidden sx={{ display: 'flex', flexShrink: 0, gap: 0.375 }}>
          {REACH_LEVELS.map((name, index) => (
            <Box
              key={name}
              sx={{
                width: 14,
                height: 3,
                borderRadius: 2,
                bgcolor: index < scale.step ? 'primary.main' : 'action.hover',
              }}
            />
          ))}
        </Box>
      </Box>
    </Tooltip>
  )
}
