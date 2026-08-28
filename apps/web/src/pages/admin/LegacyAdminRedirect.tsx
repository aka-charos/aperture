import { Navigate, useLocation, useParams } from 'react-router-dom'
import { LEGACY_ADMIN_PATHS, resolveLegacySettingsPath } from './nav/legacyRoutes'

/**
 * Sends an address the console used before it became one route per section to
 * wherever that thing lives now.
 *
 * Worth keeping rather than letting the old URLs 404: five links inside the app
 * pointed at `/admin/settings`, a release note names it with query params, and
 * an operator who bookmarked "the page with the OMDb key" has no way to know
 * the console was reorganised. `replace` so the dead address does not sit in
 * the history for the back button to return to.
 */
export function LegacyAdminRedirect() {
  const location = useLocation()
  const params = useParams()

  // `/admin/users/42` — the id is the whole point of the link, so it has to
  // survive the move rather than dropping the visitor on the users table.
  if (params.id && location.pathname.startsWith('/admin/users/')) {
    return <Navigate to={`/admin/access/users/${params.id}`} replace />
  }

  const mapped = LEGACY_ADMIN_PATHS[location.pathname]
  if (mapped && location.pathname !== '/admin/settings') {
    return <Navigate to={mapped} replace />
  }

  return <Navigate to={resolveLegacySettingsPath(new URLSearchParams(location.search))} replace />
}
