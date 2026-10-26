import { useEffect, useRef, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { applyLiveString } from '@/i18n/inlineEdit/store'
import type { RenderedString } from '@/i18n/inlineEdit/textIndex'
import { LocaleFlag } from '@/components/LocaleFlag'
import { decideInlineSave, isUntranslated, tokenMismatchMessage } from '@/pages/admin/translations/catalogFilter'
import type { TranslationCatalog } from '@/pages/admin/translations/useTranslationCatalog'
import { useEditorT } from './useInlineEdit'

export const TRANSLATIONS_PAGE_PATH = '/admin/appearance/translations'

/**
 * What a string reads as, layer by layer. `baseline` is what it shows with no
 * database override (the operator file if it has the key, else the bundled
 * text) — the value Reset brings back. `current` is what it shows now.
 */
export interface InlineTexts {
  baseline: (locale: string, key: string) => string
  current: (locale: string, key: string) => string
}

interface InlineStringEditorProps {
  matches: RenderedString[]
  compareLocale: string | null
  catalog: TranslationCatalog
  texts: InlineTexts
  localeLabel: (code: string) => string
  onClose: () => void
}

/**
 * The inline editor: one key's English and one other language side by side,
 * saved together. When the clicked text came from several keys (a "Cancel"
 * shared by many dialogs) they are offered as chips, most recently rendered
 * first — that is almost always the one on screen.
 */
export function InlineStringEditor({ matches, compareLocale, catalog, texts, localeLabel, onClose }: InlineStringEditorProps) {
  const t = useEditorT()
  const locales = compareLocale ? ['en', compareLocale] : ['en']
  const { defaults, overrides, saveOverride } = catalog

  const draftsFor = (forKey: string) => Object.fromEntries(locales.map((locale) => [locale, texts.current(locale, forKey)]))
  const [key, setKey] = useState(matches[0].key)
  // Filled synchronously, here and on switching key, so no render ever
  // compares one key's drafts against another key's saved text. Not
  // refreshed from later catalog updates, which would wipe what is typed.
  const [drafts, setDrafts] = useState<Record<string, string>>(() => draftsFor(matches[0].key))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (copiedTimer.current) clearTimeout(copiedTimer.current)
  }, [])

  const switchKey = (next: string) => {
    setKey(next)
    setDrafts(draftsFor(next))
    setError(null)
  }

  const knownKey = defaults.en?.[key] !== undefined
  const decisions = locales.map((locale) => ({
    locale,
    decision: decideInlineSave({
      draft: drafts[locale] ?? '',
      current: texts.current(locale, key),
      bundledDefault: texts.baseline(locale, key),
      hasOverride: overrides[locale]?.[key] !== undefined,
    }),
  }))
  const dirty = decisions.some((d) => d.decision.kind !== 'none')

  const save = async () => {
    if (!dirty || saving) return
    setSaving(true)
    setError(null)
    try {
      for (const { locale, decision } of decisions) {
        if (decision.kind === 'none') continue
        await saveOverride(locale, key, decision.kind === 'reset' ? null : decision.value)
        applyLiveString(locale, key, decision.kind === 'reset' ? texts.baseline(locale, key) : decision.value)
      }
      onClose()
    } catch (err) {
      setError((err as Error).message || t('admin.translationsPage.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const reset = async (locale: string) => {
    setSaving(true)
    setError(null)
    try {
      await saveOverride(locale, key, null)
      const baseline = texts.baseline(locale, key)
      applyLiveString(locale, key, baseline)
      setDrafts((prev) => ({ ...prev, [locale]: baseline }))
    } catch (err) {
      setError((err as Error).message || t('admin.translationsPage.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const copyKey = () => {
    void navigator.clipboard?.writeText(key).then(() => {
      setCopied(true)
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopied(false), 1200)
    })
  }

  const english = drafts.en ?? ''

  return (
    <Dialog
      open
      // Esc and a click outside close only an untouched editor: either is
      // easy to do by accident (Esc also dismisses an input method's
      // candidates), and losing a typed translation to it is not. The close
      // button and Cancel still discard on purpose.
      onClose={() => {
        if (!dirty) onClose()
      }}
      maxWidth={compareLocale ? 'md' : 'sm'}
      fullWidth
      // The layer's click capture ignores anything inside this.
      data-inline-edit-ui
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="subtitle1" component="div">
            {t('inlineEdit.editorTitle')}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
            <Typography
              component="code"
              sx={{ fontFamily: 'monospace', fontSize: '0.85rem', color: 'text.secondary', overflowWrap: 'anywhere' }}
            >
              {key}
            </Typography>
            <Tooltip title={copied ? t('inlineEdit.copied') : t('inlineEdit.copyKey')}>
              <IconButton size="small" onClick={copyKey} aria-label={t('inlineEdit.copyKey')}>
                <ContentCopyIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
        <IconButton size="small" onClick={onClose} aria-label={t('admin.translationsPage.close')}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {matches.length > 1 && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              {t('inlineEdit.severalKeys', { count: matches.length })}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {matches.map((match) => (
                <Chip
                  key={match.key}
                  label={match.key}
                  size="small"
                  variant={match.key === key ? 'filled' : 'outlined'}
                  color={match.key === key ? 'primary' : 'default'}
                  onClick={() => switchKey(match.key)}
                  sx={{ fontFamily: 'monospace' }}
                />
              ))}
            </Box>
          </Box>
        )}
        {!knownKey && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {t('inlineEdit.unknownKey')}
          </Alert>
        )}
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          {locales.map((locale) => {
            const bundled = texts.baseline(locale, key)
            const draft = drafts[locale] ?? ''
            const hasOverride = overrides[locale]?.[key] !== undefined
            const tokenProblem = locale === 'en' ? '' : tokenMismatchMessage(t, english, draft)
            const sameAsEnglish = locale !== 'en' && isUntranslated(defaults.en?.[key] ?? '', draft)
            return (
              <Box key={locale} sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75, minHeight: 30 }}>
                  <LocaleFlag locale={locale} width={20} />
                  <Typography variant="subtitle2">
                    {localeLabel(locale)} <Box component="span" sx={{ color: 'text.secondary' }}>({locale})</Box>
                  </Typography>
                  {hasOverride && <Chip label={t('inlineEdit.edited')} size="small" variant="outlined" />}
                  {sameAsEnglish && <Chip label={t('inlineEdit.sameAsEnglish')} size="small" color="warning" variant="outlined" />}
                  <Box sx={{ flexGrow: 1 }} />
                  <Tooltip title={t('admin.translationsPage.resetToDefault')}>
                    <span>
                      <IconButton size="small" disabled={!hasOverride || saving} onClick={() => void reset(locale)}>
                        <RestartAltIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Box>
                <TextField
                  fullWidth
                  multiline
                  minRows={2}
                  maxRows={10}
                  size="small"
                  autoFocus={locale === (compareLocale ?? 'en')}
                  value={draft}
                  placeholder={bundled}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [locale]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing || e.keyCode === 229) return
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault()
                      void save()
                    }
                  }}
                  slotProps={{ htmlInput: { lang: locale, 'aria-label': `${key} (${locale})` } }}
                />
                {bundled && bundled !== draft && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    {t('admin.translationsPage.defaultValueLabel')} {bundled}
                  </Typography>
                )}
                {tokenProblem && (
                  <Alert severity="warning" sx={{ mt: 0.75, py: 0 }}>
                    {tokenProblem}
                  </Alert>
                )}
              </Box>
            )
          })}
        </Stack>
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3 }}>
        <Button
          component={RouterLink}
          to={`${TRANSLATIONS_PAGE_PATH}?q=${encodeURIComponent(key)}`}
          onClick={onClose}
          size="small"
          startIcon={<OpenInNewIcon fontSize="small" />}
          sx={{ mr: 'auto' }}
        >
          {t('inlineEdit.allLanguages')}
        </Button>
        <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' }, mr: 1 }}>
          {t('inlineEdit.saveShortcut')}
        </Typography>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          onClick={() => void save()}
          disabled={!dirty || saving}
          startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}
        >
          {t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
