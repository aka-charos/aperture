import { useEffect, useState } from 'react'
import { Box, Button, CircularProgress, MenuItem, Stack, TextField } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { PlacementFields } from '@/components/homeSections/PlacementFields'
import {
  describePlacement,
  isPlacementComplete,
  type FeaturePlacementValue,
  type HomeRowOption,
  type PlacementValue,
} from '@/components/homeSections/placement'
import type { InstantOutcome } from './types'

interface PlacementEditorProps {
  feature: string
  defaultPlacement: FeaturePlacementValue
  override: PlacementValue | null
  anchors: HomeRowOption[]
  modes: string[]
  maxPosition: number
  disabled?: boolean
  /** Called after a save, with what the server answered. */
  onSaved: (outcome: InstantOutcome | null, error?: string) => void
}

/**
 * Where one kind of row goes on this viewer's home screen: the admin's default,
 * or a placement of their own anchored to a row on their own screen. Applying
 * moves the row at once.
 */
export function PlacementEditor({
  feature,
  defaultPlacement,
  override,
  anchors,
  modes,
  maxPosition,
  disabled = false,
  onSaved,
}: PlacementEditorProps) {
  const { t } = useTranslation()
  /** null = use the default. */
  const [draft, setDraft] = useState<PlacementValue | null>(override)
  const [busy, setBusy] = useState(false)

  // A reload after any change on the page brings a fresh override; follow it.
  useEffect(() => setDraft(override), [override])

  const changed = JSON.stringify(draft) !== JSON.stringify(override)
  const ready = draft === null || isPlacementComplete(draft)

  const apply = async () => {
    setBusy(true)
    try {
      const response = await fetch(`/api/home-sections/me/placements/${feature}`, {
        method: draft ? 'PUT' : 'DELETE',
        headers: draft ? { 'Content-Type': 'application/json' } : undefined,
        credentials: 'include',
        body: draft ? JSON.stringify(draft) : undefined,
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || t('userSettings.homeScreen.saveFailed'))
      onSaved((data.outcome ?? null) as InstantOutcome | null)
    } catch (e) {
      onSaved(null, e instanceof Error ? e.message : t('userSettings.homeScreen.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'flex-start' }}>
      <TextField
        select
        size="small"
        value={draft ? 'own' : 'default'}
        disabled={disabled}
        sx={{ minWidth: 220 }}
        label={t('userSettings.homeScreen.placement')}
        onChange={(e) =>
          setDraft(
            e.target.value === 'own'
              ? { mode: defaultPlacement.mode, position: defaultPlacement.position, anchor: null }
              : null
          )
        }
      >
        <MenuItem value="default">
          {t('userSettings.homeScreen.useDefault', { placement: describePlacement(t, defaultPlacement) })}
        </MenuItem>
        <MenuItem value="own">{t('userSettings.homeScreen.chooseOwn')}</MenuItem>
      </TextField>

      {draft && (
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <PlacementFields
            idPrefix={`my-home-${feature}`}
            value={draft}
            onChange={setDraft}
            modes={modes}
            rows={anchors}
            maxPosition={maxPosition}
            disabled={disabled}
          />
        </Box>
      )}

      <Button
        variant="outlined"
        onClick={() => void apply()}
        disabled={disabled || !changed || !ready || busy}
        sx={{ alignSelf: { xs: 'flex-start', md: 'center' } }}
      >
        {busy ? <CircularProgress size={18} /> : t('userSettings.homeScreen.apply')}
      </Button>
    </Stack>
  )
}
