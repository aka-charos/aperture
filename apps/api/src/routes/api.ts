import type { FastifyPluginAsync } from 'fastify'
import { APP_VERSION, APP_BUILD, fullVersion } from '../config/version.js'

interface VersionResponse {
  name: string
  /** Upstream lineage plus fork build, e.g. "0.7.8-mod.412.g730c57c". */
  version: string
  /** Upstream version alone — what this fork tracks. */
  upstreamVersion: string
  /** Fork build identity, or "dev" outside CI. */
  build: string
  environment: string
}

const apiRoutes: FastifyPluginAsync = async (fastify) => {
  // API version endpoint. This is the surface that reports fork identity, so it
  // returns the parts separately as well as joined — a consumer comparing
  // against upstream wants the bare version, a bug report wants the build.
  fastify.get<{ Reply: VersionResponse }>('/api/version', async (_request, reply) => {
    return reply.send({
      name: 'Aperture',
      version: fullVersion(),
      upstreamVersion: APP_VERSION,
      build: APP_BUILD,
      environment: process.env.NODE_ENV || 'development',
    })
  })
}

export default apiRoutes



