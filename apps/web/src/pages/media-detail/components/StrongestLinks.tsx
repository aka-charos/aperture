import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink } from 'react-router-dom'
import { Box, Button, Card, CardContent, Typography } from '@mui/material'
import RouteOutlinedIcon from '@mui/icons-material/RouteOutlined'
import { fetchTrails } from '../../trails/api'
import { LinkCard } from '../../trails/LinkCard'
import { threadsPathFor } from '../../trails/labels'
import { useTrailText } from '../../trails/useTrailText'
import type { Thread, ThreadsResponse } from '../../trails/types'

/** Threads shown here; the rest are a click away on the Trails page. */
const LINKS_SHOWN = 3

interface StrongestLinksProps {
  /** The title's Trails ref (`movie:<id>` / `series:<id>`). */
  titleRef: string
  /**
   * Called as the reader follows the link out. Set when the page is a dialog
   * over Trails itself: the address then changes only in its query, which does
   * not close the dialog by itself.
   */
  onLeave?: () => void
}

/**
 * The strongest few named links out of this title — the threads Trails ranks
 * first (rarest, most telling role) — with a way into the page for the rest.
 * An extra, never a requirement: while loading, on any failure and when the
 * title links to nothing, it draws nothing at all.
 */
export function StrongestLinks({ titleRef, onLeave }: StrongestLinksProps) {
  const { t } = useTranslation()
  const { hereText } = useTrailText()
  const [answer, setAnswer] = useState<{ ref: string; threads: Thread[] } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetchTrails<ThreadsResponse>(`threads?title=${encodeURIComponent(titleRef)}`, controller.signal)
      .then((response) => setAnswer({ ref: titleRef, threads: response.threads }))
      .catch(() => {
        /* fails quietly: the card is not drawn */
      })
    return () => controller.abort()
  }, [titleRef])

  // An answer for the title shown before is not one for this title.
  const threads = answer?.ref === titleRef ? answer.threads : []
  if (threads.length === 0) return null

  return (
    <Card sx={{ backgroundColor: 'background.paper', borderRadius: 2 }}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <RouteOutlinedIcon fontSize="small" color="action" />
          <Typography variant="h6" component="h2" fontWeight={600}>
            {t('trails.detail.title')}
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('trails.detail.description')}
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 1,
            mb: 1.5,
          }}
        >
          {threads.slice(0, LINKS_SHOWN).map((thread) => (
            <LinkCard
              key={`${thread.kind}:${thread.name}`}
              entity={thread}
              caption={hereText(thread.kind, thread.roles)}
            />
          ))}
        </Box>
        <Button
          size="small"
          component={RouterLink}
          to={threadsPathFor(titleRef)}
          onClick={onLeave}
          endIcon={<RouteOutlinedIcon />}
          sx={{ textTransform: 'none' }}
        >
          {t('trails.detail.seeAll', { count: threads.length })}
        </Button>
      </CardContent>
    </Card>
  )
}
