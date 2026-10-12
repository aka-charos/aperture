import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Alert,
  Badge,
  Box,
  Collapse,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Popover,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material'
import CheckIcon from '@mui/icons-material/Check'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import LinkIcon from '@mui/icons-material/Link'
import DnsOutlinedIcon from '@mui/icons-material/DnsOutlined'
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
  /** The stored AI choice: a language, FOLLOW_APP, or null (the server default). */
  aiChoice: string | null
  effectiveUi: string
  effectiveAi: string
  /** What AI would write in under FOLLOW_APP — decided by the API. */
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
 * in, opening onto two choices that are deliberately separate — the language
 * the app is in, and the language AI writes to this viewer in (recommendation
 * explanations, the Watcher Identity, playlist text, the assistant). Someone
 * can read the app in Greek and have AI write to them in English.
 *
 * It replaces the Language card that sat in Settings → Preferences, where a
 * choice made on every visit by some people was three clicks deep.
 *
 * The app language applies the moment it is picked (and is saved); the AI
 * section is collapsed by default because most people never change it, and a
 * second full list of languages would double the height of the popover. When
 * the two differ, the button carries a small second flag so the split is
 * visible without opening anything.
 *
 * Only languages the admin enabled are offered, and the API refuses anything
 * else. A section with nothing to choose is hidden, and the button with it
 * when both are. During an assumed session the app language changes in this
 * tab only (the session is read-only) and the AI choice is shown, not offered.
 */
export function LanguageMenuButton() {
  const { t, i18n } = useTranslation()
  const theme = useTheme()
  const { user, impersonation } = useAuth()
  const [state, setState] = useState<LanguageState | null>(null)
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
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
        defaultUiLanguage?: string
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
  const aiOptions = state.locales.filter((l) => state.enabledAi.includes(l.code))
  const showUi = uiOptions.length > 1
  const showAi = aiOptions.length > 1
  if (!showUi && !showAi) return null

  // The flag shows what is on screen, which during an assumption may be a
  // tab-only choice the server does not know about.
  const appLang = i18n.resolvedLanguage || i18n.language || state.effectiveUi
  const split = state.effectiveAi !== appLang
  const tooltip = split
    ? t('languageMenu.tooltipSplit', { app: label(appLang), ai: label(state.effectiveAi) })
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

  const chooseAi = async (choice: string | null) => {
    if (readOnly || choice === state.aiChoice) return
    const prefs = await save({ aiLanguage: choice })
    if (prefs) setAiOpen(false)
  }

  const aiSummary = (() => {
    if (state.aiChoice === FOLLOW_APP) {
      return { icon: <LinkIcon fontSize="small" />, primary: t('languageMenu.sameAsApp'), secondary: label(state.effectiveAi) }
    }
    if (state.aiChoice && state.enabledAi.includes(state.aiChoice)) {
      return { icon: <LocaleFlag locale={state.aiChoice} />, primary: label(state.aiChoice), secondary: null }
    }
    return { icon: <DnsOutlinedIcon fontSize="small" />, primary: t('languageMenu.serverDefault'), secondary: label(state.effectiveAi) }
  })()

  const side = theme.direction === 'rtl' ? ('left' as const) : ('right' as const)
  const check = (on: boolean) => (on ? <CheckIcon fontSize="small" color="primary" sx={{ marginInlineStart: 1 }} /> : null)

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
        slotProps={{ paper: { sx: { width: 320, maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100vh - 96px)' } } }}
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
            <SectionHeading title={t('languageMenu.appHeading')} hint={t('languageMenu.appHint')} />
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
                  {check(l.code === appLang)}
                </ListItemButton>
              ))}
            </List>
          </>
        )}

        {showUi && showAi && <Divider />}

        {showAi && (
          <>
            <SectionHeading title={t('languageMenu.aiHeading')} hint={t('languageMenu.aiHint')} />
            <List dense disablePadding sx={{ pb: 1 }}>
              <ListItemButton
                onClick={() => setAiOpen((open) => !open)}
                aria-expanded={aiOpen}
                disabled={readOnly}
              >
                <ListItemIcon sx={{ minWidth: 36 }}>{aiSummary.icon}</ListItemIcon>
                <ListItemText primary={aiSummary.primary} secondary={aiSummary.secondary} />
                {!readOnly && (aiOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />)}
              </ListItemButton>
              <Collapse in={aiOpen && !readOnly} unmountOnExit>
                <List dense disablePadding sx={{ paddingInlineStart: theme.spacing(1.5) }}>
                  <ListItemButton
                    selected={state.aiChoice === FOLLOW_APP}
                    disabled={saving}
                    onClick={() => void chooseAi(FOLLOW_APP)}
                  >
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      <LinkIcon fontSize="small" />
                    </ListItemIcon>
                    <ListItemText primary={t('languageMenu.sameAsApp')} secondary={label(state.aiFollowingApp)} />
                    {check(state.aiChoice === FOLLOW_APP)}
                  </ListItemButton>
                  <ListItemButton
                    selected={state.aiChoice === null}
                    disabled={saving}
                    onClick={() => void chooseAi(null)}
                  >
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      <DnsOutlinedIcon fontSize="small" />
                    </ListItemIcon>
                    <ListItemText primary={t('languageMenu.serverDefault')} secondary={label(state.defaultAi)} />
                    {check(state.aiChoice === null)}
                  </ListItemButton>
                  {aiOptions.map((l) => (
                    <ListItemButton
                      key={l.code}
                      selected={state.aiChoice === l.code}
                      disabled={saving}
                      onClick={() => void chooseAi(l.code)}
                      lang={l.code}
                    >
                      <ListItemIcon sx={{ minWidth: 36 }}>
                        <LocaleFlag locale={l.code} />
                      </ListItemIcon>
                      <ListItemText primary={l.label} />
                      {check(state.aiChoice === l.code)}
                    </ListItemButton>
                  ))}
                </List>
              </Collapse>
            </List>
          </>
        )}
      </Popover>
    </>
  )
}

function SectionHeading({ title, hint }: { title: string; hint: string }) {
  return (
    <Box sx={{ px: 2, pt: 1.5, pb: 0.5 }}>
      <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.6 }}>
        {title}
      </Typography>
      <Typography variant="caption" color="text.secondary" component="p">
        {hint}
      </Typography>
    </Box>
  )
}
