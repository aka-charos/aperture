import { useTranslation } from 'react-i18next'
import { ToggleButton, ToggleButtonGroup } from '@mui/material'
import ContrastIcon from '@mui/icons-material/Contrast'
import { AppearanceIcon } from '@/components/ColorModeButton'
import { parseAppearance, setAppearance, useAppearance } from '@/lib/colorMode'
import { APPEARANCES } from '@/theme'
import { SettingsCard } from './SettingsCard'

/** Light, Black or Dark, for this browser (see lib/colorMode.ts for why not the account). */
export function AppearanceCard() {
  const { t } = useTranslation()
  const appearance = useAppearance()

  return (
    <SettingsCard
      icon={<ContrastIcon />}
      title={t('colorMode.cardTitle')}
      description={t('colorMode.cardDescription')}
    >
      <ToggleButtonGroup
        exclusive
        size="small"
        value={appearance}
        aria-label={t('colorMode.label')}
        // Three labels do not fit one row on a phone, and a joined group's buttons
        // lose their shared border when they wrap, so each keeps its own.
        sx={{
          flexWrap: 'wrap',
          gap: 0.5,
          '&& .MuiToggleButtonGroup-grouped': { m: 0, border: 1, borderColor: 'divider', borderRadius: 1 },
        }}
        onChange={(_, value) => {
          // Pressing the side already on returns null; that is not a choice.
          const next = parseAppearance(value)
          if (next) setAppearance(next)
        }}
      >
        {APPEARANCES.map((option) => (
          <ToggleButton key={option} value={option} sx={{ gap: 0.75, px: 1.75 }}>
            <AppearanceIcon appearance={option} />
            {t(`colorMode.${option}`)}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </SettingsCard>
  )
}
