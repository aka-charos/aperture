/**
 * Settings for managed Emby home-screen rows (core `homeSections/`).
 *
 * Whether the media server can hold them is asked live on every load and
 * arrives as a decided value, together with the version it needs — the bundle
 * never holds the floor, so it cannot drift from the gate core enforces.
 *
 * Saving starts the ordinary sync job, so a change reaches home screens now
 * rather than at the nightly run. "Sync now" starts the same job without a
 * save: the jobs route claims the name, so neither can run beside the other,
 * and the run gets a log and a Cancel button in the Jobs console.
 *
 * Placement is per feature. After/Before a row is chosen from rows read live
 * from every account; how many accounts lack the chosen row is shown, and only
 * then is a fallback offered for them.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
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
import RefreshIcon from '@mui/icons-material/Refresh'
import { jobConsoleLink } from '@/pages/jobs/registry'
import { PlacementFields } from '@/components/homeSections/PlacementFields'
import {
  isAnchorMode,
  isPlacementComplete,
  type FallbackMode,
  type FeaturePlacementValue,
  type HomeRowOption,
} from '@/components/homeSections/placement'

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
  topPicksWithoutAccess: boolean
  recommendationsEnabled: boolean
  playlistsEnabled: boolean
  topPicksMoviesName: string
  topPicksSeriesName: string
  recommendationsMoviesName: string
  recommendationsSeriesName: string
  sortBy: string
  recommendationsLimit: number
  placements: Record<string, FeaturePlacementValue>
}

interface Limits {
  sorts: string[]
  maxSectionPosition: number
  minRecommendationsLimit: number
  maxRecommendationsLimit: number
  maxNameLength: number
  features: string[]
  modes: string[]
  fallbackModes: string[]
}

interface SharedRows {
  accounts: number
  unreadable: number
  unreadableAccounts: string[]
  rows: HomeRowOption[]
}

/** Past this many, the list is cut short and the full set is in a tooltip. */
const MAX_LISTED_ACCOUNTS = 10

type SyncOutcome = { started: boolean; reason?: 'nothing-saved' | 'feature-off' | 'already-running' }

const JOB_NAME = 'sync-home-sections'

/** Which of the three switches a feature's rows depend on. */
const SWITCH_FOR: Record<string, 'topPicksEnabled' | 'recommendationsEnabled' | 'playlistsEnabled'> = {
  'top-picks-movies': 'topPicksEnabled',
  'top-picks-series': 'topPicksEnabled',
  'recs-movies': 'recommendationsEnabled',
  'recs-series': 'recommendationsEnabled',
  playlists: 'playlistsEnabled',
}

function toForm(config: HomeSectionsForm): HomeSectionsForm {
  const placements: Record<string, FeaturePlacementValue> = {}
  for (const [feature, placement] of Object.entries(config.placements ?? {})) {
    placements[feature] = {
      mode: placement.mode,
      position: placement.position,
      anchor: placement.anchor,
      fallbackMode: placement.fallbackMode,
      fallbackPosition: placement.fallbackPosition,
    }
  }
  return {
    enabled: config.enabled,
    topPicksEnabled: config.topPicksEnabled,
    // Absent from a server built before 0184, which always behaved as "on".
    topPicksWithoutAccess: config.topPicksWithoutAccess !== false,
    recommendationsEnabled: config.recommendationsEnabled,
    playlistsEnabled: config.playlistsEnabled,
    topPicksMoviesName: config.topPicksMoviesName,
    topPicksSeriesName: config.topPicksSeriesName,
    recommendationsMoviesName: config.recommendationsMoviesName,
    recommendationsSeriesName: config.recommendationsSeriesName,
    sortBy: config.sortBy,
    recommendationsLimit: config.recommendationsLimit,
    placements,
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
  const [anchors, setAnchors] = useState<SharedRows | null>(null)
  const [anchorsLoading, setAnchorsLoading] = useState(false)
  const [anchorsError, setAnchorsError] = useState(false)
  const anchorsRequested = useRef(false)

  const loadAnchors = useCallback(async () => {
    anchorsRequested.current = true
    setAnchorsLoading(true)
    setAnchorsError(false)
    try {
      const response = await fetch('/api/home-sections/anchors', { credentials: 'include' })
      if (!response.ok) throw new Error()
      setAnchors(await response.json())
    } catch {
      setAnchorsError(true)
    } finally {
      setAnchorsLoading(false)
    }
  }, [])

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
      // Rows are read from every account, so only when a saved placement needs them.
      if (!anchorsRequested.current && Object.values(next.placements).some((p) => isAnchorMode(p.mode))) {
        void loadAnchors()
      }
    } catch {
      setError(t('settingsHomeSections.loadError'))
    } finally {
      setLoading(false)
    }
  }, [t, loadAnchors])

  useEffect(() => {
    void load()
  }, [load])

  const update = (changes: Partial<HomeSectionsForm>) => {
    setForm((prev) => (prev ? { ...prev, ...changes } : prev))
    setSuccess(null)
  }

  const updatePlacement = (feature: string, changes: Partial<FeaturePlacementValue>) => {
    setForm((prev) =>
      prev ? { ...prev, placements: { ...prev.placements, [feature]: { ...prev.placements[feature], ...changes } } } : prev
    )
    setSuccess(null)
    if (changes.mode && isAnchorMode(changes.mode) && !anchorsRequested.current) void loadAnchors()
  }

  const handleSave = async () => {
    if (!form) return
    setSaving(true)
    setError(null)
    setSuccess(null)
    setSyncStarted(false)
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
      const sync = data.sync as SyncOutcome | undefined
      if (sync?.started) {
        setSuccess(t('settingsHomeSections.savedApplying'))
        setSyncStarted(true)
      } else if (sync?.reason === 'already-running') {
        setSuccess(t('settingsHomeSections.savedSyncRunning'))
      } else {
        setSuccess(t('settingsHomeSections.saved'))
      }
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
  const complete = Object.values(form.placements).every(isPlacementComplete)
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

  const rowSwitch = (
    field: 'recommendationsEnabled' | 'topPicksEnabled' | 'playlistsEnabled',
    labelKey: string,
    helpKey: string
  ) => (
    <Box>
      <FormControlLabel
        control={
          <Switch
            checked={form[field]}
            disabled={inactive}
            onChange={(e) => update({ [field]: e.target.checked } as Partial<HomeSectionsForm>)}
          />
        }
        label={t(labelKey)}
      />
      <Typography variant="caption" color={captionColor} component="p">
        {t(helpKey)}
      </Typography>
    </Box>
  )

  const nameField = (
    field: 'topPicksMoviesName' | 'topPicksSeriesName' | 'recommendationsMoviesName' | 'recommendationsSeriesName',
    labelKey: string
  ) => (
    <TextField
      label={t(labelKey)}
      value={form[field]}
      onChange={(e) => update({ [field]: e.target.value } as Partial<HomeSectionsForm>)}
      size="small"
      disabled={inactive}
      slotProps={{ htmlInput: { maxLength: limits.maxNameLength } }}
    />
  )

  /** Accounts lacking the chosen anchor, or null when that cannot be told yet. */
  const accountsLacking = (placement: FeaturePlacementValue): number | null => {
    if (!anchors || !placement.anchor) return null
    const shared = anchors.rows.find((row) => row.id === placement.anchor?.id)
    return Math.max(anchors.accounts - (shared?.accountsWithType ?? 0), 0)
  }

  /**
   * Account names as a caption. A long list is cut short and the full set moves
   * to a tooltip, so one row with forty names does not push the page apart.
   */
  const accountList = (key: string, names: readonly string[]) => {
    if (names.length === 0) return null
    const truncated = names.length > MAX_LISTED_ACCOUNTS
    const listed = truncated
      ? t('settingsHomeSections.namesAndMore', {
          names: names.slice(0, MAX_LISTED_ACCOUNTS).join(', '),
          extra: names.length - MAX_LISTED_ACCOUNTS,
        })
      : names.join(', ')
    const caption = (
      <Typography variant="caption" color={captionColor} component="p" sx={{ mb: 1 }}>
        {t(key, { names: listed })}
      </Typography>
    )
    return truncated ? <Tooltip title={names.join(', ')}>{caption}</Tooltip> : caption
  }

  const renderFallback = (feature: string, placement: FeaturePlacementValue, disabled: boolean) => {
    if (!isAnchorMode(placement.mode) || !placement.anchor) return null
    const name = placement.anchor.name ?? placement.anchor.id
    const lacking = accountsLacking(placement)
    if (lacking === null && anchorsLoading) {
      return (
        <Typography variant="caption" color={captionColor} component="p" sx={{ mt: 1 }}>
          {t('settingsHomeSections.anchorsLoading')}
        </Typography>
      )
    }
    if (lacking === 0) {
      return (
        <Typography variant="caption" color={captionColor} component="p" sx={{ mt: 1 }}>
          {t('settingsHomeSections.anchorEveryone', { name })}
        </Typography>
      )
    }
    const missingAccounts = anchors?.rows.find((row) => row.id === placement.anchor?.id)?.missingAccounts
    return (
      <Box sx={{ mt: 1.5 }}>
        {lacking === null ? (
          <Typography variant="caption" color={captionColor} component="p" sx={{ mb: 1 }}>
            {t('settingsHomeSections.anchorUnknown', { name })}
          </Typography>
        ) : (
          <>
            <Typography variant="caption" color={captionColor} component="p" sx={{ mb: 0.5 }}>
              {t('settingsHomeSections.anchorMissing', { name, missing: lacking, accounts: anchors?.accounts ?? 0 })}
            </Typography>
            {accountList('settingsHomeSections.anchorMissingAccounts', missingAccounts ?? [])}
            <Typography variant="caption" color={captionColor} component="p" sx={{ mb: 1 }}>
              {t('settingsHomeSections.anchorFallbackPrompt')}
            </Typography>
          </>
        )}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <TextField
            select
            size="small"
            label={t('settingsHomeSections.fallback')}
            value={placement.fallbackMode}
            disabled={disabled}
            sx={{ minWidth: 180 }}
            onChange={(e) =>
              updatePlacement(feature, {
                fallbackMode: e.target.value as FallbackMode,
                fallbackPosition: e.target.value === 'position' ? placement.fallbackPosition : 0,
              })
            }
          >
            {limits.fallbackModes.map((mode) => (
              <MenuItem key={mode} value={mode}>
                {t(`homeScreenPlacement.modes.${mode}`)}
              </MenuItem>
            ))}
          </TextField>
          {placement.fallbackMode === 'position' && (
            <TextField
              type="number"
              size="small"
              label={t('homeScreenPlacement.position')}
              helperText={t('homeScreenPlacement.positionHelp')}
              value={placement.fallbackPosition}
              disabled={disabled}
              sx={{ width: { xs: '100%', sm: 170 } }}
              onChange={(e) => {
                const parsed = Number.parseInt(e.target.value, 10)
                if (Number.isFinite(parsed)) {
                  updatePlacement(feature, {
                    fallbackPosition: Math.min(Math.max(parsed, 0), limits.maxSectionPosition),
                  })
                }
              }}
              slotProps={{ htmlInput: { min: 0, max: limits.maxSectionPosition } }}
            />
          )}
        </Stack>
      </Box>
    )
  }

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
          <Alert
            severity="success"
            sx={{ mb: 2 }}
            onClose={() => {
              setSuccess(null)
              setSyncStarted(false)
            }}
            action={
              syncStarted ? (
                <Button color="inherit" size="small" onClick={() => navigate(jobConsoleLink(JOB_NAME))}>
                  {t('settingsHomeSections.openJob')}
                </Button>
              ) : undefined
            }
          >
            {success}
          </Alert>
        )}
        {syncStarted && !success && (
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
          {rowSwitch('topPicksEnabled', 'settingsHomeSections.topPicksEnabled', 'settingsHomeSections.topPicksRowsHelp')}
          <Box id="home-sections-top-picks-without-access" sx={{ ps: 4 }}>
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={form.topPicksWithoutAccess}
                  disabled={inactive || !form.topPicksEnabled}
                  onChange={(e) => update({ topPicksWithoutAccess: e.target.checked })}
                />
              }
              label={t('settingsHomeSections.topPicksWithoutAccess')}
            />
            <Typography variant="caption" color={captionColor} component="p">
              {t('settingsHomeSections.topPicksWithoutAccessHelp')}
            </Typography>
          </Box>
          {rowSwitch(
            'recommendationsEnabled',
            'settingsHomeSections.recommendationsEnabled',
            'settingsHomeSections.recommendationsHelp'
          )}
          {rowSwitch('playlistsEnabled', 'settingsHomeSections.playlistsEnabled', 'settingsHomeSections.playlistsHelp')}
        </Stack>

        <Divider sx={{ my: 2 }} />

        <Typography variant="subtitle2" fontWeight={600} gutterBottom color={headingColor}>
          {t('settingsHomeSections.namesHeading')}
        </Typography>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          {nameField('topPicksMoviesName', 'settingsHomeSections.topPicksMoviesName')}
          {nameField('topPicksSeriesName', 'settingsHomeSections.topPicksSeriesName')}
          {nameField('recommendationsMoviesName', 'settingsHomeSections.recommendationsMoviesName')}
          {nameField('recommendationsSeriesName', 'settingsHomeSections.recommendationsSeriesName')}
        </Box>

        <Divider sx={{ my: 2 }} />

        <Box id="home-sections-placement">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="subtitle2" fontWeight={600} color={headingColor} sx={{ flex: 1 }}>
              {t('settingsHomeSections.placementHeading')}
            </Typography>
            {anchorsRequested.current && (
              <Button
                size="small"
                startIcon={anchorsLoading ? <CircularProgress size={14} /> : <RefreshIcon />}
                onClick={() => void loadAnchors()}
                disabled={inactive || anchorsLoading}
              >
                {t('settingsHomeSections.anchorsRefresh')}
              </Button>
            )}
          </Box>
          <Typography variant="caption" color={captionColor} component="p" sx={{ mb: 1.5 }}>
            {t('settingsHomeSections.placementHelp')}
          </Typography>
          {anchorsError && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {t('settingsHomeSections.anchorsError')}
            </Alert>
          )}
          {anchors && (
            <Box sx={{ mb: 1.5 }}>
              <Typography variant="caption" color={captionColor} component="p" sx={{ mb: 0.5 }}>
                {anchors.unreadable > 0
                  ? t('settingsHomeSections.anchorsSummaryUnreadable', {
                      accounts: anchors.accounts,
                      unreadable: anchors.unreadable,
                    })
                  : t('settingsHomeSections.anchorsSummary', { accounts: anchors.accounts })}
              </Typography>
              {accountList('settingsHomeSections.anchorsUnreadableAccounts', anchors.unreadableAccounts ?? [])}
            </Box>
          )}

          <Stack spacing={2.5} divider={<Divider flexItem />}>
            {limits.features.map((feature) => {
              const placement = form.placements[feature]
              if (!placement) return null
              const switchedOff = !form[SWITCH_FOR[feature]]
              const disabled = inactive || switchedOff
              return (
                <Box key={feature}>
                  <Typography
                    variant="body2"
                    fontWeight={500}
                    color={disabled ? 'text.disabled' : 'text.primary'}
                    sx={{ mb: 1 }}
                  >
                    {t(`homeScreenPlacement.features.${feature}`)}
                    {switchedOff && !inactive && (
                      <Typography component="span" variant="caption" color="text.disabled" sx={{ ml: 1 }}>
                        {t('settingsHomeSections.featureOff')}
                      </Typography>
                    )}
                  </Typography>
                  <PlacementFields
                    idPrefix={`home-sections-${feature}`}
                    value={placement}
                    onChange={(next) => updatePlacement(feature, next)}
                    modes={limits.modes}
                    rows={anchors?.rows ?? []}
                    rowsLoading={anchorsLoading}
                    maxPosition={limits.maxSectionPosition}
                    disabled={disabled}
                    showAccounts
                  />
                  {renderFallback(feature, placement, disabled)}
                </Box>
              )
            })}
          </Stack>
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
          <Button
            variant="contained"
            onClick={() => void handleSave()}
            disabled={!hasChanges || !complete || saving}
          >
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
        {!complete && (
          <Typography variant="caption" color="warning.main" component="p" sx={{ mt: 1 }}>
            {t('settingsHomeSections.anchorRequired')}
          </Typography>
        )}
        {inactive && (
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
            {t('settingsHomeSections.syncWhenOff')}
          </Typography>
        )}
      </CardContent>
    </Card>
  )
}
