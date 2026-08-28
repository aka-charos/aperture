import { lazy, type ReactElement } from 'react'
import { Navigate, Route } from 'react-router-dom'
import { ADMIN_ENTRIES, adminEntryRoutePath } from './registry'
import { ADMIN_ELEMENTS } from './elements'
import { LegacyAdminRedirect } from '../LegacyAdminRedirect'

const UserDetailPage = lazy(async () => ({
  default: (await import('@/pages/UserDetail')).UserDetailPage,
}))

/**
 * The admin route table, generated from the registry rather than written out
 * beside it.
 *
 * This is what makes the registry load-bearing instead of documentation: a
 * section with no entry gets no route, so it is unreachable and obviously
 * broken. The alternative — a hand-kept route list next to a hand-kept nav list
 * — is the arrangement that lets a destination exist in one and not the other.
 */
export function adminChildRoutes(): ReactElement[] {
  const routes = ADMIN_ENTRIES.map((entry) => {
    const element = ADMIN_ELEMENTS[entry.id]
    if (!element) return null

    const { Component } = element
    const path = adminEntryRoutePath(entry)

    return path === '' ? (
      <Route key={entry.id} index element={<Component />} />
    ) : (
      <Route key={entry.id} path={path} element={<Component />} />
    )
  }).filter((r): r is ReactElement => r !== null)

  return [
    ...routes,

    // Not a nav destination — you arrive from the users table, never from the
    // tree — so it is a route without an entry rather than a leaf nobody wants
    // listed.
    <Route key="user-detail" path="access/users/:id" element={<UserDetailPage />} />,

    // Everything the console answered to before it was one route per section.
    <Route key="legacy-settings" path="settings" element={<LegacyAdminRedirect />} />,
    <Route key="legacy-users" path="users" element={<LegacyAdminRedirect />} />,
    <Route key="legacy-user-detail" path="users/:id" element={<LegacyAdminRedirect />} />,
    <Route key="legacy-jobs" path="jobs" element={<LegacyAdminRedirect />} />,
    <Route key="legacy-translations" path="translations" element={<LegacyAdminRedirect />} />,
    <Route key="legacy-gaps" path="gaps" element={<LegacyAdminRedirect />} />,

    // An unmapped path under /admin still matches the shell, so without this it
    // renders the frame around an empty outlet — a blank page rather than a
    // wrong one, which is harder to report and harder to recognise. Ranked last
    // by React Router regardless of where it sits here.
    <Route key="admin-catch-all" path="*" element={<Navigate to="/admin" replace />} />,
  ]
}
