/**
 * AI Setup Section - Card-based AI provider configuration for Admin Settings
 */
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Box, Typography, CircularProgress } from '@mui/material'
import type { AIFunction } from '../../../components/AIFunctionCard'
import { AISetupCardGrid } from '../../../components/AISetupCardGrid'
import { type FunctionConfig } from '../../../components/aiProviderInfo'

interface AIConfig {
  embeddings: FunctionConfig | null
  chat: FunctionConfig | null
  textGeneration: FunctionConfig | null
  exploration: FunctionConfig | null
}

export function AISetupSection() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<AIConfig | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/ai', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setConfig(data.config)
      }
    } catch {
      // Ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  const handleSave = async (fn: AIFunction, fnConfig: FunctionConfig) => {
    const res = await fetch(`/api/settings/ai/${fn}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(fnConfig),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error || t('settingsAiSetup.saveFailed'))
    }
    // Refresh config
    fetchConfig()
  }

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" py={4}>
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box>
      {/* Header */}
      <Box mb={3}>
        <Typography variant="h5" fontWeight={600} gutterBottom>
          {t('settingsAiSetup.pageTitle')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('settingsAiSetup.pageSubtitle')}
        </Typography>
      </Box>

      {/* The embedding sets, the spend dashboard and the cost estimator used to
          stack below this grid. They are their own routes now — one subject per
          page — and this section is just the provider roles. */}
      <AISetupCardGrid config={config} onSave={handleSave} variant="settings" />
    </Box>
  )
}
