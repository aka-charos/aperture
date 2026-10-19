import { useState, type ReactNode } from 'react'
import { Box } from '@mui/material'

interface StudioLogoProps {
  /** The logo address the server decided; absent means there is none. */
  src: string | null | undefined
  /** The studio or network, for the image's alt text. */
  name: string
  /** Height of the logo itself; the plate adds a little around it. */
  height: number
  maxWidth: number
  /** What to show when there is no logo, or it fails to load. */
  fallback: ReactNode
}

/**
 * A studio or network logo on a light plate.
 *
 * Most TMDb logos are dark marks on a transparent background, so on the dark
 * theme they all but vanish; a plate keeps every one readable without
 * recolouring the ones that carry a brand colour. The image is scaled to fit,
 * never cropped, because logos are wide.
 */
export function StudioLogo({ src, name, height, maxWidth, fallback }: StudioLogoProps) {
  // Keyed on the address, so a page that swaps titles in place does not carry
  // one logo's failure over to the next.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  if (!src || failedSrc === src) return <>{fallback}</>

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
      <Box
        component="img"
        src={src}
        alt={name}
        loading="lazy"
        onError={() => setFailedSrc(src)}
        sx={{ height, width: 'auto', maxWidth, objectFit: 'contain', display: 'block' }}
      />
    </Box>
  )
}
