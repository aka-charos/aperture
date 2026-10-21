import { useTranslation } from 'react-i18next'
import { IconButton, ListItemIcon, MenuItem, Tooltip, type SxProps, type Theme } from '@mui/material'
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined'
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined'
import { setColorMode, useColorMode } from '@/lib/colorMode'

/** Where a press takes you, and what to call it. */
function useNextMode() {
  const { t } = useTranslation()
  const next = useColorMode() === 'light' ? 'dark' : 'light'
  return {
    next,
    label: next === 'light' ? t('colorMode.switchToLight') : t('colorMode.switchToDark'),
    icon: next === 'light' ? <LightModeOutlinedIcon fontSize="small" /> : <DarkModeOutlinedIcon fontSize="small" />,
  } as const
}

/**
 * The app bar's light/dark switch. One icon showing where a press takes you,
 * because the bar is already crowded; the two-sided control with labels is the
 * Appearance card under Settings → Display.
 */
export function ColorModeButton() {
  const { next, label, icon } = useNextMode()
  return (
    <Tooltip title={label}>
      <IconButton size="small" aria-label={label} onClick={() => setColorMode(next)}>
        {icon}
      </IconButton>
    </Tooltip>
  )
}

/** The same switch as a user-menu row, for a phone whose app bar has no room for the button. */
export function ColorModeMenuItem({ onDone, sx }: { onDone: () => void; sx?: SxProps<Theme> }) {
  const { next, label, icon } = useNextMode()
  return (
    <MenuItem
      sx={sx}
      onClick={() => {
        onDone()
        setColorMode(next)
      }}
    >
      <ListItemIcon>{icon}</ListItemIcon>
      {label}
    </MenuItem>
  )
}
