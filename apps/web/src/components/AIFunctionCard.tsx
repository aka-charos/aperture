/**
 * Shared AI Function Configuration Card
 * Used in both Admin Settings and Setup Wizard
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Box,
  Typography,
  Card,
  CardContent,
  TextField,
  Button,
  Select,
  MenuItem,
  FormControl,
  FormHelperText,
  InputLabel,
  InputAdornment,
  IconButton,
  Alert,
  AlertTitle,
  Chip,
  CircularProgress,
  Link,
  alpha,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  ListItemSecondaryAction,
  Checkbox,
  FormControlLabel,
  Tooltip,
} from '@mui/material'
import {
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  CheckCircle as CheckCircleIcon,
  Cloud as CloudIcon,
  Computer as ComputerIcon,
  Warning as WarningIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
  Refresh as RefreshIcon,
  InfoOutlined as InfoOutlinedIcon,
} from '@mui/icons-material'
import {
  PROVIDER_INFO,
  embeddingInputTypeOptions,
  PROVIDERS_WITH_INPUT_TYPE,
  ROLES_WITH_REASONING_EFFORT,
  reasoningEffortOptions,
  reasoningEffortLabelKey,
  OPENROUTER_UPSTREAMS,
  type EmbeddingInputTypeValue,
  type FallbackModelConfig,
  type FunctionConfig,
  type ProviderInfo,
  type ProviderType,
} from './aiProviderInfo'
import { AIFallbackModels } from './AIFallbackModels'

/**
 * Pacing bounds, mirroring core's `MAX_CALL_SPACING_SECONDS`.
 *
 * Duplicated rather than imported because the web bundle never imports
 * `@aperture/core` — server code would break it. The server clamps to the same
 * ceiling, so a drift here costs a slider range, never a wrong stored value.
 */
const MAX_PACING_SECONDS = 3600
const DEFAULT_PACING_SECONDS = 60

export type AIFunction =
  | 'embeddings'
  | 'chat'
  | 'textGeneration'
  | 'exploration'
  | 'webSearch'
  | 'titleAnalysis'

export interface ModelInfo {
  id: string
  name: string
  description?: string
  contextWindow?: string
  embeddingDimensions?: number
  inputCostPerMillion?: number
  outputCostPerMillion?: number
  /** Retrieval mode this model should use here; absent when its default is right. */
  recommendedInputType?: EmbeddingInputTypeValue
  /** Why that is the recommendation — or, when there is none, why none is needed. */
  inputTypeNote?: string
  /** How the mode reaches the model; absent means a request parameter. */
  inputTypeMechanism?: 'parameter' | 'textPrefix'
  /** How this model takes a reasoning effort; absent means it takes none. */
  reasoningMechanism?: 'effort' | 'thinkingLevel'
  /**
   * The effort words THIS model accepts, weakest first, resolved server-side —
   * live from OpenRouter's catalog, or the SDK's fixed enum for native Google.
   * Absent means offer no control.
   */
  supportedEfforts?: readonly string[]
  capabilities: {
    supportsToolCalling: boolean
    supportsEmbeddings: boolean
  }
  isCustom?: boolean
}

/**
 * The answer to a connection test.
 *
 * `embeddingDimensions` is MEASURED — the width of the vector the model
 * actually returned — because a local server publishes that number nowhere and
 * it decides which `embeddings_<n>` table every read goes to. Guessing it
 * points the library at an empty table and nothing errors.
 */
interface TestResult {
  success: boolean
  error?: string
  embeddingDimensions?: number
  /** Whether that width has a table to live in. Decided server-side. */
  embeddingDimensionsSupported?: boolean
}

/** One model a local server reports having installed. */
export interface DiscoveredModel {
  id: string
  name: string
  description?: string
  contextWindow?: string
  /** LM Studio loads on demand, so not-loaded is still usable — this only says
   *  which one answers instantly. Absent when the server did not say. */
  loaded?: boolean
  capabilities: {
    supportsToolCalling: boolean
    supportsEmbeddings: boolean
  }
}

/**
 * What an LM Studio server says about itself. A test rather than a ping: the
 * counts are what tell an operator the role they are configuring has nothing
 * suitable installed, which reachability alone cannot.
 */
export interface LmStudioStatus {
  reachable: boolean
  /** Which REST API generation answered, so an old server is visible. */
  api?: 'v1' | 'v0'
  totalModels: number
  languageModels: number
  embeddingModels: number
  loaded: { modelId: string; contextLength?: number }[]
  error?: string
}

/**
 * An explanation that is worth having and not worth reading twice.
 *
 * Several controls here need a paragraph of reasoning behind a one-line label —
 * why pacing exists, what LM Studio's Auto-Evict does to a second role. Printed
 * inline, those paragraphs are longer than the settings they describe and the
 * card becomes something to scroll past rather than read. Behind an icon they
 * are still one gesture away.
 *
 * A Tooltip rather than a Popover because it needs no dismissal, and on an
 * `IconButton` rather than a bare icon so it is reachable by keyboard focus and
 * by long-press on a touch screen, where there is no hover at all.
 */
function InfoHint({ title }: { title: React.ReactNode }) {
  return (
    <Tooltip
      title={<Box sx={{ p: 0.5, whiteSpace: 'pre-line' }}>{title}</Box>}
      enterTouchDelay={0}
      leaveTouchDelay={8000}
      slotProps={{ tooltip: { sx: { maxWidth: 360 } } }}
    >
      <IconButton size="small" sx={{ p: 0.25, color: 'text.secondary' }}>
        <InfoOutlinedIcon sx={{ fontSize: 16 }} />
      </IconButton>
    </Tooltip>
  )
}

interface DiscoveryResponse {
  /**
   * False when the catalog could not be read at all. Kept separate from an
   * empty `models` because "nothing installed" and "wrong address" are opposite
   * problems with opposite fixes.
   */
  reachable: boolean
  models: DiscoveredModel[]
  /** Installed models this role cannot use, with a reason key to translate. */
  skipped: { id: string; reason: 'wrongType' | 'noToolCalling' }[]
}

/**
 * Format a model's published price per 1M tokens for the picker, straight from
 * the catalog's structured cost fields (the single source of truth the Cost
 * Estimator also uses). Returns null when there is no published price — custom
 * and local (Ollama / OpenAI-compatible) models — so no price line is shown.
 */
function formatModelPrice(m: ModelInfo): string | null {
  const input = m.inputCostPerMillion
  if (input == null) return null
  const output = m.outputCostPerMillion
  if (input === 0 && (output == null || output === 0)) return 'Free'
  const usd = (n: number) => `$${n.toFixed(2)}`
  // Embedding models are billed on input tokens only (no output cost).
  if (output == null) return `${usd(input)} per 1M tokens`
  return `${usd(input)} in / ${usd(output)} out per 1M`
}

/** Compact per-item capability badge for the model picker listing */
function ToolCallingBadge({ label }: { label: string }) {
  return (
    <Chip
      label={label}
      size="small"
      color="success"
      variant="outlined"
      sx={{ height: 18, fontSize: '0.65rem', flexShrink: 0, '& .MuiChip-label': { px: 0.75 } }}
    />
  )
}

export interface AIFunctionCardProps {
  functionType: AIFunction
  title: string
  description: string
  icon: React.ReactNode
  iconColor: string
  config: FunctionConfig | null
  onSave: (config: FunctionConfig) => Promise<void>
  requiredCapability?: 'toolCalling' | 'embeddings'
  compact?: boolean // For wizard mode
  isSetup?: boolean // Use unauthenticated /api/setup/* endpoints during first-run
  /** Offer a second API key, used when the first one runs out of quota. */
  supportsFallbackKey?: boolean
  /**
   * Offer spare MODELS and a free-tier pacing delay.
   *
   * Separate from `supportsFallbackKey` because the two answer different
   * questions — a spare key covers an exhausted account, a spare model covers a
   * withdrawn endpoint — and because only a role whose consumer actually walks
   * the list may show one. A setting that does nothing is worse than an absent
   * one, so this is opt-in per card rather than on for every role.
   */
  supportsFallbackModels?: boolean
  /** Extra content rendered just above the Test/Save buttons (e.g. a usage meter). */
  footer?: React.ReactNode
}

export function AIFunctionCard({
  functionType,
  title,
  description,
  icon,
  iconColor,
  config,
  onSave,
  requiredCapability,
  compact = false,
  isSetup = false,
  supportsFallbackKey = false,
  supportsFallbackModels = false,
  footer,
}: AIFunctionCardProps) {
  const { t } = useTranslation()
  // Use setup endpoints during first-run (no auth), settings endpoints after
  const apiBase = isSetup ? '/api/setup/ai' : '/api/settings/ai'

  const ollamaNoteLabel = (note: string | null) => {
    if (!note) return null
    const key: Record<string, string> = {
      recommended: 'recommended',
      'higher quality': 'higherQuality',
      multilingual: 'multilingual',
      'best for tools': 'bestForTools',
      fast: 'fast',
      'small & capable': 'smallCapable',
    }
    const k = key[note]
    return k ? t(`aiFunctionCard.ollamaNotes.${k}`) : note
  }
  
  const [loadingProviders, setLoadingProviders] = useState(true)
  const [loading, setLoading] = useState(false)
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [models, setModels] = useState<ModelInfo[]>([])
  
  // Form state
  const [provider, setProvider] = useState<ProviderType>(config?.provider || 'openai')
  const [model, setModel] = useState(config?.model || '')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl || '')
  const [showApiKey, setShowApiKey] = useState(false)
  const [initialized, setInitialized] = useState(false)

  // Spare keys, tried in order when the one above runs out of quota. Seeded
  // from what is stored and sent back whole on every save, so editing one key
  // cannot silently drop the others. Rendered as password fields — the values
  // are real, not masked placeholders, which is what lets a save round-trip.
  const [fallbackKeys, setFallbackKeys] = useState<string[]>([])
  const [showFallbackKeys, setShowFallbackKeys] = useState(false)
  /** Whether the meter may assume Google's free-tier ceilings. See the checkbox below. */
  const [freeTier, setFreeTier] = useState(true)

  // Spare models, and the pacing delay that goes with a free-tier account.
  const [fallbackModels, setFallbackModels] = useState<FallbackModelConfig[]>([])
  /**
   * Pacing is ONE stored number, not a flag plus a number.
   *
   * 0 means off, so the checkbox is derived from the value rather than stored
   * beside it — this codebase has been burned repeatedly by two places holding
   * one answer, and a flag that can disagree with its own number is exactly
   * that shape. `pacingDraft` is local only: it remembers what was typed so
   * unticking and re-ticking does not throw away a tuned value.
   */
  const [pacingSeconds, setPacingSeconds] = useState(0)
  const [pacingDraft, setPacingDraft] = useState(DEFAULT_PACING_SECONDS)

  /**
   * Retrieval mode for the Embeddings role. '' is the provider default, which
   * is where every already-embedded vector lives.
   */
  const [inputType, setInputType] = useState<EmbeddingInputTypeValue | ''>('')

  /** Pinned OpenRouter upstream; '' means let OpenRouter choose. */
  const [providerOnly, setProviderOnly] = useState('')
  const [reasoningEffort, setReasoningEffort] = useState('')

  // Custom model dialog state
  const [addModelDialogOpen, setAddModelDialogOpen] = useState(false)
  const [newModelName, setNewModelName] = useState('')
  const [newModelEmbeddingDimensions, setNewModelEmbeddingDimensions] = useState<number | ''>('')
  const [addingModel, setAddingModel] = useState(false)
  const [deletingModel, setDeletingModel] = useState<string | null>(null)
  const [dialogTesting, setDialogTesting] = useState(false)
  const [dialogTestResult, setDialogTestResult] = useState<TestResult | null>(null)

  /**
   * What a local server says it has installed.
   *
   * `null` means nobody has asked yet, which is not the same as an empty list —
   * and neither is the same as `reachable: false`. "Nothing installed" and
   * "wrong address" look identical in a dropdown and mean opposite things, so
   * the three states stay distinct all the way to the screen.
   */
  const [discovery, setDiscovery] = useState<DiscoveryResponse | null>(null)
  const [discovering, setDiscovering] = useState(false)
  const [serverStatus, setServerStatus] = useState<LmStudioStatus | null>(null)
  
  // Valid embedding dimensions. Hand-mirrored from core's
  // VALID_EMBEDDING_DIMENSIONS (the web bundle never imports core); each one
  // needs its embeddings_<n> tables to exist before it appears here.
  const VALID_EMBEDDING_DIMENSIONS = [256, 384, 512, 768, 1024, 1536, 2560, 3072, 4096]
  
  // Status
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null)
  
  const isConfigured = Boolean(config)
  const providerInfo = PROVIDER_INFO[provider]
  const selectedModel = models.find(m => m.id === model)
  const selectedModelPrice = selectedModel ? formatModelPrice(selectedModel) : null
  // Hand-mirrored from core's CUSTOM_MODEL_PROVIDERS (the web bundle never
  // imports core). A provider missing here has no "add a custom model" option
  // at all, which for a local server means no way to use it.
  const supportsCustomModels =
    provider === 'ollama' ||
    provider === 'lmstudio' ||
    provider === 'openai-compatible' ||
    provider === 'openrouter' ||
    provider === 'huggingface'

  /**
   * Whether this server can be asked what it has installed. Mirrors core's
   * `isDiscoverableProvider`: LM Studio publishes a catalog, and
   * `openai-compatible` might BE LM Studio, since it has shipped LM Studio's
   * port as its default base URL since before the named provider existed.
   */
  const supportsDiscovery = provider === 'lmstudio' || provider === 'openai-compatible'

  // Sync form state when config prop changes (e.g., loaded from DB)
  useEffect(() => {
    if (config && !initialized) {
      if (config.provider) setProvider(config.provider)
      if (config.model) setModel(config.model)
      if (config.baseUrl) setBaseUrl(config.baseUrl)
      setInitialized(true)
    }
  }, [config, initialized])

  // Reads the legacy single-key field too, so a role configured before the list
  // existed shows its spare key rather than appearing to have none.
  const storedFallbackKeys = useMemo(() => {
    const list = config?.fallbackApiKeys ?? []
    const legacy = config?.fallbackApiKey ? [config.fallbackApiKey] : []
    return [...list, ...legacy].filter((k) => k.trim().length > 0)
  }, [config?.fallbackApiKeys, config?.fallbackApiKey])

  useEffect(() => {
    setFallbackKeys(storedFallbackKeys)
  }, [storedFallbackKeys])

  // Absent means free tier — that is what an AI Studio key almost always is,
  // and it is the reading that shows a ceiling rather than hiding one.
  const storedFreeTier = config?.freeTier !== false
  useEffect(() => {
    setFreeTier(storedFreeTier)
  }, [storedFreeTier])

  const storedFallbackModels = useMemo(
    () => config?.fallbackModels ?? [],
    [config?.fallbackModels]
  )
  useEffect(() => {
    setFallbackModels(storedFallbackModels)
  }, [storedFallbackModels])

  // Note the direction: ABSENT means off. The opposite of `freeTier`, and
  // deliberately so — that flag only chooses a denominator for a meter, while
  // this one delays real work. Reading absence as "on" would start pacing every
  // already-configured role without anyone asking, including local models that
  // have no rate limit to respect.
  const storedPacing = config?.callSpacingSeconds ?? 0
  useEffect(() => {
    setPacingSeconds(storedPacing)
    if (storedPacing > 0) setPacingDraft(storedPacing)
  }, [storedPacing])

  // The retrieval mode. Offered only by the Embeddings role, and only on the
  // two providers that can actually send one — a mode stored where it cannot be
  // sent would leave the set identity naming a space nothing was embedded in.
  //
  // Derived from `functionType` rather than taking a prop like
  // `supportsFallbackModels` does, because this is a property of the role
  // itself, not of who happens to consume it.
  const storedInputType = config?.embeddingInputType ?? ''
  useEffect(() => {
    setInputType(storedInputType)
  }, [storedInputType])

  // ...and only for a MODEL that declares how it carries one. The modes on
  // offer are Google's taxonomy, and the control used to appear for every model
  // on a mode-capable provider — so picking Qwen or pplx-embed showed a Gemini
  // dropdown, and choosing from it demanded a Gemini upstream pin for a model
  // that reads neither. Worse than confusing: the mode rides in the set
  // identity whether or not it reaches the model, so it would have bought a
  // full re-embed storing byte-identical vectors under a second name.
  //
  // A stored mode keeps the control visible even if the model stops declaring
  // one, so it can be seen and cleared rather than stranded — the same reason
  // `embeddingInputTypeOptions` re-adds a current value that is off the list.
  const offersInputType =
    functionType === 'embeddings' &&
    PROVIDERS_WITH_INPUT_TYPE.includes(provider) &&
    (selectedModel?.inputTypeMechanism !== undefined || storedInputType !== '')

  // Reasoning effort. Offered only where it is both READ (the batch writing
  // roles) and TAKEN BY THIS MODEL — the server enforces both, and a control
  // that cannot save is a control that should not render.
  //
  // Keyed on the SELECTED MODEL, never the provider. Provider-level was the
  // first version of this and it was wrong in both directions: OpenRouter hosts
  // 124 models that do not reason at all and 140 more that reason without
  // taking an effort, while the models that do take one draw on 21 different
  // vocabularies. On native Google it offered `thinking_level` — a Gemini 3.x
  // field — for gemini-2.5 and gemini-1.5, where it is a 400.
  //
  // A stored value keeps the control visible even when the current model takes
  // none, so it can be seen and cleared rather than stranded — the same reason
  // `reasoningEffortOptions` re-adds an off-list current value.
  const storedReasoningEffort = config?.reasoningEffort ?? ''
  useEffect(() => {
    setReasoningEffort(storedReasoningEffort)
  }, [storedReasoningEffort])

  const modelEfforts = selectedModel?.supportedEfforts
  const offersReasoningEffort =
    ROLES_WITH_REASONING_EFFORT.includes(functionType) &&
    ((modelEfforts?.length ?? 0) > 0 || storedReasoningEffort !== '')

  const storedProviderOnly = config?.embeddingProviderOnly ?? ''
  useEffect(() => {
    setProviderOnly(storedProviderOnly)
  }, [storedProviderOnly])

  // A pin is only load-bearing for a mode delivered as a request parameter, and
  // the catalog is the only thing that says which. An absent mechanism is not
  // "parameter" — it is a model that carries no mode at all.
  const pinRequired =
    offersInputType &&
    provider === 'openrouter' &&
    inputType !== '' &&
    selectedModel?.inputTypeMechanism === 'parameter' &&
    providerOnly === ''


  // Check capability warning
  const hasCapabilityWarning = requiredCapability === 'toolCalling' && 
    selectedModel && !selectedModel.capabilities.supportsToolCalling
  const hasEmbeddingWarning = requiredCapability === 'embeddings' &&
    selectedModel && !selectedModel.capabilities.supportsEmbeddings

  // Fetch providers
  useEffect(() => {
    setLoadingProviders(true)
    fetch(`${apiBase}/providers?function=${functionType}`, { credentials: 'include' })
      .then(res => res.json())
      .then(data => setProviders(data.providers || Object.values(PROVIDER_INFO)))
      .catch(() => setProviders(Object.values(PROVIDER_INFO)))
      .finally(() => setLoadingProviders(false))
  }, [functionType, apiBase])

  // Load saved credentials for current provider on mount (if no apiKey in config)
  useEffect(() => {
    if (!config?.apiKey && provider) {
      fetch(`${apiBase}/credentials/${provider}`, { credentials: 'include' })
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data?.apiKey) setApiKey(data.apiKey)
          if (data?.baseUrl && !baseUrl) setBaseUrl(data.baseUrl)
        })
        .catch(() => {})
    }
  }, [apiBase, config?.apiKey, provider, baseUrl])

  // Fetch models when provider changes
  useEffect(() => {
    setLoading(true)
    fetch(`${apiBase}/models?provider=${provider}&function=${functionType}`, { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        setModels(data.models || [])
        // If we have a config model and it's in the list, keep it selected
        // Otherwise auto-select first model
        if (data.models?.length > 0) {
          const configModelExists = config?.model && data.models.find((m: ModelInfo) => m.id === config.model)
          if (configModelExists && !model) {
            setModel(config.model)
          } else if (!model || !data.models.find((m: ModelInfo) => m.id === model)) {
            setModel(data.models[0].id)
          }
        }
      })
      .catch(() => setModels([]))
      .finally(() => setLoading(false))
  }, [provider, functionType, config?.model, apiBase, model])

  // Set default base URL when switching providers
  useEffect(() => {
    if (providerInfo?.defaultBaseUrl && !baseUrl) {
      setBaseUrl(providerInfo.defaultBaseUrl)
    }
  }, [provider, baseUrl, providerInfo?.defaultBaseUrl])

  const handleProviderChange = useCallback(async (newProvider: ProviderType) => {
    setProvider(newProvider)
    setModel('')
    setTestResult(null)

    // Fetch saved credentials for this provider
    try {
      const res = await fetch(`${apiBase}/credentials/${newProvider}`, { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setApiKey(data.apiKey || '')
        setBaseUrl(data.baseUrl || PROVIDER_INFO[newProvider]?.defaultBaseUrl || '')
      } else {
        setApiKey('')
        setBaseUrl(PROVIDER_INFO[newProvider]?.defaultBaseUrl || '')
      }
    } catch {
      setApiKey('')
      setBaseUrl(PROVIDER_INFO[newProvider]?.defaultBaseUrl || '')
    }
  }, [apiBase])

  /**
   * A role can be restricted to a single provider — Web Search needs Google's
   * native search grounding, so Google is the only one offered. When the current
   * selection isn't on the list (an unconfigured card starts on the OpenAI
   * default), move to what is actually available, or the card would list another
   * provider's models and save a combination the server rejects.
   */
  useEffect(() => {
    if (loadingProviders || providers.length === 0) return
    if (providers.some((p) => p.id === provider)) return
    void handleProviderChange(providers[0].id)
  }, [loadingProviders, providers, provider, handleProviderChange])

  /** True when this role offers exactly one provider — then it's a label, not a choice. */
  const providerIsFixed = !loadingProviders && providers.length === 1
  const fixedProvider = providerIsFixed ? providers[0] : null

  /** Spare keys worth exercising: whatever is in the boxes, blanks dropped. */
  const effectiveFallbackKeys = fallbackKeys.map((k) => k.trim()).filter((k) => k.length > 0)

  // The tier question is Google's alone: it is the only provider whose free
  // tier this app meters, and the only one the usage panel is drawn for. A
  // Title Analysis card pointed at LM Studio should not be asked.
  const offersFreeTierToggle = supportsFallbackKey && provider === 'google'

  /**
   * Ask the local server about itself, with no model involved.
   *
   * Runs before the model test rather than instead of it: "LM Studio is
   * unreachable" and "this model failed" are different problems with different
   * fixes, and a single pass/fail that needs a model selected can only ever
   * report the second. From a container — the normal deployment — the usual
   * faults are an unresolvable host or a closed port, neither of which has
   * anything to do with a model.
   */
  const runServerCheck = useCallback(async (): Promise<LmStudioStatus | null> => {
    try {
      const res = await fetch(`${apiBase}/lmstudio/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ baseUrl: baseUrl || undefined, apiKey: apiKey || undefined }),
      })
      if (!res.ok) return null
      return (await res.json()) as LmStudioStatus
    } catch {
      return null
    }
  }, [apiBase, baseUrl, apiKey])

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    setServerStatus(null)
    try {
      // Stage one, for a server we can interrogate. A failure here is final —
      // testing a model against a server that is not there produces a second,
      // less informative error about the same fault.
      if (supportsDiscovery) {
        const status = await runServerCheck()
        setServerStatus(status)
        if (status && !status.reachable) {
          setTestResult({ success: false, error: status.error })
          return
        }
        // No model chosen is a perfectly good place to stop: the question was
        // whether the server is there, and now it is answered.
        if (!model) {
          setTestResult({ success: true })
          return
        }
      }

      const runTest = async (key: string | undefined) => {
        const res = await fetch(`${apiBase}/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            function: functionType,
            provider,
            model,
            apiKey: key || undefined,
            baseUrl: baseUrl || undefined,
          }),
        })
        return (await res.json()) as { success: boolean; error?: string }
      }

      const primary = await runTest(apiKey || undefined)
      if (!primary.success) {
        setTestResult(primary)
        return
      }

      // A spare key that doesn't work is worse than no spare at all — you find
      // out at the moment the main key runs out. Check them all here instead,
      // and stop at the first bad one so the message names a single fault.
      if (supportsFallbackKey) {
        for (const [i, key] of effectiveFallbackKeys.entries()) {
          const fallback = await runTest(key)
          if (!fallback.success) {
            setTestResult({
              success: false,
              error: t('aiFunctionCard.fallbackKeyFailed', {
                error: `#${i + 1}: ${fallback.error ?? ''}`,
              }),
            })
            return
          }
        }
      }

      setTestResult(primary)
    } catch {
      setTestResult({ success: false, error: t('aiFunctionCard.connectionFailed') })
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    const newConfig: FunctionConfig = {
      provider,
      model,
      apiKey: apiKey || undefined,
      baseUrl: baseUrl || undefined,
      // Always sent whole for roles that offer it — the boxes were seeded from
      // what is stored, so a round-trip preserves keys the admin didn't touch,
      // and clearing them all is expressible as an empty array.
      ...(supportsFallbackKey ? { fallbackApiKeys: effectiveFallbackKeys } : {}),
      // Only sent by the card that asks the question. Omitting it elsewhere is
      // what stops switching Title Analysis to a local model from silently
      // rewriting the tier it was told about its Google keys.
      ...(offersFreeTierToggle ? { freeTier } : {}),
      // Sent whole, like the spare keys and for the same reason: the rows were
      // seeded from what is stored, so a round-trip preserves what was not
      // touched and an empty array is how the list gets cleared. Rows with no
      // model chosen are dropped — a half-filled row is a fallback that
      // resolves to nothing at the moment it is finally needed.
      ...(supportsFallbackModels
        ? {
            fallbackModels: fallbackModels.filter((m) => m.model.trim().length > 0),
            callSpacingSeconds: pacingSeconds,
          }
        : {}),
      // Explicit `null` rather than omission when cleared: omitting means
      // "leave alone" server-side, so a mode could never be switched back off.
      // Sent only by the card showing the control — otherwise saving the
      // Embeddings card from a provider that cannot carry a mode would silently
      // drop one an admin set on a provider that can.
      ...(offersInputType ? { embeddingInputType: inputType || null } : {}),
      // Explicit null when cleared, and sent only by the card showing the
      // control — same rule as the embedding mode above, for the same reason.
      ...(offersReasoningEffort
        ? { reasoningEffort: (reasoningEffort || null) as FunctionConfig['reasoningEffort'] }
        : {}),
      ...(offersInputType && provider === 'openrouter'
        ? { embeddingProviderOnly: providerOnly || null }
        : {}),
    }

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await onSave(newConfig)
      setSuccess(t('aiFunctionCard.configSaved'))
      setApiKey('') // Clear for security
      // Spare keys stay in the form on purpose: they are a list the admin
      // manages, and blanking it after every save would make "how many do I
      // have?" unanswerable without a reload.
      setFallbackKeys(effectiveFallbackKeys)
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('aiFunctionCard.failedToSave'))
    } finally {
      setSaving(false)
    }
  }

  // Refresh models list
  const refreshModels = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${apiBase}/models?provider=${provider}&function=${functionType}`, { credentials: 'include' })
      const data = await res.json()
      setModels(data.models || [])
    } catch {
      // Ignore
    } finally {
      setLoading(false)
    }
  }, [apiBase, provider, functionType])

  /**
   * Ask the local server what it has installed.
   *
   * Sends the base URL and key as typed rather than as saved, because detecting
   * models is the step BEFORE saving a provider — requiring a save first would
   * put the button behind the problem it exists to solve.
   */
  const handleDiscoverModels = useCallback(async () => {
    setDiscovering(true)
    setDiscovery(null)
    try {
      const res = await fetch(`${apiBase}/models/discover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          provider,
          function: functionType,
          baseUrl: baseUrl || undefined,
          apiKey: apiKey || undefined,
        }),
      })
      const data = await res.json()
      setDiscovery(
        res.ok && typeof data?.reachable === 'boolean'
          ? { reachable: data.reachable, models: data.models ?? [], skipped: data.skipped ?? [] }
          : { reachable: false, models: [], skipped: [] }
      )
    } catch {
      setDiscovery({ reachable: false, models: [], skipped: [] })
    } finally {
      setDiscovering(false)
    }
  }, [apiBase, provider, functionType, baseUrl, apiKey])

  // Opening the dialog for a local server is the moment the question "which
  // models do I have?" is being asked, so answer it without a second click.
  // The probe is a metadata request to a machine on the operator's own network.
  useEffect(() => {
    if (addModelDialogOpen && supportsDiscovery && !discovery && !discovering) {
      void handleDiscoverModels()
    }
  }, [addModelDialogOpen, supportsDiscovery, discovery, discovering, handleDiscoverModels])

  // Test custom model in dialog
  const handleTestCustomModel = async () => {
    if (!newModelName.trim()) return

    setDialogTesting(true)
    setDialogTestResult(null)
    try {
      const res = await fetch(`${apiBase}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          function: functionType,
          provider,
          model: newModelName.trim(),
          apiKey: apiKey || undefined,
          baseUrl: baseUrl || undefined,
        }),
      })
      const data: TestResult = await res.json()
      setDialogTestResult(data)

      // The test embedded a string, so the vector's width is now known. Fill it
      // in rather than leaving the operator to guess the one number that
      // decides which table their library lives in — but only when it has a
      // table to live in, since offering an unsupported width would just move
      // the failure to the save.
      if (
        functionType === 'embeddings' &&
        data.success &&
        data.embeddingDimensions != null &&
        data.embeddingDimensionsSupported === true
      ) {
        setNewModelEmbeddingDimensions(data.embeddingDimensions)
      }
    } catch {
      setDialogTestResult({ success: false, error: t('aiFunctionCard.connectionFailed') })
    } finally {
      setDialogTesting(false)
    }
  }

  // Add custom model (only after successful test)
  const handleAddCustomModel = async () => {
    if (!newModelName.trim() || !dialogTestResult?.success) return
    // For embeddings, require dimension selection
    if (functionType === 'embeddings' && !newModelEmbeddingDimensions) return
    
    setAddingModel(true)
    setError(null)
    try {
      const res = await fetch(`${apiBase}/custom-models`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          provider,
          function: functionType,
          modelId: newModelName.trim(),
          ...(functionType === 'embeddings' && newModelEmbeddingDimensions && {
            embeddingDimensions: newModelEmbeddingDimensions,
          }),
        }),
      })
      
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || t('aiFunctionCard.failedAddCustom'))
      }
      
      // Refresh models list and select the new model
      await refreshModels()
      setModel(newModelName.trim())
      setAddModelDialogOpen(false)
      setNewModelName('')
      setNewModelEmbeddingDimensions('')
      setDialogTestResult(null)
      setSuccess(t('aiFunctionCard.customModelAdded', { name: newModelName.trim() }))
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('aiFunctionCard.failedAddCustom'))
    } finally {
      setAddingModel(false)
    }
  }
  
  // Close dialog and reset state
  const handleCloseDialog = () => {
    setAddModelDialogOpen(false)
    setNewModelName('')
    setNewModelEmbeddingDimensions('')
    setDialogTestResult(null)
    setDiscovery(null)
  }

  // Delete custom model
  const handleDeleteCustomModel = async (modelId: string, e: React.MouseEvent) => {
    e.stopPropagation() // Prevent selecting the model
    
    setDeletingModel(modelId)
    setError(null)
    try {
      const res = await fetch(`${apiBase}/custom-models`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          provider,
          function: functionType,
          modelId,
        }),
      })
      
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || t('aiFunctionCard.failedDeleteCustom'))
      }
      
      // If the deleted model was selected, clear selection
      if (model === modelId) {
        setModel('')
      }
      
      // Refresh models list
      await refreshModels()
      setSuccess(t('aiFunctionCard.customModelDeleted', { name: modelId }))
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('aiFunctionCard.failedDeleteCustom'))
    } finally {
      setDeletingModel(null)
    }
  }

  return (
    <Card 
      sx={{ 
        height: '100%',
        borderLeft: 4,
        borderColor: isConfigured ? 'success.main' : 'warning.main',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column', p: compact ? 2 : 3 }}>
        {/* Header */}
        <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
          <Box display="flex" alignItems="center" gap={2}>
            <Box
              sx={{
                p: 1,
                borderRadius: 2,
                bgcolor: alpha(iconColor, 0.1),
                color: iconColor,
                display: 'flex',
              }}
            >
              {icon}
            </Box>
            <Typography variant={compact ? 'subtitle1' : 'h6'} fontWeight={600}>
              {title}
            </Typography>
          </Box>
          {isConfigured ? (
            <Chip icon={<CheckCircleIcon />} label={t('aiFunctionCard.chipActive')} color="success" size="small" />
          ) : (
            <Chip icon={<WarningIcon />} label={t('aiFunctionCard.chipSetupRequired')} color="warning" size="small" />
          )}
        </Box>

        {/* Description */}
        <Typography variant="body2" color="text.secondary" mb={2}>
          {description}
        </Typography>

        {/* Alerts */}
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {success && (
          <Alert severity="success" sx={{ mb: 2 }}>
            {success}
          </Alert>
        )}

        {/* Provider & Model Selection */}
        <Box display="flex" flexDirection="column" gap={2} mb={2}>
          {fixedProvider ? (
            // One provider means there is nothing to choose. Show which one it is
            // and why, rather than a dropdown with a single entry.
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 1.5,
                py: 1,
                borderRadius: 1,
                border: 1,
                borderColor: 'divider',
                bgcolor: 'action.hover',
              }}
            >
              {PROVIDER_INFO[fixedProvider.id as ProviderType]?.logoPath ? (
                <Box
                  component="img"
                  src={PROVIDER_INFO[fixedProvider.id as ProviderType].logoPath}
                  alt={fixedProvider.name}
                  sx={{
                    width: 20,
                    height: 20,
                    objectFit: 'contain',
                    filter: (theme) =>
                      theme.palette.mode === 'dark' ? 'brightness(0) invert(1)' : 'none',
                  }}
                />
              ) : (
                <CloudIcon fontSize="small" />
              )}
              <Typography variant="body2" fontWeight={500}>
                {fixedProvider.name}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                {t('aiFunctionCard.onlyProvider')}
              </Typography>
            </Box>
          ) : (
          <FormControl size="small" fullWidth>
            <InputLabel>{t('aiFunctionCard.provider')}</InputLabel>
            <Select
              value={!loadingProviders && providers.length > 0 ? provider : ''}
              label={t('aiFunctionCard.provider')}
              onChange={(e) => handleProviderChange(e.target.value as ProviderType)}
              displayEmpty
              disabled={loadingProviders}
            >
              {loadingProviders && (
                <MenuItem value="" disabled>
                  <CircularProgress size={16} sx={{ mr: 1 }} /> {t('aiFunctionCard.loadingProviders')}
                </MenuItem>
              )}
              {[...providers].sort((a, b) => a.name.localeCompare(b.name)).map((p) => {
                const info = PROVIDER_INFO[p.id as ProviderType]
                return (
                  <MenuItem key={p.id} value={p.id}>
                    <Box display="flex" alignItems="center" gap={1}>
                      {info?.logoPath ? (
                        <Box
                          component="img"
                          src={info.logoPath}
                          alt={p.name}
                          sx={{ 
                            width: 20, 
                            height: 20, 
                            objectFit: 'contain',
                            filter: (theme) => theme.palette.mode === 'dark' ? 'brightness(0) invert(1)' : 'none',
                          }}
                        />
                      ) : p.type === 'self-hosted' ? (
                        <ComputerIcon fontSize="small" />
                      ) : (
                        <CloudIcon fontSize="small" />
                      )}
                      {p.name}
                    </Box>
                  </MenuItem>
                )
              })}
            </Select>
          </FormControl>
          )}

          <FormControl size="small" fullWidth>
            <InputLabel>{t('aiFunctionCard.model')}</InputLabel>
            <Select
              value={!loading && models.length > 0 ? model : ''}
              label={t('aiFunctionCard.model')}
              onChange={(e) => {
                const value = e.target.value
                if (value === '__add_custom__') {
                  setAddModelDialogOpen(true)
                } else {
                  setModel(value)
                  setTestResult(null)
                }
              }}
              disabled={loading || loadingProviders || providers.length === 0}
              displayEmpty
              renderValue={(selected) => {
                if (!selected) return ''
                const selectedModelInfo = models.find(m => m.id === selected)
                if (selectedModelInfo?.isCustom) {
                  return <Typography variant="body2" sx={{ fontStyle: 'italic' }}>{selectedModelInfo.name}</Typography>
                }
                return selectedModelInfo?.name || selected
              }}
            >
              {(loading || loadingProviders) && (
                <MenuItem value="" disabled>
                  <CircularProgress size={16} sx={{ mr: 1 }} /> {t('aiFunctionCard.loadingModels')}
                </MenuItem>
              )}
              {!loading && !loadingProviders && models.length === 0 && !supportsCustomModels && (
                <MenuItem value="" disabled>
                  {t('aiFunctionCard.noModelsAvailable')}
                </MenuItem>
              )}
              {/* Built-in models */}
              {[...models].filter(m => !m.isCustom).sort((a, b) => a.name.localeCompare(b.name)).map((m) => {
                const price = formatModelPrice(m)
                return (
                  <MenuItem key={m.id} value={m.id}>
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1, width: '100%' }}>
                      <Box>
                        <Typography variant="body2">{m.name}</Typography>
                        {m.description && (
                          <Typography variant="caption" color="text.secondary" display="block">
                            {m.description}
                          </Typography>
                        )}
                        {price && (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            display="block"
                            sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
                          >
                            {price}
                          </Typography>
                        )}
                      </Box>
                      {functionType !== 'embeddings' && m.capabilities.supportsToolCalling && (
                        <ToolCallingBadge label={t('aiFunctionCard.toolCalling')} />
                      )}
                    </Box>
                  </MenuItem>
                )
              })}
              {/* Custom models with delete button */}
              {models.filter(m => m.isCustom).length > 0 && (
                <MenuItem disabled sx={{ borderTop: 1, borderColor: 'divider', mt: 1, opacity: 0.7 }}>
                  <Typography variant="caption" color="text.secondary">
                    {t('aiFunctionCard.customModelsHeader')}
                  </Typography>
                </MenuItem>
              )}
              {models.filter(m => m.isCustom).sort((a, b) => a.name.localeCompare(b.name)).map((m) => {
                const price = formatModelPrice(m)
                return (
                <MenuItem key={m.id} value={m.id} sx={{ pr: 6 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2" sx={{ fontStyle: 'italic' }}>{m.name}</Typography>
                        {functionType !== 'embeddings' && m.capabilities.supportsToolCalling && (
                          <ToolCallingBadge label={t('aiFunctionCard.toolCalling')} />
                        )}
                      </Box>
                      <Typography variant="caption" color="text.secondary">
                        {t('aiFunctionCard.customModelSubtitle')}
                      </Typography>
                      {price && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          display="block"
                          sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
                        >
                          {price}
                        </Typography>
                      )}
                    </Box>
                    <ListItemSecondaryAction>
                      <IconButton
                        edge="end"
                        size="small"
                        onClick={(e) => handleDeleteCustomModel(m.id, e)}
                        disabled={deletingModel === m.id}
                        sx={{ 
                          opacity: 0.6,
                          '&:hover': { opacity: 1, color: 'error.main' }
                        }}
                      >
                        {deletingModel === m.id ? (
                          <CircularProgress size={16} />
                        ) : (
                          <DeleteIcon fontSize="small" />
                        )}
                      </IconButton>
                    </ListItemSecondaryAction>
                  </Box>
                </MenuItem>
                )
              })}
              {/* Add custom model option for self-hosted providers */}
              {supportsCustomModels && (
                <MenuItem 
                  value="__add_custom__" 
                  sx={{ 
                    borderTop: 1, 
                    borderColor: 'divider', 
                    mt: 1,
                    color: 'primary.main',
                  }}
                >
                  <Box display="flex" alignItems="center" gap={1}>
                    <AddIcon fontSize="small" />
                    <Box>
                      <Typography variant="body2">{t('aiFunctionCard.addCustomModel')}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t('aiFunctionCard.addCustomModelHint')}
                      </Typography>
                    </Box>
                  </Box>
                </MenuItem>
              )}
            </Select>
          </FormControl>
        </Box>

        {/* Model Info Chips */}
        {selectedModel && (
          <Box display="flex" gap={1} mb={2} flexWrap="wrap">
            {selectedModel.contextWindow && (
              <Chip label={selectedModel.contextWindow} size="small" variant="outlined" />
            )}
            {selectedModelPrice && (
              <Chip label={selectedModelPrice} size="small" variant="outlined" />
            )}
            {selectedModel.embeddingDimensions && (
              <Chip
                label={t('aiFunctionCard.embeddingsDimensions', { d: selectedModel.embeddingDimensions })}
                size="small"
                variant="outlined"
              />
            )}
            {selectedModel.capabilities.supportsToolCalling && (
              <Chip
                label={t('aiFunctionCard.toolCalling')}
                size="small"
                color="success"
                variant="outlined"
              />
            )}
          </Box>
        )}

        {/* Capability Warnings */}
        {hasCapabilityWarning && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            <Typography variant="body2" sx={{ mb: 0.5 }}>
              <strong>{t('aiFunctionCard.toolCallingWarningTitle')}</strong>
            </Typography>
            <Typography variant="body2">
              {t('aiFunctionCard.toolCallingWarningBody')}
              {provider === 'ollama' && t('aiFunctionCard.toolCallingWarningOllama')}
            </Typography>
          </Alert>
        )}
        {hasEmbeddingWarning && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {t('aiFunctionCard.embeddingUnsupported')}
          </Alert>
        )}

        {/* Spacer to push form fields to bottom */}
        <Box flex={1} />

        {/* API Key */}
        {providerInfo?.requiresApiKey && (
          <TextField
            label={t('aiFunctionCard.apiKey')}
            type={showApiKey ? 'text' : 'password'}
            value={apiKey || (isConfigured ? '••••••••••••••••' : '')}
            onChange={(e) => setApiKey(e.target.value.replace(/•/g, ''))}
            size="small"
            fullWidth
            placeholder={t('aiFunctionCard.apiKeyPlaceholder', { provider: providerInfo.name })}
            sx={{ mb: 2 }}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton onClick={() => setShowApiKey(!showApiKey)} size="small">
                    {showApiKey ? <VisibilityOffIcon /> : <VisibilityIcon />}
                  </IconButton>
                </InputAdornment>
              ),
            }}
            helperText={
              providerInfo.website && (
                <span>
                  {t('aiFunctionCard.getApiKeyPrefix')}{' '}
                  <Link href={providerInfo.website} target="_blank" rel="noopener">
                    {providerInfo.name}
                  </Link>
                </span>
              )
            }
          />
        )}

        {/* Spare API keys — tried in order when the key above runs out of quota.
            Only offered for roles that ask for them (the grounding roles, where
            a free-tier daily cap is the thing that actually runs out). Each key
            should be a separate provider project: two keys on one project share
            one quota, so a "fallback" there buys nothing. */}
        {supportsFallbackKey && providerInfo?.requiresApiKey && (
          <Box sx={{ mb: 2 }}>
            {fallbackKeys.map((key, i) => (
              <TextField
                key={i}
                label={t('aiFunctionCard.fallbackApiKeyNumbered', { number: i + 1 })}
                type={showFallbackKeys ? 'text' : 'password'}
                value={key}
                onChange={(e) => {
                  const next = [...fallbackKeys]
                  next[i] = e.target.value
                  setFallbackKeys(next)
                }}
                size="small"
                fullWidth
                placeholder={t('aiFunctionCard.fallbackApiKeyPlaceholder')}
                sx={{ mb: 1 }}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton onClick={() => setShowFallbackKeys(!showFallbackKeys)} size="small">
                        {showFallbackKeys ? <VisibilityOffIcon /> : <VisibilityIcon />}
                      </IconButton>
                      <IconButton
                        onClick={() => setFallbackKeys(fallbackKeys.filter((_, j) => j !== i))}
                        size="small"
                        aria-label={t('aiFunctionCard.removeFallbackKey')}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
            ))}
            <Button
              size="small"
              startIcon={<AddIcon />}
              onClick={() => setFallbackKeys([...fallbackKeys, ''])}
            >
              {t('aiFunctionCard.addFallbackKey')}
            </Button>
            {/* Three lines explaining why a spare from the same Google project
                buys nothing — true, and read once. */}
            <InfoHint title={t('aiFunctionCard.fallbackApiKeyHelp')} />
          </Box>
        )}

        {/* Free tier. This changes what the usage meter is allowed to ASSUME,
            and nothing else — no request is throttled, delayed or refused on
            the strength of it. Ticked, the shipped free-tier ceilings give the
            bars a denominator; unticked, only limits Google has actually
            enforced against this account are drawn, because a paid project's
            real budget is many times the free one and a bar claiming otherwise
            would read as full while the day had barely started. */}
        {offersFreeTierToggle && (
          <Box sx={{ mb: 2 }}>
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={freeTier}
                  onChange={(e) => setFreeTier(e.target.checked)}
                />
              }
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                  {t('aiFunctionCard.freeTierLabel')}
                  {/* Same treatment as the pacing checkbox beside it: the
                      reasoning is a paragraph and the control is one tick. */}
                  <InfoHint title={t('aiFunctionCard.freeTierHelp')} />
                </Box>
              }
            />
          </Box>
        )}

        {/* Free-tier PACING. Unlike the checkbox above, this one changes what
            the app does: it refuses to issue the next call until the delay has
            passed. Free-tier keys are limited per MINUTE as well as per day, and
            a batch job calls as fast as each title finishes — so a run spends
            its budget collecting 429s that look, in the log, exactly like a
            provider being down. The SDK's own backoff cannot help: it reacts in
            hundreds of milliseconds to a window measured in minutes.

            One stored number, with the checkbox derived from it — see the state
            declaration above for why there is no separate flag. */}
        {supportsFallbackModels && (
          <Box sx={{ mb: 2 }}>
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={pacingSeconds > 0}
                  onChange={(e) => setPacingSeconds(e.target.checked ? pacingDraft : 0)}
                />
              }
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                  {t('aiFunctionCard.pacingLabel')}
                  {/* The reasoning is four sentences and the setting is one
                      checkbox. It belongs a gesture away, not under every card. */}
                  <InfoHint title={t('aiFunctionCard.pacingHelp')} />
                </Box>
              }
            />
            {pacingSeconds > 0 && (
              <TextField
                label={t('aiFunctionCard.pacingSecondsLabel')}
                type="number"
                size="small"
                value={pacingSeconds}
                onChange={(e) => {
                  const next = Math.max(1, Math.min(MAX_PACING_SECONDS, Number(e.target.value) || 0))
                  setPacingSeconds(next)
                  setPacingDraft(next)
                }}
                inputProps={{ min: 1, max: MAX_PACING_SECONDS }}
                sx={{ mt: 1, maxWidth: 220 }}
              />
            )}
          </Box>
        )}

        {/* How hard to think. A reasoning model bills its scratchpad from the
            SAME output allowance as the answer, so on a batch role the budget
            is spent silently and the symptom is a truncation. Absent means the
            provider default, which is what every role had before this existed. */}
        {offersReasoningEffort && (
          <Box sx={{ mb: 2 }}>
            <FormControl fullWidth size="small">
              <InputLabel id={`${functionType}-reasoning-label`}>
                {t('aiFunctionCard.reasoningLabel')}
              </InputLabel>
              <Select
                labelId={`${functionType}-reasoning-label`}
                value={reasoningEffort}
                label={t('aiFunctionCard.reasoningLabel')}
                onChange={(e) => setReasoningEffort(e.target.value)}
              >
                <MenuItem value="">{t('aiFunctionCard.reasoningDefault')}</MenuItem>
                {reasoningEffortOptions(modelEfforts, reasoningEffort).map((value) => {
                  // A word OpenRouter adds after this ships has no translation.
                  // Rendering the vendor's own English name beats rendering a
                  // raw key path, and beats hiding a level the model accepts.
                  const key = reasoningEffortLabelKey(value)
                  return (
                    <MenuItem key={value} value={value}>
                      {key ? t(key) : value}
                    </MenuItem>
                  )
                })}
              </Select>
            </FormControl>
            <FormHelperText>{t('aiFunctionCard.reasoningHelp')}</FormHelperText>
          </Box>
        )}

        {/* Retrieval mode. The warning is not decoration: switching this starts
            a SEPARATE set of vectors rather than converting the existing one,
            so the library keeps answering from the old space until a full
            re-embed, centring and taste-profile rebuild have run. */}
        {offersInputType && (
          <Box sx={{ mb: 2 }}>
            <FormControl fullWidth size="small">
              <InputLabel id={`${functionType}-input-type-label`}>
                {t('aiFunctionCard.inputTypeLabel')}
              </InputLabel>
              <Select
                labelId={`${functionType}-input-type-label`}
                value={inputType}
                label={t('aiFunctionCard.inputTypeLabel')}
                onChange={(e) => setInputType(e.target.value as EmbeddingInputTypeValue | '')}
              >
                <MenuItem value="">{t('aiFunctionCard.inputTypeDefault')}</MenuItem>
                {embeddingInputTypeOptions(inputType).map((value) => (
                  <MenuItem key={value} value={value}>
                    {t(`aiFunctionCard.inputTypeOptions.${value}`)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormHelperText>{t('aiFunctionCard.inputTypeHelp')}</FormHelperText>

            {/* What this model needs, from the catalog. A hint with an explicit
                Apply, never an automatic correction: applying it rewrites the
                set identity, which is a different population of vectors, and
                that must not happen because someone opened a settings page.

                The "no mode needed" note is shown too — for gemini-2 the
                default already IS the semantic space, and silence there reads
                as an oversight rather than as a decision. */}
            {selectedModel?.inputTypeNote && (
              <Alert
                severity="info"
                sx={{ mt: 1 }}
                action={
                  selectedModel.recommendedInputType &&
                  inputType !== selectedModel.recommendedInputType ? (
                    <Button
                      size="small"
                      onClick={() => setInputType(selectedModel.recommendedInputType!)}
                    >
                      {t('aiFunctionCard.inputTypeApplyRecommended')}
                    </Button>
                  ) : undefined
                }
              >
                {selectedModel.recommendedInputType && (
                  <AlertTitle sx={{ mb: 0.5 }}>
                    {t('aiFunctionCard.inputTypeRecommended', {
                      mode: t(
                        `aiFunctionCard.inputTypeOptions.${selectedModel.recommendedInputType}`
                      ),
                    })}
                  </AlertTitle>
                )}
                {selectedModel.inputTypeNote}
              </Alert>
            )}

            {/* The pin. Offered whenever OpenRouter is the provider, since an
                operator may want deterministic routing regardless — but it is
                REQUIRED for a parameter-delivered mode, because OpenRouter
                picks an upstream per call and they do not all honour an
                undocumented field. Unpinned, the library becomes a mixture of
                two spaces that nothing downstream can detect. */}
            {provider === 'openrouter' && (
              <Box sx={{ mt: 2 }}>
                <FormControl fullWidth size="small" error={pinRequired}>
                  <InputLabel id={`${functionType}-upstream-label`}>
                    {t('aiFunctionCard.upstreamLabel')}
                  </InputLabel>
                  <Select
                    labelId={`${functionType}-upstream-label`}
                    value={providerOnly}
                    label={t('aiFunctionCard.upstreamLabel')}
                    onChange={(e) => setProviderOnly(e.target.value)}
                  >
                    <MenuItem value="">{t('aiFunctionCard.upstreamAuto')}</MenuItem>
                    {OPENROUTER_UPSTREAMS.map((slug) => (
                      <MenuItem key={slug} value={slug}>
                        {slug}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormHelperText error={pinRequired}>
                  {pinRequired
                    ? t('aiFunctionCard.upstreamRequired')
                    : t('aiFunctionCard.upstreamHelp')}
                </FormHelperText>
              </Box>
            )}

            {inputType !== storedInputType && (
              <Alert severity="warning" sx={{ mt: 1 }}>
                {t('aiFunctionCard.inputTypeChangeWarning')}
              </Alert>
            )}
          </Box>
        )}

        {/* Spare models. Rendered only once a provider list has arrived, since
            each row needs it to offer a choice. */}
        {supportsFallbackModels && !loadingProviders && providers.length > 0 && (
          <AIFallbackModels
            functionType={functionType}
            apiBase={apiBase}
            value={fallbackModels}
            onChange={setFallbackModels}
            providers={providers}
            primary={{ provider, model }}
          />
        )}

        {/* Ollama Instructions */}
        {provider === 'ollama' && (
          <Box sx={{ 
            mb: 2, 
            p: 2, 
            borderRadius: 2, 
            bgcolor: (theme) => alpha(theme.palette.info.main, 0.08),
            border: 1,
            borderColor: (theme) => alpha(theme.palette.info.main, 0.2),
          }}>
            <Typography variant="subtitle2" sx={{ mb: 1.5, color: 'info.main', display: 'flex', alignItems: 'center', gap: 1 }}>
              <ComputerIcon fontSize="small" />
              {t('aiFunctionCard.ollamaInstallTitle')}
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              {(functionType === 'embeddings' 
                ? [
                    { cmd: 'ollama pull nomic-embed-text', note: 'recommended' },
                    { cmd: 'ollama pull mxbai-embed-large', note: 'higher quality' },
                    { cmd: 'ollama pull nomic-embed-text-v2-moe', note: 'multilingual' },
                  ]
                : functionType === 'chat'
                ? [
                    { cmd: 'ollama pull qwen3', note: 'recommended' },
                    { cmd: 'ollama pull firefunction-v2', note: 'best for tools' },
                  ]
                : [
                    { cmd: 'ollama pull llama3.2', note: 'recommended' },
                    { cmd: 'ollama pull llama3.1', note: null },
                    { cmd: 'ollama pull gemma3', note: 'fast' },
                    { cmd: 'ollama pull phi4', note: 'small & capable' },
                  ]
              ).map(({ cmd, note }) => (
                <Box 
                  key={cmd}
                  sx={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    flexWrap: 'wrap',
                    gap: 0.5,
                    bgcolor: 'background.paper',
                    px: 1.5,
                    py: 0.75,
                    borderRadius: 1,
                    fontFamily: 'monospace',
                    fontSize: '0.8rem',
                  }}
                >
                  <Box component="span" sx={{ color: 'text.primary' }}>{cmd}</Box>
                  {note && (
                    <Chip
                      label={ollamaNoteLabel(note)}
                      size="small"
                      variant="outlined"
                      sx={{ 
                        height: 20, 
                        fontSize: '0.65rem',
                        '& .MuiChip-label': { px: 1 }
                      }} 
                    />
                  )}
                </Box>
              ))}
            </Box>
          </Box>
        )}

        {/*
          LM Studio's equivalent is not a list of commands to run — models are
          downloaded in its own UI — so the help it needs is the two settings
          that decide whether anything here can reach it at all: the local
          server has to be started, and for the Embeddings role it will not
          answer without an embedding model loaded.
        */}
        {/*
          One line and an icon, where this used to be a boxed panel of three
          numbered steps and two paragraphs. All of it is still true and almost
          none of it is needed twice: an operator reads the setup once and then
          scrolls past it on every visit afterwards, on every role's card.
        */}
        {provider === 'lmstudio' && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 2, color: 'text.secondary' }}>
            <ComputerIcon sx={{ fontSize: 16 }} />
            <Typography variant="caption">{t('aiFunctionCard.lmStudioSetupTitle')}</Typography>
            <InfoHint
              title={[
                t('aiFunctionCard.lmStudioStepDownload'),
                t('aiFunctionCard.lmStudioStepServer'),
                t('aiFunctionCard.lmStudioStepDetect'),
                ...(functionType === 'embeddings' ? [t('aiFunctionCard.lmStudioEmbeddingNote')] : []),
                t('aiFunctionCard.lmStudioAutoEvictNote'),
              ].join('\n\n')}
            />
          </Box>
        )}

        {/* Base URL */}
        {providerInfo?.requiresBaseUrl && (
          <TextField
            label={t('aiFunctionCard.baseUrl')}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            size="small"
            fullWidth
            placeholder={providerInfo.defaultBaseUrl}
            sx={{ mb: 2 }}
            helperText={
              provider === 'ollama'
                ? t('aiFunctionCard.baseUrlHelperOllama')
                : provider === 'lmstudio'
                  ? t('aiFunctionCard.baseUrlHelperLmStudio')
                  : t('aiFunctionCard.baseUrlHelperCompatible')
            }
          />
        )}

        {footer}

        {/* Actions */}
        <Box display="flex" gap={1}>
          <Button
            variant="outlined"
            size="small"
            onClick={handleTest}
            // A local server can be tested on its own — that is the whole point
            // of separating the two stages, and the button being dead until a
            // model is chosen is what made connectivity unanswerable.
            disabled={testing || (!model && !supportsDiscovery)}
          >
            {testing ? <CircularProgress size={16} /> : t('aiFunctionCard.test')}
          </Button>
          <Button
            variant="contained"
            size="small"
            onClick={handleSave}
            // Blocked rather than warned: an unpinned parameter mode produces a
            // set that is a mixture of two spaces, and no later step can repair it.
            disabled={saving || !model || pinRequired}
          >
            {saving ? <CircularProgress size={16} /> : t('common.save')}
          </Button>
        </Box>

        {/*
          BELOW the buttons, not above them. A result that appears at the top of
          a tall card is off-screen from where the press happened — on the Title
          Analysis card the button sits past the fallback-model list, so the
          answer to "did that work" landed several hundred pixels behind the
          reader. It belongs where the action is.
        */}
        {testResult && (
          <Alert 
            severity={testResult.success ? 'success' : 'error'} 
            sx={{ mt: 2 }}
            onClose={() => setTestResult(null)}
          >
            {testResult.success
              ? t('aiFunctionCard.connectionSuccess')
              : t('aiFunctionCard.connectionFailedWithError', { error: testResult.error ?? '' })}
            {/*
              What the server actually holds, not just that it answered. The
              counts are the part that diagnoses a role pointed at a server with
              nothing suitable installed — reachability alone never could.
            */}
            {serverStatus?.reachable && (
              <Typography variant="body2" sx={{ mt: 1 }}>
                {t('aiFunctionCard.serverSummary', {
                  api: serverStatus.api ?? '?',
                  total: serverStatus.totalModels,
                  language: serverStatus.languageModels,
                  embedding: serverStatus.embeddingModels,
                })}
                {serverStatus.loaded.length > 0 && (
                  <>
                    {' '}
                    {t('aiFunctionCard.serverLoaded', {
                      models: serverStatus.loaded
                        .map((l) => (l.contextLength ? `${l.modelId} (${l.contextLength})` : l.modelId))
                        .join(', '),
                    })}
                  </>
                )}
              </Typography>
            )}
          </Alert>
        )}
      </CardContent>

      {/* Add Custom Model Dialog */}
      <Dialog 
        open={addModelDialogOpen} 
        onClose={handleCloseDialog}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t('aiFunctionCard.dialogAddCustomTitle')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {provider === 'ollama' && t('aiFunctionCard.addCustomDialog_ollama')}
            {provider === 'lmstudio' && t('aiFunctionCard.addCustomDialog_lmstudio')}
            {provider === 'openrouter' && t('aiFunctionCard.addCustomDialog_openrouter')}
            {provider === 'huggingface' && t('aiFunctionCard.addCustomDialog_huggingface')}
            {provider !== 'ollama' && provider !== 'lmstudio' && provider !== 'openrouter' &&
              provider !== 'huggingface' &&
              t('aiFunctionCard.addCustomDialog_compatible')}
          </Typography>
          {/*
            What the server says it has. Shown above the free-text field so the
            list is the obvious path and typing an id is the fallback, not the
            other way round — copying `text-embedding-nomic-embed-text-v1.5` by
            hand is exactly the step this removes.
          */}
          {supportsDiscovery && (
            <Box sx={{ mb: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="subtitle2">{t('aiFunctionCard.discoverTitle')}</Typography>
                <Button
                  size="small"
                  startIcon={discovering ? <CircularProgress size={14} /> : <RefreshIcon />}
                  onClick={handleDiscoverModels}
                  disabled={discovering || dialogTesting}
                >
                  {t('aiFunctionCard.discoverRefresh')}
                </Button>
              </Box>

              {discovering && (
                <Typography variant="body2" color="text.secondary">
                  {t('aiFunctionCard.discoverLoading')}
                </Typography>
              )}

              {!discovering && discovery && !discovery.reachable && (
                <Alert severity="info">
                  {t('aiFunctionCard.discoverUnreachable', {
                    url: baseUrl || providerInfo?.defaultBaseUrl || '',
                  })}
                </Alert>
              )}

              {!discovering && discovery?.reachable && discovery.models.length === 0 && (
                <Alert severity="info">{t('aiFunctionCard.discoverNoneForRole')}</Alert>
              )}

              {!discovering && discovery?.reachable && discovery.models.length > 0 && (
                <FormControl fullWidth size="small">
                  <InputLabel>{t('aiFunctionCard.discoverPick')}</InputLabel>
                  <Select
                    value={discovery.models.some((m) => m.id === newModelName) ? newModelName : ''}
                    label={t('aiFunctionCard.discoverPick')}
                    onChange={(e) => {
                      setNewModelName(e.target.value as string)
                      setDialogTestResult(null)
                    }}
                    disabled={dialogTesting}
                  >
                    {discovery.models.map((m) => (
                      <MenuItem key={m.id} value={m.id}>
                        <Box sx={{ minWidth: 0 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="body2" noWrap>
                              {m.name}
                            </Typography>
                            {m.loaded && (
                              <Chip size="small" label={t('aiFunctionCard.discoverLoaded')} color="success" variant="outlined" />
                            )}
                          </Box>
                          {(m.description || m.contextWindow) && (
                            <Typography variant="caption" color="text.secondary">
                              {[m.description, m.contextWindow].filter(Boolean).join(' · ')}
                            </Typography>
                          )}
                        </Box>
                      </MenuItem>
                    ))}
                  </Select>
                  {discovery.skipped.length > 0 && (
                    <FormHelperText>
                      {t('aiFunctionCard.discoverSkipped', { count: discovery.skipped.length })}
                    </FormHelperText>
                  )}
                </FormControl>
              )}
            </Box>
          )}

          <TextField
            autoFocus
            label={t('aiFunctionCard.modelName')}
            value={newModelName}
            onChange={(e) => {
              setNewModelName(e.target.value)
              // Reset test result when model name changes
              setDialogTestResult(null)
            }}
            fullWidth
            size="small"
            placeholder={
              provider === 'ollama'
                ? t('aiFunctionCard.placeholderOllama')
                : provider === 'openrouter'
                  ? t('aiFunctionCard.placeholderOpenrouter')
                  : provider === 'huggingface'
                    ? t('aiFunctionCard.placeholderHuggingface')
                    : t('aiFunctionCard.placeholderDefault')
            }
            helperText={supportsDiscovery ? t('aiFunctionCard.discoverManualHint') : undefined}
            disabled={dialogTesting}
            sx={{ mb: 2 }}
          />

          {/* Embedding Dimensions Dropdown - only for embeddings function */}
          {functionType === 'embeddings' && (
            <>
              <Alert severity="warning" sx={{ mb: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                  {t('aiFunctionCard.embeddingVectorTitle')}
                </Typography>
                <Typography variant="body2" sx={{ mb: 1.5 }}>
                  {t('aiFunctionCard.embeddingVectorBody')}
                </Typography>
                <Typography variant="body2" component="div">
                  <strong>{t('aiFunctionCard.embeddingCommonDimensionsTitle')}</strong>
                  <Box
                    component="span"
                    sx={{ display: 'block', mt: 0.5, whiteSpace: 'pre-line', pl: 0 }}
                  >
                    {t('aiFunctionCard.embeddingCommonDimensionsList')}
                  </Box>
                </Typography>
                <Typography variant="body2" sx={{ mt: 1, fontStyle: 'italic' }}>
                  {t('aiFunctionCard.embeddingCheckDocs')}
                </Typography>
              </Alert>

              <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                <InputLabel>{t('aiFunctionCard.embeddingDimensionsLabel')}</InputLabel>
                <Select
                  value={newModelEmbeddingDimensions}
                  label={t('aiFunctionCard.embeddingDimensionsLabel')}
                  onChange={(e) => setNewModelEmbeddingDimensions(e.target.value as number | '')}
                  disabled={dialogTesting}
                >
                  <MenuItem value="" disabled>
                    <em>{t('aiFunctionCard.selectDimensions')}</em>
                  </MenuItem>
                  {VALID_EMBEDDING_DIMENSIONS.map((dim) => (
                    <MenuItem key={dim} value={dim}>
                      {t('aiFunctionCard.dimensionOption', { dim })}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </>
          )}
          
          {/* Test Result */}
          {dialogTestResult && (
            <Alert 
              severity={dialogTestResult.success ? 'success' : 'error'} 
              sx={{ mb: 2 }}
            >
              {dialogTestResult.success
                ? t('aiFunctionCard.modelValidatedSuccess')
                : t('aiFunctionCard.validationFailedWithError', { error: dialogTestResult.error ?? '' })}
              {/*
                The test embedded a string, so the vector's width is a measured
                fact now rather than something to look up. Say so — and say it
                plainly when there is no table for it, because the model works
                and is still unusable here.
              */}
              {dialogTestResult.success && dialogTestResult.embeddingDimensions != null && (
                <Typography variant="body2" sx={{ mt: 1 }}>
                  {dialogTestResult.embeddingDimensionsSupported === false
                    ? t('aiFunctionCard.detectedDimensionsUnsupported', {
                        dim: dialogTestResult.embeddingDimensions,
                      })
                    : t('aiFunctionCard.detectedDimensions', {
                        dim: dialogTestResult.embeddingDimensions,
                      })}
                </Typography>
              )}
            </Alert>
          )}
          
          {/* Testing indicator */}
          {dialogTesting && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2, color: 'text.secondary' }}>
              <CircularProgress size={20} />
              <Typography variant="body2">
                {t('aiFunctionCard.validatingModel', {
                  ollamaSuffix:
                    provider === 'ollama' ? t('aiFunctionCard.validatingModelOllamaSuffix') : '',
                })}
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={handleCloseDialog}
            disabled={dialogTesting || addingModel}
          >
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleTestCustomModel}
            variant="outlined"
            disabled={!newModelName.trim() || dialogTesting || addingModel}
          >
            {dialogTesting ? <CircularProgress size={16} /> : t('aiFunctionCard.test')}
          </Button>
          <Button
            onClick={handleAddCustomModel}
            variant="contained"
            disabled={
              !newModelName.trim() ||
              !dialogTestResult?.success ||
              addingModel ||
              (functionType === 'embeddings' && !newModelEmbeddingDimensions)
            }
          >
            {addingModel ? <CircularProgress size={16} /> : t('aiFunctionCard.addModel')}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  )
}

