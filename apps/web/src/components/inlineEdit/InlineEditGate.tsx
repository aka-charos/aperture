import { Suspense, lazy, useEffect } from 'react'
import { isInlineEditEnabled, setInlineEditEnabled } from '@/i18n/inlineEdit/store'
import { useInlineEdit } from './useInlineEdit'

// Loaded only once an admin switches editing on: it pulls in the
// Translations editor's catalog, which nobody else needs.
const InlineEditLayer = lazy(() => import('./InlineEditLayer'))

/**
 * Mounts the inline editing layer while it is on, and switches it off when
 * the person can no longer save strings: signing out, losing admin, or
 * viewing as another account (read-only, even when that account is an
 * admin) — nobody should be left with clicks that open an editor that cannot
 * save.
 */
export function InlineEditGate({ canEdit }: { canEdit: boolean }) {
  const { enabled } = useInlineEdit()

  useEffect(() => {
    if (!canEdit && isInlineEditEnabled()) setInlineEditEnabled(false)
  }, [canEdit])

  useEffect(() => () => setInlineEditEnabled(false), [])

  if (!canEdit || !enabled) return null
  return (
    <Suspense fallback={null}>
      <InlineEditLayer />
    </Suspense>
  )
}
