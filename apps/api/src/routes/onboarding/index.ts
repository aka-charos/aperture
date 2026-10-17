/**
 * Onboarding: what the welcome tour, the getting-started checklist and the
 * first-visit hints need to know about the person signed in.
 *
 * Every decision ships as a decided value (whether the tour starts by itself,
 * which checklist items are done), so the bundle holds no thresholds. The
 * rules are core `onboarding/rules.ts`.
 *
 * An assumed session ("view as user") is read-only, so its PATCH is refused by
 * the auth plugin like any other write; the client does not send one.
 */
import type { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../../plugins/auth.js'
import { can } from '../../lib/permissions.js'
import { getOnboardingSummary, readOnboardingPatch, updateOnboardingState } from '@aperture/core'

const idList = { type: 'array', items: { type: 'string' } } as const

const stateSchema = {
  type: 'object',
  properties: {
    welcome: { type: 'string', enum: ['done', 'dismissed'] },
    toursSeen: idList,
    hintsDismissed: idList,
    checklistDismissed: { type: 'boolean' },
    seen: idList,
  },
} as const

const summarySchema = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: ['tour', 'offer', 'none'] },
    state: stateSchema,
    watchingEnabled: { type: 'boolean' },
    checklist: {
      type: 'object',
      properties: {
        complete: { type: 'boolean' },
        recommendations: { type: 'string', enum: ['ready', 'pending', 'off'] },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              done: { type: 'boolean' },
              progress: { type: 'integer' },
              goal: { type: 'integer' },
            },
          },
        },
      },
    },
  },
} as const

const onboardingRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/onboarding
   */
  fastify.get(
    '/api/onboarding',
    {
      preHandler: requireAuth,
      schema: {
        tags: ['auth'],
        description:
          'Whether the welcome tour starts by itself, the getting-started checklist, and the tours and hints already seen.',
        response: { 200: summarySchema },
      },
    },
    async (request) => {
      const user = request.user!
      return getOnboardingSummary(user.id, { assistant: can(user, 'assistant') })
    }
  )

  /**
   * PATCH /api/onboarding
   * Lists are added to, never replaced; `resetTips` clears the tours and hints
   * seen so they are offered again.
   */
  fastify.patch(
    '/api/onboarding',
    {
      preHandler: requireAuth,
      schema: {
        tags: ['auth'],
        description: 'Record a tour finished, a hint closed, the checklist dismissed, or reset the tips.',
        body: {
          type: 'object',
          properties: {
            welcome: { type: 'string', enum: ['done', 'dismissed'] },
            toursSeen: idList,
            hintsDismissed: idList,
            checklistDismissed: { type: 'boolean' },
            seen: idList,
            resetTips: { type: 'boolean' },
          },
          additionalProperties: false,
        },
        response: {
          200: stateSchema,
          400: { type: 'object', properties: { error: { type: 'string' } } },
        },
      },
    },
    async (request, reply) => {
      const read = readOnboardingPatch(request.body)
      if ('error' in read) return reply.status(400).send({ error: read.error })
      return updateOnboardingState(request.user!.id, read.patch)
    }
  )
}

export default onboardingRoutes
