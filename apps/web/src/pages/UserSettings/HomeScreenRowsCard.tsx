import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  Grid,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import HomeIcon from '@mui/icons-material/Home'
import { useTranslation } from 'react-i18next'
import { PlacementFields } from '@/components/homeSections/PlacementFields'
import {
  describePlacement,
  isPlacementComplete,
  type FeaturePlacementValue,
  type HomeRowOption,
  type PlacementValue,
} from '@/components/homeSections/placement'

interface HomeScreenFeature {
  feature: string
  rowName: string | null
  defaultPlacement: FeaturePlacementValue
  override: PlacementValue | null
}

interface HomeScreenSettings {
  available: boolean
  features: HomeScreenFeature[]
  rows: HomeRowOption[]
  rowsUnavailable: boolean
  maxPosition: number
  modes: string[]
}

type Notice = { severity: 'success' | 'info' | 'error'; text: string }

/**
 * Where the rows Aperture adds to this viewer's Emby home screen go.
 *
 * Only features that actually reach the viewer are listed, so this renders its
 * own Grid item — or nothing at all, rather than an empty column. A row left on
 * the default follows whatever the admin sets; choosing one's own anchors to a
 * row on this viewer's home screen. Applying moves the row at once.
 */
export function HomeScreenRowsCard() {
  const { t } = useTranslation()
  const [settings, setSettings] = useState<HomeScreenSettings | null>(null)
  /** null = use the default. */
  const [drafts, setDrafts] = useState<Record<string, PlacementValue | null>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/home-sections/me', { credentials: 'include' })
      if (!response.ok) return
      const data = (await response.json()) as HomeScreenSettings
      setSettings(data)
      setDrafts(Object.fromEntries(data.features.map((f) => [f.feature, f.override])))
    } catch {
      // A card that cannot load is left out rather than shown broken.
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (!settings?.available || settings.features.length === 0) return null

  const apply = async (feature: HomeScreenFeature) => {
    const draft = drafts[feature.feature] ?? null
    setBusy(feature.feature)
    setNotice(null)
    try {
      const response = await fetch(`/api/home-sections/me/placements/${feature.feature}`, {
        method: draft ? 'PUT' : 'DELETE',
        headers: draft ? { 'Content-Type': 'application/json' } : undefined,
        credentials: 'include',
        body: draft ? JSON.stringify(draft) : undefined,
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || t('userSettings.homeScreen.saveFailed'))

      const placement = (data.placement ?? null) as PlacementValue | null
      setSettings((prev) =>
        prev
          ? {
              ...prev,
              features: prev.features.map((f) => (f.feature === feature.feature ? { ...f, override: placement } : f)),
            }
          : prev
      )
      setDrafts((prev) => ({ ...prev, [feature.feature]: placement }))
      setNotice(
        data.outcome?.applied
          ? { severity: 'success', text: t('userSettings.homeScreen.applied') }
          : { severity: 'info', text: t('userSettings.homeScreen.savedLater') }
      )
    } catch (e) {
      setNotice({
        severity: 'error',
        text: e instanceof Error ? e.message : t('userSettings.homeScreen.saveFailed'),
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Grid item xs={12}>
      <Card sx={{ backgroundColor: 'background.default', borderRadius: 2 }}>
        <CardContent>
          <Box display="flex" alignItems="center" gap={1} mb={1}>
            <HomeIcon color="primary" />
            <Typography variant="h6">{t('userSettings.homeScreen.title')}</Typography>
          </Box>
          <Typography variant="body2" color="text.secondary" mb={2}>
            {t('userSettings.homeScreen.subtitle')}
          </Typography>

          {settings.rowsUnavailable && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {t('userSettings.homeScreen.rowsUnavailable')}
            </Alert>
          )}
          {notice && (
            <Alert severity={notice.severity} sx={{ mb: 2 }} onClose={() => setNotice(null)}>
              {notice.text}
            </Alert>
          )}

          <Stack spacing={2.5} divider={<Divider flexItem />}>
            {settings.features.map((feature) => {
              const draft = drafts[feature.feature] ?? null
              const changed = JSON.stringify(draft) !== JSON.stringify(feature.override)
              const ready = draft === null || isPlacementComplete(draft)
              return (
                <Box key={feature.feature}>
                  <Typography variant="body2" fontWeight={500}>
                    {t(`homeScreenPlacement.features.${feature.feature}`)}
                  </Typography>
                  {feature.rowName && (
                    <Typography variant="caption" color="text.secondary" component="p">
                      {feature.rowName}
                    </Typography>
                  )}

                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mt: 1.5 }} alignItems={{ md: 'flex-start' }}>
                    <TextField
                      select
                      size="small"
                      value={draft ? 'own' : 'default'}
                      sx={{ minWidth: 240 }}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [feature.feature]:
                            e.target.value === 'own'
                              ? {
                                  mode: feature.defaultPlacement.mode,
                                  position: feature.defaultPlacement.position,
                                  anchor: null,
                                }
                              : null,
                        }))
                      }
                    >
                      <MenuItem value="default">
                        {t('userSettings.homeScreen.useDefault', {
                          placement: describePlacement(t, feature.defaultPlacement),
                        })}
                      </MenuItem>
                      <MenuItem value="own">{t('userSettings.homeScreen.chooseOwn')}</MenuItem>
                    </TextField>

                    {draft && (
                      <Box sx={{ flex: 1 }}>
                        <PlacementFields
                          idPrefix={`my-home-${feature.feature}`}
                          value={draft}
                          onChange={(next) => setDrafts((prev) => ({ ...prev, [feature.feature]: next }))}
                          modes={settings.modes}
                          rows={settings.rows}
                          maxPosition={settings.maxPosition}
                        />
                      </Box>
                    )}

                    <Button
                      variant="outlined"
                      onClick={() => void apply(feature)}
                      disabled={!changed || !ready || busy !== null}
                      sx={{ alignSelf: { xs: 'flex-start', md: 'center' } }}
                    >
                      {busy === feature.feature ? <CircularProgress size={18} /> : t('userSettings.homeScreen.apply')}
                    </Button>
                  </Stack>
                </Box>
              )
            })}
          </Stack>
        </CardContent>
      </Card>
    </Grid>
  )
}
