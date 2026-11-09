import { useTranslation } from 'react-i18next'
import { Link as RouterLink } from 'react-router-dom'
import { Box, Button, Skeleton, Typography } from '@mui/material'
import SkipNextOutlinedIcon from '@mui/icons-material/SkipNextOutlined'
import { TitleTile } from '../../next/TitleTile'
import { orderReasons, reasonText } from '../../next/reasons'
import { useReasonText } from '../../next/useReasonText'
import type { TrailTitle } from '../../next/types'
import type { NextSummaryState } from '../hooks/useNextSummary'

/** Placeholder rows while the summary loads; the API answers at most three. */
const PLACEHOLDER_ROWS = 3
const TILE_WIDTH = 72

interface NextFromHereTabProps {
  state: NextSummaryState
  /** This title's name, which the reasons are worded against ("closest in feel to …"). */
  title: string
  /** Next from here, starting at this title. */
  nextPath: string
  onOpen: (title: TrailTitle) => void
}

/**
 * The Next from here tab beside Related on a title's page: the best few things
 * to watch after this title, each with the reason that says most, and a way
 * into the page for the rest. The tab is always offered, so it says when it is
 * still loading, when it failed and when there is nothing to suggest.
 */
export function NextFromHereTab({ state, title, nextPath, onOpen }: NextFromHereTabProps) {
  const { t } = useTranslation()
  const say = useReasonText()
  const { items, failed } = state

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('next.detail.description')}
      </Typography>

      {failed ? (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {t('next.detail.failed')}
        </Typography>
      ) : items == null ? (
        <Box sx={{ display: 'grid', gap: 2, mb: 1.5 }} aria-busy>
          {Array.from({ length: PLACEHOLDER_ROWS }, (_, i) => (
            <Box key={i} sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
              <Skeleton variant="rounded" sx={{ width: TILE_WIDTH, height: 'auto', aspectRatio: '2 / 3', flexShrink: 0 }} />
              <Box sx={{ flex: 1 }}>
                <Skeleton variant="text" sx={{ width: '60%' }} />
                <Skeleton variant="text" sx={{ width: '85%' }} />
              </Box>
            </Box>
          ))}
        </Box>
      ) : items.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {t('next.detail.empty')}
        </Typography>
      ) : (
        <Box sx={{ display: 'grid', gap: 2, mb: 1.5 }}>
          {items.map((item) => {
            const reason = orderReasons(item.reasons)[0]
            return (
              <Box key={item.title.ref} sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', minWidth: 0 }}>
                <TitleTile title={item.title} onOpen={onOpen} width={TILE_WIDTH} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="subtitle2" sx={{ lineHeight: 1.3 }}>
                    {item.title.title}
                    {item.title.year ? (
                      <Typography component="span" variant="body2" color="text.secondary">
                        {` (${item.title.year})`}
                      </Typography>
                    ) : null}
                  </Typography>
                  {reason && (
                    <Typography variant="body2" color="text.secondary">
                      {say(reasonText(reason, title, item.title.type))}
                    </Typography>
                  )}
                </Box>
              </Box>
            )
          })}
        </Box>
      )}

      <Button
        size="small"
        component={RouterLink}
        to={nextPath}
        endIcon={<SkipNextOutlinedIcon />}
        sx={{ textTransform: 'none' }}
      >
        {/* "See more" only beside something to see more of. */}
        {items != null && items.length > 0 ? t('next.detail.seeAll') : t('next.detail.open')}
      </Button>
    </Box>
  )
}
