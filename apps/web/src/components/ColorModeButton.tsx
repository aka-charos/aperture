import { useTranslation } from 'react-i18next'
import { IconButton, Tooltip } from '@mui/material'
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined'
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined'
import { setColorMode, useColorMode } from '@/lib/colorMode'

/**
 * The app bar's light/dark switch. One icon showing where a press takes you,
 * because the bar is already crowded on a phone; the two-sided control with
 * labels is the Appearance card under Settings → Display.
 */
export function ColorModeButton() {
  const { t } = useTranslation()
  const mode = useColorMode()
  const next = mode === 'light' ? 'dark' : 'light'
  const label = next === 'light' ? t('colorMode.switchToLight') : t('colorMode.switchToDark')

  return (
    <Tooltip title={label}>
      <IconButton size="small" aria-label={label} onClick={() => setColorMode(next)}>
        {next === 'light' ? <LightModeOutlinedIcon /> : <DarkModeOutlinedIcon />}
      </IconButton>
    </Tooltip>
  )
}
