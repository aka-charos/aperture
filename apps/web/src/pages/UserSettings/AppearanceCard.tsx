import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Box, ButtonBase, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import CheckIcon from '@mui/icons-material/Check'
import ContrastIcon from '@mui/icons-material/Contrast'
import DevicesOutlinedIcon from '@mui/icons-material/DevicesOutlined'
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined'
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined'
import { parseColorModeChoice, setColorMode, setUiTheme, useColorModeChoice, useUiTheme } from '@/lib/colorMode'
import { createAppTheme, UI_THEMES, type UiTheme } from '@/theme'
import { SettingsCard } from './SettingsCard'

/**
 * A miniature of one dark look, drawn from the real theme so it cannot go out of
 * step with what pressing it gives (admin brand colours included). Always dark,
 * in light mode too: light is Studio's either way, so the dark look is all these
 * tiles choose.
 */
function ThemePreview({ name }: { name: UiTheme }) {
  const { i18n } = useTranslation()
  const { palette } = useMemo(() => createAppTheme('ltr', 'dark', i18n.language, name), [i18n.language, name])
  return (
    <Box
      aria-hidden="true"
      sx={{
        display: 'flex',
        height: 72,
        mb: 1,
        borderRadius: 1,
        overflow: 'hidden',
        border: 1,
        borderColor: palette.divider,
        bgcolor: palette.background.default,
      }}
    >
      <Box sx={{ width: 26, p: 0.75, bgcolor: palette.background.paper }}>
        {[0, 1, 2, 3].map((i) => (
          <Box key={i} sx={{ height: 3, mt: 0.75, bgcolor: i === 1 ? palette.primary.main : palette.text.secondary }} />
        ))}
      </Box>
      <Box sx={{ flex: 1, p: 1 }}>
        <Box sx={{ width: '55%', height: 5, mb: 0.75, bgcolor: palette.text.primary }} />
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          {[0, 1, 2].map((i) => (
            <Box
              key={i}
              sx={{ height: 36, flex: 1, borderRadius: 0.5, bgcolor: i === 0 ? palette.primary.main : palette.surface.raised }}
            />
          ))}
        </Box>
      </Box>
    </Box>
  )
}

/** Light or dark, and the dark look, for this browser (see lib/colorMode.ts for why not the account). */
export function AppearanceCard() {
  const { t } = useTranslation()
  const choice = useColorModeChoice()
  const uiTheme = useUiTheme()

  return (
    <SettingsCard
      icon={<ContrastIcon />}
      title={t('colorMode.cardTitle')}
      description={t('colorMode.cardDescription')}
    >
      <Stack spacing={2}>
        <Box
          role="group"
          aria-label={t('colorMode.themeLabel')}
          sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 1.5 }}
        >
          {UI_THEMES.map((name) => {
            const selected = uiTheme === name
            return (
              <ButtonBase
                key={name}
                aria-pressed={selected}
                onClick={() => setUiTheme(name)}
                sx={{
                  display: 'block',
                  p: 1.25,
                  textAlign: 'start',
                  borderRadius: 1,
                  border: 1,
                  borderColor: selected ? 'primary.main' : 'divider',
                  bgcolor: selected ? 'action.selected' : undefined,
                }}
              >
                <ThemePreview name={name} />
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2" fontWeight={700}>
                    {t(`colorMode.${name}`)}
                  </Typography>
                  {selected && <CheckIcon fontSize="small" color="primary" />}
                </Stack>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.25 }}>
                  {t(`colorMode.${name}Description`)}
                </Typography>
              </ButtonBase>
            )
          })}
        </Box>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={choice}
          aria-label={t('colorMode.label')}
          sx={{ flexWrap: 'wrap' }}
          onChange={(_, value) => {
            // Pressing the side already on returns null; that is not a choice.
            const next = parseColorModeChoice(value)
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
          <ToggleButton value="system" sx={{ gap: 0.75, px: 1.75 }}>
            <DevicesOutlinedIcon fontSize="small" />
            {t('colorMode.system')}
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>
    </SettingsCard>
  )
}
