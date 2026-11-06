import type { Theme } from '@mui/material/styles'

/**
 * Neutral fills for tracks and empty thumbnails.
 *
 * The web app's theme supplies them per light/dark mode as `palette.surface`
 * (apps/web/src/theme.ts). This package cannot see that type, and a palette
 * path such as `'surface.fill'` under a theme without it is emitted as a
 * literal string and draws nothing, so every reader goes through here and
 * falls back to MUI's greys.
 */
interface SurfaceFills {
  fill?: string
  fillDeep?: string
  onBrand?: string
  onStatus?: string
}

function surfaceOf(theme: Theme): SurfaceFills | undefined {
  return (theme.palette as Theme['palette'] & { surface?: SurfaceFills }).surface
}

/** Progress-bar tracks, an empty thumbnail. */
export function neutralFill(theme: Theme): string {
  return surfaceOf(theme)?.fill ?? theme.palette.grey[800]
}

/** Behind a poster while it loads. */
export function neutralFillDeep(theme: Theme): string {
  return surfaceOf(theme)?.fillDeep ?? theme.palette.grey[900]
}

/** The label on a primary or secondary fill; a theme without the token keeps white. */
export function onBrandFill(theme: Theme): string {
  return surfaceOf(theme)?.onBrand ?? '#fff'
}

/** The label on a success, warning, error or information fill. */
export function onStatusFill(theme: Theme): string {
  return surfaceOf(theme)?.onStatus ?? '#fff'
}
