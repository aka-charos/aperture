import { useEffect, useRef, useState } from 'react'
import { Box, CircularProgress, IconButton, TextField, Tooltip } from '@mui/material'
import CheckIcon from '@mui/icons-material/Check'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import { useTranslation } from 'react-i18next'
import { diffInterpolationTokens } from '../../../i18n/flatten'
import { decideInlineSave, isUntranslated } from './catalogFilter'
import type { TranslationCatalog } from './useTranslationCatalog'

interface InlineTranslationCellProps {
  keyPath: string
  locale: string
  catalog: TranslationCatalog
}

/**
 * One language's text for one key, edited in the table. Saves on blur and on
 * Enter (Shift+Enter is a line break); Escape puts the saved text back.
 */
export function InlineTranslationCell({ keyPath, locale, catalog }: InlineTranslationCellProps) {
  const { t } = useTranslation()
  const { defaults, overrides, effective, saveOverride } = catalog

  const current = effective[locale]?.[keyPath] ?? ''
  const bundledDefault = defaults[locale]?.[keyPath] ?? ''
  const english = effective.en?.[keyPath] ?? ''
  // "Same as English" is judged against the BUNDLED English, like the page's
  // filter and count: a bundled copy that still reads as the original English
  // is untranslated even after an admin rewords the English itself.
  const bundledEnglish = defaults.en?.[keyPath] ?? ''
  const hasOverride = overrides[locale]?.[keyPath] !== undefined

  const [draft, setDraft] = useState(current)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editing = useRef(false)
  // Set by Escape: the blur that follows must not save. It cannot be done by
  // resetting the draft first, because blur runs before React re-renders and
  // would still see the typed text.
  const discardOnBlur = useRef(false)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Follow a change made elsewhere (the Edit dialog, a CSV import), but never
  // over text the admin is in the middle of typing.
  useEffect(() => {
    if (!editing.current) setDraft(current)
  }, [current])

  useEffect(() => () => {
    if (savedTimer.current) clearTimeout(savedTimer.current)
  }, [])

  const commit = async () => {
    editing.current = false
    if (discardOnBlur.current) {
      discardOnBlur.current = false
      setDraft(current)
      return
    }
    const decision = decideInlineSave({ draft, current, bundledDefault, hasOverride })
    if (decision.kind === 'none') {
      setDraft(current)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await saveOverride(locale, keyPath, decision.kind === 'reset' ? null : decision.value)
      if (decision.kind === 'reset') setDraft(bundledDefault)
      setSaved(true)
      if (savedTimer.current) clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setSaved(false), 1500)
    } catch (err) {
      setError((err as Error).message || t('admin.translationsPage.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const reset = async () => {
    setSaving(true)
    setError(null)
    try {
      await saveOverride(locale, keyPath, null)
      setDraft(bundledDefault)
    } catch (err) {
      setError((err as Error).message || t('admin.translationsPage.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const tokens = diffInterpolationTokens(english, draft)
  const tokenProblem = [
    tokens.missing.length > 0 ? t('admin.translationsPage.tokenMismatchMissing', { tokens: tokens.missing.join(', ') }) : '',
    tokens.extra.length > 0 ? t('admin.translationsPage.tokenMismatchExtra', { tokens: tokens.extra.join(', ') }) : '',
  ]
    .filter(Boolean)
    .join(' ')
  const sameAsEnglish = isUntranslated(bundledEnglish, draft)

  return (
    // Clicks here edit the cell; they must not also open the row's dialog.
    <Box onClick={(e) => e.stopPropagation()} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <TextField
        fullWidth
        multiline
        maxRows={4}
        size="small"
        value={draft}
        placeholder={english}
        error={!!error}
        helperText={error ?? undefined}
        onFocus={() => {
          editing.current = true
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          // Enter also confirms a candidate in a Japanese, Chinese or Korean
          // input method; that keystroke belongs to the IME, not to us.
          if (e.nativeEvent.isComposing || e.keyCode === 229) return
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            ;(e.target as HTMLElement).blur()
          } else if (e.key === 'Escape') {
            discardOnBlur.current = true
            ;(e.target as HTMLElement).blur()
          }
        }}
        slotProps={{
          htmlInput: { 'aria-label': `${keyPath} (${locale})` },
        }}
        sx={{
          '& .MuiInputBase-root': {
            fontSize: '0.875rem',
            py: 0.5,
            // A string still reading as the English is the worklist; mark it.
            bgcolor: sameAsEnglish ? 'action.hover' : undefined,
          },
        }}
      />
      <Box sx={{ width: 28, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
        {saving ? (
          <CircularProgress size={14} />
        ) : saved ? (
          <CheckIcon fontSize="small" color="success" />
        ) : tokenProblem ? (
          <Tooltip title={tokenProblem}>
            <WarningAmberIcon fontSize="small" color="warning" />
          </Tooltip>
        ) : hasOverride ? (
          <Tooltip title={t('admin.translationsPage.resetToDefault')}>
            <IconButton size="small" onClick={() => void reset()}>
              <RestartAltIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : null}
      </Box>
    </Box>
  )
}
