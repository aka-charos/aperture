/**
 * The library scope of the person a request is FOR — the one call every route
 * listing, searching or opening titles makes before it queries them.
 *
 * `request.user` is the viewer: during an assumption it is the assumed account,
 * so an admin viewing as someone sees exactly that person's libraries, which is
 * the point of viewing as them. Resolved once per request and remembered, since
 * one handler can run several queries (a count and a page, say) that must agree.
 *
 * A request with no user (the few public routes) is limited to the libraries the
 * operator enabled and nothing else — the same answer every route gave before
 * viewer scope existed.
 */

import type { FastifyRequest } from 'fastify'
import { query, queryOne } from './db.js'
import {
  getLibraryScopeForUser,
  loadConfiguredLibraries,
  resolveLibraryScope,
  libraryScopeSql,
  type LibraryScope,
} from '@aperture/core'

const resolved = new WeakMap<FastifyRequest, Promise<LibraryScope>>()

export function viewerScope(request: FastifyRequest): Promise<LibraryScope> {
  let scope = resolved.get(request)
  if (!scope) {
    scope = request.user
      ? getLibraryScopeForUser(request.user.id)
      : loadConfiguredLibraries().then((libraries) =>
          resolveLibraryScope({ libraries, userLibraryIds: null, maxParentalRating: null })
        )
    resolved.set(request, scope)
  }
  return scope
}

/**
 * `libraryScopeSql` for the common style: values appended to `params`, each
 * placeholder numbered by its position. A handler keeping its own counter must
 * continue from `params.length + 1` afterwards.
 */
export function scopeClause(
  scope: LibraryScope,
  alias: string,
  params: unknown[]
): string {
  return libraryScopeSql(scope, alias, (value) => {
    params.push(value)
    return `$${params.length}`
  })
}

/**
 * Whether one title is in the viewer's scope — for routes that open a title by
 * id (detail, trailer, episodes, similar). Out of scope answers exactly like a
 * title that does not exist: a 404 that says "in a library you cannot open"
 * would confirm the title is on the server.
 */
export async function titleInScope(
  request: FastifyRequest,
  table: 'movies' | 'series',
  id: string
): Promise<boolean> {
  const params: unknown[] = [id]
  const inScope = scopeClause(await viewerScope(request), 't', params)
  const row = await queryOne<{ ok: boolean }>(
    `SELECT true AS ok FROM ${table} t WHERE t.id = $1 AND ${inScope}`,
    params
  )
  return row?.ok === true
}

/**
 * Which of `ids` the viewer may see — for lists assembled elsewhere (Top Picks,
 * the dashboard's rails) that are filtered after the fact rather than queried
 * with a scope clause of their own.
 */
export async function idsInScope(
  request: FastifyRequest,
  table: 'movies' | 'series',
  ids: readonly string[]
): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const params: unknown[] = [ids]
  const inScope = scopeClause(await viewerScope(request), 't', params)
  const rows = await query<{ id: string }>(
    `SELECT t.id FROM ${table} t WHERE t.id = ANY($1) AND ${inScope}`,
    params
  )
  return new Set(rows.rows.map((row) => row.id))
}
