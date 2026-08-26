/**
 * Multi-Provider AI Configuration Handlers
 * 
 * This is the largest handler file covering all AI configuration endpoints.
 * 
 * Endpoints:
 * - GET /api/settings/ai - Get full AI configuration
 * - PUT /api/settings/ai - Update full AI configuration
 * - GET /api/settings/ai/capabilities - Get AI capabilities status (admin)
 * - GET /api/settings/ai/features - Get AI features (user accessible)
 * - GET /api/settings/ai/credentials - Get AI provider credentials status
 * - GET /api/settings/ai/credentials/:provider - Get specific provider credentials
 * - PUT /api/settings/ai/credentials/:provider - Save provider credentials
 * - GET /api/settings/ai/providers - Get available providers
 * - GET /api/settings/ai/models - Get available models for provider
 * - POST /api/settings/ai/custom-models - Add custom model
 * - DELETE /api/settings/ai/custom-models - Delete custom model
 * - GET /api/settings/ai/web-search/usage - Web Search free-tier usage meter
 * - GET /api/settings/ai/pricing - Get AI pricing
 * - GET /api/settings/ai/pricing/status - Get pricing cache status
 * - POST /api/settings/ai/pricing/refresh - Refresh pricing cache
 * - GET /api/settings/ai/embeddings/sets - List embedding sets
 * - DELETE /api/settings/ai/embeddings/sets/:model - Delete embedding set
 * - POST /api/settings/ai/embeddings/clear - Clear all embeddings
 * - GET /api/settings/ai/embeddings/episodes - Episode embedding setting + stored count
 * - PATCH /api/settings/ai/embeddings/episodes - Toggle episode embedding generation
 * - POST /api/settings/ai/embeddings/episodes/clear - Delete every episode embedding
 * - GET /api/settings/ai/embeddings/legacy - Check legacy embeddings
 * - DELETE /api/settings/ai/embeddings/legacy - Drop legacy embeddings
 * - POST /api/settings/ai/test - Test AI provider
 * - PATCH /api/settings/ai/:function - Update function config
 */
import type { FastifyInstance } from 'fastify'
import {
  getAIConfig,
  setAIConfig,
  getFunctionConfig,
  setFunctionConfig,
  getAICapabilitiesStatus,
  VALID_EMBEDDING_DIMENSIONS,
  getEmbeddingSetsReport,
  deleteEmbeddingSet,
  checkLegacyEmbeddingsExist,
  dropLegacyEmbeddingTables,
  testProviderConnection,
  PROVIDERS,
  getProvidersForFunction,
  getModelsForFunctionWithCustom,
  getPricingForModelAsync,
  refreshPricingCache,
  getPricingCacheStatus,
  addCustomModel,
  deleteCustomModel,
  getSystemSetting,
  setSystemSetting,
  getEpisodeEmbeddingsEnabled,
  setEpisodeEmbeddingsEnabled,
  getWebSearchUsageSummary,
  getGroundingKeySlots,
  resolveFallbackKeys,
  isFreeTierConfig,
  MAX_CALL_SPACING_SECONDS,
  AI_FUNCTIONS,
  isAIFunction,
  type AIFunction,
  type ProviderType,
} from '@aperture/core'
import { query } from '../../../lib/db.js'
import { requireAdmin, requireAuth } from '../../../plugins/auth.js'
import {
  aiConfigSchema,
  aiCapabilitiesSchema,
  aiFeaturesSchema,
  aiCredentialsSchema,
  updateAiCredentialSchema,
  aiProvidersSchema,
  aiModelsSchema,
  testAiProviderSchema,
  addCustomModelSchema,
  deleteCustomModelSchema,
  embeddingSetsSchema,
  deleteEmbeddingSetSchema,
  clearAllEmbeddingsSchema,
  episodeEmbeddingsSettingSchema,
  updateEpisodeEmbeddingsSettingSchema,
  clearEpisodeEmbeddingsSchema,
  legacyEmbeddingsSchema,
  deleteLegacyEmbeddingsSchema,
  aiPricingSchema,
  aiPricingStatusSchema,
  refreshAiPricingSchema,
} from '../schemas.js'

export function registerAiConfigHandlers(fastify: FastifyInstance) {
  /**
   * GET /api/settings/ai
   */
  fastify.get('/api/settings/ai', { preHandler: requireAdmin, schema: aiConfigSchema }, async (_request, reply) => {
    try {
      const config = await getAIConfig()
      const capabilities = await getAICapabilitiesStatus()
      return reply.send({ config, capabilities })
    } catch (err) {
      fastify.log.error({ err }, 'Failed to get AI config')
      return reply.status(500).send({ error: 'Failed to get AI configuration' })
    }
  })

  /**
   * PUT /api/settings/ai
   */
  fastify.put<{
    Body: {
      embeddings?: { provider: ProviderType; model: string; apiKey?: string; baseUrl?: string }
      chat?: { provider: ProviderType; model: string; apiKey?: string; baseUrl?: string }
      textGeneration?: { provider: ProviderType; model: string; apiKey?: string; baseUrl?: string }
      exploration?: { provider: ProviderType; model: string; apiKey?: string; baseUrl?: string }
      webSearch?: {
        provider: ProviderType
        model: string
        apiKey?: string
        baseUrl?: string
        fallbackApiKeys?: string[]
      }
      // `fallbackApiKeys` because this role can be switched to Gemini's
      // built-in search, and then it spends the same per-day grounding quota
      // Web Search does. Unused when it points at a local or OpenRouter model.
      titleAnalysis?: {
        provider: ProviderType
        model: string
        apiKey?: string
        baseUrl?: string
        fallbackApiKeys?: string[]
      }
    }
  }>('/api/settings/ai', { preHandler: requireAdmin, schema: { tags: ['settings'] } }, async (request, reply) => {
    try {
      const currentConfig = await getAIConfig()
      const updates = request.body

      const newConfig = {
        embeddings: updates.embeddings
          ? { ...currentConfig.embeddings, ...updates.embeddings }
          : currentConfig.embeddings,
        chat: updates.chat ? { ...currentConfig.chat, ...updates.chat } : currentConfig.chat,
        textGeneration: updates.textGeneration
          ? { ...currentConfig.textGeneration, ...updates.textGeneration }
          : currentConfig.textGeneration,
        exploration: updates.exploration
          ? { ...currentConfig.exploration, ...updates.exploration }
          : currentConfig.exploration,
        webSearch: updates.webSearch
          ? { ...currentConfig.webSearch, ...updates.webSearch }
          : currentConfig.webSearch,
        titleAnalysis: updates.titleAnalysis
          ? { ...currentConfig.titleAnalysis, ...updates.titleAnalysis }
          : currentConfig.titleAnalysis,
      }

      await setAIConfig(newConfig)
      const capabilities = await getAICapabilitiesStatus()
      return reply.send({ config: newConfig, capabilities })
    } catch (err) {
      fastify.log.error({ err }, 'Failed to update AI config')
      return reply.status(500).send({ error: 'Failed to update AI configuration' })
    }
  })

  /**
   * GET /api/settings/ai/capabilities
   */
  fastify.get('/api/settings/ai/capabilities', { preHandler: requireAdmin, schema: aiCapabilitiesSchema }, async (_request, reply) => {
    try {
      const capabilities = await getAICapabilitiesStatus()
      return reply.send(capabilities)
    } catch (err) {
      fastify.log.error({ err }, 'Failed to get AI capabilities')
      return reply.status(500).send({ error: 'Failed to get AI capabilities' })
    }
  })

  /**
   * GET /api/settings/ai/features
   */
  fastify.get('/api/settings/ai/features', { preHandler: requireAuth, schema: aiFeaturesSchema }, async (_request, reply) => {
    try {
      const capabilities = await getAICapabilitiesStatus()
      
      return reply.send({
        embeddings: {
          configured: capabilities.embeddings.configured,
          supportsEmbeddings: capabilities.embeddings.capabilities?.supportsEmbeddings ?? false,
        },
        chat: {
          configured: capabilities.chat.configured,
          // Exposed so capability warnings can name the model
          provider: capabilities.chat.provider,
          model: capabilities.chat.model,
          supportsToolCalling: capabilities.chat.capabilities?.supportsToolCalling ?? false,
          supportsStreaming: capabilities.chat.capabilities?.supportsToolStreaming ?? false,
        },
        textGeneration: {
          configured: capabilities.textGeneration.configured,
        },
        exploration: {
          configured: capabilities.exploration.configured,
        },
        features: {
          semanticSearch: capabilities.embeddings.configured,
          chatWithTools: capabilities.chat.configured && (capabilities.chat.capabilities?.supportsToolCalling ?? false),
          basicChat: capabilities.chat.configured,
          recommendations: capabilities.embeddings.configured && capabilities.textGeneration.configured,
          explanations: capabilities.textGeneration.configured,
          exploration: capabilities.exploration.configured && capabilities.embeddings.configured,
        },
        isFullyConfigured: capabilities.isFullyConfigured,
        isAnyConfigured: capabilities.isAnyConfigured,
      })
    } catch (err) {
      fastify.log.error({ err }, 'Failed to get AI features')
      return reply.status(500).send({ error: 'Failed to get AI features' })
    }
  })

  /**
   * GET /api/settings/ai/credentials
   */
  fastify.get('/api/settings/ai/credentials', { preHandler: requireAdmin, schema: aiCredentialsSchema }, async (_request, reply) => {
    try {
      const credentialsJson = await getSystemSetting('ai_provider_credentials')
      const credentials = credentialsJson ? JSON.parse(credentialsJson) : {}
      
      const maskedCredentials: Record<string, { hasApiKey: boolean; baseUrl?: string }> = {}
      for (const [provider, creds] of Object.entries(credentials)) {
        const c = creds as { apiKey?: string; baseUrl?: string }
        maskedCredentials[provider] = {
          hasApiKey: !!c.apiKey,
          baseUrl: c.baseUrl,
        }
      }
      
      return reply.send({ credentials: maskedCredentials })
    } catch (err) {
      fastify.log.error({ err }, 'Failed to get AI credentials')
      return reply.status(500).send({ error: 'Failed to get AI credentials' })
    }
  })

  /**
   * GET /api/settings/ai/credentials/:provider
   */
  fastify.get<{ Params: { provider: string } }>('/api/settings/ai/credentials/:provider', { preHandler: requireAdmin, schema: { tags: ['settings'] } }, async (request, reply) => {
    try {
      const { provider } = request.params
      const credentialsJson = await getSystemSetting('ai_provider_credentials')
      const credentials = credentialsJson ? JSON.parse(credentialsJson) : {}
      const providerCreds = credentials[provider] || {}
      
      return reply.send({
        provider,
        apiKey: providerCreds.apiKey || '',
        baseUrl: providerCreds.baseUrl || '',
      })
    } catch (err) {
      fastify.log.error({ err }, 'Failed to get provider credentials')
      return reply.status(500).send({ error: 'Failed to get provider credentials' })
    }
  })

  /**
   * PUT /api/settings/ai/credentials/:provider
   */
  fastify.put<{ 
    Params: { provider: string }
    Body: { apiKey?: string; baseUrl?: string }
  }>('/api/settings/ai/credentials/:provider', { preHandler: requireAdmin, schema: updateAiCredentialSchema }, async (request, reply) => {
    try {
      const { provider } = request.params
      const { apiKey, baseUrl } = request.body
      
      const credentialsJson = await getSystemSetting('ai_provider_credentials')
      const credentials = credentialsJson ? JSON.parse(credentialsJson) : {}
      
      credentials[provider] = {
        ...(credentials[provider] || {}),
        ...(apiKey !== undefined && { apiKey }),
        ...(baseUrl !== undefined && { baseUrl }),
      }
      
      if (!credentials[provider].apiKey && !credentials[provider].baseUrl) {
        delete credentials[provider]
      }
      
      await setSystemSetting('ai_provider_credentials', JSON.stringify(credentials), 'Stored credentials for AI providers')
      
      return reply.send({ success: true, provider })
    } catch (err) {
      fastify.log.error({ err }, 'Failed to save provider credentials')
      return reply.status(500).send({ error: 'Failed to save provider credentials' })
    }
  })

  /**
   * GET /api/settings/ai/providers
   */
  fastify.get<{
    Querystring: { function?: string }
  }>('/api/settings/ai/providers', { preHandler: requireAdmin, schema: aiProvidersSchema }, async (request, reply) => {
    try {
      const fn = request.query.function as AIFunction | undefined

      if (fn) {
        const providers = await getProvidersForFunction(fn)
        return reply.send({ providers })
      }

      return reply.send({ providers: PROVIDERS })
    } catch (err) {
      fastify.log.error({ err }, 'Failed to get AI providers')
      return reply.status(500).send({ error: 'Failed to get AI providers' })
    }
  })

  /**
   * GET /api/settings/ai/models
   */
  fastify.get<{
    Querystring: { provider: string; function: string }
  }>('/api/settings/ai/models', { preHandler: requireAdmin, schema: aiModelsSchema }, async (request, reply) => {
    try {
      const { provider, function: fn } = request.query

      if (!provider || !fn) {
        return reply.status(400).send({ error: 'provider and function are required' })
      }

      const models = await getModelsForFunctionWithCustom(provider as ProviderType, fn as AIFunction)
      return reply.send({ models })
    } catch (err) {
      fastify.log.error({ err }, 'Failed to get AI models')
      return reply.status(500).send({ error: 'Failed to get AI models' })
    }
  })

  /**
   * POST /api/settings/ai/custom-models
   */
  fastify.post<{
    Body: { provider: string; function: string; modelId: string; embeddingDimensions?: number }
  }>('/api/settings/ai/custom-models', { preHandler: requireAdmin, schema: addCustomModelSchema }, async (request, reply) => {
    try {
      const { provider, function: fn, modelId, embeddingDimensions } = request.body

      if (!provider || !fn || !modelId) {
        return reply.status(400).send({ error: 'provider, function, and modelId are required' })
      }

      if (provider !== 'ollama' && provider !== 'openai-compatible' && provider !== 'openrouter' && provider !== 'huggingface') {
        return reply.status(400).send({ error: 'Custom models are only supported for ollama, openai-compatible, openrouter, and huggingface providers' })
      }

      if (fn === 'embeddings') {
        if (!embeddingDimensions) {
          return reply.status(400).send({ error: 'embeddingDimensions is required for embedding models' })
        }
        if (!VALID_EMBEDDING_DIMENSIONS.includes(embeddingDimensions as typeof VALID_EMBEDDING_DIMENSIONS[number])) {
          return reply.status(400).send({ 
            error: `Invalid embedding dimensions. Supported: ${VALID_EMBEDDING_DIMENSIONS.join(', ')}` 
          })
        }
      }

      const customModel = await addCustomModel(
        provider as 'ollama' | 'openai-compatible' | 'openrouter' | 'huggingface',
        fn as AIFunction,
        modelId,
        fn === 'embeddings' ? embeddingDimensions : undefined
      )

      return reply.send({ success: true, model: customModel })
    } catch (err) {
      fastify.log.error({ err }, 'Failed to add custom model')
      return reply.status(500).send({ error: 'Failed to add custom model' })
    }
  })

  /**
   * DELETE /api/settings/ai/custom-models
   */
  fastify.delete<{
    Body: { provider: string; function: string; modelId: string }
  }>('/api/settings/ai/custom-models', { preHandler: requireAdmin, schema: deleteCustomModelSchema }, async (request, reply) => {
    try {
      const { provider, function: fn, modelId } = request.body

      if (!provider || !fn || !modelId) {
        return reply.status(400).send({ error: 'provider, function, and modelId are required' })
      }

      if (provider !== 'ollama' && provider !== 'openai-compatible' && provider !== 'openrouter' && provider !== 'huggingface') {
        return reply.status(400).send({ error: 'Custom models are only supported for ollama, openai-compatible, openrouter, and huggingface providers' })
      }

      const deleted = await deleteCustomModel(
        provider as 'ollama' | 'openai-compatible' | 'openrouter' | 'huggingface',
        fn as AIFunction,
        modelId
      )

      if (!deleted) {
        return reply.status(404).send({ error: 'Custom model not found' })
      }

      return reply.send({ success: true })
    } catch (err) {
      fastify.log.error({ err }, 'Failed to delete custom model')
      return reply.status(500).send({ error: 'Failed to delete custom model' })
    }
  })

  /**
   * GET /api/settings/ai/web-search/usage?role=webSearch|titleAnalysis
   *
   * Free-tier meter for a role that spends Google grounding quota: requests in
   * the last minute and since midnight US/Pacific, per API key, against limits
   * learned from Google's own 429s. Never 500s on a missing table — the summary
   * degrades to zeroes so the settings page still renders.
   *
   * Two roles can qualify: `webSearch` always, and `titleAnalysis` when it is
   * set to Gemini's built-in search. They hold different keys and therefore
   * different quota, so a combined response could not say which ran out.
   * Anything unrecognised falls back to `webSearch` rather than erroring — a
   * meter is not worth a 400.
   */
  fastify.get<{ Querystring: { role?: string } }>('/api/settings/ai/web-search/usage', { preHandler: requireAdmin, schema: { tags: ['settings'] } }, async (request, reply) => {
    try {
      const role: AIFunction = request.query.role === 'titleAnalysis' ? 'titleAnalysis' : 'webSearch'
      const config = await getFunctionConfig(role)
      const slots = await getGroundingKeySlots(role)
      // The free-tier ceilings are an assumption about the operator's Google
      // project, so they are only applied when the operator has made it. What
      // Google has actually enforced is shown either way.
      const usage = await getWebSearchUsageSummary(role, config?.model ?? null, slots, {
        freeTier: isFreeTierConfig(config),
      })
      return reply.send({
        configured: Boolean(config),
        provider: config?.provider ?? null,
        /** How many spare keys are configured; 0 means one 429 stops the role. */
        fallbackKeyCount: config ? resolveFallbackKeys(config).length : 0,
        ...usage,
      })
    } catch (err) {
      fastify.log.error({ err }, 'Failed to get grounding usage')
      return reply.status(500).send({ error: 'Failed to get Web Search usage' })
    }
  })

  /**
   * GET /api/settings/ai/pricing
   */
  fastify.get('/api/settings/ai/pricing', { preHandler: requireAdmin, schema: aiPricingSchema }, async (_request, reply) => {
    try {
      const aiConfig = await getAIConfig()

      // Every role, priced the same way, so the estimator's summary cannot
      // quietly omit a model that is spending money — which is what a
      // hand-written list of roles did to `titleAnalysis`, the one role that
      // runs across the whole library.
      const priced = await Promise.all(
        AI_FUNCTIONS.map(async (fn) => {
          const roleConfig = aiConfig[fn]
          return [
            fn,
            roleConfig ? await getPricingForModelAsync(roleConfig.provider, roleConfig.model, fn) : null,
          ] as const
        })
      )

      return reply.send(Object.fromEntries(priced))
    } catch (err) {
      fastify.log.error({ err }, 'Failed to get AI pricing')
      return reply.status(500).send({ error: 'Failed to get AI pricing' })
    }
  })

  /**
   * GET /api/settings/ai/pricing/status
   */
  fastify.get('/api/settings/ai/pricing/status', { preHandler: requireAdmin, schema: aiPricingStatusSchema }, async (_request, reply) => {
    try {
      const status = await getPricingCacheStatus()
      return reply.send(status)
    } catch (err) {
      fastify.log.error({ err }, 'Failed to get pricing cache status')
      return reply.status(500).send({ error: 'Failed to get pricing cache status' })
    }
  })

  /**
   * POST /api/settings/ai/pricing/refresh
   */
  fastify.post('/api/settings/ai/pricing/refresh', { preHandler: requireAdmin, schema: refreshAiPricingSchema }, async (_request, reply) => {
    try {
      await refreshPricingCache()
      const status = await getPricingCacheStatus()
      return reply.send({ success: true, status })
    } catch (err) {
      fastify.log.error({ err }, 'Failed to refresh pricing cache')
      return reply.status(500).send({ error: 'Failed to refresh pricing cache' })
    }
  })

  /**
   * GET /api/settings/ai/embeddings/sets
   *
   * Every stored set, not just the inactive ones, and each with the work the
   * embedding job would still have for it. Switching the embeddings model
   * starts a new set beside the old one and never deletes anything, so the
   * question an admin actually has at the dropdown is "have I already paid for
   * this one?" — which a bare row count cannot answer, since a fully populated
   * set still needs rebuilding when CANONICAL_TEXT_VERSION moves.
   *
   * `currentModel`/`totalSets` are kept for compatibility with anything still
   * reading the old shape.
   */
  fastify.get('/api/settings/ai/embeddings/sets', { preHandler: requireAdmin, schema: embeddingSetsSchema }, async (_request, reply) => {
    try {
      const report = await getEmbeddingSetsReport()

      return reply.send({
        ...report,
        currentModel: report.activeModel,
        totalSets: report.sets.length,
      })
    } catch (err) {
      fastify.log.error({ err }, 'Failed to get embedding sets')
      return reply.status(500).send({ error: 'Failed to get embedding sets' })
    }
  })

  /**
   * DELETE /api/settings/ai/embeddings/sets/:model
   *
   * Refuses the active set: deleting the vectors the instance is currently
   * querying would empty recommendations, the similarity graph and semantic
   * search all at once, with a full re-embed as the only way back.
   *
   * `dimensions` is optional and scopes the delete to one table family. The
   * listing is keyed on (model, dimension) because a custom model whose
   * configured dimensions were edited after embedding owns rows in two tables;
   * without the scope, deleting one row from the panel would take both.
   */
  fastify.delete<{ Params: { model: string }; Querystring: { dimensions?: number } }>('/api/settings/ai/embeddings/sets/:model', { preHandler: requireAdmin, schema: deleteEmbeddingSetSchema }, async (request, reply) => {
    const { model } = request.params
    const decodedModel = decodeURIComponent(model)
    const { dimensions } = request.query

    try {
      const aiConfig = await getAIConfig()
      const currentModel = aiConfig.embeddings ? `${aiConfig.embeddings.provider}:${aiConfig.embeddings.model}` : null

      if (decodedModel === currentModel) {
        return reply.status(400).send({ error: 'Cannot delete the active embedding set. Switch to a different model first.' })
      }

      const deleted = await deleteEmbeddingSet(decodedModel, dimensions)

      fastify.log.info({ model: decodedModel, dimensions, totalDeleted: deleted.total }, 'Deleted embedding set')
      return reply.send({
        success: true,
        message: `Deleted embedding set for ${decodedModel}`,
        deleted: {
          movies: deleted.movies,
          series: deleted.series,
          episodes: deleted.episodes,
        },
      })
    } catch (err) {
      fastify.log.error({ err, model: decodedModel }, 'Failed to delete embedding set')
      return reply.status(500).send({ error: 'Failed to delete embedding set' })
    }
  })

  /**
   * POST /api/settings/ai/embeddings/clear
   */
  fastify.post('/api/settings/ai/embeddings/clear', { preHandler: requireAdmin, schema: clearAllEmbeddingsSchema }, async (_request, reply) => {
    try {
      for (const dim of VALID_EMBEDDING_DIMENSIONS) {
        await query(`TRUNCATE embeddings_${dim}`)
        await query(`TRUNCATE series_embeddings_${dim}`)
        await query(`TRUNCATE episode_embeddings_${dim}`)
      }
      
      fastify.log.info('All embeddings cleared from dimension tables')
      return reply.send({ success: true, message: 'All embeddings cleared' })
    } catch (err) {
      fastify.log.error({ err }, 'Failed to clear embeddings')
      return reply.status(500).send({ error: 'Failed to clear embeddings' })
    }
  })

  /**
   * GET /api/settings/ai/embeddings/episodes
   *
   * Reports the setting alongside what is actually stored, because the two
   * answer different questions: turning generation off does not delete
   * anything, so an operator needs to see the row count to know whether there
   * is still space to reclaim.
   */
  fastify.get('/api/settings/ai/embeddings/episodes', { preHandler: requireAdmin, schema: episodeEmbeddingsSettingSchema }, async (_request, reply) => {
    try {
      const enabled = await getEpisodeEmbeddingsEnabled()

      // Count across every dimension, not just the active one: a dimension
      // switch leaves the old rows behind, and they are what is taking up room.
      const unions = VALID_EMBEDDING_DIMENSIONS.map(
        (d) => `SELECT COUNT(*)::int AS count FROM episode_embeddings_${d}`
      ).join(' UNION ALL ')
      const counts = await query<{ count: number }>(unions)
      const storedCount = counts.rows.reduce((sum, row) => sum + row.count, 0)

      const total = await query<{ count: number }>('SELECT COUNT(*)::int AS count FROM episodes')

      return reply.send({
        enabled,
        storedCount,
        episodeCount: total.rows[0]?.count ?? 0,
      })
    } catch (err) {
      fastify.log.error({ err }, 'Failed to read episode embedding settings')
      return reply.status(500).send({ error: 'Failed to read episode embedding settings' })
    }
  })

  /**
   * PATCH /api/settings/ai/embeddings/episodes
   */
  fastify.patch<{ Body: { enabled: boolean } }>('/api/settings/ai/embeddings/episodes', { preHandler: requireAdmin, schema: updateEpisodeEmbeddingsSettingSchema }, async (request, reply) => {
    try {
      const enabled = await setEpisodeEmbeddingsEnabled(request.body.enabled === true)
      fastify.log.info({ enabled }, 'Episode embeddings setting updated')
      return reply.send({ success: true, enabled })
    } catch (err) {
      fastify.log.error({ err }, 'Failed to update episode embedding settings')
      return reply.status(500).send({ error: 'Failed to update episode embedding settings' })
    }
  })

  /**
   * POST /api/settings/ai/embeddings/episodes/clear
   *
   * Separate from the setting on purpose: disabling generation is reversible
   * and free, deleting the rows costs a re-embed of every episode to undo. An
   * operator should be able to do the first without being talked into the
   * second.
   */
  fastify.post('/api/settings/ai/embeddings/episodes/clear', { preHandler: requireAdmin, schema: clearEpisodeEmbeddingsSchema }, async (_request, reply) => {
    try {
      let deleted = 0
      for (const dim of VALID_EMBEDDING_DIMENSIONS) {
        const result = await query(`DELETE FROM episode_embeddings_${dim}`)
        deleted += result.rowCount || 0
      }
      fastify.log.info({ deleted }, 'Episode embeddings cleared')
      return reply.send({ success: true, deleted })
    } catch (err) {
      fastify.log.error({ err }, 'Failed to clear episode embeddings')
      return reply.status(500).send({ error: 'Failed to clear episode embeddings' })
    }
  })

  /**
   * GET /api/settings/ai/embeddings/legacy
   */
  fastify.get('/api/settings/ai/embeddings/legacy', { preHandler: requireAdmin, schema: legacyEmbeddingsSchema }, async (_request, reply) => {
    try {
      const legacyInfo = await checkLegacyEmbeddingsExist()
      return reply.send(legacyInfo)
    } catch (err) {
      fastify.log.error({ err }, 'Failed to check legacy embeddings')
      return reply.status(500).send({ error: 'Failed to check legacy embeddings' })
    }
  })

  /**
   * DELETE /api/settings/ai/embeddings/legacy
   */
  fastify.delete('/api/settings/ai/embeddings/legacy', { preHandler: requireAdmin, schema: deleteLegacyEmbeddingsSchema }, async (_request, reply) => {
    try {
      const legacyInfo = await checkLegacyEmbeddingsExist()
      if (!legacyInfo.exists) {
        return reply.status(404).send({ error: 'No legacy embedding tables found' })
      }
      
      await dropLegacyEmbeddingTables()
      
      fastify.log.info({ tables: legacyInfo.tables }, 'Legacy embedding tables dropped')
      return reply.send({ 
        success: true, 
        message: 'Legacy embedding tables dropped',
        droppedTables: legacyInfo.tables,
        totalRowsDeleted: legacyInfo.totalRows
      })
    } catch (err) {
      fastify.log.error({ err }, 'Failed to drop legacy embeddings')
      return reply.status(500).send({ error: 'Failed to drop legacy embeddings' })
    }
  })

  /**
   * POST /api/settings/ai/test
   */
  fastify.post<{
    Body: {
      function: string
      provider: string
      model: string
      apiKey?: string
      baseUrl?: string
    }
  }>('/api/settings/ai/test', { preHandler: requireAdmin, schema: testAiProviderSchema }, async (request, reply) => {
    try {
      const { function: fn, provider, model, apiKey, baseUrl } = request.body

      if (!fn || !provider || !model) {
        return reply.status(400).send({ error: 'function, provider, and model are required' })
      }

      let testApiKey = apiKey
      let testBaseUrl = baseUrl
      if (!testApiKey || !testBaseUrl) {
        const savedConfig = await getFunctionConfig(fn as AIFunction)
        if (savedConfig && savedConfig.provider === provider) {
          testApiKey = testApiKey || savedConfig.apiKey
          testBaseUrl = testBaseUrl || savedConfig.baseUrl
        }
      }

      const result = await testProviderConnection(
        {
          provider: provider as ProviderType,
          model,
          apiKey: testApiKey,
          baseUrl: testBaseUrl,
        },
        fn as AIFunction
      )

      return reply.send(result)
    } catch (err) {
      fastify.log.error({ err }, 'Failed to test AI provider')
      return reply.status(500).send({ error: 'Failed to test AI provider' })
    }
  })

  /**
   * PATCH /api/settings/ai/:function
   */
  fastify.patch<{
    Params: { function: string }
    Body: {
      provider: string
      model: string
      apiKey?: string
      baseUrl?: string
      fallbackApiKeys?: string[]
      freeTier?: boolean
      fallbackModels?: { provider: string; model: string }[]
      callSpacingSeconds?: number
    }
  }>('/api/settings/ai/:function', { preHandler: requireAdmin, schema: { tags: ['settings'] } }, async (request, reply) => {
    try {
      const fn = request.params.function
      const {
        provider,
        model,
        apiKey,
        baseUrl,
        fallbackApiKeys,
        freeTier,
        fallbackModels,
        callSpacingSeconds,
      } = request.body

      if (!isAIFunction(fn)) {
        return reply.status(400).send({ error: `Invalid function. Must be one of: ${AI_FUNCTIONS.join(', ')}` })
      }

      // `ai_provider_credentials` is keyed by PROVIDER and shared by every role
      // on it, which is exactly wrong for a role that can spend Google grounding
      // quota: publishing its key there would let another role borrow it,
      // silently putting that spend back on the free-tier quota a separate role
      // exists to protect. Its key stays on the role, like its fallbacks do.
      //
      // `titleAnalysis` is included because it can be switched to Gemini's
      // built-in search (see core `analysis/mode.ts`). It costs nothing when it
      // is pointed at a local model — there is no key to protect — and the
      // alternative is a setting whose safety depends on another setting.
      const isGroundingRole = fn === 'webSearch' || fn === 'titleAnalysis'

      if ((apiKey || baseUrl) && !isGroundingRole) {
        const credentialsJson = await getSystemSetting('ai_provider_credentials')
        const credentials = credentialsJson ? JSON.parse(credentialsJson) : {}

        credentials[provider] = {
          ...(credentials[provider] || {}),
          ...(apiKey && { apiKey }),
          ...(baseUrl && { baseUrl }),
        }

        await setSystemSetting('ai_provider_credentials', JSON.stringify(credentials), 'Stored credentials for AI providers')
      }

      const existing = await getFunctionConfig(fn)

      // A non-grounding role's primary key survives a keyless save because
      // withResolvedCredentials finds it again in the shared store. A grounding
      // role's does not go there at all, so an omitted key has to be carried
      // over here or saving a model change would wipe the credential.
      const nextApiKey = apiKey ?? (isGroundingRole ? existing?.apiKey : undefined)

      // Fallback keys live only here, so an omitted field means "leave alone"
      // and only an explicit empty array clears them.
      const nextFallbackKeys =
        fallbackApiKeys === undefined
          ? (existing?.fallbackApiKeys ??
            (existing?.fallbackApiKey ? [existing.fallbackApiKey] : undefined))
          : fallbackApiKeys.map((k) => k.trim()).filter((k) => k.length > 0)

      // Same rule as the keys, for the same reason: the flag lives only here,
      // so an omitted field means "leave alone". Unlike the keys it is stored
      // only when it is `false` — absent already reads as free tier, and
      // writing the default would just make every role's config noisier.
      const nextFreeTier = freeTier === undefined ? existing?.freeTier : freeTier

      // Same rule again for the two fields the Title Analysis card adds. They
      // live only here — there is no shared store for "which spare model" or
      // "how fast may this role call" — so an omitted field is "leave alone"
      // and an empty array is the only way to clear the list.
      //
      // Validated rather than trusted: an unknown provider id would be stored,
      // reach `createProviderInstance`, and throw on the first title of a
      // library pass. A blank model id is dropped for the same reason
      // `resolveFallbackModels` drops it — a fallback that cannot resolve is
      // worse than no fallback, because it is only discovered at the moment
      // the primary has already failed.
      const nextFallbackModels =
        fallbackModels === undefined
          ? existing?.fallbackModels
          : fallbackModels
              .filter((m) => PROVIDERS.some((p) => p.id === m?.provider) && m?.model?.trim())
              .map((m) => ({ provider: m.provider as ProviderType, model: m.model.trim() }))

      // Clamped, not rejected: this arrives from a number field, and a bad
      // value costs pacing rather than correctness. 0 is meaningful — it is how
      // the card says "pacing off" — so it survives the clamp untouched.
      const nextSpacing =
        callSpacingSeconds === undefined
          ? existing?.callSpacingSeconds
          : Math.min(
              Math.max(Math.round(callSpacingSeconds) || 0, 0),
              MAX_CALL_SPACING_SECONDS
            )

      await setFunctionConfig(fn, {
        provider: provider as ProviderType,
        model,
        apiKey: nextApiKey,
        baseUrl,
        fallbackApiKeys: nextFallbackKeys?.length ? nextFallbackKeys : undefined,
        freeTier: nextFreeTier === false ? false : undefined,
        fallbackModels: nextFallbackModels?.length ? nextFallbackModels : undefined,
        // Stored only when it is doing something, like `freeTier` above:
        // writing the default into every role's config would just make the blob
        // noisier without saying anything.
        callSpacingSeconds: nextSpacing && nextSpacing > 0 ? nextSpacing : undefined,
      })

      const config = await getFunctionConfig(fn)
      return reply.send({ config })
    } catch (err) {
      fastify.log.error({ err }, 'Failed to update AI function config')
      return reply.status(500).send({ error: 'Failed to update AI function configuration' })
    }
  })
}
