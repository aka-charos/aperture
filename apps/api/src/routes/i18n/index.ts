import type { FastifyPluginAsync } from 'fastify'
import path from 'path'
import { promises as fs } from 'fs'

/** Locale codes are 2-letter (see packages/core APP_LOCALE_OPTIONS); reject anything else. */
const LNG_RE = /^[a-z]{2}$/

/** Directory holding operator-supplied `overrides.<lng>.json` files (bind-mountable). */
function overridesDir(): string {
  return process.env.I18N_OVERRIDES_DIR || '/config/i18n'
}

const i18nRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/i18n/overrides/:lng
   *
   * Public. Returns operator-supplied UI string overrides for a locale, read at
   * request time from a mounted directory (I18N_OVERRIDES_DIR, default
   * /config/i18n). The web app deep-merges this over the bundled translations,
   * so strings can be customized via Docker volume without rebuilding the image.
   * Returns {} when no (valid) file is present.
   *
   * NOTE: intentionally no response schema — the payload is arbitrary operator
   * JSON and must not be stripped by serialization.
   */
  fastify.get<{ Params: { lng: string } }>('/api/i18n/overrides/:lng', async (request, reply) => {
    void reply.header('Cache-Control', 'no-store')
    const { lng } = request.params
    if (!LNG_RE.test(lng)) {
      return reply.send({})
    }
    const file = path.join(overridesDir(), `overrides.${lng}.json`)
    try {
      const raw = await fs.readFile(file, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return reply.send(parsed)
      }
      fastify.log.warn({ file }, 'i18n overrides file is not a JSON object; ignoring')
    } catch (err) {
      // Missing file is the normal "no overrides" case; log anything else.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        fastify.log.warn({ err, file }, 'Failed to read i18n overrides')
      }
    }
    return reply.send({})
  })
}

export default i18nRoutes
