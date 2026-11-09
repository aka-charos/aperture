import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Box, Tab, Tabs, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import GridViewIcon from '@mui/icons-material/GridView'
import BubbleChartIcon from '@mui/icons-material/BubbleChart'
import { SimilarMedia, type SimilarViewMode } from './SimilarMedia'
import { NextFromHereTab } from './NextFromHereTab'
import { useNextSummary } from '../hooks/useNextSummary'
import { titleRefFor } from '../../next/trail'
import type { TrailTitle } from '../../next/types'
import type { MediaType, SimilarItem } from '../types'

type Section = 'related' | 'next'

interface RelatedPanelProps {
  mediaType: MediaType
  mediaId?: string
  mediaTitle: string
  similar: SimilarItem[]
  similarLoading: boolean
  onOpenMedia?: (mediaType: MediaType, id: string) => void
  /** Next from here, starting at this title; null offers no Next from here tab. */
  nextPath: string | null
  onOpenNext: (title: TrailTitle) => void
}

/**
 * The right column of a title's page: titles related to this one, and Next
 * from here (what to watch after it), as two tabs of one panel. Mounted once
 * per title (the page keys it by id), so every title opens on Related, as a
 * list: the graph and the other tab are per-visit choices, never remembered.
 *
 * Both tabs stay mounted and the inactive one is hidden, so a graph the viewer
 * has explored is still there when they come back to it.
 */
export function RelatedPanel({
  mediaType,
  mediaId,
  mediaTitle,
  similar,
  similarLoading,
  onOpenMedia,
  nextPath,
  onOpenNext,
}: RelatedPanelProps) {
  const { t } = useTranslation()
  const ids = useId()
  const [section, setSection] = useState<Section>('related')
  const [viewMode, setViewMode] = useState<SimilarViewMode>('list')
  // Asked only when someone points at or opens the tab, never on page load.
  const nextSummary = useNextSummary(mediaId ? titleRefFor(mediaType, mediaId) : null)

  const relatedLabel =
    mediaType === 'movie' ? t('mediaDetail.similar.titleMovies') : t('mediaDetail.similar.titleSeries')
  const shown: Section = nextPath ? section : 'related'
  const tabId = (value: Section) => `${ids}-tab-${value}`
  const panelId = (value: Section) => `${ids}-panel-${value}`

  return (
    <Box component="section" aria-labelledby={`${ids}-heading`}>
      {/* The tabs stand where the heading stood; the heading stays for
          anyone moving through the page by headings. */}
      <Typography
        id={`${ids}-heading`}
        component="h2"
        sx={nextPath ? visuallyHidden : { typography: 'h6', fontWeight: 600, mb: 2 }}
      >
        {nextPath ? t('mediaDetail.similar.sectionsLabel') : relatedLabel}
      </Typography>

      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: nextPath ? 'space-between' : 'flex-end',
          flexWrap: 'wrap',
          columnGap: 2,
          rowGap: 1,
          mb: 2,
          '&:empty': { display: 'none' },
        }}
      >
        {nextPath && (
          <Tabs
            value={shown}
            onChange={(_, value: Section) => {
              if (value === 'next') nextSummary.load()
              setSection(value)
            }}
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
            aria-label={t('mediaDetail.similar.sectionsLabel')}
            sx={{ minHeight: 40, minWidth: 0 }}
          >
            <Tab
              value="related"
              label={relatedLabel}
              id={tabId('related')}
              aria-controls={panelId('related')}
              sx={sectionTabSx}
            />
            <Tab
              value="next"
              label={t('next.detail.title')}
              id={tabId('next')}
              aria-controls={panelId('next')}
              // Pointing at the tab is enough of a sign to start asking, so
              // the answer is usually there by the time it opens.
              onMouseEnter={nextSummary.load}
              onFocus={nextSummary.load}
              sx={sectionTabSx}
            />
          </Tabs>
        )}

        {shown === 'related' && (
          <ToggleButtonGroup
            size="small"
            exclusive
            value={viewMode}
            onChange={(_, value: SimilarViewMode | null) => {
              // Pressing the selected button again would clear the choice.
              if (value) setViewMode(value)
            }}
            aria-label={t('mediaDetail.similar.viewLabel')}
          >
            <ToggleButton value="list" sx={viewButtonSx}>
              <GridViewIcon fontSize="small" />
              {t('mediaDetail.similar.tabList')}
            </ToggleButton>
            <ToggleButton value="graph" sx={viewButtonSx}>
              <BubbleChartIcon fontSize="small" />
              {t('mediaDetail.similar.tabGraph')}
            </ToggleButton>
          </ToggleButtonGroup>
        )}
      </Box>

      <Box
        role={nextPath ? 'tabpanel' : undefined}
        id={panelId('related')}
        aria-labelledby={nextPath ? tabId('related') : undefined}
        hidden={shown !== 'related'}
      >
        <SimilarMedia
          mediaType={mediaType}
          viewMode={viewMode}
          mediaId={mediaId}
          mediaTitle={mediaTitle}
          similar={similar}
          loading={similarLoading}
          onOpenMedia={onOpenMedia}
        />
      </Box>

      {nextPath && (
        <Box role="tabpanel" id={panelId('next')} aria-labelledby={tabId('next')} hidden={shown !== 'next'}>
          <NextFromHereTab state={nextSummary} title={mediaTitle} nextPath={nextPath} onOpen={onOpenNext} />
        </Box>
      )}
    </Box>
  )
}

/** The two tabs stand where the column's heading stood, so they read as headings. */
const sectionTabSx = { minHeight: 40, px: 1.5, fontSize: '1rem', fontWeight: 600 } as const

const viewButtonSx = { gap: 0.75, px: 1.25, py: 0.5, textTransform: 'none' } as const

/** Read by screen readers, not drawn. */
const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  p: 0,
  m: '-1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const
