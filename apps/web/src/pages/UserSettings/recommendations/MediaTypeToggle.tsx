import { ToggleButton, ToggleButtonGroup } from '@mui/material'
import MovieIcon from '@mui/icons-material/Movie'
import TvIcon from '@mui/icons-material/Tv'
import { useTranslation } from 'react-i18next'
import type { MediaType } from './useTasteData'

interface MediaTypeToggleProps {
  value: MediaType
  options: readonly MediaType[]
  onChange: (value: MediaType) => void
}

/**
 * Movies or TV, for the few settings that really are stored per media type.
 * It sits inside the card it switches, never above the page: a page-level
 * switch is how per-user settings came to look per-type. Renders nothing for a
 * viewer with only one kind of library, since there is nothing to choose.
 */
export function MediaTypeToggle({ value, options, onChange }: MediaTypeToggleProps) {
  const { t } = useTranslation()
  if (options.length < 2) return null
  return (
    <ToggleButtonGroup
      size="small"
      exclusive
      value={value}
      onChange={(_, next: MediaType | null) => {
        if (next) onChange(next)
      }}
      aria-label={t('userSettings.recs.mediaTypeToggle')}
    >
      {options.map((type) => (
        <ToggleButton key={type} value={type} sx={{ textTransform: 'none', gap: 0.75, px: 1.25, py: 0.5 }}>
          {type === 'movie' ? <MovieIcon fontSize="small" /> : <TvIcon fontSize="small" />}
          {type === 'movie' ? t('userSettings.identitySubtabMovies') : t('userSettings.identitySubtabSeries')}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  )
}
