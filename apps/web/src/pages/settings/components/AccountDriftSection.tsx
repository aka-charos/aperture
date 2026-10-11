import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import BlockIcon from '@mui/icons-material/Block'
import CheckIcon from '@mui/icons-material/Check'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import RefreshIcon from '@mui/icons-material/Refresh'
import RemoveIcon from '@mui/icons-material/Remove'
import SyncProblemIcon from '@mui/icons-material/SyncProblem'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import { formatRelativeTime } from '@/lib/relativeTime'
import { withServerMessageDetail } from '@/lib/withServerMessageDetail'

/**
 * Where the media server, LLDAP and Aperture disagree about who has an
 * account. Everything here is decided by the server (core
 * `users/accountDrift.ts`): which accounts belong to one person, what is out
 * of step and how serious it is. The card only groups and words it.
 */

type Severity = 'warning' | 'info'
type RowStatus = Severity | 'inSync'
type Source = { state: 'ok'; count: number } | { state: 'notConfigured' } | { state: 'failed'; error: string }

interface Finding {
  id: string
  severity: Severity
  vars?: Record<string, string>
}

interface Row {
  key: string
  name: string
  mediaServer: { id: string; name: string; disabled: boolean; admin: boolean; lastActivity: string | null } | null
  lldap: { id: string; displayName: string | null; email: string | null; created: string | null; groups: string[] } | null
  aperture: { id: string; username: string; email: string | null; emailLocked: boolean; accessEnabled: boolean } | null
  findings: Finding[]
  status: RowStatus
}

interface Report {
  generatedAt: string
  mediaServerType: string | null
  sources: { mediaServer: Source; lldap: Source; aperture: { state: 'ok'; count: number } }
  rows: Row[]
  summary: { total: number; warning: number; info: number; inSync: number } | null
}

type Filter = RowStatus | 'all'
const FILTERS: Filter[] = ['warning', 'info', 'inSync', 'all']

export function AccountDriftSection() {
  const { t, i18n } = useTranslation()
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter | null>(null)
  const request = useRef(0)

  const load = useCallback(async () => {
    const id = ++request.current
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/settings/account-drift', { credentials: 'include' })
      const data = await response.json().catch(() => null)
      if (id !== request.current) return
      if (!response.ok || !data) {
        setError(data?.error ? withServerMessageDetail(t, data.error) : t('settingsAccountDrift.loadError'))
        return
      }
      setReport(data as Report)
    } catch {
      if (id === request.current) setError(t('settingsAccountDrift.loadError'))
    } finally {
      if (id === request.current) setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const provider = report?.mediaServerType
    ? report.mediaServerType.charAt(0).toUpperCase() + report.mediaServerType.slice(1)
    : t('settingsAccountDrift.mediaServerFallback')
  const sourceNames = { mediaServer: provider, lldap: 'LLDAP', aperture: t('settingsAccountDrift.apertureName') }

  // Open on what needs attention, unless nothing does.
  const activeFilter: Filter = filter ?? (report?.summary && report.summary.warning === 0 ? 'all' : 'warning')
  const visible = useMemo(
    () => (report?.rows ?? []).filter((row) => activeFilter === 'all' || row.status === activeFilter),
    [report, activeFilter]
  )
  const now = new Date()
  const when = (iso: string | null) => (iso ? formatRelativeTime(new Date(iso), now, i18n.language) : null)

  const findingText = (finding: Finding) => {
    const key =
      finding.id === 'goneFromMediaServer' && finding.vars?.email ? 'goneFromMediaServerWithEmail' : finding.id
    return t(`settingsAccountDrift.findings.${key}`, { provider, ...finding.vars })
  }

  // The address on file; for an account only LLDAP has, who it is and which
  // groups it is in, since that decides whether it should be there at all.
  const subtitle = (row: Row): string | null => {
    if (row.aperture) return row.aperture.email
    if (!row.lldap) return null
    const parts = [row.lldap.displayName, row.lldap.email].filter((part): part is string => !!part)
    if (row.lldap.groups.length > 0) {
      parts.push(t('settingsAccountDrift.detail.groups', { list: row.lldap.groups.join(', ') }))
    }
    return parts.length > 0 ? parts.join(' · ') : null
  }

  const sourceChip = (name: string, source: Source) => {
    if (source.state === 'ok') {
      return (
        <Chip
          key={name}
          size="small"
          variant="outlined"
          label={t('settingsAccountDrift.source.ok', { name, count: source.count })}
        />
      )
    }
    if (source.state === 'notConfigured') {
      return (
        <Chip key={name} size="small" variant="outlined" label={t('settingsAccountDrift.source.notConfigured', { name })} />
      )
    }
    return (
      <Tooltip key={name} title={source.error}>
        <Chip size="small" color="error" variant="outlined" label={t('settingsAccountDrift.source.failed', { name })} />
      </Tooltip>
    )
  }

  const presence = (row: Row, which: 'mediaServer' | 'lldap' | 'aperture') => {
    const name = sourceNames[which]
    const read = which === 'aperture' || report?.sources[which].state === 'ok'
    const details: string[] = []
    let state: 'present' | 'absent' | 'unknown' | 'disabled' = read ? 'absent' : 'unknown'

    if (which === 'mediaServer' && row.mediaServer) {
      state = row.mediaServer.disabled ? 'disabled' : 'present'
      details.push(
        row.mediaServer.lastActivity
          ? t('settingsAccountDrift.detail.lastActivity', { when: when(row.mediaServer.lastActivity) })
          : t('settingsAccountDrift.detail.neverActive')
      )
      if (row.mediaServer.admin) details.push(t('settingsAccountDrift.detail.admin'))
    }
    if (which === 'lldap' && row.lldap) {
      state = 'present'
      if (row.lldap.displayName) details.push(row.lldap.displayName)
      if (row.lldap.created) details.push(t('settingsAccountDrift.detail.created', { when: when(row.lldap.created) }))
      details.push(
        row.lldap.groups.length > 0
          ? t('settingsAccountDrift.detail.groups', { list: row.lldap.groups.join(', ') })
          : t('settingsAccountDrift.detail.noGroups')
      )
    }
    if (which === 'aperture' && row.aperture) {
      state = 'present'
      details.push(
        row.aperture.email
          ? t('settingsAccountDrift.detail.address', { email: row.aperture.email })
          : t('settingsAccountDrift.detail.noAddress')
      )
      details.push(
        row.aperture.accessEnabled ? t('settingsAccountDrift.detail.accessOn') : t('settingsAccountDrift.detail.accessOff')
      )
    }

    const icon = state === 'present' ? <CheckIcon /> : state === 'disabled' ? <BlockIcon /> : <RemoveIcon />
    return (
      <Tooltip
        key={which}
        title={
          <Box>
            <Typography variant="body2">{t(`settingsAccountDrift.presence.${state}`, { name })}</Typography>
            {details.map((line) => (
              <Typography key={line} variant="caption" component="div">
                {line}
              </Typography>
            ))}
          </Box>
        }
      >
        <Chip
          size="small"
          icon={icon}
          label={name}
          color={state === 'present' ? 'success' : state === 'disabled' ? 'warning' : 'default'}
          variant="outlined"
          sx={state === 'absent' || state === 'unknown' ? { opacity: 0.55, borderStyle: 'dashed' } : undefined}
        />
      </Tooltip>
    )
  }

  const mediaServerSource = report?.sources.mediaServer
  const lldapSource = report?.sources.lldap
  const summary = report?.summary ?? null

  return (
    <Card id="smtp-account-drift">
      <CardContent>
        <Box display="flex" alignItems="center" gap={2} mb={2} flexWrap="wrap">
          <SyncProblemIcon sx={{ fontSize: 28, color: 'primary.main' }} />
          <Typography variant="h6" fontWeight={600} sx={{ flex: 1 }}>
            {t('settingsAccountDrift.title')}
          </Typography>
          <Button
            size="small"
            variant="outlined"
            startIcon={loading ? <CircularProgress size={14} /> : <RefreshIcon />}
            onClick={() => void load()}
            disabled={loading}
          >
            {t('settingsAccountDrift.refresh')}
          </Button>
        </Box>

        <Typography variant="body2" color="text.secondary" mb={1}>
          {t('settingsAccountDrift.description', { provider })}
        </Typography>
        <Typography variant="body2" color="text.secondary" mb={2}>
          {t('settingsAccountDrift.ldapNote', { provider })}
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {!report && loading && (
          <Box display="flex" alignItems="center" gap={1.5} py={2}>
            <CircularProgress size={18} />
            <Typography variant="body2" color="text.secondary">
              {t('settingsAccountDrift.checking')}
            </Typography>
          </Box>
        )}

        {report && (
          <>
            <Box display="flex" gap={1} flexWrap="wrap" mb={2}>
              {sourceChip(sourceNames.mediaServer, report.sources.mediaServer)}
              {sourceChip(sourceNames.lldap, report.sources.lldap)}
              {sourceChip(sourceNames.aperture, report.sources.aperture)}
            </Box>

            {mediaServerSource?.state === 'notConfigured' && (
              <Alert severity="info" sx={{ mb: 2 }}>
                {t('settingsAccountDrift.mediaServerNotConfigured')}
              </Alert>
            )}
            {mediaServerSource?.state === 'failed' && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {t('settingsAccountDrift.mediaServerFailed', { provider, error: mediaServerSource.error })}
              </Alert>
            )}
            {mediaServerSource?.state === 'ok' && lldapSource?.state === 'failed' && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                {t('settingsAccountDrift.lldapFailed', { error: lldapSource.error })}
              </Alert>
            )}
            {mediaServerSource?.state === 'ok' && lldapSource?.state === 'notConfigured' && (
              <Alert severity="info" sx={{ mb: 2 }}>
                {t('settingsAccountDrift.lldapNotConfigured', { provider })}
              </Alert>
            )}

            {summary && (
              <>
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={activeFilter}
                  onChange={(_e, value: Filter | null) => value && setFilter(value)}
                  sx={{ mb: 2, flexWrap: 'wrap' }}
                >
                  {FILTERS.map((f) => (
                    <ToggleButton key={f} value={f} sx={{ textTransform: 'none' }}>
                      {t(`settingsAccountDrift.filter.${f}`, {
                        count: f === 'all' ? summary.total : summary[f],
                      })}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>

                {visible.length === 0 ? (
                  <Typography variant="body2" color="text.secondary" py={1}>
                    {t(`settingsAccountDrift.empty.${activeFilter}`)}
                  </Typography>
                ) : (
                  <Box display="flex" flexDirection="column" gap={1}>
                    {visible.map((row) => (
                      <Box
                        key={row.key}
                        sx={{ border: 1, borderColor: 'divider', borderRadius: 1, px: 1.5, py: 1 }}
                      >
                        <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                          <Box sx={{ flex: '1 1 160px', minWidth: 0 }}>
                            <Typography variant="body2" fontWeight={600} sx={{ wordBreak: 'break-word' }}>
                              {row.name}
                            </Typography>
                            {subtitle(row) && (
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                component="div"
                                sx={{ wordBreak: 'break-word' }}
                              >
                                {subtitle(row)}
                              </Typography>
                            )}
                          </Box>
                          <Box display="flex" gap={0.75} flexWrap="wrap">
                            {presence(row, 'mediaServer')}
                            {presence(row, 'lldap')}
                            {presence(row, 'aperture')}
                          </Box>
                        </Box>
                        {row.findings.length > 0 && (
                          <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0, mt: 1 }}>
                            {row.findings.map((finding) => (
                              <Box
                                component="li"
                                key={finding.id}
                                display="flex"
                                gap={1}
                                alignItems="flex-start"
                                sx={{ py: 0.25 }}
                              >
                                {finding.severity === 'warning' ? (
                                  <WarningAmberIcon fontSize="small" color="warning" sx={{ mt: '1px' }} />
                                ) : (
                                  <InfoOutlinedIcon fontSize="small" color="info" sx={{ mt: '1px' }} />
                                )}
                                <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                                  {findingText(finding)}
                                </Typography>
                              </Box>
                            ))}
                          </Box>
                        )}
                      </Box>
                    ))}
                  </Box>
                )}
              </>
            )}

            <Typography variant="caption" color="text.secondary" component="div" mt={2}>
              {t('settingsAccountDrift.checkedAt', { when: when(report.generatedAt) })}
            </Typography>
          </>
        )}
      </CardContent>
    </Card>
  )
}
