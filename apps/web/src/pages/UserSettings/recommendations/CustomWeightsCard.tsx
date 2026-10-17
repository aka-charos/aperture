import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Alert, Box, Button, CircularProgress, IconButton, Slider, Switch, Tooltip, Typography } from '@mui/material'
import TuneIcon from '@mui/icons-material/Tune'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import HelpOutlineIcon from '@mui/icons-material/HelpOutline'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/useAuth'
import { SettingsCard } from '../SettingsCard'
import { MediaTypeToggle } from './MediaTypeToggle'
import type { MediaType } from './useTasteData'
import { HelpHint } from '@/components/HelpHint'

interface AlgorithmWeights {
  similarityWeight: number
  noveltyWeight: number
  ratingWeight: number
  diversityWeight: number
  recentWatchLimit: number
}

interface AlgorithmSettings {
  enabled: boolean
  movie?: Partial<AlgorithmWeights>
  series?: Partial<AlgorithmWeights>
}

type BlendKey = Exclude<keyof AlgorithmWeights, 'recentWatchLimit'>

const BLEND_KEYS: readonly BlendKey[] = ['similarityWeight', 'noveltyWeight', 'ratingWeight', 'diversityWeight']

const BLEND_LABEL_KEYS: Record<BlendKey, { label: string; description: string }> = {
  similarityWeight: { label: 'algorithmSettings.weightSimilarity', description: 'algorithmSettings.weightSimilarityDesc' },
  noveltyWeight: { label: 'algorithmSettings.weightNovelty', description: 'algorithmSettings.weightNoveltyDesc' },
  ratingWeight: { label: 'algorithmSettings.weightRating', description: 'algorithmSettings.weightRatingDesc' },
  diversityWeight: { label: 'algorithmSettings.weightDiversity', description: 'algorithmSettings.weightDiversityDesc' },
}

const SAVE_DELAY_MS = 800

function resolveWeights(settings: AlgorithmSettings, defaults: Record<MediaType, AlgorithmWeights>, type: MediaType): AlgorithmWeights {
  const current = settings[type] ?? {}
  const base = defaults[type]
  return {
    similarityWeight: current.similarityWeight ?? base.similarityWeight,
    noveltyWeight: current.noveltyWeight ?? base.noveltyWeight,
    ratingWeight: current.ratingWeight ?? base.ratingWeight,
    diversityWeight: current.diversityWeight ?? base.diversityWeight,
    recentWatchLimit: current.recentWatchLimit ?? base.recentWatchLimit,
  }
}

function WeightRow({
  label,
  help,
  display,
  defaultDisplay,
  children,
}: {
  label: string
  help: string
  display: string
  defaultDisplay: string | null
  children: ReactNode
}) {
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Typography variant="body2" fontWeight={500}>
          {label}
        </Typography>
        <Tooltip title={help}>
          <IconButton size="small" sx={{ p: 0.25 }} aria-label={help}>
            <HelpOutlineIcon fontSize="inherit" />
          </IconButton>
        </Tooltip>
        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'baseline', gap: 1 }}>
          <Typography variant="body2" fontWeight={600} color="primary.main">
            {display}
          </Typography>
          {defaultDisplay && (
            <Typography variant="caption" color="text.secondary">
              {defaultDisplay}
            </Typography>
          )}
        </Box>
      </Box>
      {children}
    </Box>
  )
}

/**
 * The viewer's own blend weights, in place of the admin's. Off by default, and
 * under Advanced: the weights only mean anything relative to each other, and
 * the defaults are what the admin tuned for this library.
 */
export function CustomWeightsCard({ mediaTypes }: { mediaTypes: MediaType[] }) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const userId = user?.id
  const [settings, setSettings] = useState<AlgorithmSettings>({ enabled: false })
  const [defaults, setDefaults] = useState<Record<MediaType, AlgorithmWeights> | null>(null)
  const [type, setType] = useState<MediaType>(mediaTypes[0] ?? 'movie')
  const [local, setLocal] = useState<AlgorithmWeights | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSave = useRef<(() => Promise<void>) | null>(null)
  // What that waiting save would send, so a switch change can carry it in the same request.
  const pendingBody = useRef<Record<string, AlgorithmWeights> | null>(null)

  const load = useCallback(async () => {
    if (!userId) return
    try {
      const response = await fetch(`/api/users/${userId}/algorithm-settings`, { credentials: 'include' })
      if (!response.ok) throw new Error()
      const data = (await response.json()) as { settings: AlgorithmSettings; defaults: Record<MediaType, AlgorithmWeights> }
      setSettings(data.settings)
      setDefaults(data.defaults)
    } catch {
      setError(t('algorithmSettings.errFetchSettings'))
    }
  }, [t, userId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!mediaTypes.includes(type)) setType(mediaTypes[0] ?? 'movie')
  }, [mediaTypes, type])

  useEffect(() => {
    // Not while an edit is waiting to be sent: the answer to an earlier save
    // would put the sliders back under the viewer's hand.
    if (defaults && !pendingSave.current) setLocal(resolveWeights(settings, defaults, type))
  }, [defaults, settings, type])

  // A change still waiting out the delay is saved now rather than dropped:
  // when the card goes away, and before switching media type, since the next
  // change on the other type would otherwise clear its timer.
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    void pendingSave.current?.()
  }, [])

  /** Forget a change still waiting: a reset supersedes it, and a switch change sends it itself. */
  const discardPending = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    pendingSave.current = null
    pendingBody.current = null
  }

  /**
   * One request for the switch and any edit still waiting. Two would race:
   * the route reads the stored settings and merges, so whichever finished
   * second would write back the other's old values.
   */
  const setEnabled = (enabled: boolean) => {
    const waiting = pendingBody.current
    discardPending()
    void patch({ ...waiting, enabled })
  }

  useEffect(() => flush, [flush])

  const patch = useCallback(
    async (body: Record<string, unknown>) => {
      if (!userId) return
      setSaving(true)
      setError(null)
      try {
        const response = await fetch(`/api/users/${userId}/algorithm-settings`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body),
        })
        const data = (await response.json().catch(() => ({}))) as { settings?: AlgorithmSettings; error?: string }
        if (!response.ok) throw new Error(data.error || t('algorithmSettings.errSaveSettings'))
        if (data.settings) setSettings(data.settings)
      } catch (e) {
        setError(e instanceof Error ? e.message : t('algorithmSettings.errSaveWeights'))
      } finally {
        setSaving(false)
      }
    },
    [t, userId]
  )

  const change = (key: keyof AlgorithmWeights, value: number) => {
    if (!local) return
    const next = { ...local, [key]: value }
    setLocal(next)
    if (timer.current) clearTimeout(timer.current)
    // No `enabled` here: the route keeps the stored value when it is absent.
    // Sending `enabled: true` with every weight meant that switching the
    // weights off inside the save delay was undone by the save that followed.
    const body = { [type]: next }
    const run = () => {
      pendingSave.current = null
      pendingBody.current = null
      return patch(body)
    }
    pendingSave.current = run
    pendingBody.current = body
    timer.current = setTimeout(() => void run(), SAVE_DELAY_MS)
  }

  const reset = async () => {
    if (!userId) return
    discardPending()
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/users/${userId}/algorithm-settings/reset`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!response.ok) throw new Error()
      await load()
    } catch {
      setError(t('algorithmSettings.errReset'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsCard
      icon={<TuneIcon />}
      title={
        <>
          {t('userSettings.recs.customWeightsTitle')}{' '}
          <HelpHint doc="user-settings/recommendations" anchor="use-my-own-weights" />
        </>
      }
      description={t('algorithmSettings.masterSubtitle')}
      action={
        <Switch
          checked={settings.enabled}
          disabled={!defaults || saving}
          onChange={(e) => setEnabled(e.target.checked)}
          slotProps={{ input: { 'aria-label': t('userSettings.recs.customWeightsTitle') } }}
        />
      }
      footer={settings.enabled ? t('algorithmSettings.autoSaveFooter') : undefined}
    >
      {error && (
        <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {settings.enabled && local && defaults && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
            <MediaTypeToggle
              value={type}
              options={mediaTypes}
              onChange={(next) => {
                flush()
                setType(next)
              }}
            />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ml: 'auto' }}>
              {saving && <CircularProgress size={16} />}
              <Button size="small" variant="outlined" startIcon={<RestartAltIcon />} onClick={() => void reset()} disabled={saving}>
                {t('userSettings.resetToDefaults')}
              </Button>
            </Box>
          </Box>
          <Typography variant="caption" color="text.secondary">
            {t('algorithmSettings.weightTipNormal')}
          </Typography>
          {BLEND_KEYS.map((key) => {
            const value = local[key]
            const fallback = defaults[type][key]
            return (
              <WeightRow
                key={key}
                label={t(BLEND_LABEL_KEYS[key].label)}
                help={t(BLEND_LABEL_KEYS[key].description)}
                display={`${Math.round(value * 100)}%`}
                defaultDisplay={
                  Math.abs(value - fallback) > 0.01
                    ? t('algorithmSettings.defaultPercent', { percent: Math.round(fallback * 100) })
                    : null
                }
              >
                <Slider
                  size="small"
                  value={value}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(_, v) => change(key, v as number)}
                  valueLabelDisplay="auto"
                  valueLabelFormat={(v) => `${Math.round(v * 100)}%`}
                  slotProps={{ input: { 'aria-label': t(BLEND_LABEL_KEYS[key].label) } }}
                />
              </WeightRow>
            )
          })}
          <WeightRow
            label={t('algorithmSettings.recentWatchLimit')}
            help={t('algorithmSettings.recentWatchTooltip')}
            display={t('algorithmSettings.itemsCount', { count: local.recentWatchLimit })}
            defaultDisplay={
              local.recentWatchLimit !== defaults[type].recentWatchLimit
                ? t('algorithmSettings.defaultValue', { value: defaults[type].recentWatchLimit })
                : null
            }
          >
            <Slider
              size="small"
              value={local.recentWatchLimit}
              min={10}
              max={200}
              step={10}
              onChange={(_, v) => change('recentWatchLimit', v as number)}
              valueLabelDisplay="auto"
              slotProps={{ input: { 'aria-label': t('algorithmSettings.recentWatchLimit') } }}
            />
          </WeightRow>
        </Box>
      )}
    </SettingsCard>
  )
}
