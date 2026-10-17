import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { DocDrawer } from '@/components/docs/DocDrawer'
import type { DocPage } from '@/components/docs/pages'
import { ADMIN_DOC_PAGES } from './docs'
import { adminLinkTarget, consolePathIn, guideDocPath } from './links'

interface AdminHelpDrawerProps {
  open: boolean
  /** The section's pages, from `AdminEntry.docs`; the first opens by default. */
  docs: readonly string[]
  onClose: () => void
}

/** A console section's admin guide pages, read beside the section. */
export function AdminHelpDrawer({ open, docs, onClose }: AdminHelpDrawerProps) {
  const { t } = useTranslation()

  const linkTarget = useCallback(
    (href: string, page: DocPage) => adminLinkTarget(href, page.file, (slug) => ADMIN_DOC_PAGES.has(slug)),
    []
  )

  const labels = useMemo(
    () => ({
      guide: t('adminDocs.guide.title'),
      back: t('adminDocs.help.back'),
      openInNewTab: t('adminDocs.help.openInNewTab'),
      close: t('adminDocs.help.close'),
      textLinkHint: t('adminDocs.link.outside'),
    }),
    [t]
  )

  return (
    <DocDrawer
      open={open}
      slugs={docs}
      pages={ADMIN_DOC_PAGES}
      pagePath={guideDocPath}
      linkTarget={linkTarget}
      codeRoute={consolePathIn}
      // Never collides with the section's own ids underneath.
      idPrefix="admin-help-"
      labels={labels}
      onClose={onClose}
    />
  )
}
