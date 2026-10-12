import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Alert,
  Badge,
  Box,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Popover,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material'
import CheckIcon from '@mui/icons-material/Check'
import { useAuth } from '@/hooks/useAuth'
import { applyEffectiveUiLanguage } from '@/i18n/syncUiLanguage'
import { LocaleFlag } from './LocaleFlag'

/** Stored `aiLanguage` meaning "same as the app" (core `AI_LANGUAGE_FOLLOWS_APP`, a wire value). */
const FOLLOW_APP = 'app'

type LocaleRow = { code: string; label: string }

interface LanguageState {
  locales: LocaleRow[]
  enabledUi: string[]
  enabledAi: string[]
  defaultAi: string
  /** The stored recommendations-language choice: a language, FOLLOW_APP, or null (the server default). */
  aiChoice: string | null
  effectiveUi: string
  effectiveAi: string
  /** What recommendations would be written in under FOLLOW_APP — decided by the API. */
  aiFollowingApp: string
}

interface PrefsResponse {
  aiLanguage?: string | null
  effectiveUiLanguage?: string
  effectiveAiLanguage?: string
  aiLanguageFollowingApp?: string
}

function applyPrefs(prev: LanguageState, prefs: PrefsResponse): LanguageState {
  return {
    ...prev,
    aiChoice: prefs.aiLanguage ?? null,
    effectiveUi: prefs.effectiveUiLanguage || prev.effectiveUi,
    effectiveAi: prefs.effectiveAiLanguage || prev.effectiveAi,
    aiFollowingApp: prefs.aiLanguageFollowingApp || prev.aiFollowingApp,
  }
}

/**
 * The language switcher in the app bar: the flag of the language the app is
 * in, opening onto the list of app languages and, under it, one two-way toggle
 * for the language recommendations are written in (and with them the Watcher
 * Identity, playlist text and the assistant). Someone can read the app in
 * Greek and have recommendations written in English.
 *
 * The toggle is deliberately two options, not a second language list: the
 * app's own language (stored as FOLLOW_APP, so it moves when the app language
 * does) and one other — the server default, or when that IS the app language,
 * the first other language enabled. On an instance with two languages that is
 * simply "this one or the other one". A third language is still storable
 * through the API; the toggle then shows neither option pressed rather than a
 * wrong one.
 *
 * When the two differ, the button carries a small second flag so the split is
 * visible without opening anything. Only languages the admin enabled are
 * offered, and the API refuses anything else. During an assumed session the
 * app language changes in this tab only (the session is read-only) and the
 * toggle is shown, not offered.
 */
export function LanguageMenuButton() {
  const { t, i18n } = useTranslation()
  const theme = useTheme()
  const { user, impersonation } = useAuth()
  const [state, setState] = useState<LanguageState | null>(null)
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const readOnly = Boolean(impersonation)

  const load = useCallback(async () => {
    try {
      const [locRes, defRes, prefRes] = await Promise.all([
        fetch('/api/settings/locales', { credentials: 'include' }),
        fetch('/api/settings/language-defaults', { credentials: 'include' }),
        fetch('/api/auth/me/preferences', { credentials: 'include' }),
      ])
      if (!locRes.ok || !defRes.ok || !prefRes.ok) return
      const locales = ((await locRes.json()).locales ?? []) as LocaleRow[]
      const defaults = (await defRes.json()) as {
        defaultAiLanguage?: string
        enabledUiLanguages?: string[]
        enabledAiLanguages?: string[]
      }
      const prefs = (await prefRes.json()) as PrefsResponse
      const all = locales.map((l) => l.code)
      const base: LanguageState = {
        locales,
        enabledUi: Array.isArray(defaults.enabledUiLanguages) ? defaults.enabledUiLanguages : all,
        enabledAi: Array.isArray(defaults.enabledAiLanguages) ? defaults.enabledAiLanguages : all,
        defaultAi: defaults.defaultAiLanguage || 'en',
        aiChoice: null,
        effectiveUi: i18n.language,
        effectiveAi: defaults.defaultAiLanguage || 'en',
        aiFollowingApp: defaults.defaultAiLanguage || 'en',
      }
      setState(applyPrefs(base, prefs))
    } catch {
      // No switcher beats a broken one; the app still renders in its language.
    }
  }, [i18n])

  // Re-read when the person changes (sign-in, starting or leaving an assumption).
  const userId = user?.id
  useEffect(() => {
    if (userId) void load()
  }, [userId, readOnly, load])

  if (!user || !state) return null

  const label = (code: string) => state.locales.find((l) => l.code === code)?.label ?? code
  const uiOptions = state.locales.filter((l) => state.enabledUi.includes(l.code))

  // The toggle's two sides: the app's language, and one other.
  const sameLang = state.aiFollowingApp
  const otherLang =
    state.defaultAi !== sameLang
      ? state.defaultAi
      : state.enabledAi.find((code) => code !== sameLang && state.locales.some((l) => l.code === code))
  const toggleValue =
    state.aiChoice === FOLLOW_APP || state.effectiveAi === sameLang
      ? FOLLOW_APP
      : state.effectiveAi === otherLang
        ? otherLang
        : null

  const showUi = uiOptions.length > 1
  const showContent = Boolean(otherLang)
  if (!showUi && !showContent) return null

  // The flag shows what is on screen, which during an assumption may be a
  // tab-only choice the server does not know about.
  const appLang = i18n.resolvedLanguage || i18n.language || state.effectiveUi
  const split = state.effectiveAi !== appLang
  const tooltip = split
    ? t('languageMenu.tooltipSplit', { app: label(appLang), content: label(state.effectiveAi) })
    : t('languageMenu.tooltip', { app: label(appLang) })

  const save = async (body: { uiLanguage?: string; aiLanguage?: string | null }) => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/me/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(String(res.status))
      const prefs = (await res.json()) as PrefsResponse
      setState((prev) => (prev ? applyPrefs(prev, prefs) : prev))
      return prefs
    } catch {
      setError(t('languageMenu.saveFailed'))
      return null
    } finally {
      setSaving(false)
    }
  }

  const chooseApp = async (code: string) => {
    if (code === appLang) return
    const previous = appLang
    // Apply first: the change is visible at once, and the popover re-renders
    // in the language just picked, which is its own confirmation.
    await applyEffectiveUiLanguage(code)
    if (readOnly) return
    const prefs = await save({ uiLanguage: code })
    if (!prefs) await applyEffectiveUiLanguage(previous)
  }

  const chooseContent = (value: string | null) => {
    // An exclusive group hands back null when the pressed option is clicked again.
    if (readOnly || value === null || value === toggleValue) return
    void save({ aiLanguage: value })
  }

  const side = theme.direction === 'rtl' ? ('left' as const) : ('right' as const)

  return (
    <>
      <Tooltip title={tooltip}>
        <IconButton
          onClick={(e) => {
            setError(null)
            setAnchorEl(e.currentTarget)
          }}
          size="small"
          aria-label={tooltip}
          sx={{ mr: 0.5, width: 40, height: 40 }}
        >
          <Badge
            overlap="rectangular"
            invisible={!split}
            anchorOrigin={{ vertical: 'bottom', horizontal: side }}
            badgeContent={<LocaleFlag locale={state.effectiveAi} width={12} />}
            sx={{
              '& .MuiBadge-badge': {
                p: 0,
                minWidth: 0,
                height: 'auto',
                bottom: -3,
                [side]: -5,
                borderRadius: '3px',
                // A ring in the app bar's colour separates the two flags.
                boxShadow: `0 0 0 2px ${theme.palette.background.paper}`,
              },
            }}
          >
            <LocaleFlag locale={appLang} width={22} />
          </Badge>
        </IconButton>
      </Tooltip>

      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: side }}
        transformOrigin={{ vertical: 'top', horizontal: side }}
        slotProps={{ paper: { sx: { width: 300, maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100vh - 96px)' } } }}
      >
        {error && (
          <Alert severity="error" sx={{ m: 1.5, mb: 0 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {readOnly && (
          <Alert severity="info" sx={{ m: 1.5, mb: 0 }}>
            {t('languageMenu.readOnlyNote')}
          </Alert>
        )}

        {showUi && (
          <>
            <SectionHeading>{t('languageMenu.appHeading')}</SectionHeading>
            <List dense disablePadding sx={{ pb: 1 }}>
              {uiOptions.map((l) => (
                <ListItemButton
                  key={l.code}
                  selected={l.code === appLang}
                  disabled={saving}
                  onClick={() => void chooseApp(l.code)}
                  lang={l.code}
                >
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <LocaleFlag locale={l.code} />
                  </ListItemIcon>
                  <ListItemText primary={l.label} />
                  {l.code === appLang && (
                    <CheckIcon fontSize="small" color="primary" sx={{ marginInlineStart: 1 }} />
                  )}
                </ListItemButton>
              ))}
            </List>
          </>
        )}

        {showUi && showContent && <Divider />}

        {showContent && otherLang && (
          <Box sx={{ px: 2, pb: 2 }}>
            <SectionHeading inset={false}>{t('languageMenu.contentHeading')}</SectionHeading>
            <ToggleButtonGroup
              exclusive
              fullWidth
              size="small"
              value={toggleValue}
              onChange={(_e, value: string | null) => chooseContent(value)}
              disabled={readOnly || saving}
              aria-label={t('languageMenu.contentHeading')}
            >
              {[
                { value: FOLLOW_APP, code: sameLang },
                { value: otherLang, code: otherLang },
              ].map((option) => (
                <ToggleButton
                  key={option.value}
                  value={option.value}
                  lang={option.code}
                  sx={{ gap: 1, textTransform: 'none' }}
                >
                  <LocaleFlag locale={option.code} width={18} />
                  {label(option.code)}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
              {t('languageMenu.contentHint')}
            </Typography>
          </Box>
        )}
      </Popover>
    </>
  )
}

function SectionHeading({ children, inset = true }: { children: string; inset?: boolean }) {
  return (
    <Typography
      variant="overline"
      color="text.secondary"
      component="p"
      sx={{ lineHeight: 1.6, pt: 1.5, pb: 0.75, px: inset ? 2 : 0 }}
    >
      {children}
    </Typography>
  )
}
