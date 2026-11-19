import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { Box, Button, Skeleton, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import GridViewIcon from '@mui/icons-material/GridView'
import BubbleChartIcon from '@mui/icons-material/BubbleChart'
import SkipNextOutlinedIcon from '@mui/icons-material/SkipNextOutlined'
import { NextMap } from '../../next/NextMap'
import { nextPath, orderReasons, reasonText, writeNextUrl } from '../../next/reasons'
import { useReasonText } from '../../next/useReasonText'
import type { TrailTitle } from '../../next/types'
import { useNextSummary } from '../hooks/useNextSummary'
import { useNextMap } from '../hooks/useNextMap'
import { useGridColumns } from '../hooks/useGridColumns'
import { wholeRowCount } from '../wholeRows'
import { TitlePosterCard, TitlePosterPlaceholderRow, TITLE_POSTER_GRID_SX } from './TitlePosterCard'

type View = 'list' | 'map'

interface NextFromHerePanelProps {
  /** This title as Next from here names it (`movie:<id>`); the page renders no panel without one. */
  titleRef: string
  /** This title's name, which the reasons are worded against ("closest in feel to …"). */
  mediaTitle: string
  onOpen: (title: TrailTitle) => void
}

/**
 * The right column of a title's page: what to watch after it, from Next from
 * here. One list replaced the Related tab beside it, which showed the same
 * embedding neighbours without the reasons, the viewer's own record or the
 * other media type (measured in docs/aperture-forensics.md, F-199).
 *
 * How many suggestions come back is the admin's setting, decided by the API;
 * the grid draws whole rows of them. The map is Next from here's own, asked
 * the first time someone switches to it. Mounted once per title (the page
 * keys it by id), so every title opens as a list.
 */
export function NextFromHerePanel({ titleRef, mediaTitle, onOpen }: NextFromHerePanelProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const say = useReasonText()
  const ids = useId()
  const [view, setView] = useState<View>('list')
  const summary = useNextSummary(titleRef)
  const map = useNextMap(titleRef, view === 'map')
  const [gridRef, columns] = useGridColumns()

  const items = summary.items ?? []
  const shown = items.slice(0, wholeRowCount(items.length, columns))

  // A step from the map carries on in Next from here itself, where the trail
  // and its map live: from this title to the one stepped to.
  const stepTo = (title: TrailTitle) => {
    const query = writeNextUrl({ trail: [titleRef, title.ref], view: 'map', hideSeen: false, kinds: [] })
    navigate(`/next?${query.toString()}`)
  }
  const fullMapPath = `/next?${writeNextUrl({ trail: [titleRef], view: 'map', hideSeen: false, kinds: [] }).toString()}`

  return (
    <Box component="section" aria-labelledby={`${ids}-heading`}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          columnGap: 2,
          rowGap: 1,
          mb: 1,
        }}
      >
        <Typography id={`${ids}-heading`} component="h2" variant="h6" sx={{ fontWeight: 600 }}>
          {t('next.detail.title')}
        </Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={view}
          onChange={(_, value: View | null) => {
            // Pressing the selected button again would clear the choice.
            if (value) setView(value)
          }}
          aria-label={t('next.detail.viewLabel')}
        >
          <ToggleButton value="list" sx={viewButtonSx}>
            <GridViewIcon fontSize="small" />
            {t('next.detail.viewList')}
          </ToggleButton>
          <ToggleButton value="map" sx={viewButtonSx}>
            <BubbleChartIcon fontSize="small" />
            {t('next.detail.viewMap')}
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {view === 'list' ? (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('next.detail.description')}
          </Typography>
          {summary.status === 'failed' ? (
            <Failed onRetry={summary.retry} />
          ) : summary.status === 'loading' ? (
            // How many come back is the admin's setting, so no count is promised.
            <TitlePosterPlaceholderRow />
          ) : items.length === 0 ? (
            // No link: the page draws on the same candidates and would be as empty.
            <Typography variant="body2" color="text.secondary">
              {t('next.detail.empty')}
            </Typography>
          ) : (
            <>
              <Box ref={gridRef} sx={{ ...TITLE_POSTER_GRID_SX, mb: 2 }}>
                {shown.map((item) => {
                  const reason = orderReasons(item.reasons)[0]
                  const sentence = reason ? say(reasonText(reason, mediaTitle, item.title.type)) : null
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
                      {/* Drawn whole: the reason is the point of the list, and a
                          clipped one can only be finished by hovering, which a
                          touch screen cannot do. Cards in a row grow together. */}
                      {sentence && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          display="block"
                          sx={{ mt: 0.75, lineHeight: 1.35 }}
                        >
                          {sentence}
                        </Typography>
                      )}
                    </TitlePosterCard>
                  )
                })}
              </Box>
              <MoreLink to={nextPath(titleRef)} label={t('next.detail.seeAll')} />
            </>
          )}
        </>
      ) : map.status === 'failed' ? (
        <Failed onRetry={map.retry} />
      ) : map.data ? (
        <>
          <NextMap
            compact
            data={map.data}
            onOpen={onOpen}
            onStepItem={(item) => stepTo(item.title)}
            onStepRow={(_, member) => stepTo(member.title)}
          />
          <MoreLink to={fullMapPath} label={t('next.detail.fullMap')} />
        </>
      ) : (
        <Skeleton variant="rounded" sx={{ height: { xs: 420, md: 480 } }} />
      )}
    </Box>
  )
}

function Failed({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
      <Typography variant="body2" color="text.secondary">
        {t('next.detail.failed')}
      </Typography>
      <Button size="small" onClick={onRetry} sx={{ textTransform: 'none' }}>
        {t('next.detail.retry')}
      </Button>
    </Box>
  )
}

function MoreLink({ to, label }: { to: string; label: string }) {
  return (
    <Button size="small" component={RouterLink} to={to} endIcon={<SkipNextOutlinedIcon />} sx={{ textTransform: 'none' }}>
      {label}
    </Button>
  )
}

const viewButtonSx = { gap: 0.75, px: 1.25, py: 0.5, textTransform: 'none' } as const
