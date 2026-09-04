/**
 * Issue reporting, proxied to Seerr.
 *
 * No local table and no reconcile job, deliberately. `GET /issue` scopes
 * itself — a user holding only CREATE_ISSUES gets `createdBy = them` applied
 * server-side — so acting as the user returns their own handful of rows, and
 * a mirror would buy a per-title index nobody needs at the cost of comments
 * being stale exactly when someone is having a conversation on them.
 *
 * The attribution rule, once: a user-scoped read or write acts as the user
 * (`X-API-User`), and an admin-scoped read acts as the API key's owner, who is
 * Seerr user 1 and holds MANAGE_ISSUES. That single choice gives correct
 * authorship, correct scoping and a working admin view with no permission
 * juggling — and it means Seerr's own notification agents fire with the right
 * person attached, since these are real Seerr issues by real Seerr users.
 */
import type { FastifyPluginAsync } from 'fastify'
import { requireAuth, type SessionUser } from '../../plugins/auth.js'

import {
  isSeerrConfigured,
  getSeerrMediaStatus,
  createSeerrIssue,
  listSeerrIssues,
  getSeerrIssue,
  createSeerrIssueComment,
  seerrUserExists,
} from '@aperture/core'
import {
  clearStaleSeerrUserId,
  ensureSeerrUserIdForRequest,
} from '../../lib/seerrActingUser.js'
import { attachLibraryMediaIds } from '../../lib/libraryLinks.js'
import { mapSeerrIssue, toIssueKindCode } from './issueMapping.js'
import {
  issueSchemas,
  listIssuesSchema,
  createIssueSchema,
  getIssueSchema,
  commentIssueSchema,
} from './schemas.js'

/** Upstream refusals are the user's answer; anything else is our outage. */
function upstreamStatus(status: number | null | undefined): number {
  return status != null && status >= 400 && status < 500 ? status : 502
}

const issueRoutes: FastifyPluginAsync = async (fastify) => {
  for (const [name, schema] of Object.entries(issueSchemas)) {
    fastify.addSchema({ $id: name, ...schema })
  }

  /**
   * GET /api/issues
   */
  fastify.get<{ Querystring: { scope?: string; filter?: string } }>(
    '/api/issues',
    { preHandler: requireAuth, schema: listIssuesSchema },
    async (request, reply) => {
      const currentUser = request.user as SessionUser

      if (!(await isSeerrConfigured())) {
        // Distinct from an empty list. "Nobody has reported anything" and
        // "issue reporting is switched off" look identical in a table and mean
        // opposite things, and only the second is something an operator fixes.
        return reply.status(503).send({
          error: 'Issue reporting unavailable',
          message: 'Seerr is not configured',
        })
      }

      const wantsAllUsers = request.query.scope === 'all' && currentUser.isAdmin
      const filter =
        request.query.filter === 'open' || request.query.filter === 'resolved'
          ? request.query.filter
          : 'all'

      // Acting as nobody means acting as the API key's owner, who can see
      // everything. Acting as the user makes Seerr scope the list for us.
      const actAsUserId = wantsAllUsers
        ? undefined
        : (await ensureSeerrUserIdForRequest(currentUser.id, request.log)) ?? undefined

      const listed = await listSeerrIssues({
        filter,
        ...(actAsUserId != null ? { actAsUserId } : {}),
      })

      if (!listed) {
        return reply.status(502).send({ error: 'Failed to load issues from Seerr' })
      }

      // An unmapped user has no Seerr identity, so the unscoped call would
      // return the API key owner's view — everyone's issues — to someone who
      // is not an admin. Empty is the honest answer for them.
      if (!wantsAllUsers && actAsUserId == null) {
        return reply.send({ issues: [], total: 0, scope: 'mine', unlinked: true })
      }

      const mapped = listed.results.map(mapSeerrIssue)
      const withLibrary = await attachLibraryMediaIds(mapped)

      return reply.send({
        issues: withLibrary,
        total: listed.pageInfo?.results ?? withLibrary.length,
        scope: wantsAllUsers ? 'all' : 'mine',
        unlinked: false,
      })
    }
  )

  /**
   * POST /api/issues
   */
  fastify.post<{
    Body: {
      tmdbId: number
      mediaType: 'movie' | 'series'
      kind: string
      message: string
      problemSeason?: number
      problemEpisode?: number
    }
  }>(
    '/api/issues',
    { preHandler: requireAuth, schema: createIssueSchema },
    async (request, reply) => {
      const currentUser = request.user as SessionUser
      const { tmdbId, mediaType, kind, message, problemSeason, problemEpisode } = request.body

      if (!(await isSeerrConfigured())) {
        return reply.status(503).send({
          error: 'Issue reporting unavailable',
          message: 'Seerr is not configured',
        })
      }

      const issueType = toIssueKindCode(kind)
      if (issueType == null) {
        return reply.status(400).send({ error: 'Unknown issue type' })
      }

      // Seerr's issue is keyed by its INTERNAL media row, not a TMDb id, and
      // that row exists only for titles its own scan has seen. Resolving it
      // here is also the check for whether an issue can be filed at all.
      const status = await getSeerrMediaStatus(tmdbId, mediaType === 'movie' ? 'movie' : 'tv')
      const seerrMediaId = status?.seerrMediaId
      if (seerrMediaId == null) {
        return reply.status(409).send({
          error: 'Title is not known to Seerr',
          message:
            'Seerr has no record of this title, so there is nothing to report against. It usually means Seerr is not scanning this library.',
        })
      }

      const actAsUserId =
        (await ensureSeerrUserIdForRequest(currentUser.id, request.log)) ?? undefined

      const body = {
        issueType,
        message,
        mediaId: seerrMediaId,
        // 0 is Seerr's own "the whole title", so an omitted season sends 0
        // rather than being left out and defaulting somewhere else.
        problemSeason: problemSeason ?? 0,
        problemEpisode: problemEpisode ?? 0,
      }

      let result = await createSeerrIssue(body, {
        ...(actAsUserId != null ? { actAsUserId } : {}),
      })

      // A 403 while acting as someone is either a stale link or a genuine
      // refusal, and guessing is wrong in both directions — so ask Seerr which.
      if (!result.success && result.status === 403 && actAsUserId != null) {
        if (!(await seerrUserExists(actAsUserId))) {
          await clearStaleSeerrUserId(currentUser.id, request.log)
          result = await createSeerrIssue(body)
        }
      }

      if (!result.success) {
        return reply.status(upstreamStatus(result.status)).send({
          error: 'Failed to report the issue',
          message: result.message,
        })
      }

      return reply.send({ success: true, issueId: result.issueId })
    }
  )

  /**
   * GET /api/issues/:id
   *
   * Seerr enforces the read itself — the creator, or someone who can manage
   * issues — so acting as the user is what makes a 403 mean "not yours"
   * rather than "you are not the admin".
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/issues/:id',
    { preHandler: requireAuth, schema: getIssueSchema },
    async (request, reply) => {
      const currentUser = request.user as SessionUser
      const issueId = Number.parseInt(request.params.id, 10)

      if (!Number.isFinite(issueId)) {
        return reply.status(400).send({ error: 'Invalid issue id' })
      }
      if (!(await isSeerrConfigured())) {
        return reply.status(503).send({ error: 'Issue reporting unavailable' })
      }

      const actAsUserId = currentUser.isAdmin
        ? undefined
        : (await ensureSeerrUserIdForRequest(currentUser.id, request.log)) ?? undefined

      const issue = await getSeerrIssue(issueId, {
        ...(actAsUserId != null ? { actAsUserId } : {}),
      })
      if (!issue) {
        return reply.status(404).send({ error: 'Issue not found' })
      }

      const [withLibrary] = await attachLibraryMediaIds([mapSeerrIssue(issue)])
      return reply.send(withLibrary)
    }
  )

  /**
   * POST /api/issues/:id/comment
   */
  fastify.post<{ Params: { id: string }; Body: { message: string } }>(
    '/api/issues/:id/comment',
    { preHandler: requireAuth, schema: commentIssueSchema },
    async (request, reply) => {
      const currentUser = request.user as SessionUser
      const issueId = Number.parseInt(request.params.id, 10)

      if (!Number.isFinite(issueId)) {
        return reply.status(400).send({ error: 'Invalid issue id' })
      }
      if (!(await isSeerrConfigured())) {
        return reply.status(503).send({ error: 'Issue reporting unavailable' })
      }

      const actAsUserId =
        (await ensureSeerrUserIdForRequest(currentUser.id, request.log)) ?? undefined

      // There is no on-behalf-of field for comments in any Seerr version, so
      // an unmapped user's reply would be posted under the API key owner's
      // name — someone else's words attributed to the admin. Refuse instead.
      if (actAsUserId == null && !currentUser.isAdmin) {
        return reply.status(422).send({
          error: 'Seerr account not linked',
          message:
            'Your account could not be matched to a Seerr user, so a reply would be posted under someone else’s name. Ask an admin to link it.',
        })
      }

      const result = await createSeerrIssueComment(issueId, request.body.message, {
        ...(actAsUserId != null ? { actAsUserId } : {}),
      })

      if (!result.success) {
        return reply.status(upstreamStatus(result.status)).send({
          error: 'Failed to post the reply',
          message: result.message,
        })
      }

      return reply.send({ success: true })
    }
  )
}

export default issueRoutes
