/**
 * Operator-supplied logo and favicon, read from a bind-mounted directory.
 *
 * Same shape as the UI string overrides (see routes/i18n): drop a file in the
 * mounted folder and it takes effect on the next request — no upload endpoint,
 * no database row, no rebuild. Whoever can write to that directory already
 * controls the compose file, so the file is trusted as given.
 *
 * Nothing here is required: with an empty directory every lookup returns null
 * and the app falls back to the artwork bundled in the image.
 */

import path from 'path'
import { promises as fs } from 'fs'

export type BrandingAssetKind = 'logo' | 'favicon'

export const BRANDING_ASSET_KINDS: BrandingAssetKind[] = ['logo', 'favicon']

/**
 * Extensions tried in order, so a folder holding both logo.svg and logo.png
 * resolves the same way on every boot. SVG first: it is the only format that
 * stays sharp at every size these assets are drawn at.
 */
const EXTENSIONS: Record<BrandingAssetKind, string[]> = {
  logo: ['svg', 'png', 'webp', 'jpg', 'jpeg', 'gif'],
  favicon: ['svg', 'png', 'ico', 'webp'],
}

const MIME_TYPES: Record<string, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  ico: 'image/x-icon',
}

/** Bind-mountable directory holding `logo.*` and `favicon.*`. */
export function brandingDir(): string {
  return process.env.BRANDING_DIR || '/config/branding'
}

export function isBrandingAssetKind(value: string): value is BrandingAssetKind {
  return (BRANDING_ASSET_KINDS as string[]).includes(value)
}

/** The filenames an operator can use, for docs and the admin hint. */
export function acceptedFilenames(kind: BrandingAssetKind): string[] {
  return EXTENSIONS[kind].map((ext) => `${kind}.${ext}`)
}

export interface ResolvedBrandingAsset {
  kind: BrandingAssetKind
  absolutePath: string
  filename: string
  mimeType: string
  size: number
  /** Changes whenever the mounted file does; used for ETag and `?v=`. */
  version: string
  modifiedAt: Date
}

/**
 * Find the file backing an asset, or null when the operator supplied none.
 *
 * Resolved per call rather than cached: the whole point of a mounted file is
 * that replacing it takes effect without restarting the container, and a stat
 * on a handful of paths is cheaper than the HTTP round trip that prompted it.
 */
export async function resolveBrandingAsset(
  kind: BrandingAssetKind
): Promise<ResolvedBrandingAsset | null> {
  const dir = brandingDir()

  for (const ext of EXTENSIONS[kind]) {
    const filename = `${kind}.${ext}`
    const absolutePath = path.join(dir, filename)

    try {
      const stat = await fs.stat(absolutePath)
      if (!stat.isFile()) continue

      return {
        kind,
        absolutePath,
        filename,
        mimeType: MIME_TYPES[ext] ?? 'application/octet-stream',
        size: stat.size,
        version: Math.trunc(stat.mtimeMs).toString(36),
        modifiedAt: stat.mtime,
      }
    } catch {
      // Missing is the normal case — try the next extension.
    }
  }

  return null
}

/** Public URL for an asset, versioned so a replaced file is picked up at once. */
export function brandingAssetUrl(asset: ResolvedBrandingAsset): string {
  return `/api/branding/${asset.kind}?v=${asset.version}`
}
