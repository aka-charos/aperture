/**
 * What the API answers while a restore's transaction is open.
 *
 * Every table the dump replaces is locked until it commits, so a query on one
 * waits rather than fails. Left alone, an open tab's polling would pile up
 * waiting session lookups until the connection pool was full, and the request
 * asking for the restore's own progress would queue behind them. So the API
 * answers 503 at once instead, and only what needs no database goes through.
 *
 * Files and `/health` are not API routes and pass: the health check has its own
 * way past a busy pool (lib/databaseHealth.ts) and selects from no table.
 *
 * No imports, so it can be tested without a server.
 */

export const DATABASE_RESTORING_ERROR = {
  error: 'The database is being restored. Try again when it finishes.',
  code: 'DATABASE_RESTORING',
}

export function answersDuringRestore(url: string): boolean {
  const path = url.split('?', 1)[0]
  if (!path.startsWith('/api/')) return true
  // In-memory, and authorised by a signed token rather than a session. The
  // stream route shares the prefix and answers 401, having no session to read.
  return path.startsWith('/api/jobs/progress/')
}
