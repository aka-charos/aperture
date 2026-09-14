/**
 * Settings for managed Emby home-screen rows (core `homeSections/`).
 *
 * Whether the media server can hold them is asked live on every load and
 * arrives as a decided value, together with the version it needs — the bundle
 * never holds the floor, so it cannot drift from the gate core enforces.
 *
 * "Sync now" starts the ordinary job rather than calling a bespoke endpoint: the
 * jobs route claims the name, so a press cannot run beside the nightly schedule,
 * and the run gets a log and a Cancel button in the Jobs console.
 */
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import HomeIcon from '@mui/icons-material/Home'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import SyncIcon from '@mui/icons-material/Sync'
import { jobConsoleLink } from '@/pages/jobs/registry'

type SupportReason = 'ok' | 'not-configured' | 'unsupported-provider' | 'unsupported-server' | 'unreachable'

interface ServerStatus {
  providerType: string | null
  serverVersion: string | null
  minVersion: string
  supported: boolean
  reason: SupportReason
}

interface HomeSectionsForm {
  enabled: boolean
  topPicksEnabled: boolean
  recommendationsEnabled: boolean
  playlistsEnabled: boolean
  sectionPosition: number
  topPicksMoviesName: string
  topPicksSeriesName: string
  recommendationsName: string
  sortBy: string
  recommendationsLimit: number
}

interface Limits {
  sorts: string[]
  maxSectionPosition: number
  minRecommendationsLimit: number
  maxRecommendationsLimit: number
  maxNameLength: number
}

const JOB_NAME = 'sync-home-sections'

function toForm(config: HomeSectionsForm): HomeSectionsForm {
  return {
    enabled: config.enabled,
    topPicksEnabled: config.topPicksEnabled,
    recommendationsEnabled: config.recommendationsEnabled,
    playlistsEnabled: config.playlistsEnabled,
    sectionPosition: config.sectionPosition,
    topPicksMoviesName: config.topPicksMoviesName,
    topPicksSeriesName: config.topPicksSeriesName,
    recommendationsName: config.recommendationsName,
    sortBy: config.sortBy,
    recommendationsLimit: config.recommendationsLimit,
  }
}

export function HomeSectionsSection() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [form, setForm] = useState<HomeSectionsForm | null>(null)
  const [saved, setSaved] = useState<HomeSectionsForm | null>(null)
  const [status, setStatus] = useState<ServerStatus | null>(null)
  const [limits, setLimits] = useState<Limits | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncStarted, setSyncStarted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/home-sections', { credentials: 'include' })
      if (!response.ok) throw new Error(t('settingsHomeSections.loadError'))
      const data = await response.json()
      const next = toForm(data.config)
      setForm(next)
      setSaved(next)
      setStatus(data.status)
      setLimits(data.limits)
    } catch {
      setError(t('settingsHomeSections.loadError'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const update = (changes: Partial<HomeSectionsForm>) => {
    setForm((prev) => (prev ? { ...prev, ...changes } : prev))
    setSuccess(null)
  }

  const handleSave = async () => {
    if (!form) return
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const response = await fetch('/api/home-sections/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(form),
      })
      const data = await response.json().catch(() => ({}))
      if (data.status) setStatus(data.status)
      if (!response.ok) throw new Error(data.error || t('settingsHomeSections.saveError'))
      const next = toForm(data.config)
      setForm(next)
      setSaved(next)
      setSuccess(t('settingsHomeSections.saved'))
    } catch (e) {
      setError(e instanceof Error ? e.message : t('settingsHomeSections.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const handleSyncNow = async () => {
    setSyncing(true)
    setError(null)
    setSyncStarted(false)
    try {
      const response = await fetch(`/api/jobs/${JOB_NAME}/run`, { method: 'POST', credentials: 'include' })
      if (!response.ok) {
        // A 409 says whether the job is running or still winding down after a
        // cancel; that sentence is the useful part, so it is shown as-is.
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || t('settingsHomeSections.syncFailed'))
      }
      setSyncStarted(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('settingsHomeSections.syncFailed'))
    } finally {
      setSyncing(false)
    }
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

  if (!form || !status || !limits) {
    return <Alert severity="error">{error ?? t('settingsHomeSections.loadError')}</Alert>
  }

  const hasChanges = JSON.stringify(form) !== JSON.stringify(saved)
  // Switching ON needs a supported server; switching OFF never does, because
  // that is how every managed row gets removed.
  const enableBlocked = !status.supported && !form.enabled
  // Nothing below the master switch has any effect while it is off: the sync
  // gates every row on it and a run can only remove. Showing those controls as
  // live — a Top Picks switch reading "on" under a feature that is off — says
  // otherwise, so they are disabled. Their values are kept for when it comes back
  // on, and the form value (not the saved one) decides, so flipping the switch
  // on unlocks them before saving.
  const inactive = !form.enabled
  const captionColor = inactive ? 'text.disabled' : 'text.secondary'
  const headingColor = inactive ? 'text.disabled' : 'text.primary'

  const unsupportedMessage = (() => {
    switch (status.reason) {
      case 'not-configured':
        return t('settingsHomeSections.status.notConfigured')
      case 'unsupported-provider':
        return t('settingsHomeSections.status.unsupportedProvider', { provider: status.providerType })
      case 'unsupported-server':
        return t('settingsHomeSections.status.unsupportedServer', {
          minVersion: status.minVersion,
          version: status.serverVersion ?? t('settingsHomeSections.status.unknownVersion'),
        })
      case 'unreachable':
        return t('settingsHomeSections.status.unreachable')
      default:
        return null
    }
  })()

  const enableSwitch = (
    <FormControlLabel
      control={
        <Switch
          checked={form.enabled}
          disabled={enableBlocked}
          onChange={(e) => update({ enabled: e.target.checked })}
        />
      }
      label={t('settingsHomeSections.enabled')}
    />
  )

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1, flexWrap: 'wrap' }}>
          <HomeIcon color="primary" />
          <Typography variant="h6" fontWeight={600}>
            {t('settingsHomeSections.title')}
          </Typography>
          {status.supported && (
            <Chip
              icon={<CheckCircleIcon />}
              label={t('settingsHomeSections.status.supported', { version: status.serverVersion })}
              color="success"
              size="small"
            />
          )}
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('settingsHomeSections.description')}
        </Typography>

        {unsupportedMessage && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {unsupportedMessage}
          </Alert>
        )}
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {success && (
          <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
            {success}
          </Alert>
        )}
        {syncStarted && (
          <Alert
            severity="info"
            sx={{ mb: 2 }}
            onClose={() => setSyncStarted(false)}
            action={
              <Button color="inherit" size="small" onClick={() => navigate(jobConsoleLink(JOB_NAME))}>
                {t('settingsHomeSections.openJob')}
              </Button>
            }
          >
            {t('settingsHomeSections.syncStarted')}
          </Alert>
        )}

        <Box id="home-sections-enabled">
          {enableBlocked ? (
            <Tooltip title={t('settingsHomeSections.enableBlocked', { minVersion: status.minVersion })}>
              <span>{enableSwitch}</span>
            </Tooltip>
          ) : (
            enableSwitch
          )}
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
            {t('settingsHomeSections.enabledHelp')}
          </Typography>
        </Box>

        <Divider sx={{ my: 2 }} />

        <Typography variant="subtitle2" fontWeight={600} gutterBottom color={headingColor}>
          {t('settingsHomeSections.rowsHeading')}
        </Typography>
        <Stack spacing={1}>
          <Box>
            <FormControlLabel
              control={
                <Switch
                  checked={form.recommendationsEnabled}
                  disabled={inactive}
                  onChange={(e) => update({ recommendationsEnabled: e.target.checked })}
                />
              }
              label={t('settingsHomeSections.recommendationsEnabled')}
            />
            <Typography variant="caption" color={captionColor} component="p">
              {t('settingsHomeSections.recommendationsHelp')}
            </Typography>
          </Box>
          <Box>
            <FormControlLabel
              control={
                <Switch
                  checked={form.topPicksEnabled}
                  disabled={inactive}
                  onChange={(e) => update({ topPicksEnabled: e.target.checked })}
                />
              }
              label={t('settingsHomeSections.topPicksEnabled')}
            />
            <Typography variant="caption" color={captionColor} component="p">
              {t('settingsHomeSections.topPicksHelp')}
            </Typography>
          </Box>
          <Box>
            <FormControlLabel
              control={
                <Switch
                  checked={form.playlistsEnabled}
                  disabled={inactive}
                  onChange={(e) => update({ playlistsEnabled: e.target.checked })}
                />
              }
              label={t('settingsHomeSections.playlistsEnabled')}
            />
            <Typography variant="caption" color={captionColor} component="p">
              {t('settingsHomeSections.playlistsHelp')}
            </Typography>
          </Box>
        </Stack>

        <Divider sx={{ my: 2 }} />

        <Typography variant="subtitle2" fontWeight={600} gutterBottom color={headingColor}>
          {t('settingsHomeSections.namesHeading')}
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          }}
        >
          <TextField
            label={t('settingsHomeSections.recommendationsName')}
            value={form.recommendationsName}
            onChange={(e) => update({ recommendationsName: e.target.value })}
            size="small"
            disabled={inactive}
            slotProps={{ htmlInput: { maxLength: limits.maxNameLength } }}
          />
          <TextField
            label={t('settingsHomeSections.topPicksMoviesName')}
            value={form.topPicksMoviesName}
            onChange={(e) => update({ topPicksMoviesName: e.target.value })}
            size="small"
            disabled={inactive}
            slotProps={{ htmlInput: { maxLength: limits.maxNameLength } }}
          />
          <TextField
            label={t('settingsHomeSections.topPicksSeriesName')}
            value={form.topPicksSeriesName}
            onChange={(e) => update({ topPicksSeriesName: e.target.value })}
            size="small"
            disabled={inactive}
            slotProps={{ htmlInput: { maxLength: limits.maxNameLength } }}
          />
        </Box>

        <Divider sx={{ my: 2 }} />

        <Typography variant="subtitle2" fontWeight={600} gutterBottom color={headingColor}>
          {t('settingsHomeSections.layoutHeading')}
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            alignItems: 'start',
          }}
        >
          <TextField
            type="number"
            label={t('settingsHomeSections.position')}
            helperText={t('settingsHomeSections.positionHelp')}
            value={form.sectionPosition}
            onChange={(e) => {
              const value = Number.parseInt(e.target.value, 10)
              if (Number.isFinite(value)) update({ sectionPosition: value })
            }}
            size="small"
            disabled={inactive}
            slotProps={{ htmlInput: { min: 0, max: limits.maxSectionPosition } }}
          />
          <TextField
            type="number"
            label={t('settingsHomeSections.limit')}
            value={form.recommendationsLimit}
            onChange={(e) => {
              const value = Number.parseInt(e.target.value, 10)
              if (Number.isFinite(value)) update({ recommendationsLimit: value })
            }}
            size="small"
            disabled={inactive}
            slotProps={{
              htmlInput: { min: limits.minRecommendationsLimit, max: limits.maxRecommendationsLimit },
            }}
          />
          <Box id="home-sections-sort">
            <TextField
              select
              fullWidth
              label={t('settingsHomeSections.sortBy')}
              helperText={t('settingsHomeSections.sortHelp')}
              value={form.sortBy}
              onChange={(e) => update({ sortBy: e.target.value })}
              disabled={inactive}
              size="small"
            >
              {limits.sorts.map((sort) => (
                <MenuItem key={sort} value={sort}>
                  {t(`settingsHomeSections.sort.${sort}`, { defaultValue: sort })}
                </MenuItem>
              ))}
            </TextField>
          </Box>
        </Box>

        <Typography variant="caption" color={captionColor} component="p" sx={{ mt: 2 }}>
          {t('settingsHomeSections.tagsNote')}
        </Typography>

        <Box sx={{ display: 'flex', gap: 1.5, mt: 3, flexWrap: 'wrap' }}>
          <Button variant="contained" onClick={() => void handleSave()} disabled={!hasChanges || saving}>
            {saving ? <CircularProgress size={18} color="inherit" /> : t('settingsHomeSections.save')}
          </Button>
          <Button
            variant="outlined"
            startIcon={<SyncIcon />}
            onClick={() => void handleSyncNow()}
            disabled={inactive || !status.supported || syncing || hasChanges}
          >
            {t('settingsHomeSections.syncNow')}
          </Button>
        </Box>
        {inactive && (
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
            {t('settingsHomeSections.syncWhenOff')}
          </Typography>
        )}
      </CardContent>
    </Card>
  )
}
