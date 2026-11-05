import React from 'react'
import { useTranslation } from 'react-i18next'
import { PageErrorBoundary } from './PageErrorBoundary'

/**
 * `PageErrorBoundary` around one admin section, in the console's own words: the
 * nav column stays usable, so the message can say so.
 */
export function AdminErrorBoundary({
  children,
  resetKey,
}: {
  children: React.ReactNode
  resetKey: string
}) {
  const { t } = useTranslation()
  return (
    <PageErrorBoundary
      resetKey={resetKey}
      title={t('adminNav.sectionErrorTitle')}
      body={t('adminNav.sectionErrorBody')}
      reload={t('adminNav.sectionErrorReload')}
    >
      {children}
    </PageErrorBoundary>
  )
}
