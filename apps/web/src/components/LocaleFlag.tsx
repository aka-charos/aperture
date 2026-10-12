import { Box, type SxProps, type Theme } from '@mui/material'
import { CN, DE, ES, FR, GB, GR, IN, IT, JP, KR, NL, PT, RU, SA } from 'country-flag-icons/react/3x2'
import { flagCountryFor } from '@/i18n/localeFlags'

// Named imports only: a namespace import indexed by a runtime key would pull
// every flag the package ships into the bundle.
const FLAGS: Record<string, typeof GB> = { CN, DE, ES, FR, GB, GR, IN, IT, JP, KR, NL, PT, RU, SA }

interface LocaleFlagProps {
  locale: string
  /** Width in px; height follows the 3:2 ratio. */
  width?: number
  sx?: SxProps<Theme>
}

/**
 * The flag standing for an app language (see `localeFlags.ts` for why a flag
 * is only ever a convention here). Decorative: callers name the language in
 * text beside it or in a tooltip, so it carries no accessible name of its own.
 * An unmapped language falls back to its code, never to an empty box.
 */
export function LocaleFlag({ locale, width = 22, sx }: LocaleFlagProps) {
  const country = flagCountryFor(locale)
  const Flag = country ? FLAGS[country] : undefined
  const height = Math.round((width * 2) / 3)
  return (
    <Box
      component="span"
      aria-hidden
      sx={[
        {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          width,
          height,
          borderRadius: '3px',
          overflow: 'hidden',
          // A hairline so white-edged flags (Japan, Korea, Greece) keep their shape on a light surface.
          boxShadow: (theme) => `0 0 0 1px ${theme.palette.divider}`,
          bgcolor: 'action.selected',
          fontSize: Math.max(8, Math.round(height * 0.6)),
          fontWeight: 700,
          lineHeight: 1,
          textTransform: 'uppercase',
          '& svg': { width: '100%', height: '100%', display: 'block' },
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {Flag ? <Flag /> : locale.slice(0, 2)}
    </Box>
  )
}
