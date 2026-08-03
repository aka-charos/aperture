/**
 * i18n Routes Module
 *
 * - GET /api/i18n/overrides/:lng — public, merges the operator file layer
 *   and the DB (Translations editor) layer.
 * - /api/i18n/admin/overrides — admin-only CRUD backing the Translations
 *   editor and its CSV import.
 */
import type { FastifyPluginAsync } from 'fastify'
import { registerPublicOverridesHandlers, registerAdminOverridesHandlers } from './handlers/index.js'

const i18nRoutes: FastifyPluginAsync = async (fastify) => {
  registerPublicOverridesHandlers(fastify)
  registerAdminOverridesHandlers(fastify)
}

export default i18nRoutes
