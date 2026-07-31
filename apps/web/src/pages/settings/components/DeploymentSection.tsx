import { useState, useEffect, useCallback } from 'react'
import {
  Box,
  Typography,
  Card,
  CardContent,
  Alert,
  AlertTitle,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  TextField,
} from '@mui/material'
import PublicIcon from '@mui/icons-material/Public'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import { useTranslation } from 'react-i18next'

/**
 * System > Deployment: how this instance is reached, and whether the settings
 * that depend on that are right.
 *
 * Read-only on purpose. Everything here comes from environment variables, and
 * the one that matters most — trustProxy — is baked into Fastify's Request
 * class when the server is constructed, with no way to change it on a running
 * server. A switch here would look like it worked and quietly do nothing until
 * the next restart, so the panel reports and tells you what to set instead.
 *
 * The findings are computed server-side (config/deploymentPosture.ts) and
 * arrive as stable ids, translated here. Some are evidence-based: the server
 * samples live requests, which is the only way to tell a correctly-configured
 * instance from one silently ignoring its proxy's headers.
 */

type Severity = 'critical' | 'warning' | 'info'

interface Finding {
  id: string
  severity: Severity
  data?: Record<string, string | number>
}

interface ProxyTrustState {
  envManaged: boolean
  entries: string[]
  trustsAll: boolean
  trustsAny: boolean
}

interface Posture {
  mode: 'direct' | 'proxy'
  production: boolean
  effective: {
    trustedProxies: ProxyTrustState
    cookieSecure: boolean
    apiDocs: string
    setupRemoteAllowed: boolean
    passwordlessPermitted: boolean
    cspReportOnly: boolean
    bindHost: string
  }
  observed: {
    requestsSeen: number
    forwardedForSeen: number
    distinctClientIps: number
    allClientIpsLocal: boolean
    forwardedBy: string[]
  }
  findings: Finding[]
}

const SEVERITY_TO_MUI: Record<Severity, 'error' | 'warning' | 'info'> = {
  critical: 'error',
  warning: 'warning',
  info: 'info',
}

function formatTrustProxy(state: ProxyTrustState): string {
  if (state.trustsAll) return 'all (unsafe)'
  if (state.entries.length === 0) return 'off'
  return state.entries.join(', ')
}

export function DeploymentSection() {
  const { t } = useTranslation()
  const [posture, setPosture] = useState<Posture | null>(null)
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const apply = useCallback((next: Posture) => {
    setPosture(next)
    setDraft(next.effective.trustedProxies.entries.join(', '))
  }, [])

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/deployment', { credentials: 'include' })
      if (res.ok) apply(await res.json())
    } catch {
      // Leave the panel empty rather than blocking the rest of the tab.
    } finally {
      setLoading(false)
    }
  }, [apply])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (value: string) => {
    setSaving(true)
    setSaveError(null)
    setSaved(false)
    try {
      const res = await fetch('/api/settings/deployment', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          trustedProxies: value
            .split(',')
            .map((e) => e.trim())
            .filter(Boolean),
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        setSaveError(body.error || t('settingsDeployment.saveFailed'))
        return
      }
      // The response carries the recomputed posture, so the rows and findings
      // above update from the same round trip that applied the change.
      apply(body.posture)
      setSaved(true)
    } catch {
      setSaveError(t('settingsDeployment.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent>
          <CircularProgress size={24} />
        </CardContent>
      </Card>
    )
  }

  if (!posture) return null

  const trust = posture.effective.trustedProxies

  // Client IPs are only trustworthy when something is trusted to forward them,
  // or when nothing is in front at all.
  const resolvesClientIps = trust.trustsAny || posture.observed.forwardedForSeen === 0

  // Observed forwarders that are not yet trusted — i.e. the thing to act on.
  const undetectedProxies = posture.observed.forwardedBy.filter(
    (addr) => !trust.entries.includes(addr)
  )

  const hasUnsavedEdit = draft.trim() !== trust.entries.join(', ')

  const loudFindings = posture.findings.filter((f) => f.severity !== 'info')

  const rows: Array<{ label: string; value: string; ok: boolean }> = [
    {
      label: t('settingsDeployment.rows.mode'),
      value:
        posture.mode === 'proxy'
          ? t('settingsDeployment.modeProxy')
          : t('settingsDeployment.modeDirect'),
      ok: true,
    },
    {
      label: t('settingsDeployment.rows.clientIps'),
      value: resolvesClientIps
        ? t('settingsDeployment.clientIpsReal')
        : t('settingsDeployment.clientIpsCollapsed'),
      ok: resolvesClientIps,
    },
    {
      label: t('settingsDeployment.rows.trustedProxies'),
      value: formatTrustProxy(trust),
      ok: !trust.trustsAll,
    },
    {
      label: t('settingsDeployment.rows.cookies'),
      value: posture.effective.cookieSecure
        ? t('settingsDeployment.cookiesSecure')
        : t('settingsDeployment.cookiesInsecure'),
      ok: posture.effective.cookieSecure || !posture.production,
    },
    {
      label: t('settingsDeployment.rows.setupAccess'),
      value: posture.effective.setupRemoteAllowed
        ? t('settingsDeployment.setupAnywhere')
        : t('settingsDeployment.setupLocalOnly'),
      ok: !posture.effective.setupRemoteAllowed,
    },
    {
      label: t('settingsDeployment.rows.apiDocs'),
      value: posture.effective.apiDocs,
      ok: posture.effective.apiDocs !== 'public' || !posture.production,
    },
    {
      label: t('settingsDeployment.rows.bindHost'),
      value: posture.effective.bindHost,
      ok: !(posture.mode === 'proxy' && posture.effective.bindHost === '0.0.0.0'),
    },
  ]

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <PublicIcon color="primary" />
          <Typography variant="h6">{t('settingsDeployment.title')}</Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('settingsDeployment.description')}
        </Typography>

        <Stack spacing={0.5} sx={{ mb: 2 }}>
          {rows.map((row) => (
            <Box
              key={row.label}
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 2,
                py: 0.75,
              }}
            >
              <Typography variant="body2" color="text.secondary">
                {row.label}
              </Typography>
              <Chip
                size="small"
                label={row.value}
                color={row.ok ? 'success' : 'warning'}
                variant={row.ok ? 'outlined' : 'filled'}
              />
            </Box>
          ))}
        </Stack>

        <Divider sx={{ my: 2 }} />

        {/* The one setting here that can change on a live server: Fastify
            consults trustProxy per request when it is a function, so a save
            applies to the very next request with no restart. */}
        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
          {t('settingsDeployment.trustedProxiesTitle')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {t('settingsDeployment.trustedProxiesHelp')}
        </Typography>

        {/* The answer, when we have it. Nobody should have to work out whether
            their tunnel counts as "on this host" — these are the addresses
            observed forwarding to us, so the only question left is yes/no. */}
        {!trust.envManaged && !trust.trustsAny && undetectedProxies.length > 0 && (
          <Alert severity="info" sx={{ mb: 2 }}>
            <AlertTitle>{t('settingsDeployment.detectedTitle')}</AlertTitle>
            <Typography variant="body2" sx={{ mb: 1.5 }}>
              {t('settingsDeployment.detectedBody', {
                addresses: undetectedProxies.join(', '),
              })}
            </Typography>
            <Button
              variant="contained"
              size="small"
              disabled={saving}
              onClick={() => {
                const next = undetectedProxies.join(', ')
                setDraft(next)
                void save(next)
              }}
            >
              {t('settingsDeployment.detectedAction', {
                addresses: undetectedProxies.join(', '),
              })}
            </Button>
          </Alert>
        )}

        {trust.envManaged ? (
          <Alert severity="info" sx={{ mb: 2 }}>
            {t('settingsDeployment.envManaged')}
          </Alert>
        ) : (
          <Box sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <TextField
                size="small"
                fullWidth
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value)
                  setSaved(false)
                  setSaveError(null)
                }}
                placeholder="127.0.0.1, 172.18.0.0/16"
                disabled={saving}
                error={Boolean(saveError)}
                helperText={saveError ?? t('settingsDeployment.trustedProxiesFormat')}
                sx={{ flex: '1 1 320px' }}
              />
              <Button
                variant="contained"
                onClick={() => void save(draft)}
                disabled={saving || !hasUnsavedEdit}
                sx={{ mt: 0.25 }}
              >
                {saving ? <CircularProgress size={20} color="inherit" /> : t('common.save')}
              </Button>
            </Box>

            {/* Without this, typing a value (or clicking a preset) leaves the
                warning below still showing and the panel reads as broken when
                it is simply unsaved. */}
            {hasUnsavedEdit && !saveError && (
              <Alert severity="warning" sx={{ mt: 1.5 }}>
                {t('settingsDeployment.unsaved')}
              </Alert>
            )}

            <Box sx={{ display: 'flex', gap: 1, mt: 1.5, flexWrap: 'wrap' }}>
              <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
                {t('settingsDeployment.presets')}
              </Typography>
              <Chip
                size="small"
                label={t('settingsDeployment.presetTunnel')}
                onClick={() => setDraft('127.0.0.1, ::1')}
                variant="outlined"
                clickable
              />
              <Chip
                size="small"
                label={t('settingsDeployment.presetDocker')}
                onClick={() => setDraft('172.16.0.0/12')}
                variant="outlined"
                clickable
              />
              <Chip
                size="small"
                label={t('settingsDeployment.presetNone')}
                onClick={() => setDraft('')}
                variant="outlined"
                clickable
              />
            </Box>

            {saved && (
              <Alert severity="success" sx={{ mt: 1.5 }}>
                {t('settingsDeployment.savedApplied')}
              </Alert>
            )}
          </Box>
        )}

        <Divider sx={{ my: 2 }} />

        {loudFindings.length === 0 ? (
          <Alert severity="success" icon={<CheckCircleIcon fontSize="inherit" />}>
            {t('settingsDeployment.allClear')}
          </Alert>
        ) : (
          <Stack spacing={1.5}>
            {loudFindings.map((finding) => (
              <Alert key={finding.id} severity={SEVERITY_TO_MUI[finding.severity]}>
                <AlertTitle>{t(`settingsDeployment.findings.${finding.id}.title`)}</AlertTitle>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  {t(`settingsDeployment.findings.${finding.id}.detail`)}
                </Typography>
                <Typography
                  variant="body2"
                  component="code"
                  sx={{
                    display: 'block',
                    fontFamily: 'monospace',
                    fontSize: '0.8rem',
                    px: 1,
                    py: 0.5,
                    borderRadius: 1,
                    bgcolor: 'action.hover',
                    overflowX: 'auto',
                  }}
                >
                  {t(`settingsDeployment.findings.${finding.id}.fix`)}
                </Typography>
              </Alert>
            ))}
          </Stack>
        )}

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
          {t('settingsDeployment.restartNote')}
        </Typography>
      </CardContent>
    </Card>
  )
}
