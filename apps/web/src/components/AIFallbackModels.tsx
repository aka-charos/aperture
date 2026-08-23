/**
 * Spare models for a role, tried in order when the primary cannot be reached.
 *
 * WHY A LIST OF MODELS AND NOT MORE KEYS. `fallbackApiKeys` answers "this
 * account is out of quota"; this answers "this model is gone". Measured live on
 * this instance: a `:free` OpenRouter model had exactly one upstream endpoint,
 * its provider deranked it, and every call came back 404 with an empty body and
 * `isRetryable: false`. No key and no amount of waiting fixes that — and a
 * `:free` variant usually has a single endpoint, so "the model I picked has
 * been withdrawn" is ordinary rather than exotic.
 *
 * Each row carries its own provider so a cloud role can fall back to a local
 * server: that survives the provider being down, not merely the model. No key
 * is asked for — credentials are resolved per provider server-side, from the
 * same shared store the primary uses when its own key is blank. Asking here
 * would make a spare model a second place to keep a credential.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Box,
  Button,
  FormControl,
  FormHelperText,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'

import { PROVIDER_INFO, type FallbackModelConfig, type ProviderType } from './aiProviderInfo'

interface ProviderOption {
  id: ProviderType
  name: string
}

interface ModelOption {
  id: string
  name?: string
}

export interface AIFallbackModelsProps {
  /** Which role these belong to — decides which models each provider offers. */
  functionType: string
  /** `/api/settings/ai` normally, `/api/setup/ai` during first-run. */
  apiBase: string
  value: FallbackModelConfig[]
  onChange: (next: FallbackModelConfig[]) => void
  /** The providers this role may use, from the card that already fetched them. */
  providers: ProviderOption[]
  /** The primary, so a row can warn when it merely repeats it. */
  primary: { provider: ProviderType; model: string }
}

/**
 * One row: a provider and one of its models.
 *
 * Its own model list, fetched per provider, because the whole point is that a
 * fallback may sit somewhere the primary does not. The list is advisory — the
 * value is a free-text id server-side — so a fetch that fails leaves the row
 * usable rather than empty.
 */
function FallbackRow({
  entry,
  index,
  apiBase,
  functionType,
  providers,
  duplicate,
  onChange,
  onRemove,
}: {
  entry: FallbackModelConfig
  index: number
  apiBase: string
  functionType: string
  providers: ProviderOption[]
  duplicate: boolean
  onChange: (next: FallbackModelConfig) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const [models, setModels] = useState<ModelOption[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`${apiBase}/models?provider=${entry.provider}&function=${functionType}`, {
      credentials: 'include',
    })
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setModels(data.models || [])
      })
      .catch(() => {
        if (!cancelled) setModels([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [entry.provider, functionType, apiBase])

  // A provider with no catalogue of its own (OpenRouter, LM Studio, Hugging
  // Face ship none — every model is operator-entered) would otherwise render an
  // empty dropdown and look broken. The stored id is always offered back, so a
  // saved fallback survives a catalogue that cannot list it.
  const options = models.some((m) => m.id === entry.model) || !entry.model
    ? models
    : [{ id: entry.model, name: entry.model }, ...models]

  return (
    <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ mb: 1 }}>
      <FormControl size="small" sx={{ minWidth: 140 }}>
        <InputLabel>{t('aiFunctionCard.fallbackModelProvider')}</InputLabel>
        <Select
          value={entry.provider}
          label={t('aiFunctionCard.fallbackModelProvider')}
          onChange={(e) =>
            // The model belongs to the old provider, so it is cleared rather
            // than carried across — a leftover id on a new provider is a
            // fallback that resolves to nothing at the moment it is needed.
            onChange({ provider: e.target.value as ProviderType, model: '' })
          }
        >
          {providers.map((p) => (
            <MenuItem key={p.id} value={p.id}>
              {PROVIDER_INFO[p.id]?.name ?? p.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl size="small" fullWidth error={duplicate}>
        <InputLabel>{t('aiFunctionCard.fallbackModelLabel', { number: index + 1 })}</InputLabel>
        <Select
          value={entry.model}
          label={t('aiFunctionCard.fallbackModelLabel', { number: index + 1 })}
          onChange={(e) => onChange({ ...entry, model: e.target.value })}
        >
          {options.length === 0 && (
            <MenuItem value="" disabled>
              {loading
                ? t('aiFunctionCard.loadingModels')
                : t('aiFunctionCard.fallbackModelNoModels')}
            </MenuItem>
          )}
          {options.map((m) => (
            <MenuItem key={m.id} value={m.id}>
              {m.name || m.id}
            </MenuItem>
          ))}
        </Select>
        {duplicate && (
          <FormHelperText>{t('aiFunctionCard.fallbackModelDuplicate')}</FormHelperText>
        )}
      </FormControl>

      <IconButton onClick={onRemove} size="small" aria-label={t('aiFunctionCard.removeFallbackModel')}>
        <DeleteIcon fontSize="small" />
      </IconButton>
    </Stack>
  )
}

export function AIFallbackModels({
  functionType,
  apiBase,
  value,
  onChange,
  providers,
  primary,
}: AIFallbackModelsProps) {
  const { t } = useTranslation()

  const seen = new Set<string>([`${primary.provider}:${primary.model}`])
  const duplicates = value.map((entry) => {
    const key = `${entry.provider}:${entry.model}`
    const isDuplicate = Boolean(entry.model) && seen.has(key)
    seen.add(key)
    return isDuplicate
  })

  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        {t('aiFunctionCard.fallbackModelsTitle')}
      </Typography>

      {value.map((entry, i) => (
        <FallbackRow
          key={i}
          entry={entry}
          index={i}
          apiBase={apiBase}
          functionType={functionType}
          providers={providers}
          duplicate={duplicates[i]}
          onChange={(next) => onChange(value.map((e, j) => (j === i ? next : e)))}
          onRemove={() => onChange(value.filter((_, j) => j !== i))}
        />
      ))}

      <Button
        size="small"
        startIcon={<AddIcon />}
        onClick={() =>
          // Seeded with the primary's provider: the commonest fallback is
          // another model on the same account, and it is one click from there
          // to anywhere else.
          onChange([...value, { provider: primary.provider, model: '' }])
        }
      >
        {t('aiFunctionCard.addFallbackModel')}
      </Button>
      <FormHelperText>{t('aiFunctionCard.fallbackModelsHelp')}</FormHelperText>
    </Box>
  )
}
