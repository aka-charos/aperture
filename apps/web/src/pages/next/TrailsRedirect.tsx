import { Navigate, useSearchParams } from 'react-router-dom'
import { nextPathFromTrails } from './reasons'

/**
 * The retired Trails page's address (`/trails?trail=…`), saved in bookmarks
 * and old links: opens Next from here on the same trail.
 */
export function TrailsRedirect() {
  const [params] = useSearchParams()
  return <Navigate replace to={nextPathFromTrails(params)} />
}
