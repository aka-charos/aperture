import { useCallback, useEffect, useState } from 'react'
import { Alert, Box, CircularProgress, Stack, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { HomeRowCard } from './HomeRowCard'
import { HomeScreenPreview } from './HomeScreenPreview'
import { PlaylistRowsCard } from './PlaylistRowsCard'
import { playlistKey } from './rowStatus'
import type { InstantOutcome, Notice, UserHomePlaylist, UserHomeScreen } from './types'

/**
 * Everything Aperture puts on this viewer's Emby home screen, on one page: each
 * kind of row with its own switch, what is in it, where it goes, their
 * playlists, and a preview of the whole screen. Every change reaches Emby at
 * once; the page reloads afterwards so the preview shows what was written.
 */
export function HomeScreenTab() {
  const { t } = useTranslation()
  const [screen, setScreen] = useState<UserHomeScreen | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/home-sections/me', { credentials: 'include' })
      if (!response.ok) throw new Error()
      setScreen((await response.json()) as UserHomeScreen)
      setLoadFailed(false)
    } catch {
      setLoadFailed(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const noticeFor = (outcome: InstantOutcome | null): Notice => {
    if (outcome?.applied) return { severity: 'success', text: t('userSettings.homeScreen.applied') }
    if (outcome?.reason === 'failed') return { severity: 'info', text: t('userSettings.homeScreen.savedNotApplied') }
    if (outcome?.reason === 'nothing-to-show') {
      return { severity: 'info', text: t('userSettings.homeScreen.savedNothingToShow') }
    }
    return { severity: 'info', text: t('userSettings.homeScreen.savedLater') }
  }

  const afterChange = async (outcome: InstantOutcome | null, error?: string) => {
    setNotice(error ? { severity: 'error', text: error } : noticeFor(outcome))
    await load()
  }

  const toggleRow = async (feature: string, enabled: boolean) => {
    setBusy(feature)
    setNotice(null)
    // Shown at once; the reload after the write replaces it with what the server decided.
    setScreen((prev) =>
      prev
        ? {
            ...prev,
            rows: prev.rows.map((row) =>
              row.feature === feature
                ? { ...row, enabled, state: enabled ? { status: 'on' as const } : { status: 'off' as const } }
                : row
            ),
          }
        : prev
    )
    try {
      const response = await fetch(`/api/home-sections/me/rows/${feature}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ enabled }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || t('userSettings.homeScreen.saveFailed'))
      await afterChange((data.outcome ?? null) as InstantOutcome | null)
    } catch (e) {
      await afterChange(null, e instanceof Error ? e.message : t('userSettings.homeScreen.saveFailed'))
    } finally {
      setBusy(null)
    }
  }

  const togglePlaylist = async (playlist: UserHomePlaylist, enabled: boolean) => {
    const key = playlistKey(playlist)
    setBusy(key)
    setNotice(null)
    const base = playlist.source === 'chat' ? '/api/graph-playlists' : '/api/channels'
    try {
      const response = await fetch(`${base}/${playlist.id}/home-screen`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ enabled }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || t('userSettings.homeScreen.saveFailed'))
      await afterChange(
        data.applied ? { applied: true, moved: 0 } : { applied: false, reason: String(data.reason ?? 'later') }
      )
    } catch (e) {
      await afterChange(null, e instanceof Error ? e.message : t('userSettings.homeScreen.saveFailed'))
    } finally {
      setBusy(null)
    }
  }

  if (!screen) {
    return loadFailed ? (
      <Alert severity="error">{t('userSettings.homeScreen.loadFailed')}</Alert>
    ) : (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress size={28} />
      </Box>
    )
  }

  if (!screen.available) {
    return (
      <Alert severity="info">
        {t(`userSettings.homeScreen.pageUnavailable.${screen.unavailableReason ?? 'feature-off'}`)}
      </Alert>
    )
  }

  const playlistsRow = screen.rows.find((row) => row.feature === 'playlists')
  const switchable = screen.rows.filter((row) => row.switchable)

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 820 }}>
        {t('userSettings.homeScreen.intro')}
      </Typography>

      {notice && (
        <Alert severity={notice.severity} sx={{ mb: 2 }} onClose={() => setNotice(null)}>
          {notice.text}
        </Alert>
      )}

      {/* Sized off the pane, not a window breakpoint: with the assistant docked the pane is
          half the window, and two columns keyed on md would squeeze both. The preview wraps
          below the rows once there is no room for it beside them. */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'flex-start' }}>
        <Stack spacing={2} sx={{ flex: '999 1 480px', minWidth: 0 }}>
          {switchable.map((row) => (
            <HomeRowCard
              key={row.feature}
              row={row}
              anchors={screen.anchors}
              modes={screen.modes}
              maxPosition={screen.maxPosition}
              busy={busy === row.feature}
              onToggle={(enabled) => void toggleRow(row.feature, enabled)}
              onPlacementSaved={(outcome, error) => void afterChange(outcome, error)}
            />
          ))}
          {playlistsRow && (
            <PlaylistRowsCard
              row={playlistsRow}
              playlists={screen.playlists}
              anchors={screen.anchors}
              modes={screen.modes}
              maxPosition={screen.maxPosition}
              busyKey={busy}
              onToggle={(playlist, enabled) => void togglePlaylist(playlist, enabled)}
              onPlacementSaved={(outcome, error) => void afterChange(outcome, error)}
            />
          )}
        </Stack>
        {/* Sticky beside the rows, so a switch and its effect are in view together. */}
        <Box
          sx={{
            flex: '1 1 300px',
            minWidth: 0,
            position: 'sticky',
            top: 'calc(var(--aperture-chrome-top, 64px) + 24px)',
          }}
        >
          <HomeScreenPreview rows={screen.preview} unavailable={screen.screenUnavailable} sortBy={screen.sortBy} />
        </Box>
      </Box>
    </Box>
  )
}
