import { useTranslation } from 'react-i18next'
import { ToggleButton, ToggleButtonGroup } from '@mui/material'
import ContrastIcon from '@mui/icons-material/Contrast'
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined'
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined'
import { parseColorMode, setColorMode, useColorMode } from '@/lib/colorMode'
import { SettingsCard } from './SettingsCard'

/** Light or dark, for this browser (see lib/colorMode.ts for why not the account). */
export function AppearanceCard() {
  const { t } = useTranslation()
  const mode = useColorMode()

  return (
    <SettingsCard
      icon={<ContrastIcon />}
      title={t('colorMode.cardTitle')}
      description={t('colorMode.cardDescription')}
    >
      <ToggleButtonGroup
        exclusive
        size="small"
        value={mode}
        aria-label={t('colorMode.label')}
        onChange={(_, value) => {
          // Pressing the side already on returns null; that is not a choice.
          const next = parseColorMode(value)
          if (next) setColorMode(next)
        }}
      >
        <ToggleButton value="light" sx={{ gap: 0.75, px: 1.75 }}>
          <LightModeOutlinedIcon fontSize="small" />
          {t('colorMode.light')}
        </ToggleButton>
        <ToggleButton value="dark" sx={{ gap: 0.75, px: 1.75 }}>
          <DarkModeOutlinedIcon fontSize="small" />
          {t('colorMode.dark')}
        </ToggleButton>
      </ToggleButtonGroup>
    </SettingsCard>
  )
}
