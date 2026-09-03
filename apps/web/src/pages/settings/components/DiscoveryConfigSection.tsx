/**
 * Discovery pipeline tuning.
 *
 * Every knob here was a compile-time constant until this card existed — the
 * pipeline read `DEFAULT_DISCOVERY_CONFIG` and there was no way for an operator
 * to respond to their own instance. The bounds are served by the API alongside
 * the values rather than duplicated here, because the web bundle never imports
 * core and a hand-copied limit is the classic thing that drifts.
 *
 * Each field carries its `id` as a literal rather than through a data array:
 * `registry.test.ts` scans this source for the anchors the admin search
 * promises, and an id assembled at runtime is one it cannot see.
 */
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Slider,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import SaveIcon from '@mui/icons-material/Save'
import RestartAltIcon from '@mui/icons-material/RestartAlt'

type TraktPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'all'

interface DiscoveryConfig {
  maxCandidatesPerSource: number
  maxTotalCandidates: number
  maxEnrichedCandidates: number
  targetDisplayCount: number
  minVoteCount: number
  minVoteAverage: number
  similarityWeight: number
  popularityWeight: number
  recencyWeight: number
  traktPeriod: TraktPeriod
  maxPoolCandidates: number
  poolMaxAgeDays: number
}

type Bounds = Record<string, { min: number; max: number }>

const TRAKT_PERIODS: TraktPeriod[] = ['daily', 'weekly', 'monthly', 'yearly', 'all']

const gridSx = {
  display: 'grid',
  gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
  gap: 2.5,
} as const

export function DiscoveryConfigSection() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<DiscoveryConfig | null>(null)
  const [bounds, setBounds] = useState<Bounds>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/discovery/config', { credentials: 'include' })
      if (!res.ok) {
        setError(t('settingsDiscovery.loadFailed'))
        return
      }
      const data = await res.json()
      setConfig(data.config)
      setBounds(data.bounds ?? {})
      setError(null)
    } catch {
      setError(t('settingsDiscovery.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    load()
  }, [load])

  // Functional update: these fire in quick succession while typing or dragging,
  // and closing over `config` would drop all but the last.
  const update = <K extends keyof DiscoveryConfig>(key: K, value: DiscoveryConfig[K]) => {
    setConfig((prev) => (prev ? { ...prev, [key]: value } : prev))
    setSaved(false)
  }

  const save = async () => {
    if (!config) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/discovery/config', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (!res.ok) {
        setError(t('settingsDiscovery.saveFailed'))
        return
      }
      const data = await res.json()
      // Adopt what the server actually stored: a value it clamped should show
      // its clamped form here immediately, not on the next page load.
      setConfig(data.config)
      setSaved(true)
    } catch {
      setError(t('settingsDiscovery.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const numProps = (key: keyof DiscoveryConfig, step = 1) => ({
    type: 'number' as const,
    size: 'small' as const,
    fullWidth: true,
    value: config ? (config[key] as number) : 0,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      update(key, Number(e.target.value) as never),
    inputProps: { min: bounds[key]?.min, max: bounds[key]?.max, step },
  })

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    )
  }

  if (!config) {
    return <Alert severity="error">{error ?? t('settingsDiscovery.loadFailed')}</Alert>
  }

  const weightTotal = config.similarityWeight + config.popularityWeight + config.recencyWeight
  const share = (v: number) => (weightTotal > 0 ? `${Math.round((v / weightTotal) * 100)}%` : '—')

  return (
    <Stack spacing={3}>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: '60ch' }}>
        {t('settingsDiscovery.intro')}
      </Typography>

      {error && <Alert severity="error">{error}</Alert>}
      {saved && <Alert severity="success">{t('settingsDiscovery.saved')}</Alert>}

      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" gutterBottom>
            {t('settingsDiscovery.fetchTitle')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('settingsDiscovery.fetchBlurb')}
          </Typography>
          <Box sx={gridSx}>
            <TextField
              id="discovery-max-per-source"
              label={t('settingsDiscovery.maxCandidatesPerSource')}
              helperText={t('settingsDiscovery.maxCandidatesPerSourceHelp')}
              {...numProps('maxCandidatesPerSource')}
            />
            <TextField
              id="discovery-max-total"
              label={t('settingsDiscovery.maxTotalCandidates')}
              helperText={t('settingsDiscovery.maxTotalCandidatesHelp')}
              {...numProps('maxTotalCandidates')}
            />
            <TextField
              id="discovery-max-enriched"
              label={t('settingsDiscovery.maxEnrichedCandidates')}
              helperText={t('settingsDiscovery.maxEnrichedCandidatesHelp')}
              {...numProps('maxEnrichedCandidates')}
            />
            <TextField
              id="discovery-target-display"
              label={t('settingsDiscovery.targetDisplayCount')}
              helperText={t('settingsDiscovery.targetDisplayCountHelp')}
              {...numProps('targetDisplayCount')}
            />
          </Box>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" gutterBottom>
            {t('settingsDiscovery.qualityTitle')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('settingsDiscovery.qualityBlurb')}
          </Typography>
          <Box sx={gridSx}>
            <TextField
              id="discovery-min-vote-count"
              label={t('settingsDiscovery.minVoteCount')}
              helperText={t('settingsDiscovery.minVoteCountHelp')}
              {...numProps('minVoteCount')}
            />
            <TextField
              id="discovery-min-vote-average"
              label={t('settingsDiscovery.minVoteAverage')}
              helperText={t('settingsDiscovery.minVoteAverageHelp')}
              {...numProps('minVoteAverage', 0.1)}
            />
            <FormControl size="small" fullWidth>
              <InputLabel id="discovery-trakt-period-label">
                {t('settingsDiscovery.traktPeriod')}
              </InputLabel>
              <Select
                labelId="discovery-trakt-period-label"
                id="discovery-trakt-period"
                label={t('settingsDiscovery.traktPeriod')}
                value={config.traktPeriod}
                onChange={(e) => update('traktPeriod', e.target.value as TraktPeriod)}
              >
                {TRAKT_PERIODS.map((p) => (
                  <MenuItem key={p} value={p}>
                    {t(`settingsDiscovery.traktPeriodOption.${p}`)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" gutterBottom>
            {t('settingsDiscovery.poolTitle')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('settingsDiscovery.poolBlurb')}
          </Typography>
          <Box sx={gridSx}>
            <TextField
              id="discovery-max-pool"
              label={t('settingsDiscovery.maxPoolCandidates')}
              helperText={t('settingsDiscovery.maxPoolCandidatesHelp')}
              {...numProps('maxPoolCandidates')}
            />
            <TextField
              id="discovery-pool-age"
              label={t('settingsDiscovery.poolMaxAgeDays')}
              helperText={t('settingsDiscovery.poolMaxAgeDaysHelp')}
              {...numProps('poolMaxAgeDays')}
            />
          </Box>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" gutterBottom>
            {t('settingsDiscovery.weightsTitle')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('settingsDiscovery.weightsBlurb')}
          </Typography>
          <Stack spacing={2.5}>
            <Box id="discovery-weight-similarity">
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="body2">{t('settingsDiscovery.similarityWeight')}</Typography>
                <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {share(config.similarityWeight)}
                </Typography>
              </Box>
              <Slider
                size="small"
                aria-label={t('settingsDiscovery.similarityWeight')}
                value={config.similarityWeight}
                min={0}
                max={1}
                step={0.05}
                valueLabelDisplay="auto"
                onChange={(_, v) => update('similarityWeight', (Array.isArray(v) ? v[0] : v))}
              />
            </Box>
            <Box id="discovery-weight-popularity">
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="body2">{t('settingsDiscovery.popularityWeight')}</Typography>
                <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {share(config.popularityWeight)}
                </Typography>
              </Box>
              <Slider
                size="small"
                aria-label={t('settingsDiscovery.popularityWeight')}
                value={config.popularityWeight}
                min={0}
                max={1}
                step={0.05}
                valueLabelDisplay="auto"
                onChange={(_, v) => update('popularityWeight', (Array.isArray(v) ? v[0] : v))}
              />
            </Box>
            <Box id="discovery-weight-recency">
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="body2">{t('settingsDiscovery.recencyWeight')}</Typography>
                <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {share(config.recencyWeight)}
                </Typography>
              </Box>
              <Slider
                size="small"
                aria-label={t('settingsDiscovery.recencyWeight')}
                value={config.recencyWeight}
                min={0}
                max={1}
                step={0.05}
                valueLabelDisplay="auto"
                onChange={(_, v) => update('recencyWeight', (Array.isArray(v) ? v[0] : v))}
              />
            </Box>
          </Stack>
          <Divider sx={{ my: 2 }} />
          <Typography variant="caption" color="text.secondary">
            {t('settingsDiscovery.weightsNote')}
          </Typography>
        </CardContent>
      </Card>

      <Stack direction="row" spacing={1.5}>
        <Button
          variant="contained"
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
          disabled={saving}
          onClick={save}
        >
          {t('settingsDiscovery.save')}
        </Button>
        <Button variant="outlined" startIcon={<RestartAltIcon />} disabled={saving} onClick={load}>
          {t('settingsDiscovery.revert')}
        </Button>
      </Stack>
    </Stack>
  )
}

export default DiscoveryConfigSection
