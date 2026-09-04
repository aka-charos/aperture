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

type BlendTerm = 'similarity' | 'popularity' | 'recency' | 'source'

/**
 * What the weights claim against what they actually do.
 *
 * Percentages arrive decided from the API. The web bundle never imports core,
 * and this is the blend arithmetic itself -- a hand copy here would be the one
 * that drifts the first time the scorer is retuned.
 */
interface BlendDiagnostics {
  mediaType: 'movie' | 'series'
  runs: number
  candidates: number
  configured: Record<BlendTerm, number>
  realised: Record<BlendTerm, number> | null
}

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
  const [blend, setBlend] = useState<BlendDiagnostics[]>([])
  const [sourceTermWeight, setSourceTermWeight] = useState(0)

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
      // Absent means an API that predates the field, in which case the shares
      // sum over the three sliders exactly as they used to. Defaulting to 0.1
      // here would reintroduce the hand copy this field exists to remove.
      setSourceTermWeight(typeof data.sourceTermWeight === 'number' ? data.sourceTermWeight : 0)
      setError(null)
    } catch {
      setError(t('settingsDiscovery.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  /**
   * Fetched separately and allowed to fail in silence. It is an aggregate over
   * every stored candidate, so it is slower than the config and it is absent
   * until a run has happened -- neither of which should stop the sliders
   * rendering. A card that cannot be tuned because a diagnostic is missing is
   * worse than one that cannot show the diagnostic.
   */
  const loadBlend = useCallback(async () => {
    try {
      const res = await fetch('/api/discovery/blend', { credentials: 'include' })
      if (!res.ok) return
      const data = await res.json()
      setBlend(Array.isArray(data.blend) ? data.blend : [])
    } catch {
      // Left as it was; the panel simply shows configured shares alone.
    }
  }, [])

  useEffect(() => {
    load()
    loadBlend()
  }, [load, loadBlend])

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

  // The source-quality term has no slider but is a real claimant on the same
  // budget: the scorer divides by a total that includes it. Leaving it out is
  // what made this card report 50/30/20 for a blend that is 45.5/27.3/18.2/9.1.
  const weightTotal =
    config.similarityWeight + config.popularityWeight + config.recencyWeight + sourceTermWeight
  const share = (v: number) => (weightTotal > 0 ? `${Math.round((v / weightTotal) * 100)}%` : '—')

  const pct = (v: number | undefined) => (typeof v === 'number' ? `${Math.round(v)}%` : '—')
  const measured = blend.filter((b) => b.realised !== null)
  const blendRows: { term: BlendTerm; label: string }[] = [
    { term: 'similarity', label: t('settingsDiscovery.similarityWeight') },
    { term: 'popularity', label: t('settingsDiscovery.popularityWeight') },
    { term: 'recency', label: t('settingsDiscovery.recencyWeight') },
    { term: 'source', label: t('settingsDiscovery.sourceWeight') },
  ]

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

          {/*
            What the weights CLAIM against what they DO.
            A term's real influence is its share times the range it actually
            uses, so two terms with the same weight move the ranking by
            different amounts when their spreads differ. Reported rather than
            silently corrected: correcting it was simulated on live data and
            bought no better matching, only a trade of new-and-obscure for
            old-and-popular -- which is an operator's preference, not a defect.
          */}
          {measured.length > 0 && (
            <Box id="discovery-weight-measured" sx={{ mt: 2.5 }}>
              <Typography variant="subtitle2" gutterBottom>
                {t('settingsDiscovery.measuredTitle')}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                {t('settingsDiscovery.measuredBlurb')}
              </Typography>

              <Box sx={{ overflowX: 'auto' }}>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: `minmax(9rem, 1.4fr) repeat(${measured.length + 1}, minmax(4.5rem, 1fr))`,
                    columnGap: 2,
                    rowGap: 0.75,
                    minWidth: '22rem',
                    alignItems: 'baseline',
                  }}
                >
                  <Typography variant="caption" color="text.secondary" />
                  <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'right' }}>
                    {t('settingsDiscovery.measuredConfigured')}
                  </Typography>
                  {measured.map((b) => (
                    <Typography
                      key={`head-${b.mediaType}`}
                      variant="caption"
                      color="text.secondary"
                      sx={{ textAlign: 'right' }}
                    >
                      {t(`settingsDiscovery.measured_${b.mediaType}`)}
                    </Typography>
                  ))}

                  {blendRows.map(({ term, label }) => (
                    <Box key={term} sx={{ display: 'contents' }}>
                      <Typography variant="body2">{label}</Typography>
                      <Typography
                        variant="body2"
                        sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                      >
                        {pct(measured[0]?.configured?.[term])}
                      </Typography>
                      {measured.map((b) => {
                        const configuredShare = b.configured?.[term]
                        const realisedShare = b.realised?.[term]
                        // Flagged only when the gap is big enough to change a
                        // decision. Colouring every rounding difference would
                        // make the whole column look broken.
                        const drifted =
                          typeof configuredShare === 'number' &&
                          typeof realisedShare === 'number' &&
                          Math.abs(realisedShare - configuredShare) >= 5
                        return (
                          <Typography
                            key={`${term}-${b.mediaType}`}
                            variant="body2"
                            color={drifted ? 'warning.main' : 'text.primary'}
                            sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                          >
                            {pct(realisedShare)}
                          </Typography>
                        )
                      })}
                    </Box>
                  ))}
                </Box>
              </Box>

              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
                {t('settingsDiscovery.measuredFootnote', {
                  runs: measured.reduce((n, b) => n + b.runs, 0),
                  candidates: measured.reduce((n, b) => n + b.candidates, 0),
                })}
              </Typography>
            </Box>
          )}
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
