import { useCallback, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { getInlineEditVersion, isInlineEditEnabled, subscribeInlineEdit } from '@/i18n/inlineEdit/store'

/** Whether inline text editing is on, re-rendering when it switches or when
 *  the set of recorded strings changes (`version`). */
export function useInlineEdit(): { enabled: boolean; version: number } {
  const version = useSyncExternalStore(subscribeInlineEdit, getInlineEditVersion, getInlineEditVersion)
  return { enabled: isInlineEditEnabled(), version }
}

/**
 * `t` for the editor's own chrome. An explicit empty `postProcess` skips the
 * recording post-processor, so the toolbar, the strings panel and the editor
 * dialog never list themselves among the strings "on this screen".
 */
export function useEditorT(): (key: string, options?: Record<string, unknown>) => string {
  const { t } = useTranslation()
  return useCallback((key: string, options?: Record<string, unknown>) => t(key, { ...options, postProcess: [] }), [t])
}
