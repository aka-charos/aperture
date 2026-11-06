import { useTranslation } from 'react-i18next'
import { IconButton, ListItemIcon, MenuItem, Tooltip, type SxProps, type Theme } from '@mui/material'
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined'
import DarkModeIcon from '@mui/icons-material/DarkMode'
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined'
import { nextAppearance, setAppearance, useAppearance } from '@/lib/colorMode'
import type { Appearance } from '@/theme'

/** One icon per appearance: the sun, and the filled and outlined moons. */
export function AppearanceIcon({ appearance }: { appearance: Appearance }) {
  if (appearance === 'light') return <LightModeOutlinedIcon fontSize="small" />
  return appearance === 'black' ? <DarkModeIcon fontSize="small" /> : <DarkModeOutlinedIcon fontSize="small" />
}

const SWITCH_LABEL_KEYS = {
  light: 'colorMode.switchToLight',
  black: 'colorMode.switchToBlack',
  dark: 'colorMode.switchToDark',
} as const

/** Where a press takes you, and what to call it. */
function useNextAppearance() {
  const { t } = useTranslation()
  const next = nextAppearance(useAppearance())
  return { next, label: t(SWITCH_LABEL_KEYS[next]) }
}

/**
 * The app bar's appearance button. One icon showing where a press takes you, and
 * a press moves on to the next of the three, because the bar is already crowded;
 * the control showing all three with labels is the Appearance card under
 * Settings → Display.
 */
export function ColorModeButton() {
  const { next, label } = useNextAppearance()
  return (
    <Tooltip title={label}>
      <IconButton size="small" aria-label={label} onClick={() => setAppearance(next)}>
        <AppearanceIcon appearance={next} />
      </IconButton>
    </Tooltip>
  )
}

/** The same button as a user-menu row, for a phone whose app bar has no room for it. */
export function ColorModeMenuItem({ onDone, sx }: { onDone: () => void; sx?: SxProps<Theme> }) {
  const { next, label } = useNextAppearance()
  return (
    <MenuItem
      sx={sx}
      onClick={() => {
        onDone()
        setAppearance(next)
      }}
    >
      <ListItemIcon>
        <AppearanceIcon appearance={next} />
      </ListItemIcon>
      {label}
    </MenuItem>
  )
}
