import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@mui/material'
import ExploreOutlinedIcon from '@mui/icons-material/ExploreOutlined'
import { DocDrawer } from '@/components/docs/DocDrawer'
import type { DocPage } from '@/components/docs/pages'
import { userGuidePath } from '@/components/docs/guidePaths'
import { useTour } from '@/hooks/useTour'
import { isTourId } from '@/components/tour/tours'
import { useAuth } from '@/hooks/useAuth'
import { USER_DOC_PAGES, userDocPages } from './docs'
import { useGuideLanguage } from './useGuideLanguage'
import { userLinkTarget } from './links'
import { appPathIn } from './routeDocs'
import { translatedAnchor } from './translatedAnchor'

interface UserHelpDrawerProps {
  open: boolean
  /** The pages describing the current screen, from `docsForLocation`. */
  docs: readonly string[]
  /** A heading on the first page to open at. */
  anchor?: string
  /** The tour for the screen underneath, offered as "Show me around". */
  tour?: string
  onClose: () => void
}

/** The user guide pages for the screen someone is on, read beside it. */
export function UserHelpDrawer({ open, docs, anchor, tour, onClose }: UserHelpDrawerProps) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { startTour } = useTour()
  const isAdmin = user?.isAdmin === true
  const language = useGuideLanguage()
  const pages = userDocPages(language)
  // The anchor is an English heading id; a translated page has its own.
  const initialAnchor = translatedAnchor(
    USER_DOC_PAGES.get(docs[0])?.headings,
    pages.get(docs[0])?.headings,
    anchor
  )

  const linkTarget = useCallback(
    (href: string, page: DocPage) => userLinkTarget(href, page.file, (slug) => USER_DOC_PAGES.has(slug), isAdmin),
    [isAdmin]
  )

  const labels = useMemo(
    () => ({
      guide: t('userGuide.title'),
      back: t('userGuide.help.back'),
      openInNewTab: t('userGuide.help.openInNewTab'),
      close: t('userGuide.help.close'),
      textLinkHint: t('userGuide.link.outside'),
    }),
    [t]
  )

  const showMeAround =
    tour && isTourId(tour) ? (
      <Button
        size="small"
        startIcon={<ExploreOutlinedIcon fontSize="small" />}
        onClick={() => {
          // The drawer closes first: the tour points at the screen behind it.
          onClose()
          startTour(tour)
        }}
        sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
      >
        {t('onboarding.tour.showMeAround')}
      </Button>
    ) : undefined

  return (
    <DocDrawer
      open={open}
      slugs={docs}
      pages={pages}
      pagePath={(slug) => userGuidePath(slug)}
      linkTarget={linkTarget}
      codeRoute={appPathIn}
      // Never collides with an id on the screen underneath.
      idPrefix="user-help-"
      labels={labels}
      initialAnchor={initialAnchor}
      headerAction={showMeAround}
      onClose={onClose}
    />
  )
}
