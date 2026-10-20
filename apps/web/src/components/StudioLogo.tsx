import { useState, type ReactNode } from 'react'
import { Box } from '@mui/material'

/**
 * A studio or network logo as the server decided it. `tile` is the media
 * server's own image (Emby's are 16:9 tiles with the logo on a dark
 * background), shown as it is; `mark` is a transparent TMDb logo.
 */
export interface StudioLogoData {
  url: string
  kind: 'tile' | 'mark'
}

interface StudioLogoProps {
  /** The logo the server decided; absent means there is none. */
  logo: StudioLogoData | null | undefined
  /** The studio or network, for the image's alt text; empty when a label sits beside it. */
  name: string
  /** Height of a mark; a tile is drawn as tall as a mark on its plate, so the two line up. */
  height: number
  /**
   * Widest a mark may draw, the plate's padding not included; a number, or one
   * per breakpoint. Defaults to five times its height.
   */
  maxWidth?: number | Partial<Record<'xs' | 'sm' | 'md' | 'lg' | 'xl', number>>
  /** What to show when there is no logo, or it fails to load. */
  fallback: ReactNode
}

/**
 * A studio or network logo, drawn by its kind.
 *
 * A tile is an opaque picture made to be shown whole, so it gets rounded
 * corners and nothing else. A mark is usually a dark logo on transparency and
 * all but vanishes on the dark theme, so it sits on a light plate; it is
 * scaled to fit, never cropped, because logos are wide.
 */
export function StudioLogo({ logo, name, height, maxWidth, fallback }: StudioLogoProps) {
  // Keyed on the address, so a page that swaps titles in place does not carry
  // one logo's failure over to the next.
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  if (!logo || failedUrl === logo.url) return <>{fallback}</>

  // The plate adds 3px padding and a 1px border on each side.
  const tileHeight = height + 8

  const image = (
    <Box
      component="img"
      src={logo.url}
      alt={name}
      loading="lazy"
      onError={() => setFailedUrl(logo.url)}
      sx={
        logo.kind === 'tile'
          ? { height: tileHeight, width: 'auto', aspectRatio: '16 / 9', objectFit: 'cover', display: 'block', borderRadius: 0.75 }
          : { height, width: 'auto', maxWidth: maxWidth ?? height * 5, objectFit: 'contain', display: 'block' }
      }
    />
  )
  if (logo.kind === 'tile') return image

  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        px: 0.75,
        py: 0.375,
        borderRadius: 1,
        bgcolor: 'rgba(255, 255, 255, 0.92)',
        border: 1,
        borderColor: 'divider',
        lineHeight: 0,
      }}
    >
      {image}
    </Box>
  )
}
