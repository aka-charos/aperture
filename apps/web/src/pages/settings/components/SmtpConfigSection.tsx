import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import ForwardToInboxIcon from '@mui/icons-material/ForwardToInbox'
import SaveIcon from '@mui/icons-material/Save'
import SendIcon from '@mui/icons-material/Send'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import { withServerMessageDetail } from '@/lib/withServerMessageDetail'

type Security = string

interface SmtpSettings {
  config: {
    enabled: boolean
    host: string
    port: number
    security: Security
    allowSelfSigned: boolean
    username: string
    hasPassword: boolean
    fromAddress: string
    fromName: string
    ehloName: string
  }
  /** Decided by the server: what stops the SAVED settings from sending. */
  problems: string[]
  securityModes: Security[]
  defaultPorts: Record<Security, number>
  /** Decided by the server: the host and transports the stored password may be used with, or null. */
  storedPassword: { host: string; transports: string[] } | null
  defaultFromName: string
  testRecipient: string | null
}

interface TestResult {
  success: boolean
  stage?: 'connect' | 'send'
  /** The host the server actually tried, which the card may have moved on from since. */
  host?: string
  /** A stable id, translated here; `detail` is the server's own words beside it. */
  failure?: string
  detail?: string
  sentTo?: string
  error?: string
  problems?: string[]
}

interface Form {
  enabled: boolean
  host: string
  port: string
  security: Security
  allowSelfSigned: boolean
  username: string
  password: string
  fromAddress: string
  fromName: string
  ehloName: string
}

function formFrom(settings: SmtpSettings): Form {
  const c = settings.config
  return {
    enabled: c.enabled,
    host: c.host,
    port: String(c.port),
    security: c.security,
    allowSelfSigned: c.allowSelfSigned,
    username: c.username,
    password: '',
    fromAddress: c.fromAddress,
    fromName: c.fromName,
    ehloName: c.ehloName,
  }
}

/**
 * Two tiny mirrors of core `email/settings.ts` (the bundle never imports core):
 * how a host is compared, and which transport a form describes. Only these are
 * mirrored; WHICH transports the stored password may use is the server's
 * decision, shipped in `storedPassword`.
 */
const hostKey = (host: string) => {
  const trimmed = host.trim()
  const bare = /^\[([0-9A-Fa-f:.]+)\]$/.exec(trimmed)
  return (bare ? bare[1] : trimmed).toLowerCase()
}
const transportOf = (form: Pick<Form, 'security' | 'allowSelfSigned'>) =>
  form.security === 'none' ? 'none' : form.allowSelfSigned ? `${form.security}-unverified` : form.security

/**
 * Outgoing email: the mail server everything else will send through.
 *
 * Nothing in the app sends email yet, so this card is the whole feature for
 * now — set the server up, prove it works, and leave sending off until a
 * feature needs it. Test works on unsaved settings and whether or not sending
 * is on, because the point is to find out before switching it on.
 */
export function SmtpConfigSection() {
  const { t, i18n } = useTranslation()
  const [settings, setSettings] = useState<SmtpSettings | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<'connect' | 'send' | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [sendTo, setSendTo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)

  const apply = useCallback((data: SmtpSettings) => {
    setSettings(data)
    setForm(formFrom(data))
    setSendTo((current) => current || data.testRecipient || '')
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/settings/smtp', { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) throw new Error()
        const data = (await response.json()) as SmtpSettings
        if (!cancelled) apply(data)
      })
      .catch(() => {
        if (!cancelled) setError(t('settingsSmtp.loadError'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [apply, t])

  const hasChanges = useMemo(() => {
    if (!settings || !form) return false
    const original = formFrom(settings)
    return (Object.keys(form) as (keyof Form)[]).some((key) => form[key] !== original[key])
  }, [settings, form])

  /** The server's problem ids as one translated phrase: "the mail server and the password". */
  const missingList = useCallback(
    (problems: string[]) => {
      const names = problems.map((p) => t(`settingsSmtp.problem.${p}`, { defaultValue: p }))
      try {
        return new Intl.ListFormat(i18n.resolvedLanguage, { type: 'conjunction' }).format(names)
      } catch {
        return names.join(', ')
      }
    },
    [i18n.resolvedLanguage, t]
  )

  if (loading || !form || !settings) {
    return (
      <Card>
        <CardContent>
          <Box display="flex" justifyContent="center" py={4}>
            {error ? <Alert severity="error">{error}</Alert> : <CircularProgress />}
          </Box>
        </CardContent>
      </Card>
    )
  }

  const update = (patch: Partial<Form>) => {
    setForm((current) => (current ? { ...current, ...patch } : current))
    setSaved(false)
    // A result describes the settings it was run with; once they change, it
    // describes settings that are no longer on the card.
    setResult(null)
  }

  const changeSecurity = (security: Security) => {
    // Move the port along with the mode only while it is still the previous
    // mode's convention; a port someone typed on purpose stays.
    const port =
      form.port.trim() === '' || form.port === String(settings.defaultPorts[form.security])
        ? String(settings.defaultPorts[security])
        : form.port
    update({ security, port })
  }

  const portNumber = Number(form.port)
  const portValid = Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65535
  const scope = settings.storedPassword
  const samePasswordHost = !!scope && hostKey(form.host) === scope.host
  const savedPasswordApplies = samePasswordHost && !!scope && scope.transports.includes(transportOf(form))
  const passwordAvailable = !form.username.trim() || !!form.password || savedPasswordApplies

  /** The card as it stands. A blank password is omitted, which means "keep the saved one" (within its scope). */
  const body = () => ({
    enabled: form.enabled,
    host: form.host,
    port: portNumber,
    security: form.security,
    allowSelfSigned: form.allowSelfSigned,
    username: form.username,
    password: form.password || undefined,
    fromAddress: form.fromAddress,
    fromName: form.fromName,
    ehloName: form.ehloName,
  })

  /** A refusal for missing settings names them in the reader's language; anything else shows the server's sentence. */
  const refusal = (data: { error?: string; problems?: string[] }, purpose: 'enable' | 'test', fallback: string) => {
    if (data.problems?.length) {
      return t(purpose === 'enable' ? 'settingsSmtp.missingToEnable' : 'settingsSmtp.missingToTest', {
        list: missingList(data.problems),
      })
    }
    return data.error ? withServerMessageDetail(t, data.error) : fallback
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const response = await fetch('/api/settings/smtp', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body()),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(refusal(data, 'enable', t('settingsSmtp.errSave')))
        return
      }
      apply(data as SmtpSettings)
      setResult(null)
      setSaved(true)
    } catch {
      setError(t('settingsSmtp.errConnect'))
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async (stage: 'connect' | 'send') => {
    setTesting(stage)
    setError(null)
    setResult(null)
    try {
      const response = await fetch('/api/settings/smtp/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...body(), sendTo: stage === 'send' ? sendTo.trim() : undefined }),
      })
      const data = (await response.json()) as TestResult
      setResult(data.error ? { success: false, error: refusal(data, 'test', t('settingsSmtp.errConnect')) } : data)
    } catch {
      setResult({ success: false, error: t('settingsSmtp.errConnect') })
    } finally {
      setTesting(null)
    }
  }

  const resultAlert = () => {
    if (!result) return null
    if (result.success) {
      return (
        <Alert severity="success" onClose={() => setResult(null)}>
          {result.stage === 'send'
            ? t('settingsSmtp.sendOk', { address: result.sentTo })
            : t('settingsSmtp.testOk', { host: result.host })}
        </Alert>
      )
    }
    if (result.error) {
      return (
        <Alert severity="error" onClose={() => setResult(null)}>
          {result.error}
        </Alert>
      )
    }
    const failure = result.failure ?? 'unknown'
    const hint = t(`settingsSmtp.failure.${failure}.hint`, { defaultValue: '' })
    return (
      <Alert severity="error" onClose={() => setResult(null)}>
        <AlertTitle>
          {t(`settingsSmtp.failure.${failure}.title`, { defaultValue: t('settingsSmtp.failure.unknown.title') })}
        </AlertTitle>
        {hint && <Typography variant="body2">{hint}</Typography>}
        {result.detail && (
          <Typography variant="caption" component="div" sx={{ mt: 1, opacity: 0.85, wordBreak: 'break-word' }}>
            {t('settingsSmtp.serverSaid', { host: result.host, detail: result.detail })}
          </Typography>
        )}
      </Alert>
    )
  }

  const passwordHelper = () => {
    if (form.password || !settings.config.hasPassword || savedPasswordApplies) {
      return savedPasswordApplies && !form.password ? t('settingsSmtp.passwordSaved') : undefined
    }
    return samePasswordHost
      ? t('settingsSmtp.passwordWeaker')
      : t('settingsSmtp.passwordOtherHost', { host: settings.config.host })
  }

  const canCheck = !!form.host.trim() && portValid && passwordAvailable && testing === null

  return (
    <Card>
      <CardContent>
        <Box display="flex" alignItems="center" gap={2} mb={2} flexWrap="wrap">
          <ForwardToInboxIcon sx={{ fontSize: 28, color: 'primary.main' }} />
          <Typography variant="h6" fontWeight={600}>
            {t('settingsSmtp.title')}
          </Typography>
          {settings.config.enabled ? (
            <Chip label={t('settingsSmtp.chipOn')} color="success" size="small" />
          ) : (
            <Chip label={t('settingsSmtp.chipOff')} size="small" variant="outlined" />
          )}
        </Box>

        <Typography variant="body2" color="text.secondary" mb={3}>
          {t('settingsSmtp.description')}
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {saved && (
          <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSaved(false)}>
            {t('settingsSmtp.saved')}
          </Alert>
        )}

        <Box display="flex" flexDirection="column" gap={2}>
          <FormControlLabel
            control={<Switch checked={form.enabled} onChange={(e) => update({ enabled: e.target.checked })} />}
            label={
              <Box>
                <Typography variant="body2">{t('settingsSmtp.enabled')}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('settingsSmtp.enabledCaption')}
                </Typography>
              </Box>
            }
          />

          {!hasChanges && settings.problems.length > 0 && (
            <Typography variant="caption" color="text.secondary">
              {t('settingsSmtp.incomplete', { list: missingList(settings.problems) })}
            </Typography>
          )}

          <Box display="flex" gap={2} flexWrap="wrap">
            <TextField
              label={t('settingsSmtp.host')}
              value={form.host}
              onChange={(e) => update({ host: e.target.value })}
              placeholder={t('settingsSmtp.hostPlaceholder')}
              size="small"
              sx={{ flex: '1 1 240px' }}
            />
            <TextField
              label={t('settingsSmtp.port')}
              value={form.port}
              onChange={(e) => update({ port: e.target.value.replace(/[^0-9]/g, '') })}
              error={!portValid}
              helperText={t('settingsSmtp.portHelper', { port: settings.defaultPorts[form.security] })}
              size="small"
              inputProps={{ inputMode: 'numeric' }}
              sx={{ flex: '0 0 140px' }}
            />
          </Box>

          <TextField
            select
            label={t('settingsSmtp.security')}
            value={form.security}
            onChange={(e) => changeSecurity(e.target.value)}
            helperText={t(`settingsSmtp.securityHelper.${form.security}`)}
            size="small"
            fullWidth
          >
            {settings.securityModes.map((mode) => (
              <MenuItem key={mode} value={mode}>
                {t(`settingsSmtp.securityMode.${mode}`, { defaultValue: mode })}
              </MenuItem>
            ))}
          </TextField>

          {form.security !== 'none' && (
            <FormControlLabel
              control={
                <Checkbox
                  checked={form.allowSelfSigned}
                  onChange={(e) => update({ allowSelfSigned: e.target.checked })}
                />
              }
              label={
                <Box>
                  <Typography variant="body2">{t('settingsSmtp.allowSelfSigned')}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('settingsSmtp.allowSelfSignedCaption')}
                  </Typography>
                </Box>
              }
            />
          )}

          <TextField
            label={t('settingsSmtp.username')}
            value={form.username}
            onChange={(e) => update({ username: e.target.value })}
            helperText={t('settingsSmtp.usernameHelper')}
            size="small"
            fullWidth
            autoComplete="off"
          />

          {form.username.trim() !== '' && (
            <TextField
              label={t('settingsSmtp.password')}
              type={showPassword ? 'text' : 'password'}
              value={form.password}
              onChange={(e) => update({ password: e.target.value })}
              placeholder={savedPasswordApplies ? '••••••••' : undefined}
              helperText={passwordHelper()}
              error={!passwordAvailable}
              size="small"
              fullWidth
              autoComplete="new-password"
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      onClick={() => setShowPassword((show) => !show)}
                      edge="end"
                      size="small"
                      aria-label={t('settingsSmtp.togglePassword')}
                    >
                      {showPassword ? <VisibilityOffIcon /> : <VisibilityIcon />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
          )}

          {form.security === 'none' && form.username.trim() !== '' && (
            <Alert severity="warning" variant="outlined">
              {t('settingsSmtp.plaintextWarning')}
            </Alert>
          )}

          <TextField
            label={t('settingsSmtp.fromAddress')}
            value={form.fromAddress}
            onChange={(e) => update({ fromAddress: e.target.value })}
            placeholder={t('settingsSmtp.fromAddressPlaceholder')}
            helperText={t('settingsSmtp.fromAddressHelper')}
            size="small"
            fullWidth
          />

          <TextField
            label={t('settingsSmtp.fromName')}
            value={form.fromName}
            onChange={(e) => update({ fromName: e.target.value })}
            placeholder={settings.defaultFromName}
            helperText={t('settingsSmtp.fromNameHelper', { name: settings.defaultFromName })}
            size="small"
            fullWidth
          />

          <TextField
            label={t('settingsSmtp.ehloName')}
            value={form.ehloName}
            onChange={(e) => update({ ehloName: e.target.value })}
            placeholder={t('settingsSmtp.ehloNamePlaceholder')}
            helperText={t('settingsSmtp.ehloNameHelper')}
            size="small"
            fullWidth
          />

          {!settings.config.enabled && settings.problems.length === 0 && !hasChanges && (
            <Typography variant="caption" color="text.secondary">
              {t('settingsSmtp.readyButOff')}
            </Typography>
          )}

          <Box display="flex" gap={1} flexWrap="wrap">
            <Button
              variant="contained"
              startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}
              onClick={handleSave}
              disabled={saving || !hasChanges || !portValid}
              size="small"
            >
              {saving ? t('common.saving') : t('common.save')}
            </Button>
            <Button variant="outlined" onClick={() => handleTest('connect')} disabled={!canCheck} size="small">
              {testing === 'connect' ? t('settingsSmtp.testing') : t('settingsSmtp.testConnection')}
            </Button>
          </Box>

          <Divider sx={{ my: 1 }} />

          <Typography variant="subtitle2">{t('settingsSmtp.sendTestTitle')}</Typography>
          <Box display="flex" gap={1} flexWrap="wrap" alignItems="flex-start">
            <TextField
              label={t('settingsSmtp.sendTestTo')}
              value={sendTo}
              onChange={(e) => setSendTo(e.target.value)}
              size="small"
              sx={{ flex: '1 1 260px' }}
              type="email"
            />
            <Button
              variant="outlined"
              startIcon={testing === 'send' ? <CircularProgress size={16} /> : <SendIcon />}
              onClick={() => handleTest('send')}
              disabled={!canCheck || !sendTo.trim() || !form.fromAddress.trim()}
              size="small"
              sx={{ mt: 0.5 }}
            >
              {testing === 'send' ? t('settingsSmtp.sending') : t('settingsSmtp.sendTest')}
            </Button>
          </Box>

          {resultAlert()}
        </Box>
      </CardContent>
    </Card>
  )
}
