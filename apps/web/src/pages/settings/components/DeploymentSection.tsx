import { useState, useEffect, useCallback } from 'react'
import {
  Box,
  Typography,
  Card,
  CardContent,
  Alert,
  AlertTitle,
  Chip,
  CircularProgress,
  Divider,
  Stack,
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

interface Posture {
  mode: 'direct' | 'proxy'
  production: boolean
  effective: {
    trustProxy: boolean | number | string[]
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
  }
  findings: Finding[]
}

const SEVERITY_TO_MUI: Record<Severity, 'error' | 'warning' | 'info'> = {
  critical: 'error',
  warning: 'warning',
  info: 'info',
}

function formatTrustProxy(value: boolean | number | string[]): string {
  if (value === false) return 'off'
  if (value === true) return 'all (unsafe)'
  if (Array.isArray(value)) return value.join(', ')
  return `${value} hop(s)`
}

export function DeploymentSection() {
  const { t } = useTranslation()
  const [posture, setPosture] = useState<Posture | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/deployment', { credentials: 'include' })
      if (res.ok) setPosture(await res.json())
    } catch {
      // Leave the panel empty rather than blocking the rest of the tab.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

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

  // Client IPs are only trustworthy when something is trusted to forward them,
  // or when nothing is in front at all.
  const resolvesClientIps =
    posture.effective.trustProxy !== false || posture.observed.forwardedForSeen === 0

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
      value: formatTrustProxy(posture.effective.trustProxy),
      ok: posture.effective.trustProxy !== true,
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
