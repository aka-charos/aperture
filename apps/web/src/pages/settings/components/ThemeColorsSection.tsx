import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Box,
  Typography,
  Card,
  CardContent,
  TextField,
  Button,
  Alert,
  Divider,
  CircularProgress,
  Stack,
} from '@mui/material'
import SaveIcon from '@mui/icons-material/Save'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import PaletteOutlinedIcon from '@mui/icons-material/PaletteOutlined'
import { DEFAULT_THEME_COLORS, type ThemeColorOverrides } from '@/theme'
import { setThemeColorOverrides as applyThemeColors } from '@/lib/branding'

const HEX_RE = /^#[0-9a-f]{6}$/i

type ColorPair = { primary: string; secondary: string }

const DEFAULTS: ColorPair = { primary: DEFAULT_THEME_COLORS.primary, secondary: DEFAULT_THEME_COLORS.secondary }

function isValidHex(value: string): boolean {
  return HEX_RE.test(value)
}

/**
 * Admin: the two brand colors used throughout the UI.
 *
 * Only `primary`/`secondary` are exposed — semantic colors (error/warning/success/info)
 * stay fixed so a recolor can't accidentally make a "danger" state unreadable. Shades
 * (light/dark/contrastText) are derived server-round-trip-free on the client via
 * theme.ts's applyThemeColorOverrides, so this card only ever needs two hex values.
 *
 * Saved colors are applied to the running page immediately, same as BrandingSection's
 * name field — the whole point is to see the result without a reload.
 */
export function ThemeColorsSection() {
  const { t } = useTranslation()
  const [saved, setSaved] = useState<ColorPair>(DEFAULTS)
  const [value, setValue] = useState<ColorPair>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const fetchConfig = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/branding', { credentials: 'include' })
      if (!response.ok) throw new Error(t('settingsThemeColors.fetchFailed'))
      const data = (await response.json()) as { themeColors?: Partial<ColorPair> }
      const next: ColorPair = {
        primary: data.themeColors?.primary ?? DEFAULTS.primary,
        secondary: data.themeColors?.secondary ?? DEFAULTS.secondary,
      }
      setSaved(next)
      setValue(next)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settingsThemeColors.unknownError'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void fetchConfig()
  }, [fetchConfig])

  const save = async (colors: ColorPair) => {
    try {
      setSaving(true)
      setError(null)
      const response = await fetch('/api/branding', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ themeColors: colors }),
      })
      if (!response.ok) throw new Error(t('settingsThemeColors.saveFailed'))
      const data = (await response.json()) as { themeColors?: Partial<ColorPair> }
      const next: ColorPair = {
        primary: data.themeColors?.primary ?? colors.primary,
        secondary: data.themeColors?.secondary ?? colors.secondary,
      }
      setSaved(next)
      setValue(next)
      applyThemeColors(next satisfies ThemeColorOverrides)
      setSuccess(t('settingsThemeColors.saved'))
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settingsThemeColors.unknownError'))
    } finally {
      setSaving(false)
    }
  }

  const validPrimary = isValidHex(value.primary)
  const validSecondary = isValidHex(value.secondary)
  const hasChanges = value.primary !== saved.primary || value.secondary !== saved.secondary
  const isDefault = saved.primary === DEFAULTS.primary && saved.secondary === DEFAULTS.secondary

  return (
    <Card sx={{ backgroundColor: 'background.paper', borderRadius: 2 }} elevation={0}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
          <PaletteOutlinedIcon sx={{ color: 'primary.main' }} />
          <Typography variant="h6" fontWeight={600}>
            {t('settingsThemeColors.title')}
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary">
          {t('settingsThemeColors.subtitle')}
        </Typography>

        <Divider sx={{ my: 2 }} />

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {success && (
          <Alert severity="success" sx={{ mb: 2 }}>
            {success}
          </Alert>
        )}

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={24} />
          </Box>
        ) : (
          <Stack spacing={2}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Box
                  component="input"
                  type="color"
                  aria-label={t('settingsThemeColors.primaryLabel')}
                  value={validPrimary ? value.primary : DEFAULTS.primary}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setValue((v) => ({ ...v, primary: e.target.value }))
                  }
                  sx={{
                    width: 40,
                    height: 40,
                    p: 0,
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                    cursor: 'pointer',
                    backgroundColor: 'transparent',
                    flexShrink: 0,
                    '&::-webkit-color-swatch-wrapper': { padding: 0 },
                    '&::-webkit-color-swatch': { border: 'none', borderRadius: 4 },
                  }}
                />
                <TextField
                  label={t('settingsThemeColors.primaryLabel')}
                  value={value.primary}
                  onChange={(e) => setValue((v) => ({ ...v, primary: e.target.value.trim() }))}
                  error={!validPrimary}
                  helperText={validPrimary ? ' ' : t('settingsThemeColors.invalidHex')}
                  size="small"
                  sx={{ maxWidth: 160 }}
                  inputProps={{ maxLength: 7, spellCheck: false }}
                />
              </Box>

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Box
                  component="input"
                  type="color"
                  aria-label={t('settingsThemeColors.secondaryLabel')}
                  value={validSecondary ? value.secondary : DEFAULTS.secondary}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setValue((v) => ({ ...v, secondary: e.target.value }))
                  }
                  sx={{
                    width: 40,
                    height: 40,
                    p: 0,
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                    cursor: 'pointer',
                    backgroundColor: 'transparent',
                    flexShrink: 0,
                    '&::-webkit-color-swatch-wrapper': { padding: 0 },
                    '&::-webkit-color-swatch': { border: 'none', borderRadius: 4 },
                  }}
                />
                <TextField
                  label={t('settingsThemeColors.secondaryLabel')}
                  value={value.secondary}
                  onChange={(e) => setValue((v) => ({ ...v, secondary: e.target.value.trim() }))}
                  error={!validSecondary}
                  helperText={validSecondary ? ' ' : t('settingsThemeColors.invalidHex')}
                  size="small"
                  sx={{ maxWidth: 160 }}
                  inputProps={{ maxLength: 7, spellCheck: false }}
                />
              </Box>

              <Box
                sx={{
                  flex: 1,
                  minWidth: 120,
                  borderRadius: 2,
                  background: `linear-gradient(135deg, ${validPrimary ? value.primary : DEFAULTS.primary} 0%, ${validSecondary ? value.secondary : DEFAULTS.secondary} 100%)`,
                }}
              />
            </Stack>

            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button
                variant="contained"
                size="small"
                startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}
                onClick={() => void save(value)}
                disabled={saving || !hasChanges || !validPrimary || !validSecondary}
              >
                {t('common.save')}
              </Button>
              <Button
                variant="outlined"
                size="small"
                startIcon={<RestartAltIcon />}
                onClick={() => void save(DEFAULTS)}
                disabled={saving || isDefault}
              >
                {t('settingsThemeColors.reset')}
              </Button>
            </Box>
          </Stack>
        )}
      </CardContent>
    </Card>
  )
}
