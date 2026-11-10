/**
 * Bitwarden Secrets Manager: which credentials are read from the operator's
 * Bitwarden project instead of being saved here.
 *
 * The card never holds a secret. The server sends names, counts and states;
 * linking sends a name. The access token, project and server come from the
 * container's environment and are shown read-only, so nothing typed into a
 * browser can repoint the instance at another vault.
 *
 * A linked credential whose secret cannot be read is drawn as a problem, never
 * as "not set": to the integration the two look the same (it has no key), and
 * this card is where an admin tells them apart.
 */
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import KeyIcon from '@mui/icons-material/Key'
import RefreshIcon from '@mui/icons-material/Refresh'

type BindingState = 'ok' | 'missing' | 'ambiguous' | 'empty' | 'unreachable'

interface Binding {
  id: string
  source: 'none' | 'stored' | 'bitwarden'
  secretName: string | null
  state: BindingState | null
}

interface Status {
  configured: boolean
  problem: string | null
  projectId: string | null
  serverUrl: string | null
  connected: boolean
  secretCount: number
  ambiguousNames: string[]
  fetchedAt: string | null
  stale: boolean
  lastFailure: { kind: string; detail: string | null; at: string } | null
}

interface Overview {
  status: Status
  secretNames: string[]
  bindings: Binding[]
}

export function BitwardenSecretsSection() {
  const { t, i18n } = useTranslation()
  const [overview, setOverview] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [choices, setChoices] = useState<Record<string, string | null>>({})
  const [error, setError] = useState<string | null>(null)

  const request = useCallback(
    async (url: string, init?: RequestInit): Promise<boolean> => {
      setError(null)
      try {
        const response = await fetch(url, { credentials: 'include', ...init })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
          setError(data.error || t('settingsBitwarden.requestError'))
          return false
        }
        setOverview(data)
        return true
      } catch {
        setError(t('settingsBitwarden.requestError'))
        return false
      }
    },
    [t]
  )

  useEffect(() => {
    request('/api/settings/secrets').finally(() => setLoading(false))
  }, [request])

  const handleRefresh = async () => {
    setRefreshing(true)
    await request('/api/settings/secrets/refresh', { method: 'POST' })
    setRefreshing(false)
  }

  const handleLink = async (id: string) => {
    const secretName = choices[id]
    if (!secretName) return
    setBusyId(id)
    const ok = await request(`/api/settings/secrets/bindings/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secretName }),
    })
    if (ok) setChoices((prev) => ({ ...prev, [id]: null }))
    setBusyId(null)
  }

  const handleUnlink = async (id: string) => {
    setBusyId(id)
    await request(`/api/settings/secrets/bindings/${encodeURIComponent(id)}`, { method: 'DELETE' })
    setBusyId(null)
  }

  if (loading) {
    return (
      <Card>
        <CardContent sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={24} />
        </CardContent>
      </Card>
    )
  }

  const status = overview?.status ?? null
  const failure = status?.lastFailure ?? null
  const lastRead = status?.fetchedAt ? new Date(status.fetchedAt).toLocaleString(i18n.language) : null

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1, flexWrap: 'wrap' }}>
          <KeyIcon color="primary" />
          <Typography variant="h6" fontWeight={600}>
            {t('settingsBitwarden.title')}
          </Typography>
          {status?.connected && !status.stale && (
            <Chip icon={<CheckCircleIcon />} label={t('settingsBitwarden.chipConnected')} color="success" size="small" />
          )}
          {status?.configured && (!status.connected || status.stale) && (
            <Chip icon={<ErrorOutlineIcon />} label={t('settingsBitwarden.chipProblem')} color="warning" size="small" />
          )}
          {status && !status.configured && <Chip label={t('settingsBitwarden.chipOff')} size="small" />}
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('settingsBitwarden.description')}
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {status && !status.configured && (
          <Alert severity={status.problem ? 'warning' : 'info'} sx={{ mb: 2 }} id="bitwarden-connection">
            {status.problem && (
              <Typography variant="body2" sx={{ mb: 1 }}>
                {t(`settingsBitwarden.problems.${status.problem}`)}
              </Typography>
            )}
            <Typography variant="body2">{t('settingsBitwarden.setup')}</Typography>
            <Box component="pre" sx={{ m: 0, mt: 1, fontSize: '0.8125rem', whiteSpace: 'pre-wrap' }}>
              {'BWS_ACCESS_TOKEN=…\nBWS_PROJECT_ID=…\nBWS_SERVER_URL=…'}
            </Box>
            <Typography variant="caption" display="block" sx={{ mt: 1 }}>
              {t('settingsBitwarden.setupServerNote')}
            </Typography>
          </Alert>
        )}

        {status?.configured && (
          <Box id="bitwarden-connection" sx={{ mb: 2 }}>
            <Stack direction="row" spacing={2} alignItems="flex-start" justifyContent="space-between">
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                  {t('settingsBitwarden.project', { projectId: status.projectId })}
                </Typography>
                <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                  {status.serverUrl
                    ? t('settingsBitwarden.server', { serverUrl: status.serverUrl })
                    : t('settingsBitwarden.serverCloud')}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                  {status.connected
                    ? t('settingsBitwarden.lastRead', { count: status.secretCount, when: lastRead })
                    : t('settingsBitwarden.neverRead')}
                </Typography>
              </Box>
              <Button
                variant="outlined"
                size="small"
                onClick={handleRefresh}
                disabled={refreshing}
                startIcon={refreshing ? <CircularProgress size={14} /> : <RefreshIcon />}
                sx={{ flexShrink: 0 }}
              >
                {t('settingsBitwarden.refresh')}
              </Button>
            </Stack>

            {failure && (
              <Alert severity={status.connected ? 'warning' : 'error'} sx={{ mt: 2 }}>
                <Typography variant="body2">
                  {t(`settingsBitwarden.failures.${failure.kind}`, {
                    defaultValue: t('settingsBitwarden.failures.failed'),
                  })}
                </Typography>
                {failure.detail && (
                  <Typography variant="caption" display="block" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>
                    {failure.detail}
                  </Typography>
                )}
                {status.connected && (
                  <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
                    {t('settingsBitwarden.staleNote')}
                  </Typography>
                )}
              </Alert>
            )}

            {status.ambiguousNames.length > 0 && (
              <Alert severity="warning" sx={{ mt: 2 }}>
                {t('settingsBitwarden.ambiguousNames', { names: status.ambiguousNames.join(', ') })}
              </Alert>
            )}
          </Box>
        )}

        <Divider sx={{ mb: 2 }} />

        <Typography variant="subtitle2" fontWeight={600} id="bitwarden-credentials">
          {t('settingsBitwarden.credentialsTitle')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
          {t('settingsBitwarden.credentialsDescription')}
        </Typography>

        <Stack divider={<Divider flexItem />} spacing={1.5}>
          {(overview?.bindings ?? []).map((binding) => {
            const linked = binding.source === 'bitwarden'
            const broken = linked && binding.state !== 'ok'
            const busy = busyId === binding.id
            return (
              <Box
                key={binding.id}
                sx={{
                  display: 'grid',
                  gap: 1.5,
                  alignItems: 'center',
                  gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1.4fr)' },
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={600}>
                    {t(`settingsBitwarden.credentials.${binding.id}`)}
                  </Typography>
                  <Typography
                    variant="caption"
                    color={broken ? 'warning.main' : 'text.secondary'}
                    display="block"
                    sx={{ overflowWrap: 'anywhere' }}
                  >
                    {linked
                      ? broken
                        ? t(`settingsBitwarden.states.${binding.state}`, { name: binding.secretName })
                        : t('settingsBitwarden.sourceBitwarden', { name: binding.secretName })
                      : binding.source === 'stored'
                        ? t('settingsBitwarden.sourceStored')
                        : t('settingsBitwarden.sourceNone')}
                  </Typography>
                </Box>

                <Stack direction="row" spacing={1} alignItems="center">
                  <Autocomplete
                    size="small"
                    fullWidth
                    options={overview?.secretNames ?? []}
                    value={choices[binding.id] ?? null}
                    onChange={(_event, value) => setChoices((prev) => ({ ...prev, [binding.id]: value }))}
                    disabled={!status?.connected || busy}
                    noOptionsText={t('settingsBitwarden.noSecrets')}
                    renderInput={(params) => <TextField {...params} label={t('settingsBitwarden.pickSecret')} />}
                  />
                  <Button
                    variant="contained"
                    size="small"
                    onClick={() => handleLink(binding.id)}
                    disabled={!choices[binding.id] || busy}
                    sx={{ flexShrink: 0 }}
                  >
                    {t('settingsBitwarden.link')}
                  </Button>
                  {linked && (
                    <Button
                      size="small"
                      color="inherit"
                      onClick={() => handleUnlink(binding.id)}
                      disabled={busy}
                      sx={{ flexShrink: 0 }}
                    >
                      {t('settingsBitwarden.unlink')}
                    </Button>
                  )}
                </Stack>
              </Box>
            )
          })}
        </Stack>

        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 2 }}>
          {t('settingsBitwarden.linkNote')}
        </Typography>
      </CardContent>
    </Card>
  )
}
