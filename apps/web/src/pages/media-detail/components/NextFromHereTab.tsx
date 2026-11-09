import { useTranslation } from 'react-i18next'
import { Link as RouterLink } from 'react-router-dom'
import { Box, Button, CircularProgress, Typography } from '@mui/material'
import SkipNextOutlinedIcon from '@mui/icons-material/SkipNextOutlined'
import { TitleTile } from '../../next/TitleTile'
import { orderReasons, reasonText } from '../../next/reasons'
import { useReasonText } from '../../next/useReasonText'
import type { TrailTitle } from '../../next/types'
import type { NextSummaryState } from '../hooks/useNextSummary'

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
 * loading, when it failed and when there is nothing to suggest.
 */
export function NextFromHereTab({ state, title, nextPath, onOpen }: NextFromHereTabProps) {
  const { t } = useTranslation()
  const say = useReasonText()
  const { status, items, load } = state

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('next.detail.description')}
      </Typography>

      {status === 'failed' ? (
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {t('next.detail.failed')}
          </Typography>
          <Button size="small" onClick={load} sx={{ textTransform: 'none' }}>
            {t('next.detail.retry')}
          </Button>
        </Box>
      ) : items == null ? (
        // No count to promise: how many the summary answers is the server's.
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }} aria-busy>
          <CircularProgress size={28} />
        </Box>
      ) : items.length === 0 ? (
        // No link here: the page shows every kind of suggestion this summary
        // draws from, so it would be just as empty.
        <Typography variant="body2" color="text.secondary">
          {t('next.detail.empty')}
        </Typography>
      ) : (
        <>
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
          <Button
            size="small"
            component={RouterLink}
            to={nextPath}
            endIcon={<SkipNextOutlinedIcon />}
            sx={{ textTransform: 'none' }}
          >
            {t('next.detail.seeAll')}
          </Button>
        </>
      )}
    </Box>
  )
}
