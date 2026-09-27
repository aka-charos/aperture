import type { FastifyInstance, FastifyReply } from 'fastify'
import { isVisibleConnection } from '@aperture/core'
import type { SessionUser } from '../../../../plugins/auth.js'

export function requireSelfOrAdmin(
  id: string,
  currentUser: SessionUser,
  reply: FastifyReply
): boolean {
  if (id !== currentUser.id && !currentUser.isAdmin) {
    reply.status(403).send({ error: 'Forbidden' })
    return false
  }
  return true
}

/**
 * READ-ONLY widening of `requireSelfOrAdmin`: self, an admin, or a visible
 * connection of the target (docs/plans/social-connections.md §6.5).
 *
 * Only the two watch-history LIST reads use it. Everything that edits a
 * history (mark watched/unwatched), and the stats pages, stay self-or-admin: a
 * connection shares what someone watched, never the right to change it or the
 * rest of their profile. A caller who is neither self nor admin must also
 * scope what it returns to THEIR library scope — see `connectedReadNeedsScope`.
 */
export async function requireSelfOrAdminOrConnected(
  id: string,
  currentUser: SessionUser,
  reply: FastifyReply
): Promise<boolean> {
  if (id === currentUser.id || currentUser.isAdmin) return true
  // isVisibleConnection answers false for a malformed id rather than letting
  // the uuid cast throw, so an unvalidated route param is safe here.
  if (await isVisibleConnection(currentUser.id, id)) return true
  reply.status(403).send({ error: 'Forbidden' })
  return false
}

/**
 * Whether a history read is someone ELSE's, read as a connection. The viewer's
 * own record is unscoped (F-136), and so is an admin reading anyone's (an admin
 * surface); a connection sees only titles they could open themselves, or a
 * poster in the other person's history would answer "not found" when clicked.
 */
export function connectedReadNeedsScope(id: string, currentUser: SessionUser): boolean {
  return id !== currentUser.id && !currentUser.isAdmin
}

export async function streamSseGenerator<T>(
  fastify: FastifyInstance,
  reply: FastifyReply,
  userId: string,
  generator: AsyncGenerator<string, T, unknown>,
  options: {
    errorLogMessage: string
    errorResponseMessage: string
  }
): Promise<void> {
  try {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })

    let result = await generator.next()
    while (!result.done) {
      if (typeof result.value === 'string') {
        reply.raw.write(`data: ${JSON.stringify({ type: 'text', content: result.value })}\n\n`)
      }
      result = await generator.next()
    }

    const stats = result.value
    reply.raw.write(`data: ${JSON.stringify({ type: 'done', stats })}\n\n`)
    reply.raw.end()
  } catch (error) {
    // `err`, not `error`: pino serializes an Error only under `err`, and under
    // any other key it logs `{}` -- which is all a failed identity said (F-129).
    fastify.log.error({ err: error, userId }, options.errorLogMessage)
    if (reply.raw.headersSent) {
      reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: 'Failed to generate' })}\n\n`)
      reply.raw.end()
    } else {
      reply.status(500).send({ error: options.errorResponseMessage })
    }
  }
}
