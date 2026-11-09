import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Box, Tab, Tabs, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import GridViewIcon from '@mui/icons-material/GridView'
import BubbleChartIcon from '@mui/icons-material/BubbleChart'
import { SimilarMedia, type SimilarViewMode } from './SimilarMedia'
import { NextFromHereTab } from './NextFromHereTab'
import type { NextSummaryState } from '../hooks/useNextSummary'
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
  nextSummary: NextSummaryState
  onOpenNext: (title: TrailTitle) => void
}

/**
 * The right column of a title's page: titles related to this one, and Next
 * from here (what to watch after it), as two tabs of one panel. Mounted once
 * per title (the page keys it by id), so every title opens on Related, as a
 * list: the graph and the other tab are per-visit choices, never remembered.
 */
export function RelatedPanel({
  mediaType,
  mediaId,
  mediaTitle,
  similar,
  similarLoading,
  onOpenMedia,
  nextPath,
  nextSummary,
  onOpenNext,
}: RelatedPanelProps) {
  const { t } = useTranslation()
  const [section, setSection] = useState<Section>('related')
  const [viewMode, setViewMode] = useState<SimilarViewMode>('list')

  const relatedLabel =
    mediaType === 'movie' ? t('mediaDetail.similar.titleMovies') : t('mediaDetail.similar.titleSeries')
  const shown: Section = nextPath ? section : 'related'

  return (
    // Its arrival near the screen starts the Next from here request, so the
    // tab is ready by the time anyone opens it.
    <Box ref={nextSummary.watch}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          columnGap: 2,
          rowGap: 1,
          mb: 2,
        }}
      >
        {nextPath ? (
          <Tabs
            value={shown}
            onChange={(_, value: Section) => setSection(value)}
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
            aria-label={t('mediaDetail.similar.sectionsLabel')}
            sx={{ minHeight: 40, minWidth: 0 }}
          >
            <Tab value="related" label={relatedLabel} sx={sectionTabSx} />
            <Tab value="next" label={t('next.detail.title')} sx={sectionTabSx} />
          </Tabs>
        ) : (
          <Typography variant="h6" component="h2" fontWeight={600}>
            {relatedLabel}
          </Typography>
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

      {shown === 'related' ? (
        <SimilarMedia
          mediaType={mediaType}
          viewMode={viewMode}
          mediaId={mediaId}
          mediaTitle={mediaTitle}
          similar={similar}
          loading={similarLoading}
          onOpenMedia={onOpenMedia}
        />
      ) : (
        nextPath && (
          <NextFromHereTab state={nextSummary} title={mediaTitle} nextPath={nextPath} onOpen={onOpenNext} />
        )
      )}
    </Box>
  )
}

/** The two tabs stand where the column's heading stood, so they read as headings. */
const sectionTabSx = { minHeight: 40, px: 1.5, fontSize: '1rem', fontWeight: 600 } as const

const viewButtonSx = { gap: 0.75, px: 1.25, py: 0.5, textTransform: 'none' } as const
