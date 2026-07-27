import type { FastifyInstance } from 'fastify'
import { requireAuth, type SessionUser } from '../../../plugins/auth.js'
import {
  generateAIPreferences,
  generateAIPlaylistName,
  generateAIPlaylistDescription,
} from '@aperture/core'

/**
 * Core turns provider failures into an actionable sentence (bad key, quota, empty output from a
 * reasoning model). Pass it on — the dialog shows it verbatim, and a generic "failed" here is
 * exactly what left users re-clicking the button with nothing to go on.
 */
function aiErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

export function registerAiHandlers(fastify: FastifyInstance) {
  /**
   * POST /api/channels/ai-preferences
   * Generate AI-powered text preferences based on taste profile, genres, and example movies
   *
   * `userNotes` is what the dialog already had in the preferences box, sent only when the user
   * picks "build on what I wrote". Sending nothing keeps the old behaviour — a fresh take that
   * ignores the box — which is how a re-roll gets away from an earlier generation.
   */
  fastify.post<{
    Body: {
      genres: string[]
      exampleMovieIds: string[]
      exampleSeriesIds?: string[]
      userNotes?: string
    }
  }>(
    '/api/channels/ai-preferences',
    { preHandler: requireAuth, schema: { tags: ["playlists"] } },
    async (request, reply) => {
      const currentUser = request.user as SessionUser
      const { genres, exampleMovieIds, exampleSeriesIds, userNotes } = request.body

      try {
        const preferences = await generateAIPreferences(
          currentUser.id,
          genres || [],
          exampleMovieIds || [],
          exampleSeriesIds || [],
          userNotes
        )

        return reply.send({ preferences })
      } catch (err) {
        request.log.error({ err, userId: currentUser.id }, 'Failed to generate AI preferences')
        return reply
          .status(500)
          .send({ error: aiErrorMessage(err, 'Failed to generate AI preferences') })
      }
    }
  )

  /**
   * POST /api/channels/ai-name
   * Generate AI-powered playlist name based on genres, example movies, and preferences
   */
  fastify.post<{
    Body: {
      genres: string[]
      exampleMovieIds: string[]
      exampleSeriesIds?: string[]
      textPreferences?: string
    }
  }>(
    '/api/channels/ai-name',
    { preHandler: requireAuth, schema: { tags: ["playlists"] } },
    async (request, reply) => {
      const currentUser = request.user as SessionUser
      const { genres, exampleMovieIds, exampleSeriesIds, textPreferences } = request.body

      try {
        const name = await generateAIPlaylistName(
          genres || [],
          exampleMovieIds || [],
          textPreferences,
          currentUser.id,
          exampleSeriesIds || []
        )

        return reply.send({ name })
      } catch (err) {
        request.log.error({ err }, 'Failed to generate AI playlist name')
        return reply
          .status(500)
          .send({ error: aiErrorMessage(err, 'Failed to generate playlist name') })
      }
    }
  )

  /**
   * POST /api/channels/ai-description
   * Generate AI-powered playlist description based on genres, example movies, preferences, and name
   */
  fastify.post<{
    Body: {
      genres: string[]
      exampleMovieIds: string[]
      exampleSeriesIds?: string[]
      textPreferences?: string
      playlistName?: string
    }
  }>(
    '/api/channels/ai-description',
    { preHandler: requireAuth, schema: { tags: ["playlists"] } },
    async (request, reply) => {
      const currentUser = request.user as SessionUser
      const { genres, exampleMovieIds, exampleSeriesIds, textPreferences, playlistName } = request.body

      try {
        const description = await generateAIPlaylistDescription(
          genres || [],
          exampleMovieIds || [],
          textPreferences,
          playlistName,
          currentUser.id,
          exampleSeriesIds || []
        )

        return reply.send({ description })
      } catch (err) {
        request.log.error({ err }, 'Failed to generate AI playlist description')
        return reply
          .status(500)
          .send({ error: aiErrorMessage(err, 'Failed to generate playlist description') })
      }
    }
  )
}



