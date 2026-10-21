/**
 * The sections of one answer — "Recommendations", "Also worth checking", "From
 * your taste profile" — as tabs, each labelled with how many titles it holds.
 *
 * A tab appears only for a section that has cards, so the tabs are whatever the
 * answer happened to produce: one section (or none) renders exactly as before,
 * with no tab row, since a single tab names nothing the heading would not.
 *
 * Inside a tab every section is the card grid, whatever layout the tool asked
 * for. The horizontal strip was chosen for a SECONDARY section sitting under
 * the main list, a sidebar to the answer; in a tab it is the whole of what is
 * on screen, and a strip there hides most of its cards behind a scroll.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Box, Tab, Tabs } from '@mui/material'
import { ContentCarousel } from './ContentCarousel'
import { useCarouselHeaderText } from './carouselHeader'
import { chatText } from '../density'
import type { ContentCarouselData } from './types'

function SectionTabLabel({ data }: { data: ContentCarouselData }) {
  const { t } = useTranslation()
  const { resolvedTitle } = useCarouselHeaderText(data)
  return (
    <>
      {resolvedTitle ?? t('assistantToolUi.sectionUntitled')}
      <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400, marginInlineStart: 0.75 }}>
        {data.items.length}
      </Box>
    </>
  )
}

export function SectionTabs({ carousels }: { carousels: ContentCarouselData[] }) {
  const [selected, setSelected] = useState(0)
  const sections = carousels.filter((c) => c.items.length > 0)

  if (sections.length < 2) {
    return (
      <>
        {carousels.map((c) => (
          <ContentCarousel key={c.id} data={c} />
        ))}
      </>
    )
  }

  // A stored answer re-rendered with fewer sections (the watched filter can
  // empty one) must not leave the selection pointing past the end.
  const index = Math.min(selected, sections.length - 1)

  return (
    <Box sx={{ my: 2, width: '100%', maxWidth: '100%' }}>
      <Tabs
        value={index}
        onChange={(_, value: number) => setSelected(value)}
        variant="scrollable"
        scrollButtons={false}
        sx={{
          minHeight: 0,
          borderBottom: 1,
          borderColor: 'divider',
          '& .MuiTab-root': {
            minHeight: 40,
            px: 1.5,
            textTransform: 'none',
            fontFamily: 'inherit',
            fontSize: chatText(13),
            fontWeight: 600,
          },
        }}
      >
        {sections.map((section) => (
          <Tab
            key={section.id}
            id={`section-tab-${section.id}`}
            aria-controls={`section-panel-${section.id}`}
            label={<SectionTabLabel data={section} />}
          />
        ))}
      </Tabs>
      {/* Every panel stays mounted and the inactive ones are hidden, so a
          switch keeps each section's state (a favourite still being saved,
          its confirmation toast, an expanded synopsis) and every tab's
          aria-controls names a panel that exists. Mounting them all costs
          nothing new: before the tabs, every section rendered at once. */}
      {sections.map((section, i) => (
        <Box
          key={section.id}
          role="tabpanel"
          id={`section-panel-${section.id}`}
          aria-labelledby={`section-tab-${section.id}`}
          hidden={i !== index}
        >
          <ContentCarousel data={{ ...section, layout: 'list' }} hideTitle />
        </Box>
      ))}
    </Box>
  )
}
