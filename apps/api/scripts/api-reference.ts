/**
 * Writes docs/api-reference.md from the server's own OpenAPI document; the
 * page itself is rendered by src/lib/apiReference.ts, which serverBoot.test.ts
 * also uses to fail while the stored page is out of date.
 *
 * The server is built the way serverBoot.test.ts builds it: no database (every
 * settings read falls back), and an unreachable DATABASE_URL so a query fails
 * at once instead of hanging. Run with `pnpm --filter @aperture/api docs:api`.
 */
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

process.env.DATABASE_URL ??= 'postgres://boot:test@127.0.0.1:1/boot_test'
// The document is only registered when docs are on.
process.env.API_DOCS = 'public'

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..')

const { buildServer } = await import('../src/server.js')
const { renderApiReference, API_REFERENCE_PATH } = await import('../src/lib/apiReference.js')

const app = await buildServer({ logger: false })
await app.ready()
const { markdown, total, sections } = renderApiReference(app.swagger())
const out = join(REPO_ROOT, API_REFERENCE_PATH)
await writeFile(out, markdown, 'utf8')
console.log(`Wrote ${total} endpoints in ${sections} sections to ${out}`)
await app.close()
process.exit(0)
