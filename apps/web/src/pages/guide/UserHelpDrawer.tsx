import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { DocDrawer } from '@/components/docs/DocDrawer'
import type { DocPage } from '@/components/docs/pages'
import { userGuidePath } from '@/components/docs/guidePaths'
import { useAuth } from '@/hooks/useAuth'
import { USER_DOC_PAGES, userDocPages } from './docs'
import { useGuideLanguage } from './useGuideLanguage'
import { userLinkTarget } from './links'
import { appPathIn } from './routeDocs'

interface UserHelpDrawerProps {
  open: boolean
  /** The pages describing the current screen, from `docsForLocation`. */
  docs: readonly string[]
  onClose: () => void
}

/** The user guide pages for the screen someone is on, read beside it. */
export function UserHelpDrawer({ open, docs, onClose }: UserHelpDrawerProps) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const isAdmin = user?.isAdmin === true
  const language = useGuideLanguage()

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

  return (
    <DocDrawer
      open={open}
      slugs={docs}
      pages={userDocPages(language)}
      pagePath={(slug) => userGuidePath(slug)}
      linkTarget={linkTarget}
      codeRoute={appPathIn}
      // Never collides with an id on the screen underneath.
      idPrefix="user-help-"
      labels={labels}
      onClose={onClose}
    />
  )
}
