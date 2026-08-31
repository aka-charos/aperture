import { lazy, type ComponentType, type ReactElement } from 'react'
import AccountTreeIcon from '@mui/icons-material/AccountTree'
import AddToQueueIcon from '@mui/icons-material/AddToQueue'
import ArticleIcon from '@mui/icons-material/Article'
import BackupIcon from '@mui/icons-material/Backup'
import BadgeIcon from '@mui/icons-material/Badge'
import CalculateIcon from '@mui/icons-material/Calculate'
import CategoryIcon from '@mui/icons-material/Category'
import ContactMailIcon from '@mui/icons-material/ContactMail'
import DashboardIcon from '@mui/icons-material/Dashboard'
import DnsIcon from '@mui/icons-material/Dns'
import DriveFileRenameOutlineIcon from '@mui/icons-material/DriveFileRenameOutline'
import FactCheckIcon from '@mui/icons-material/FactCheck'
import FolderOpenIcon from '@mui/icons-material/FolderOpen'
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted'
import GTranslateIcon from '@mui/icons-material/GTranslate'
import HealingIcon from '@mui/icons-material/Healing'
import ImageIcon from '@mui/icons-material/Image'
import LiveTvIcon from '@mui/icons-material/LiveTv'
import LocalMoviesIcon from '@mui/icons-material/LocalMovies'
import ManageSearchIcon from '@mui/icons-material/ManageSearch'
import MemoryIcon from '@mui/icons-material/Memory'
import MovieIcon from '@mui/icons-material/Movie'
import OutputIcon from '@mui/icons-material/Output'
import PaidIcon from '@mui/icons-material/Paid'
import PaletteIcon from '@mui/icons-material/Palette'
import PeopleIcon from '@mui/icons-material/People'
import PlaylistAddCheckIcon from '@mui/icons-material/PlaylistAddCheck'
import PlaylistPlayIcon from '@mui/icons-material/PlaylistPlay'
import PsychologyIcon from '@mui/icons-material/Psychology'
import ScatterPlotIcon from '@mui/icons-material/ScatterPlot'
import SecurityIcon from '@mui/icons-material/Security'
import StarRateIcon from '@mui/icons-material/StarRate'
import StorageIcon from '@mui/icons-material/Storage'
import SyncAltIcon from '@mui/icons-material/SyncAlt'
import TranslateIcon from '@mui/icons-material/Translate'
import TravelExploreIcon from '@mui/icons-material/TravelExplore'
import TuneIcon from '@mui/icons-material/Tune'
import ScienceIcon from '@mui/icons-material/Science'
import VideoLibraryIcon from '@mui/icons-material/VideoLibrary'
import VpnKeyIcon from '@mui/icons-material/VpnKey'
import WhatshotIcon from '@mui/icons-material/Whatshot'
import WorkIcon from '@mui/icons-material/Work'

/**
 * The React half of the registry: what each admin destination looks like and
 * what it renders.
 *
 * Split from `registry.ts` so that file can stay pure data and be loaded by a
 * test without a DOM. The two halves are keyed by the same ids and
 * `registry.test.ts` asserts they cover exactly the same set — an entry with no
 * element, or an element with no entry, fails the suite rather than rendering a
 * blank pane.
 *
 * Every component is `lazy`. Nothing under `/admin` was code-split before, so
 * ~15k lines of settings sections were parsed on first paint for every visitor,
 * admin or not; now a non-admin downloads none of it and an admin downloads the
 * one section they opened. The sections are named exports, hence the `default`
 * re-wrap on each import.
 */

export interface AdminElement {
  icon: ReactElement
  Component: ComponentType
}

const section = (loader: () => Promise<Record<string, unknown>>, name: string) =>
  lazy(async () => ({ default: (await loader())[name] as ComponentType }))

export const ADMIN_ELEMENTS: Record<string, AdminElement> = {
  // ---------------------------------------------------------------- overview
  overview: {
    icon: <DashboardIcon />,
    Component: section(() => import('@/pages/admin/AdminDashboard'), 'AdminDashboard'),
  },

  // ----------------------------------------------------------------- library
  'media-server': {
    icon: <StorageIcon />,
    Component: section(
      () => import('@/pages/settings/components/MediaServerSection'),
      'MediaServerSection'
    ),
  },
  libraries: {
    icon: <VideoLibraryIcon />,
    Component: lazy(() => import('@/pages/admin/routes/LibrariesRoute')),
  },
  'file-locations': {
    icon: <FolderOpenIcon />,
    Component: section(
      () => import('@/pages/settings/components/FileLocationsSection'),
      'FileLocationsSection'
    ),
  },
  'gap-analysis': {
    icon: <FactCheckIcon />,
    Component: section(() => import('@/pages/admin/GapAnalysisPage'), 'GapAnalysisPage'),
  },

  // ------------------------------------------------------------ integrations
  tmdb: {
    icon: <MovieIcon />,
    Component: section(
      () => import('@/pages/settings/components/TMDbConfigSection'),
      'TMDbConfigSection'
    ),
  },
  omdb: {
    icon: <LocalMoviesIcon />,
    Component: section(
      () => import('@/pages/settings/components/OMDbConfigSection'),
      'OMDbConfigSection'
    ),
  },
  mdblist: {
    icon: <FormatListBulletedIcon />,
    Component: section(
      () => import('@/pages/settings/components/MDBListConfigSection'),
      'MDBListConfigSection'
    ),
  },
  trakt: {
    icon: <SyncAltIcon />,
    Component: section(
      () => import('@/pages/settings/components/TraktConfigSection'),
      'TraktConfigSection'
    ),
  },
  seerr: {
    icon: <PlaylistAddCheckIcon />,
    Component: section(
      () => import('@/pages/settings/components/SeerrConfigSection'),
      'SeerrConfigSection'
    ),
  },
  lldap: {
    icon: <ContactMailIcon />,
    Component: section(
      () => import('@/pages/settings/components/LldapConfigSection'),
      'LldapConfigSection'
    ),
  },
  n8n: {
    icon: <AccountTreeIcon />,
    Component: section(
      () => import('@/pages/settings/components/N8nConfigSection'),
      'N8nConfigSection'
    ),
  },
  tavily: {
    icon: <TravelExploreIcon />,
    Component: section(
      () => import('@/pages/settings/components/TavilyConfigSection'),
      'TavilyConfigSection'
    ),
  },
  crw: {
    icon: <ManageSearchIcon />,
    Component: section(
      () => import('@/pages/settings/components/CrwConfigSection'),
      'CrwConfigSection'
    ),
  },
  streaming: {
    icon: <LiveTvIcon />,
    Component: section(
      () => import('@/pages/settings/components/StreamingDiscoverySettings'),
      'StreamingDiscoverySettings'
    ),
  },
  'ratings-refresh': {
    icon: <StarRateIcon />,
    Component: section(
      () => import('@/pages/settings/components/RatingsRefreshSection'),
      'RatingsRefreshSection'
    ),
  },

  // --------------------------------------------------------------- ai models
  'ai-roles': {
    icon: <MemoryIcon />,
    Component: section(
      () => import('@/pages/settings/components/AISetupSection'),
      'AISetupSection'
    ),
  },
  'ai-spend': {
    icon: <PaidIcon />,
    Component: section(
      () => import('@/pages/settings/components/InferenceDashboardSection'),
      'InferenceDashboardSection'
    ),
  },
  'ai-estimate': {
    icon: <CalculateIcon />,
    Component: section(
      () => import('@/pages/settings/components/CostEstimatorSection'),
      'CostEstimatorSection'
    ),
  },
  embeddings: {
    icon: <ScatterPlotIcon />,
    Component: lazy(() => import('@/pages/admin/routes/EmbeddingsRoute')),
  },

  // --------------------------------------------------------- recommendations
  algorithm: {
    icon: <TuneIcon />,
    Component: lazy(() => import('@/pages/admin/routes/AlgorithmRoute')),
  },
  evaluation: {
    icon: <ScienceIcon />,
    Component: lazy(() => import('@/pages/admin/routes/EvaluationRoute')),
  },
  explanations: {
    icon: <PsychologyIcon />,
    Component: section(
      () => import('@/pages/settings/components/AiExplanationSection'),
      'AiExplanationSection'
    ),
  },
  'output-format': {
    icon: <OutputIcon />,
    Component: section(
      () => import('@/pages/settings/components/OutputFormatSection'),
      'OutputFormatSection'
    ),
  },
  'library-naming': {
    icon: <DriveFileRenameOutlineIcon />,
    Component: section(
      () => import('@/pages/settings/components/LibraryTitlesSection'),
      'LibraryTitlesSection'
    ),
  },
  'top-picks': {
    icon: <WhatshotIcon />,
    Component: section(() => import('@/pages/settings/topPicks/TopPicksSection'), 'TopPicksSection'),
  },
  watching: {
    icon: <AddToQueueIcon />,
    Component: section(
      () => import('@/pages/settings/components/WatchingSection'),
      'WatchingSection'
    ),
  },
  'genre-strips': {
    icon: <CategoryIcon />,
    Component: lazy(() => import('@/pages/admin/routes/GenreStripsRoute')),
  },
  'channels-web-expand': {
    icon: <PlaylistPlayIcon />,
    Component: section(
      () => import('@/pages/settings/components/ChannelsWebExpandSettings'),
      'ChannelsWebExpandSettings'
    ),
  },

  // -------------------------------------------------------------- appearance
  branding: {
    icon: <BadgeIcon />,
    Component: section(
      () => import('@/pages/settings/components/BrandingSection'),
      'BrandingSection'
    ),
  },
  'theme-colors': {
    icon: <PaletteIcon />,
    Component: section(
      () => import('@/pages/settings/components/ThemeColorsSection'),
      'ThemeColorsSection'
    ),
  },
  'poster-display': {
    icon: <ImageIcon />,
    Component: section(
      () => import('@/pages/settings/components/PosterDisplaySection'),
      'PosterDisplaySection'
    ),
  },
  'language-defaults': {
    icon: <TranslateIcon />,
    Component: section(
      () => import('@/pages/settings/components/LanguageDefaultsSection'),
      'LanguageDefaultsSection'
    ),
  },
  translations: {
    icon: <GTranslateIcon />,
    Component: section(
      () => import('@/pages/admin/translations/TranslationsPage'),
      'TranslationsPage'
    ),
  },

  // ------------------------------------------------------------------ access
  users: {
    icon: <PeopleIcon />,
    Component: section(() => import('@/pages/Users'), 'UsersPage'),
  },
  'api-keys': {
    icon: <VpnKeyIcon />,
    Component: section(
      () => import('@/pages/settings/components/ApiKeysSection'),
      'ApiKeysSection'
    ),
  },
  deployment: {
    icon: <SecurityIcon />,
    Component: section(
      () => import('@/pages/settings/components/DeploymentSection'),
      'DeploymentSection'
    ),
  },

  // -------------------------------------------------------------- operations
  jobs: {
    icon: <WorkIcon />,
    Component: section(() => import('@/pages/jobs'), 'JobsPage'),
  },
  backup: {
    icon: <BackupIcon />,
    Component: section(() => import('@/pages/settings/components/BackupSection'), 'BackupSection'),
  },
  'poster-repair': {
    icon: <HealingIcon />,
    Component: section(
      () => import('@/pages/settings/components/PosterRepairSection'),
      'PosterRepairSection'
    ),
  },
  logs: {
    icon: <ArticleIcon />,
    Component: section(
      () => import('@/pages/settings/components/SystemLogsSection'),
      'SystemLogsSection'
    ),
  },
  database: {
    icon: <DnsIcon />,
    Component: lazy(() => import('@/pages/admin/routes/DatabaseRoute')),
  },
}
