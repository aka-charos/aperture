import { useCallback, useEffect, useMemo, useState, type ReactElement, type SyntheticEvent } from 'react'
import { Box, Paper, Tab, Tabs } from '@mui/material'
import SettingsIcon from '@mui/icons-material/Settings'
import TuneIcon from '@mui/icons-material/Tune'
import PaletteOutlinedIcon from '@mui/icons-material/PaletteOutlined'
import ManageAccountsOutlinedIcon from '@mui/icons-material/ManageAccountsOutlined'
import HomeIcon from '@mui/icons-material/Home'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/useAuth'
import { Breadcrumbs } from '@/components/Breadcrumbs'
import { EmailNotificationsCard } from './UserSettings/EmailNotificationsCard'
import { AiLibraryNamesCard } from './UserSettings/AiLibraryNamesCard'
import { SimilarityGraphPrefsCard } from './UserSettings/SimilarityGraphPrefsCard'
import { PosterDisplayCard } from './UserSettings/PosterDisplayCard'
import { AppearanceCard } from './UserSettings/AppearanceCard'
import { TipsCard } from './UserSettings/TipsCard'
import { TraktIntegrationCard } from './UserSettings/TraktIntegrationCard'
import { NewsletterCard } from './UserSettings/NewsletterCard'
import { useNewsletterSubscription } from './UserSettings/hooks/useNewsletterSubscription'
import { SettingsGrid } from './UserSettings/SettingsCard'
import { RecommendationsTab } from './UserSettings/recommendations/RecommendationsTab'
import { HomeScreenTab } from './UserSettings/homeScreen/HomeScreenTab'
import { useTraktIntegration } from './UserSettings/hooks/useTraktIntegration'
import { TabPanel } from './UserSettings/TabPanel'
import {
  USER_SETTINGS_TAB_KEYS,
  userSettingsTabFromParam,
  visibleUserSettingsTab,
  type UserSettingsTabKey,
} from './UserSettings/tabHelpers'
import { PageHeading } from '@/components/PageHeading'

/** The query params the Trakt sign-in comes back with; removed once shown. */
const TRAKT_CALLBACK_PARAMS = ['trakt', 'username', 'message'] as const

export function UserSettingsPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTab = userSettingsTabFromParam(searchParams.get('tab'))

  const [email, setEmail] = useState('')
  const [originalEmail, setOriginalEmail] = useState('')
  const [emailLocked, setEmailLocked] = useState(false)
  const [emailNotificationsEnabled, setEmailNotificationsEnabled] = useState(true)
  const [emailNotificationsAllowed, setEmailNotificationsAllowed] = useState(false)
  const [emailLoaded, setEmailLoaded] = useState(false)
  const [loadingEmail, setLoadingEmail] = useState(false)
  const [savingEmail, setSavingEmail] = useState(false)
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null)
  const [emailError, setEmailError] = useState<string | null>(null)
  // Legacy library output: whether the library-names card applies. null until read.
  const [libraryOutputEnabled, setLibraryOutputEnabled] = useState<boolean | null>(null)
  const [traktChecked, setTraktChecked] = useState(false)

  const {
    status: traktStatus,
    loading: loadingTrakt,
    syncing: syncingTrakt,
    message: traktMessage,
    setMessage: setTraktMessage,
    fetchStatus: fetchTraktStatus,
    connect: connectTrakt,
    disconnect: disconnectTrakt,
    syncRatings: syncTraktRatings,
    showCallbackResult: showTraktCallback,
  } = useTraktIntegration()
  const newsletter = useNewsletterSubscription()

  /**
   * Which tabs this viewer gets. Emby home rows exist on Emby only. Account is
   * left out only once it is KNOWN to have nothing on it — no email grant, no
   * Trakt, no legacy library names — so a slow answer never hides it, and an
   * address naming it still lands there while the answers arrive.
   */
  const visibleTabs = useMemo<UserSettingsTabKey[]>(() => {
    const accountKnown = emailLoaded && traktChecked && libraryOutputEnabled !== null && newsletter.loaded
    const accountHasCards =
      emailNotificationsAllowed ||
      traktStatus?.traktConfigured === true ||
      libraryOutputEnabled === true ||
      newsletter.offered
    return USER_SETTINGS_TAB_KEYS.filter((key) => {
      if (key === 'home') return user?.provider === 'emby'
      if (key === 'account') return !accountKnown || accountHasCards
      return true
    })
  }, [
    emailLoaded,
    emailNotificationsAllowed,
    libraryOutputEnabled,
    newsletter.loaded,
    newsletter.offered,
    traktChecked,
    traktStatus,
    user?.provider,
  ])

  const tab = visibleUserSettingsTab(requestedTab, visibleTabs)

  const handleTabChange = (_: SyntheticEvent, next: UserSettingsTabKey) => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev)
        params.set('tab', next)
        return params
      },
      { replace: true }
    )
  }

  // The Trakt sign-in returns here with its outcome in the address; show it once and tidy up.
  useEffect(() => {
    if (!showTraktCallback(searchParams)) return
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev)
        for (const key of TRAKT_CALLBACK_PARAMS) params.delete(key)
        return params
      },
      { replace: true }
    )
  }, [searchParams, setSearchParams, showTraktCallback])

  const fetchEmailSettings = useCallback(async () => {
    if (!user?.id) return
    setLoadingEmail(true)
    try {
      const response = await fetch(`/api/users/${user.id}/email-settings`, { credentials: 'include' })
      if (response.ok) {
        const data = (await response.json()) as {
          email?: string
          emailLocked?: boolean
          emailNotificationsEnabled?: boolean
          emailNotificationsAllowed?: boolean
        }
        const emailValue = data.email || ''
        setEmail(emailValue)
        setOriginalEmail(emailValue)
        setEmailLocked(data.emailLocked || false)
        setEmailNotificationsEnabled(data.emailNotificationsEnabled ?? true)
        setEmailNotificationsAllowed(data.emailNotificationsAllowed ?? false)
      }
    } catch {
      // Optional load failures may degrade gracefully
    } finally {
      setLoadingEmail(false)
      setEmailLoaded(true)
    }
  }, [user?.id])

  const fetchLibraryOutput = useCallback(async () => {
    try {
      const response = await fetch('/api/settings/user', { credentials: 'include' })
      if (!response.ok) throw new Error()
      const data = (await response.json()) as { defaults?: { libraryOutputEnabled?: boolean } }
      // Absent is not false: an API from before the switch still writes the libraries.
      setLibraryOutputEnabled(data.defaults?.libraryOutputEnabled !== false)
    } catch {
      // Unknown reads as off: the card renames legacy libraries, which new
      // installs never create, so leaving it out is the safe guess.
      setLibraryOutputEnabled(false)
    }
  }, [])

  useEffect(() => {
    void fetchEmailSettings()
    void fetchLibraryOutput()
    void fetchTraktStatus().finally(() => setTraktChecked(true))
  }, [fetchEmailSettings, fetchLibraryOutput, fetchTraktStatus])

  const saveEmailSettings = async (newEmail?: string, newNotificationsEnabled?: boolean) => {
    if (!user?.id) return

    if (newEmail !== undefined && newEmail.trim() === originalEmail) {
      return
    }

    setSavingEmail(true)
    setEmailError(null)
    try {
      const body: { email?: string | null; emailNotificationsEnabled?: boolean } = {}
      if (newEmail !== undefined) {
        body.email = newEmail.trim() || null
      }
      if (newNotificationsEnabled !== undefined) {
        body.emailNotificationsEnabled = newNotificationsEnabled
      }

      const response = await fetch(`/api/users/${user.id}/email-settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })
      if (response.ok) {
        const data = (await response.json()) as {
          email?: string
          emailLocked?: boolean
          emailNotificationsEnabled?: boolean
          emailNotificationsAllowed?: boolean
        }
        const emailValue = data.email || ''
        setEmail(emailValue)
        setOriginalEmail(emailValue)
        setEmailLocked(data.emailLocked || false)
        setEmailNotificationsEnabled(data.emailNotificationsEnabled ?? true)
        setEmailNotificationsAllowed(data.emailNotificationsAllowed ?? false)
        setEmailSuccess(t('userSettings.emailSettingsSaved'))
        window.setTimeout(() => setEmailSuccess(null), 3000)
      } else {
        const err = (await response.json().catch(() => ({}))) as { error?: string }
        setEmailError(err.error || t('userSettings.errSaveSettings'))
      }
    } catch {
      setEmailError(t('userSettings.errConnectServer'))
    } finally {
      setSavingEmail(false)
    }
  }

  const tabIcons: Record<UserSettingsTabKey, ReactElement> = {
    recommendations: <TuneIcon />,
    display: <PaletteOutlinedIcon />,
    account: <ManageAccountsOutlinedIcon />,
    home: <HomeIcon />,
  }

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Breadcrumbs />

        <PageHeading
          title={t('userSettings.pageTitle')}
          description={t('userSettings.pageSubtitle')}
          icon={<SettingsIcon sx={{ color: 'primary.main', fontSize: 28 }} />}
          sx={{ mb: 0 }}
        />
      </Box>

      <Paper sx={{ backgroundColor: 'background.paper', borderRadius: 2 }} elevation={0}>
        <Tabs
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
          value={tab}
          onChange={handleTabChange}
          sx={{
            px: 2,
            borderBottom: 1,
            borderColor: 'divider',
            '& .MuiTab-root': {
              minHeight: 56,
              textTransform: 'none',
              fontSize: '0.9rem',
              fontWeight: 500,
            },
          }}
        >
          {visibleTabs.map((key) => (
            <Tab key={key} value={key} icon={tabIcons[key]} iconPosition="start" label={t(`userSettings.tabs.${key}`)} />
          ))}
        </Tabs>

        <Box sx={{ p: { xs: 1.5, sm: 3 } }}>
          <TabPanel value={tab} tab="recommendations">
            <RecommendationsTab />
          </TabPanel>

          <TabPanel value={tab} tab="display">
            <SettingsGrid stretch>
              <AppearanceCard />
              <PosterDisplayCard />
              <SimilarityGraphPrefsCard />
              <TipsCard />
            </SettingsGrid>
          </TabPanel>

          <TabPanel value={tab} tab="account">
            {/* Each card renders nothing when it is not offered, and the grid
                gives a card that renders nothing no cell, so none is gated here
                except the two whose deciding flag only the page holds. */}
            <SettingsGrid stretch>
              {emailNotificationsAllowed && (
                <EmailNotificationsCard
                  email={email}
                  emailLocked={emailLocked}
                  emailNotificationsEnabled={emailNotificationsEnabled}
                  loadingEmail={loadingEmail}
                  savingEmail={savingEmail}
                  emailSuccess={emailSuccess}
                  emailError={emailError}
                  onEmailChange={setEmail}
                  onEmailBlur={() => void saveEmailSettings(email)}
                  onNotificationsChange={(enabled) => {
                    setEmailNotificationsEnabled(enabled)
                    void saveEmailSettings(undefined, enabled)
                  }}
                  onDismissSuccess={() => setEmailSuccess(null)}
                  onDismissEmailError={() => setEmailError(null)}
                />
              )}
              <NewsletterCard
                subscription={newsletter.subscription}
                offered={newsletter.offered}
                saving={newsletter.saving}
                error={newsletter.error}
                onChange={(optedIn) => void newsletter.setOptedIn(optedIn)}
                onDismissError={newsletter.dismissError}
              />
              <TraktIntegrationCard
                status={traktStatus}
                loading={loadingTrakt}
                syncing={syncingTrakt}
                message={traktMessage}
                onDismissMessage={() => setTraktMessage(null)}
                onConnect={() => void connectTrakt()}
                onDisconnect={() => void disconnectTrakt()}
                onSync={() => void syncTraktRatings()}
              />
              {libraryOutputEnabled === true && <AiLibraryNamesCard user={user} />}
            </SettingsGrid>
          </TabPanel>

          <TabPanel value={tab} tab="home">
            <HomeScreenTab />
          </TabPanel>
        </Box>
      </Paper>
    </Box>
  )
}
