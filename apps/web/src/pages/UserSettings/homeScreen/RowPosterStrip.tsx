import { Box, Chip, Tooltip } from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { getProxiedImageUrl } from '@aperture/ui'
import type { RowTitle } from './types'

/**
 * The first titles in a row, as small posters, so a viewer can see what a row
 * would put on their home screen before deciding whether they want it. Sized
 * off the row rather than a breakpoint: it scrolls sideways in whatever width
 * the pane gives it.
 */
export function RowPosterStrip({
  sample,
  count,
  dimmed = false,
}: {
  sample: RowTitle[]
  count: number
  dimmed?: boolean
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  if (sample.length === 0) return null
  const more = count - sample.length

  return (
    <Box
      sx={{
        display: 'flex',
        gap: 1,
        overflowX: 'auto',
        pb: 0.5,
        alignItems: 'center',
        opacity: dimmed ? 0.45 : 1,
        transition: 'opacity 150ms',
      }}
    >
      {sample.map((title) => {
        const label = title.year ? `${title.title} (${title.year})` : title.title
        return (
          <Tooltip key={`${title.type}-${title.id}`} title={label}>
            <Box
              component="button"
              type="button"
              aria-label={label}
              onClick={() => navigate(`/${title.type === 'movie' ? 'movies' : 'series'}/${title.id}`)}
              sx={{
                flex: '0 0 auto',
                width: 64,
                aspectRatio: '2 / 3',
                p: 0,
                border: 0,
                borderRadius: 1,
                overflow: 'hidden',
                cursor: 'pointer',
                backgroundColor: 'action.hover',
                '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' },
              }}
            >
              <Box
                component="img"
                src={getProxiedImageUrl(title.posterUrl)}
                alt=""
                loading="lazy"
                sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            </Box>
          </Tooltip>
        )
      })}
      {more > 0 && (
        <Chip
          size="small"
          label={t('userSettings.homeScreen.moreTitles', { count: more })}
          sx={{ flex: '0 0 auto' }}
        />
      )}
    </Box>
  )
}
