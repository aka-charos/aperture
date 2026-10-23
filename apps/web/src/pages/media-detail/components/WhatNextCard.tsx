import { useTranslation } from 'react-i18next'
import { Link as RouterLink } from 'react-router-dom'
import { Box, Button, Card, CardContent, Typography } from '@mui/material'
import SkipNextOutlinedIcon from '@mui/icons-material/SkipNextOutlined'
import { TitleTile } from '../../next/TitleTile'
import { orderReasons, reasonText } from '../../next/reasons'
import { useReasonText } from '../../next/useReasonText'
import type { TrailTitle } from '../../next/types'
import type { NextSummaryState } from '../hooks/useNextSummary'

interface WhatNextCardProps {
  state: NextSummaryState
  /** This title's name, which the reasons are worded against ("closest in feel to …"). */
  title: string
  /** Next from here, starting at this title. */
  nextPath: string
  onOpen: (title: TrailTitle) => void
}

/**
 * The best few things to watch after this title, each with the reason that
 * says most — Next from here in miniature, with a way into the page for the
 * rest. An extra, never a requirement: until it has suggestions it draws only
 * an empty marker (which starts the request when it nears the screen), and on
 * a failure or with nothing to suggest it draws nothing at all.
 */
export function WhatNextCard({ state, title, nextPath, onOpen }: WhatNextCardProps) {
  const { t } = useTranslation()
  const say = useReasonText()
  const { items, watch } = state

  if (!items) return <Box ref={watch} aria-hidden sx={{ height: 0 }} />
  if (items.length === 0) return null

  return (
    <Card sx={{ backgroundColor: 'background.paper', borderRadius: 2 }}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <SkipNextOutlinedIcon fontSize="small" color="action" />
          <Typography variant="h6" component="h2" fontWeight={600}>
            {t('next.detail.title')}
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('next.detail.description')}
        </Typography>
        <Box sx={{ display: 'grid', gap: 1.5, mb: 1.5 }}>
          {items.map((item) => {
            const reason = orderReasons(item.reasons)[0]
            return (
              <Box key={item.title.ref} sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', minWidth: 0 }}>
                <TitleTile title={item.title} onOpen={onOpen} width={56} />
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
      </CardContent>
    </Card>
  )
}
