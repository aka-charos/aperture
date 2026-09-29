import { useTranslation } from 'react-i18next'
import { Chip } from '@mui/material'
import { alpha } from '@mui/material/styles'
import MovieIcon from '@mui/icons-material/Movie'
import TvIcon from '@mui/icons-material/Tv'

/**
 * "Movie" or "Series" on a poster, for a row that mixes the two — the
 * dashboard's "Recently watched by …" rows, where nothing else says which a
 * title is. A row of one kind does not need it.
 *
 * Top-left, the RankBadge's corner, so the two are never passed together:
 * top-right is the viewer's own badge stack plus the watching toggle, and the
 * bottom edge is where library artwork burns in flags and rating badges. The
 * dark translucent chip is the poster overlays' own look, so it reads on any
 * art; neutral rather than coloured, because on this poster green already
 * means "you watched it". Icon and word both, so it is legible at a glance
 * and to a screen reader.
 */
export function MediaTypeChip({ type }: { type: 'movie' | 'series' }) {
  const { t } = useTranslation()
  const Icon = type === 'movie' ? MovieIcon : TvIcon
  return (
    <Chip
      size="small"
      icon={<Icon />}
      label={type === 'movie' ? t('dashboard.typeMovie') : t('dashboard.typeSeries')}
      sx={{
        position: 'absolute',
        top: 8,
        insetInlineStart: 8,
        // Above the hover overlay (1), level with the poster's own badges.
        zIndex: 2,
        height: 22,
        maxWidth: 'calc(100% - 16px)',
        fontSize: '0.68rem',
        fontWeight: 600,
        color: 'common.white',
        backgroundColor: alpha('#000', 0.75),
        border: '1px solid',
        borderColor: alpha('#fff', 0.18),
        '& .MuiChip-icon': { color: 'inherit', fontSize: 14, marginInlineStart: '6px' },
        '& .MuiChip-label': { px: 0.75 },
      }}
    />
  )
}
