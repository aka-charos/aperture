import React, { Suspense, lazy } from 'react'
import { Box, CircularProgress } from '@mui/material'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from './i18n/config'
import { RtlProviders } from './RtlProviders'
import { AuthProvider } from './hooks/AuthProvider'
import { useAuth } from './hooks/useAuth'
import { WatchingProvider } from './hooks/useWatching'
import { SetupProvider } from './hooks/SetupProvider'
import { useSetupStatus } from './hooks/useSetupStatus'
import { UserRatingsProvider } from './hooks/UserRatingsProvider'
import { WatchStatusProvider } from './hooks/WatchStatusProvider'
import { ConnectionsProvider } from './hooks/ConnectionsProvider'
import { ViewModeProvider } from './hooks/ViewModeProvider'
import { PosterPrefsProvider } from './hooks/PosterPrefsProvider'
import { AssistantDockProvider } from './hooks/AssistantDockProvider'
import { Layout } from './components/Layout'
import { AssistantModal } from './components/AssistantModal'
import { PageErrorBoundary } from './components/PageErrorBoundary'
import { useCapability } from './hooks/useCapability'
import { DarkStage } from './components/DarkStage'
// The route table itself: its pages are lazy (pages/admin/nav/elements.tsx).
import { adminChildRoutes } from './pages/admin/nav/routes'

/*
 * Every page is its own chunk, so the first download is the shell (Layout, the
 * providers, MUI, English) and nobody pays for pages they never open.
 * `routeImports.test.ts` fails on an eager page import in this file. A page in
 * the Layout subtree suspends inside Layout, which keeps the sidebar and app bar
 * on screen; login and setup suspend in `AppRoutes`.
 */
const AdminShell = lazy(async () => ({
  default: (await import('./components/AdminShell')).AdminShell,
}))
const LoginPage = lazy(async () => ({ default: (await import('./pages/Login')).LoginPage }))
const SetupPage = lazy(async () => ({ default: (await import('./pages/setup')).SetupPage }))
const DashboardPage = lazy(async () => ({
  default: (await import('./pages/dashboard')).DashboardPage,
}))
const MyRecommendationsPage = lazy(async () => ({
  default: (await import('./pages/MyRecommendations')).MyRecommendationsPage,
}))
const MyWatchHistoryPage = lazy(async () => ({
  default: (await import('./pages/MyWatchHistory')).MyWatchHistoryPage,
}))
const SharedWithMePage = lazy(async () => ({
  default: (await import('./pages/SharedWithMe')).SharedWithMePage,
}))
const MoviesPage = lazy(async () => ({ default: (await import('./pages/Movies')).MoviesPage }))
const SeriesPage = lazy(async () => ({ default: (await import('./pages/Series')).SeriesPage }))
const MovieDetailPage = lazy(async () => ({
  default: (await import('./pages/media-detail')).MovieDetailPage,
}))
const SeriesDetailPage = lazy(async () => ({
  default: (await import('./pages/media-detail')).SeriesDetailPage,
}))
const PlaylistsPage = lazy(async () => ({
  default: (await import('./pages/playlists')).PlaylistsPage,
}))
const CollectionsPage = lazy(async () => ({
  default: (await import('./pages/collections')).CollectionsPage,
}))
const UserSettingsPage = lazy(async () => ({
  default: (await import('./pages/UserSettings')).UserSettingsPage,
}))
const TopPicksPage = lazy(async () => ({
  default: (await import('./pages/top-picks')).TopPicksPage,
}))
const TopPicksMoviesPage = lazy(async () => ({
  default: (await import('./pages/top-picks')).TopPicksMoviesPage,
}))
const TopPicksSeriesPage = lazy(async () => ({
  default: (await import('./pages/top-picks')).TopPicksSeriesPage,
}))
const BrowsePage = lazy(async () => ({ default: (await import('./pages/Browse')).BrowsePage }))
const WatchStatsPage = lazy(async () => ({
  default: (await import('./pages/WatchStats')).WatchStatsPage,
}))
const SearchPage = lazy(async () => ({ default: (await import('./pages/Search')).SearchPage }))
const FranchisesPage = lazy(async () => ({
  default: (await import('./pages/Franchises')).FranchisesPage,
}))
const FranchiseDetailPage = lazy(async () => ({
  default: (await import('./pages/FranchiseDetail')).FranchiseDetailPage,
}))
const WatchingPage = lazy(async () => ({ default: (await import('./pages/watching')).WatchingPage }))
const PersonDetailPage = lazy(async () => ({
  default: (await import('./pages/PersonDetail')).PersonDetailPage,
}))
const StudioDetailPage = lazy(async () => ({
  default: (await import('./pages/StudioDetail')).StudioDetailPage,
}))
const ExplorePage = lazy(async () => ({ default: (await import('./pages/explore')).ExplorePage }))
const NextFromHerePage = lazy(async () => ({
  default: (await import('./pages/next')).NextFromHerePage,
}))
const TrailsRedirect = lazy(async () => ({
  default: (await import('./pages/next/TrailsRedirect')).TrailsRedirect,
}))
const AssistantPage = lazy(async () => ({
  default: (await import('./pages/assistant')).AssistantPage,
}))
const DiscoveryPage = lazy(async () => ({
  default: (await import('./pages/discovery')).DiscoveryPage,
}))
const MyRequestsPage = lazy(async () => ({
  default: (await import('./pages/MyRequests')).MyRequestsPage,
}))
const UserGuidePage = lazy(async () => ({
  default: (await import('./pages/guide/UserGuidePage')).UserGuidePage,
}))

/** The whole window while nothing can be drawn yet: auth, setup, a page outside Layout. */
function FullPageLoading() {
  return (
    <Box
      display="flex"
      alignItems="center"
      justifyContent="center"
      minHeight="100dvh"
      bgcolor="background.default"
    >
      <CircularProgress />
    </Box>
  )
}

function SetupGuard({ children }: { children: React.ReactNode }) {
  const { status, loading } = useSetupStatus()

  if (loading) {
    return <FullPageLoading />
  }

  // Redirect to setup if needed
  if (status?.needsSetup) {
    return <Navigate to="/setup" replace />
  }

  return <>{children}</>
}

/**
 * The floating chat, for an account allowed the assistant. Not mounted at all
 * otherwise, so it never reserves dock width for a chat that cannot open.
 */
function AssistantEntry() {
  return useCapability('assistant') ? <AssistantModal /> : null
}

/**
 * /assistant for an account without the assistant goes home rather than
 * rendering a chat whose every request would answer 403 — the address still
 * exists in bookmarks and browser history after the link leaves the sidebar.
 */
function AssistantRoute() {
  return useCapability('assistant') ? <AssistantPage /> : <Navigate to="/" replace />
}

/**
 * The Watch This page's first address, from when it was "Shared with me". Kept
 * so bookmarks land, with `?tab=` carried across.
 */
function LegacySharedRedirect() {
  const { search } = useLocation()
  return <Navigate to={{ pathname: '/watch-this', search }} replace />
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()

  if (loading) {
    return <FullPageLoading />
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  // Wrap with providers so state is available everywhere
  // Include AssistantModal for AI chat on all authenticated pages
  return (
    <ViewModeProvider>
      <PosterPrefsProvider>
        <UserRatingsProvider>
          <WatchStatusProvider>
            <ConnectionsProvider>
              <WatchingProvider>
                <AssistantDockProvider>
                  {children}
                  <AssistantEntry />
                </AssistantDockProvider>
              </WatchingProvider>
            </ConnectionsProvider>
          </WatchStatusProvider>
        </UserRatingsProvider>
      </PosterPrefsProvider>
    </ViewModeProvider>
  )
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()

  if (loading) {
    return <FullPageLoading />
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (!user.isAdmin) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}

function AppRoutes() {
  const { pathname } = useLocation()
  return (
    <PageErrorBoundary resetKey={pathname}>
      <Suspense fallback={<FullPageLoading />}>
        <Routes>
          <Route path="/setup" element={<SetupPage />} />
          <Route
            path="/login"
            element={
              <DarkStage fullPage>
                <LoginPage />
              </DarkStage>
            }
          />

          <Route
            path="/"
            element={
              <SetupGuard>
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              </SetupGuard>
            }
          >
            {/* User Routes */}
            <Route index element={<DashboardPage />} />
            <Route path="assistant" element={<AssistantRoute />} />
            <Route path="recommendations" element={<MyRecommendationsPage />} />
            <Route path="watch-this" element={<SharedWithMePage />} />
            <Route path="shared-with-me" element={<LegacySharedRedirect />} />
            <Route path="watching" element={<WatchingPage />} />
            <Route path="top-picks" element={<TopPicksPage />} />
            <Route path="top-picks/movies" element={<TopPicksMoviesPage />} />
            <Route path="top-picks/series" element={<TopPicksSeriesPage />} />
            <Route path="playlists" element={<PlaylistsPage />} />
            <Route path="collections" element={<CollectionsPage />} />
            <Route path="explore" element={<ExplorePage />} />
            {/* Trails was folded into Next from here; old links keep their trail. */}
            <Route path="trails" element={<TrailsRedirect />} />
            <Route path="next" element={<NextFromHerePage />} />
            <Route path="discovery" element={<DiscoveryPage />} />
            <Route path="my-requests" element={<MyRequestsPage />} />
            <Route path="browse" element={<BrowsePage />} />
            <Route path="movies" element={<MoviesPage />} />
            <Route path="movies/:id" element={<MovieDetailPage />} />
            <Route path="series" element={<SeriesPage />} />
            <Route path="series/:id" element={<SeriesDetailPage />} />
            <Route path="history" element={<MyWatchHistoryPage />} />
            <Route path="stats" element={<WatchStatsPage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="franchises" element={<FranchisesPage />} />
            {/* `:id`, not `:collectionId` — Breadcrumbs skips a segment matching params.id. */}
            <Route path="franchises/:id" element={<FranchiseDetailPage />} />
            <Route path="person/:name" element={<PersonDetailPage />} />
            <Route path="studio/:name" element={<StudioDetailPage />} />
            <Route path="settings" element={<UserSettingsPage />} />
            <Route path="help/*" element={<UserGuidePage />} />

            {/* Admin Routes — the whole subtree is generated from the registry in
                `pages/admin/nav`, which is also what the nav column and the
                settings palette read. Listing routes here as well would be a second
                copy that could disagree with the first. */}
            <Route
              path="admin"
              element={
                <AdminRoute>
                  <AdminShell />
                </AdminRoute>
              }
            >
              {adminChildRoutes()}
            </Route>
          </Route>
        </Routes>
      </Suspense>
    </PageErrorBoundary>
  )
}

export default function App() {
  return (
    <I18nextProvider i18n={i18n}>
      <RtlProviders>
        <BrowserRouter>
          <SetupProvider>
            <AuthProvider>
              <AppRoutes />
            </AuthProvider>
          </SetupProvider>
        </BrowserRouter>
      </RtlProviders>
    </I18nextProvider>
  )
}
