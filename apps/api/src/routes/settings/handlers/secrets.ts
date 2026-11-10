/**
 * Bitwarden Secrets Manager settings.
 *
 * Endpoints (admin only):
 * - GET    /api/settings/secrets                - Connection, linkable secret names, and where each credential comes from
 * - POST   /api/settings/secrets/refresh        - Read the Bitwarden project again now
 * - PUT    /api/settings/secrets/bindings/:id   - Read a credential from a named secret
 * - DELETE /api/settings/secrets/bindings/:id   - Stop reading a credential from Bitwarden
 *
 * No response here ever carries a secret's value or the access token: names,
 * counts and states only (lib/secretExposure.ts, rule 1). The access token,
 * project and server come from the environment and cannot be changed from the
 * browser, so a stolen admin session cannot repoint this at another vault.
 */
import type { FastifyInstance } from 'fastify'
import {
  bindSecret,
  getBitwardenSecretNames,
  getBitwardenSecretsStatus,
  getSecretBindings,
  refreshBitwardenSecrets,
  unbindSecret,
} from '@aperture/core'
import { requireAdmin } from '../../../plugins/auth.js'

const TAGS = ['settings']

const bindingParams = {
  type: 'object' as const,
  required: ['id'],
  properties: { id: { type: 'string' as const, description: 'Credential id, as listed by GET /api/settings/secrets' } },
}

/** Why a link was refused, in words an admin can act on. */
const BIND_REFUSALS: Record<string, { status: number; error: string }> = {
  unknownCredential: { status: 404, error: 'Unknown credential' },
  invalidName: { status: 400, error: 'That is not a usable secret name' },
  missing: { status: 409, error: 'No secret of that name is in the Bitwarden project' },
  ambiguous: { status: 409, error: 'Two secrets in the Bitwarden project share that name' },
  empty: { status: 409, error: 'That secret holds no value' },
  unreachable: { status: 503, error: 'The Bitwarden project could not be read' },
}

async function overview(force: boolean) {
  await refreshBitwardenSecrets(force)
  return {
    status: getBitwardenSecretsStatus(),
    secretNames: getBitwardenSecretNames(),
    bindings: await getSecretBindings(),
  }
}

export function registerSecretsHandlers(fastify: FastifyInstance) {
  fastify.get(
    '/api/settings/secrets',
    {
      preHandler: requireAdmin,
      schema: {
        tags: TAGS,
        summary: 'Get Bitwarden Secrets Manager status',
        description:
          'Connection state, the names of the secrets that can be linked, and where each credential is read from (admin only). Never returns a secret value.',
      },
    },
    async (_request, reply) => {
      try {
        return reply.send(await overview(false))
      } catch (err) {
        fastify.log.error({ err }, 'Failed to read Bitwarden secrets status')
        return reply.status(500).send({ error: 'Failed to read Bitwarden secrets status' })
      }
    }
  )

  fastify.post(
    '/api/settings/secrets/refresh',
    {
      preHandler: requireAdmin,
      schema: {
        tags: TAGS,
        summary: 'Re-read the Bitwarden project',
        description: 'Reads the Bitwarden project again now, instead of waiting for the next scheduled read (admin only).',
      },
    },
    async (_request, reply) => {
      try {
        return reply.send(await overview(true))
      } catch (err) {
        fastify.log.error({ err }, 'Failed to refresh Bitwarden secrets')
        return reply.status(500).send({ error: 'Failed to refresh Bitwarden secrets' })
      }
    }
  )

  fastify.put<{ Params: { id: string }; Body: { secretName: string } }>(
    '/api/settings/secrets/bindings/:id',
    {
      preHandler: requireAdmin,
      schema: {
        tags: TAGS,
        summary: 'Read a credential from a Bitwarden secret',
        description:
          'Links a credential to a named secret in the Bitwarden project, replacing any value saved for it (admin only). Refused unless the secret can be read.',
        params: bindingParams,
        body: {
          type: 'object' as const,
          required: ['secretName'],
          properties: { secretName: { type: 'string' as const, minLength: 1, maxLength: 500 } },
        },
      },
    },
    async (request, reply) => {
      try {
        const result = await bindSecret(request.params.id, request.body.secretName)
        if (!result.ok) {
          const refusal = BIND_REFUSALS[result.reason]
          return reply.status(refusal.status).send({ error: refusal.error, reason: result.reason })
        }
        return reply.send(await overview(false))
      } catch (err) {
        fastify.log.error({ err }, 'Failed to link a credential to Bitwarden')
        return reply.status(500).send({ error: 'Failed to link the credential' })
      }
    }
  )

  fastify.delete<{ Params: { id: string } }>(
    '/api/settings/secrets/bindings/:id',
    {
      preHandler: requireAdmin,
      schema: {
        tags: TAGS,
        summary: 'Stop reading a credential from Bitwarden',
        description:
          'Removes the link, leaving the credential unset until it is entered on its own settings page (admin only).',
        params: bindingParams,
      },
    },
    async (request, reply) => {
      try {
        const result = await unbindSecret(request.params.id)
        if (!result.ok) {
          return result.reason === 'unknownCredential'
            ? reply.status(404).send({ error: 'Unknown credential', reason: result.reason })
            : reply.status(409).send({ error: 'That credential is not linked to Bitwarden', reason: result.reason })
        }
        return reply.send(await overview(false))
      } catch (err) {
        fastify.log.error({ err }, 'Failed to unlink a credential from Bitwarden')
        return reply.status(500).send({ error: 'Failed to unlink the credential' })
      }
    }
  )
}
