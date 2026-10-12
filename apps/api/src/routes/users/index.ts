import type { FastifyPluginAsync } from 'fastify'
import {
  registerListHandlers,
  registerProfileHandlers,
  registerProviderHandlers,
  registerGoneAccountHandlers,
  registerJobHandlers,
  registerAvatarHandlers,
} from './handlers/index.js'

const usersRoutes: FastifyPluginAsync = async (fastify) => {
  // Register all handler modules
  registerListHandlers(fastify)
  registerProfileHandlers(fastify)
  registerProviderHandlers(fastify)
  registerGoneAccountHandlers(fastify)
  registerJobHandlers(fastify)
  registerAvatarHandlers(fastify)
}

export default usersRoutes



