import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Button,
  IconButton,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import CheckIcon from '@mui/icons-material/Check'
import { useTranslation } from 'react-i18next'
import { diffInterpolationTokens } from '../../../i18n/flatten'
import type { TranslationCatalog } from './useTranslationCatalog'

interface EditKeyDialogProps {
  open: boolean
  keyPath: string | null
  onClose: () => void
  catalog: TranslationCatalog
}

export function EditKeyDialog({ open, keyPath, onClose, catalog }: EditKeyDialogProps) {
  const { t } = useTranslation()
  const { locales, defaults, overrides, effective, saveOverride } = catalog

  const orderedLocales = useMemo(() => {
    const en = locales.find((l) => l.code === 'en')
    const rest = locales.filter((l) => l.code !== 'en')
    return en ? [en, ...rest] : locales
  }, [locales])

  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [initialValues, setInitialValues] = useState<Record<string, string>>({})
  const [savingLocale, setSavingLocale] = useState<string | null>(null)
  const [savedLocale, setSavedLocale] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!keyPath) return
    const next: Record<string, string> = {}
    for (const locale of locales) {
      next[locale.code] = effective[locale.code]?.[keyPath] ?? ''
    }
    setDrafts(next)
    setInitialValues(next)
    setErrors({})
    // Only re-initialize when the target key changes, not on every catalog update
    // (that would clobber in-progress edits after a sibling locale's autosave).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyPath])

  if (!keyPath) return null

  const commitLocale = async (locale: string) => {
    const draftValue = drafts[locale] ?? ''
    const initial = initialValues[locale] ?? ''
    if (draftValue === initial) return

    const defaultValue = defaults[locale]?.[keyPath] ?? ''
    const hasOverride = overrides[locale]?.[keyPath] !== undefined
    const matchesDefault = draftValue === defaultValue

    setErrors((prev) => ({ ...prev, [locale]: '' }))
    if (matchesDefault && !hasOverride) {
      setInitialValues((prev) => ({ ...prev, [locale]: draftValue }))
      return
    }

    setSavingLocale(locale)
    try {
      await saveOverride(locale, keyPath, matchesDefault ? null : draftValue)
      setInitialValues((prev) => ({ ...prev, [locale]: draftValue }))
      setSavedLocale(locale)
      setTimeout(() => setSavedLocale((current) => (current === locale ? null : current)), 1500)
    } catch (err) {
      setErrors((prev) => ({ ...prev, [locale]: (err as Error).message || t('admin.translationsPage.saveFailed') }))
    } finally {
      setSavingLocale(null)
    }
  }

  const handleReset = async (locale: string) => {
    setSavingLocale(locale)
    setErrors((prev) => ({ ...prev, [locale]: '' }))
    try {
      await saveOverride(locale, keyPath, null)
      const resetValue = defaults[locale]?.[keyPath] ?? ''
      setDrafts((prev) => ({ ...prev, [locale]: resetValue }))
      setInitialValues((prev) => ({ ...prev, [locale]: resetValue }))
    } catch (err) {
      setErrors((prev) => ({ ...prev, [locale]: (err as Error).message || t('admin.translationsPage.saveFailed') }))
    } finally {
      setSavingLocale(null)
    }
  }

  const enDraft = drafts.en ?? ''

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ fontFamily: 'monospace', fontSize: '0.95rem', flexGrow: 1 }}>{keyPath}</Box>
        <IconButton size="small" onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {orderedLocales.map((locale) => {
            const defaultValue = defaults[locale.code]?.[keyPath] ?? ''
            const hasOverride = overrides[locale.code]?.[keyPath] !== undefined
            const tokenDiff =
              locale.code === 'en' ? null : diffInterpolationTokens(enDraft, drafts[locale.code] ?? '')
            const hasTokenIssue = !!tokenDiff && (tokenDiff.missing.length > 0 || tokenDiff.extra.length > 0)

            return (
              <Box key={locale.code}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <Typography variant="subtitle2">
                    {locale.label} ({locale.code})
                  </Typography>
                  {savingLocale === locale.code && <CircularProgress size={14} />}
                  {savedLocale === locale.code && <CheckIcon fontSize="small" color="success" />}
                  <Tooltip title={t('admin.translationsPage.resetToDefault')}>
                    <span>
                      <IconButton size="small" disabled={!hasOverride} onClick={() => void handleReset(locale.code)}>
                        <RestartAltIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Box>
                <TextField
                  fullWidth
                  multiline
                  minRows={1}
                  maxRows={6}
                  size="small"
                  value={drafts[locale.code] ?? ''}
                  placeholder={defaultValue}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [locale.code]: e.target.value }))}
                  onBlur={() => void commitLocale(locale.code)}
                />
                {defaultValue && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    {t('admin.translationsPage.defaultValueLabel')} {defaultValue}
                  </Typography>
                )}
                {hasTokenIssue && (
                  <Alert severity="warning" sx={{ mt: 0.5, py: 0 }}>
                    {tokenDiff!.missing.length > 0 &&
                      t('admin.translationsPage.tokenMismatchMissing', { tokens: tokenDiff!.missing.join(', ') })}
                    {tokenDiff!.missing.length > 0 && tokenDiff!.extra.length > 0 && ' '}
                    {tokenDiff!.extra.length > 0 &&
                      t('admin.translationsPage.tokenMismatchExtra', { tokens: tokenDiff!.extra.join(', ') })}
                  </Alert>
                )}
                {errors[locale.code] && (
                  <Alert severity="error" sx={{ mt: 0.5, py: 0 }}>
                    {errors[locale.code]}
                  </Alert>
                )}
              </Box>
            )
          })}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('admin.translationsPage.close')}</Button>
      </DialogActions>
    </Dialog>
  )
}
