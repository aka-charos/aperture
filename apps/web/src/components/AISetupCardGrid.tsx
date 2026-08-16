import { Box } from '@mui/material'
import {
  AutoFixHigh as AutoFixHighIcon,
  HubOutlined as HubOutlinedIcon,
  Memory as MemoryIcon,
  SmartToy as SmartToyIcon,
  Theaters as TheatersIcon,
  TravelExplore as TravelExploreIcon,
} from '@mui/icons-material'
import { useTranslation } from 'react-i18next'
import { AIFunctionCard, type AIFunction } from './AIFunctionCard'
import { WebSearchUsagePanel } from './WebSearchUsagePanel'
import type { FunctionConfig } from './aiProviderInfo'

export interface AISetupGridConfig {
  embeddings: FunctionConfig | null
  chat: FunctionConfig | null
  textGeneration: FunctionConfig | null
  exploration: FunctionConfig | null
  webSearch?: FunctionConfig | null
  titleAnalysis?: FunctionConfig | null
}

interface AISetupCardGridProps {
  config: AISetupGridConfig | null
  onSave: (fn: AIFunction, config: FunctionConfig) => Promise<void>
  variant: 'setup' | 'settings'
}

export function AISetupCardGrid({ config, onSave, variant }: AISetupCardGridProps) {
  const { t } = useTranslation()
  const isSetup = variant === 'setup'
  const keyPrefix = isSetup ? 'setup.aiSetup' : 'settingsAiSetup'

  return (
    <Box
      display="grid"
      gridTemplateColumns={{ xs: '1fr', md: 'repeat(2, 1fr)' }}
      gap={isSetup ? 2 : 3}
      mb={isSetup ? 3 : undefined}
    >
      <AIFunctionCard
        functionType="embeddings"
        title={t(`${keyPrefix}.cardEmbeddingsTitle`)}
        description={t(`${keyPrefix}.cardEmbeddingsDesc`)}
        icon={<MemoryIcon />}
        iconColor="#2196f3"
        config={config?.embeddings ?? null}
        onSave={(c) => onSave('embeddings', c)}
        requiredCapability="embeddings"
        compact={isSetup}
        isSetup={isSetup}
      />

      <AIFunctionCard
        functionType="chat"
        title={t(`${keyPrefix}.cardChatTitle`)}
        description={t(`${keyPrefix}.cardChatDesc`)}
        icon={<SmartToyIcon />}
        iconColor="#9c27b0"
        config={config?.chat ?? null}
        onSave={(c) => onSave('chat', c)}
        requiredCapability="toolCalling"
        compact={isSetup}
        isSetup={isSetup}
      />

      <AIFunctionCard
        functionType="textGeneration"
        title={t(`${keyPrefix}.cardTextGenTitle`)}
        description={t(`${keyPrefix}.cardTextGenDesc`)}
        icon={<AutoFixHighIcon />}
        iconColor="#ff9800"
        config={config?.textGeneration ?? null}
        onSave={(c) => onSave('textGeneration', c)}
        compact={isSetup}
        isSetup={isSetup}
      />

      <AIFunctionCard
        functionType="exploration"
        title={t(`${keyPrefix}.cardExplorationTitle`)}
        description={t(`${keyPrefix}.cardExplorationDesc`)}
        icon={<HubOutlinedIcon />}
        iconColor="#4caf50"
        config={config?.exploration ?? null}
        onSave={(c) => onSave('exploration', c)}
        compact={isSetup}
        isSetup={isSetup}
      />

      {/* The two grounding roles — optional, admin settings only (not the
          onboarding wizard). Google-only, because they ride on Gemini's native
          search grounding, so each card locks its provider and offers spare API
          keys for when a free tier runs out.

          They are separate roles, with separate credentials, on purpose: both
          spend the same per-project daily grounding cap, so a batch of title
          analyses run from the chat role's key would exhaust the quota the
          assistant needs. Give each its own key from its own Google project or
          the split achieves nothing. */}
      {variant === 'settings' && (
        <AIFunctionCard
          functionType="webSearch"
          title={t(`${keyPrefix}.cardWebSearchTitle`)}
          description={t(`${keyPrefix}.cardWebSearchDesc`)}
          icon={<TravelExploreIcon />}
          iconColor="#00bcd4"
          config={config?.webSearch ?? null}
          onSave={(c) => onSave('webSearch', c)}
          compact={isSetup}
          isSetup={isSetup}
          supportsFallbackKey
          footer={<WebSearchUsagePanel role="webSearch" />}
        />
      )}

      {variant === 'settings' && (
        <AIFunctionCard
          functionType="titleAnalysis"
          title={t(`${keyPrefix}.cardTitleAnalysisTitle`)}
          description={t(`${keyPrefix}.cardTitleAnalysisDesc`)}
          icon={<TheatersIcon />}
          iconColor="#e91e63"
          config={config?.titleAnalysis ?? null}
          onSave={(c) => onSave('titleAnalysis', c)}
          compact={isSetup}
          isSetup={isSetup}
          supportsFallbackKey
          footer={<WebSearchUsagePanel role="titleAnalysis" />}
        />
      )}
    </Box>
  )
}
