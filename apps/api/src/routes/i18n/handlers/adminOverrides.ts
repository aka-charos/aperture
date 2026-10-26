import type { FastifyInstance } from 'fastify'
import { requireAdmin } from '../../../plugins/auth.js'
import { adminOverrideSchemas } from '../schemas.js'
import { readFileOverrides } from './publicOverrides.js'

export function registerAdminOverridesHandlers(fastify: FastifyInstance) {
  /**
   * GET /api/i18n/admin/overrides
   *
   * Admin only. Every translation override row, every locale — the
   * Translations editor's one bulk load, merged client-side against the
   * bundled default strings it already has.
   */
  fastify.get(
    '/api/i18n/admin/overrides',
    { preHandler: requireAdmin, schema: adminOverrideSchemas.list },
    async (_request, reply) => {
      try {
        const { listAllOverrides } = await import('@aperture/core')
        const overrides = await listAllOverrides()
        return reply.send({ overrides })
      } catch (err) {
        fastify.log.error({ err }, 'Failed to list i18n overrides')
        return reply.status(500).send({ error: 'Failed to list translation overrides' })
      }
    }
  )

  /**
   * GET /api/i18n/admin/file-overrides/:locale
   *
   * Admin only. The operator file layer alone. The public route merges it
   * with the database rows, which hides the file's value for any key that
   * also has a row — and that value is exactly what deleting the row brings
   * back, so the inline editor needs it to show what Reset will do.
   */
  fastify.get<{ Params: { locale: string } }>(
    '/api/i18n/admin/file-overrides/:locale',
    { preHandler: requireAdmin, schema: adminOverrideSchemas.fileLayer },
    async (request, reply) => {
      void reply.header('Cache-Control', 'no-store')
      const { locale } = request.params
      const { isValidAppLocale } = await import('@aperture/core')
      if (!isValidAppLocale(locale)) {
        return reply.status(400).send({ error: 'Unknown locale' })
      }
      return reply.send(await readFileOverrides(fastify, locale))
    }
  )

  /**
   * PUT /api/i18n/admin/overrides/:locale/:key
   *
   * Admin only. Upserts a single override. A null/empty value deletes it,
   * resetting the key back to the file/bundled default.
   */
  fastify.put<{ Params: { locale: string; key: string }; Body: { value: string | null } }>(
    '/api/i18n/admin/overrides/:locale/:key',
    { preHandler: requireAdmin, schema: adminOverrideSchemas.upsert },
    async (request, reply) => {
      const { locale, key } = request.params
      try {
        const { upsertOverride, isValidOverrideKey, isValidAppLocale } = await import('@aperture/core')
        if (!isValidAppLocale(locale)) {
          return reply.status(400).send({ error: 'Unknown locale' })
        }
        if (!isValidOverrideKey(key)) {
          return reply.status(400).send({ error: 'Invalid key' })
        }
        const row = await upsertOverride(locale, key, request.body.value)
        return reply.send({ locale, key, value: row?.value ?? null })
      } catch (err) {
        fastify.log.error({ err, locale, key }, 'Failed to upsert i18n override')
        return reply.status(500).send({ error: 'Failed to save translation override' })
      }
    }
  )

  /**
   * POST /api/i18n/admin/overrides/bulk
   *
   * Admin only. CSV import's write path — upserts/deletes many entries in
   * one transaction. The whole batch is rejected (nothing written) if any
   * entry has an invalid locale or key.
   */
  fastify.post<{ Body: { overrides: { locale: string; key: string; value: string | null }[] } }>(
    '/api/i18n/admin/overrides/bulk',
    { preHandler: requireAdmin, schema: adminOverrideSchemas.bulk },
    async (request, reply) => {
      try {
        const { bulkUpsertOverrides, isValidOverrideKey, isValidAppLocale } = await import('@aperture/core')
        const items = request.body.overrides
        const bad = items.find((item) => !isValidAppLocale(item.locale) || !isValidOverrideKey(item.key))
        if (bad) {
          return reply.status(400).send({ error: `Invalid entry: ${bad.locale}/${bad.key}` })
        }
        const result = await bulkUpsertOverrides(items)
        return reply.send(result)
      } catch (err) {
        fastify.log.error({ err }, 'Failed to bulk-upsert i18n overrides')
        return reply.status(500).send({ error: 'Failed to import translations' })
      }
    }
  )
}
