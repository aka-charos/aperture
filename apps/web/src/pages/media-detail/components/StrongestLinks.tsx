import { useTranslation } from 'react-i18next'
import { Link as RouterLink } from 'react-router-dom'
import { Box, Button, Card, CardContent, Typography } from '@mui/material'
import RouteOutlinedIcon from '@mui/icons-material/RouteOutlined'
import { LinkCard } from '../../trails/LinkCard'
import { sharedWithOthers } from '../../trails/labels'
import { useTrailText } from '../../trails/useTrailText'
import type { StrongestLinksState } from '../hooks/useStrongestLinks'

interface StrongestLinksProps {
  state: StrongestLinksState
  /** Start a trail at this title, in Trails. */
  trailPath: string
}

/**
 * The strongest few named links out of this title — the threads Trails ranks
 * first (rarest, most telling role) — with a way into the page for the rest.
 * An extra, never a requirement: until it has links to show it draws only an
 * empty marker (which starts the request when it nears the screen), and on a
 * failure or for a title that links to nothing it draws nothing at all.
 */
export function StrongestLinks({ state, trailPath }: StrongestLinksProps) {
  const { t } = useTranslation()
  const { hereText } = useTrailText()
  const { links, watch } = state

  if (!links) return <Box ref={watch} aria-hidden sx={{ height: 0 }} />
  if (links.threads.length === 0) return null

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
          {links.threads.map((thread) => {
            const shared = sharedWithOthers(thread.titleCount)
            return (
              <LinkCard
                key={`${thread.kind}:${thread.name}`}
                entity={thread}
                caption={hereText(thread.kind, thread.roles)}
                rarity={t(shared.key, { count: shared.count })}
              />
            )
          })}
        </Box>
        <Button
          size="small"
          component={RouterLink}
          to={trailPath}
          endIcon={<RouteOutlinedIcon />}
          sx={{ textTransform: 'none' }}
        >
          {t('trails.detail.seeAll', { count: links.total })}
        </Button>
      </CardContent>
    </Card>
  )
}
