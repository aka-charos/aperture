import type { FastifyInstance } from 'fastify'
import path from 'path'
import { promises as fs } from 'fs'

/** Locale codes are 2-letter (see packages/core APP_LOCALE_OPTIONS); reject anything else. */
const LNG_RE = /^[a-z]{2}$/

/** Directory holding operator-supplied `overrides.<lng>.json` files (bind-mountable). */
function overridesDir(): string {
  return process.env.I18N_OVERRIDES_DIR || '/config/i18n'
}

async function readFileOverrides(fastify: FastifyInstance, lng: string): Promise<Record<string, unknown>> {
  const file = path.join(overridesDir(), `overrides.${lng}.json`)
  try {
    const raw = await fs.readFile(file, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    fastify.log.warn({ file }, 'i18n overrides file is not a JSON object; ignoring')
  } catch (err) {
    // Missing file is the normal "no overrides" case; log anything else.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      fastify.log.warn({ err, file }, 'Failed to read i18n overrides')
    }
  }
  return {}
}

export function registerPublicOverridesHandlers(fastify: FastifyInstance) {
  /**
   * GET /api/i18n/overrides/:lng
   *
   * Public. Returns UI string overrides for a locale, merging two layers:
   * an operator-supplied file (I18N_OVERRIDES_DIR/overrides.<lng>.json, a
   * bind-mountable directory, default /config/i18n) and admin-edited overrides
   * stored in the i18n_overrides table (the Translations editor) — the DB
   * layer wins on conflicts since it's the more specific, more recent layer.
   * The web app deep-merges this over the bundled translations, so strings
   * can be customized without rebuilding the image.
   * Returns {} when neither layer has anything for this locale.
   *
   * NOTE: intentionally no response schema — the payload is arbitrary
   * override JSON and must not be stripped by serialization.
   */
  fastify.get<{ Params: { lng: string } }>('/api/i18n/overrides/:lng', async (request, reply) => {
    void reply.header('Cache-Control', 'no-store')
    const { lng } = request.params
    if (!LNG_RE.test(lng)) {
      return reply.send({})
    }

    const fileOverrides = await readFileOverrides(fastify, lng)

    let dbTree: Record<string, unknown> = {}
    try {
      const { getOverridesTreeForLocale } = await import('@aperture/core')
      dbTree = await getOverridesTreeForLocale(lng)
    } catch (err) {
      // DB overrides are additive — never fail the whole response over them.
      fastify.log.warn({ err, lng }, 'Failed to load DB i18n overrides')
    }

    if (Object.keys(dbTree).length === 0) {
      return reply.send(fileOverrides)
    }
    const { mergeFileAndDbOverrides } = await import('@aperture/core')
    return reply.send(mergeFileAndDbOverrides(fileOverrides, dbTree))
  })
}
