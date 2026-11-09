import { useTranslation } from 'react-i18next'
import { Link as RouterLink } from 'react-router-dom'
import { Box, Button, CircularProgress, Typography } from '@mui/material'
import SkipNextOutlinedIcon from '@mui/icons-material/SkipNextOutlined'
import { orderReasons, reasonText } from '../../next/reasons'
import { useReasonText } from '../../next/useReasonText'
import type { TrailTitle } from '../../next/types'
import type { NextSummaryState } from '../hooks/useNextSummary'
import { TitlePosterCard, TITLE_POSTER_GRID_SX } from './TitlePosterCard'

/** Lines a reason may take under its poster; the whole sentence is in its tooltip. */
const REASON_LINES = 3

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
 * to watch after this title, drawn as Related draws its titles, each with the
 * reason that says most under its poster where Related puts its connection
 * chips, and a way into the page for the rest. The tab is always offered, so
 * it says when it is loading, when it failed and when there is nothing to
 * suggest.
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
          <Box sx={{ ...TITLE_POSTER_GRID_SX, mb: 2 }}>
            {items.map((item) => {
              const reason = orderReasons(item.reasons)[0]
              const sentence = reason ? say(reasonText(reason, title, item.title.type)) : null
              return (
                <TitlePosterCard
                  key={item.title.ref}
                  mediaType={item.title.type}
                  id={item.title.id}
                  title={item.title.title}
                  year={item.title.year}
                  posterUrl={item.title.posterUrl}
                  onOpen={() => onOpen(item.title)}
                >
                  {sentence && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      title={sentence}
                      sx={{
                        mt: 0.75,
                        display: '-webkit-box',
                        WebkitLineClamp: REASON_LINES,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        lineHeight: 1.35,
                      }}
                    >
                      {sentence}
                    </Typography>
                  )}
                </TitlePosterCard>
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
