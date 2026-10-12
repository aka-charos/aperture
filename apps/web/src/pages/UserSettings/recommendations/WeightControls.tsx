import { Box, Chip, IconButton, Slider, Tooltip, Typography } from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@mui/material/styles'
import type { WeightScale, WeightTone } from './weights'

const SUMMARY_CHIP_LIMIT = 8

function SummaryLine({ label, names, color }: { label: string; names: string[]; color: 'success' | 'error' }) {
  const { t } = useTranslation()
  if (names.length === 0) return null
  const shown = names.slice(0, SUMMARY_CHIP_LIMIT)
  const hidden = names.length - shown.length
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.75 }}>
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 72 }}>
        {label}
      </Typography>
      {shown.map((name) => (
        <Chip key={name} label={name} size="small" color={color} variant="outlined" />
      ))}
      {hidden > 0 && (
        <Typography variant="caption" color="text.secondary">
          {t('userSettings.recs.summaryMore', { count: hidden })}
        </Typography>
      )}
    </Box>
  )
}

/**
 * What a weight list amounts to, in one glance: the names turned up and the
 * names turned down. Neutral entries are the default and are not listed — the
 * point is what pulls away from neutral, not a second copy of the whole list.
 */
export function WeightSummary({ up, down, total }: { up: string[]; down: string[]; total: number }) {
  const { t } = useTranslation()
  if (up.length === 0 && down.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t('userSettings.recs.summaryAllNeutral', { count: total })}
      </Typography>
    )
  }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <SummaryLine label={t('userSettings.recs.summaryMoreOf')} names={up} color="success" />
      <SummaryLine label={t('userSettings.recs.summaryLessOf')} names={down} color="error" />
    </Box>
  )
}

interface WeightSliderRowProps {
  name: string
  isNew: boolean
  value: number
  scale: WeightScale
  tone: WeightTone
  toneLabel: string
  onChange: (value: number) => void
  onRemove: () => void
}

/**
 * One adjustable weight: the name, where it stands, a way to drop it from the
 * list, and the slider. Genres and franchises share this row; only their scale
 * and the words for each end differ, and those come from the caller.
 */
export function WeightSliderRow({
  name,
  isNew,
  value,
  scale,
  tone,
  toneLabel,
  onChange,
  onRemove,
}: WeightSliderRowProps) {
  const { t } = useTranslation()
  const theme = useTheme()
  const up = theme.palette.success.main
  const down = theme.palette.error.main
  const grey = theme.palette.grey[500]

  return (
    <Box
      sx={{
        mb: 1,
        px: 1,
        py: 0.5,
        borderRadius: 1,
        outline: isNew ? `2px solid ${theme.palette.warning.main}` : 'none',
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flex: 1 }}>
          <Typography variant="body2" fontWeight={500} noWrap>
            {name}
          </Typography>
          {isNew && (
            <Chip
              size="small"
              color="warning"
              label={t('watcherIdentity.chipNew')}
              sx={{ height: 18, fontSize: '0.6rem', fontWeight: 700 }}
            />
          )}
        </Box>
        <Chip
          size="small"
          label={toneLabel}
          color={tone === 'up' ? 'success' : tone === 'down' ? 'error' : 'default'}
          variant={tone === 'neutral' ? 'outlined' : 'filled'}
          sx={{ height: 20, fontSize: '0.7rem' }}
        />
        <Tooltip title={t('watcherIdentity.removeFromListTooltip')}>
          <IconButton
            size="small"
            onClick={onRemove}
            aria-label={t('userSettings.recs.removeNamed', { name })}
            sx={{ p: 0.25, opacity: 0.6, '&:hover': { opacity: 1, color: 'error.main' } }}
          >
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      <Slider
        value={value}
        onChange={(_, next) => onChange(next as number)}
        min={scale.min}
        max={scale.max}
        step={scale.step}
        size="small"
        track={false}
        slotProps={{ input: { 'aria-label': name } }}
        sx={{
          py: 1,
          color: tone === 'up' ? up : tone === 'down' ? down : grey,
          '& .MuiSlider-rail': {
            background: `linear-gradient(to right, ${down}, ${grey}, ${up})`,
            opacity: 0.35,
          },
        }}
      />
    </Box>
  )
}
