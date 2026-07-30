import { buildServer } from './server.js'
import { validateEnv, getDatabaseUrl } from './config/env.js'
import { runMigrations, getMigrationStatus, detectInterruptedEnrichmentRuns } from '@aperture/core'
import { closePool } from './lib/db.js'
import { initializeScheduler, stopScheduler } from './lib/scheduler.js'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Global error handlers.
//
// These log and then exit: after an uncaught exception the process is in an
// undefined state, and continuing to serve requests from it risks answering
// them with half-applied state — including auth decisions. The container
// restart policy is the recovery mechanism, not a limping process.
//
// Fastify's own error handling still catches per-request errors, so reaching
// here means something escaped the request lifecycle entirely.
function fatal(label: string, err: unknown): void {
  console.error(`💥 ${label}:`, err)
  // Give the logger a tick to flush before the process goes away.
  setTimeout(() => process.exit(1), 100).unref()
}

process.on('uncaughtException', (err) => {
  fatal('Uncaught Exception', err)
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise)
  fatal('Unhandled Rejection', reason)
})

async function main() {
  // Validate environment variables
  let env
  try {
    env = validateEnv()
  } catch (err) {
    console.error('Failed to validate environment:', err)
    process.exit(1)
  }

  const migrationsDir = path.resolve(__dirname, '../../../db/migrations')
  const databaseUrl = getDatabaseUrl()

  // Run migrations if enabled
  if (env.RUN_MIGRATIONS_ON_START) {
    console.log('🔮 Running database migrations...')
    try {
      const result = await runMigrations(databaseUrl, migrationsDir)
      if (result.applied.length > 0) {
        console.log(`✓ Applied ${result.applied.length} migration(s)`)
      } else {
        console.log('✓ Database is up to date')
      }
    } catch (err) {
      console.error('Failed to run migrations:', err)
      process.exit(1)
    }
  } else {
    // Just check migration status
    try {
      const status = await getMigrationStatus(databaseUrl, migrationsDir)
      if (status.pending.length > 0) {
        console.warn(`⚠ ${status.pending.length} pending migration(s). Run 'pnpm db:migrate' to apply.`)
      }
    } catch {
      console.warn('⚠ Could not check migration status')
    }
  }

  // Detect any enrichment runs that were interrupted (e.g. container restart)
  try {
    await detectInterruptedEnrichmentRuns()
  } catch (err) {
    console.warn('⚠️ Could not check for interrupted enrichment runs:', err)
    // Don't exit - this is a recoverable error
  }

  // Build and start server
  const server = await buildServer({ logger: true })

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received, shutting down gracefully...`)

    try {
      stopScheduler()
      await server.close()
      await closePool()
      console.log('Server closed')
      process.exit(0)
    } catch (err) {
      console.error('Error during shutdown:', err)
      process.exit(1)
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  // Start listening.
  //
  // 0.0.0.0 by default because a container has to accept traffic from outside
  // itself. But when the only intended front door is a tunnel or reverse proxy
  // on the same host (cloudflared, for instance), binding the whole interface
  // leaves the app directly reachable on the LAN — around whatever access
  // control the front door enforces. Set HOST=127.0.0.1 in that case.
  try {
    const address = await server.listen({
      port: env.PORT,
      host: process.env.HOST?.trim() || '0.0.0.0',
    })
    console.log(`🚀 Aperture API server running at ${address}`)

    // Initialize job scheduler after server is running
    try {
      await initializeScheduler()
      console.log('📅 Job scheduler initialized')
    } catch (err) {
      console.error('⚠️ Failed to initialize scheduler:', err)
      // Don't exit - scheduler failure shouldn't prevent server from running
    }
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }
}

main()

