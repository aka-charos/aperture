export interface MediaServerType {
  id: string
  name: string
}

export interface DiscoveredServer {
  id: string
  name: string
  address: string
  type: 'emby' | 'jellyfin'
}

export interface ExistingMediaServer {
  type: string
  baseUrl: string
  maskedApiKey: string
}

export type SetupStepId =
  | 'restoreFromBackup'
  | 'mediaServer'
  | 'mediaLibraries'
  | 'users'
  | 'topPicks'
  | 'aiSetup'
  | 'initialJobs'
  | 'complete'

export type AIFunction = 'embeddings' | 'chat' | 'textGeneration'

export interface AIFunctionConfig {
  provider: string
  model: string
  apiKey?: string
  baseUrl?: string
}

export interface AIConfig {
  embeddings?: AIFunctionConfig | null
  chat?: AIFunctionConfig | null
  textGeneration?: AIFunctionConfig | null
}

export interface AIProviderOption {
  id: string
  name: string
  description: string
  requiresApiKey: boolean
  requiresBaseUrl: boolean
  defaultBaseUrl?: string
  supportsEmbeddings: boolean
  supportsChat: boolean
  supportsTextGeneration: boolean
}

export interface AIModelOption {
  id: string
  name: string
  description?: string
  contextWindow?: number
  dimensions?: number
}

export interface SetupProgress {
  completedSteps: SetupStepId[]
  currentStep: SetupStepId | null
}

export interface LibraryConfig {
  providerLibraryId: string
  name: string
  collectionType: string
  isEnabled: boolean
}

/**
 * The wizard asks only whether Top Picks is on. Its library, collection and
 * playlist output is legacy (F-142) and configured in Admin → Top Picks.
 */
export interface TopPicksConfig {
  isEnabled: boolean
}

export interface SetupUser {
  providerUserId: string
  name: string
  isAdmin: boolean
  isDisabled: boolean
  lastActivityDate?: string
  // Aperture status
  apertureUserId: string | null
  isImported: boolean
  isEnabled: boolean
  recommendationsEnabled: boolean
}

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

export interface JobLogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
}

export interface JobProgress {
  id: string
  name: string
  description: string
  status: JobStatus
  progress?: number
  message?: string
  error?: string
  // Detailed progress info
  currentStep?: string
  itemsProcessed?: number
  itemsTotal?: number
  currentItem?: string
  // Job result (populated on completion)
  result?: Record<string, unknown>
}

export interface SetupWizardState {
  // Navigation
  activeStep: number
  progress: SetupProgress | null
  stepId: SetupStepId

  // Media Server
  mediaServerTypes: MediaServerType[]
  discoveredServers: DiscoveredServer[]
  discoveringServers: boolean
  serverType: string
  serverUrl: string
  serverApiKey: string
  serverName: string
  showApiKey: boolean
  existingMediaServer: ExistingMediaServer | null

  // Libraries
  libraries: LibraryConfig[]
  loadingLibraries: boolean

  // Users
  setupUsers: SetupUser[]
  loadingUsers: boolean
  usersError: string | null
  setupCompleteForUsers: boolean // True if API returned 403

  // AI Configuration (multi-provider)
  aiConfig: AIConfig
  aiProviders: AIProviderOption[]
  loadingAIConfig: boolean

  // Top Picks
  topPicks: TopPicksConfig

  // UI State
  testing: boolean
  saving: boolean
  error: string
  testSuccess: boolean
  aiTestResults: Record<AIFunction, boolean | null>
  runningJobs: boolean
  jobLogs: string[]
  jobsProgress: JobProgress[]
  currentJobIndex: number
}

export interface SetupWizardActions {
  setActiveStep: (step: number) => void
  goToStep: (stepId: SetupStepId) => void

  // Media Server
  discoverServers: () => Promise<void>
  selectDiscoveredServer: (server: DiscoveredServer) => void
  setServerType: (type: string) => void
  setServerUrl: (url: string) => void
  setServerApiKey: (key: string) => void
  setShowApiKey: (show: boolean) => void
  handleTestMediaServer: () => Promise<void>
  handleSaveMediaServer: () => Promise<void>

  // Libraries
  setLibraries: React.Dispatch<React.SetStateAction<LibraryConfig[]>>
  loadLibraries: () => Promise<void>
  saveLibraries: () => Promise<void>

  // Users
  fetchSetupUsers: () => Promise<void>
  importAndEnableUser: (providerUserId: string, recommendationsEnabled: boolean) => Promise<void>
  toggleUserRecommendations: (providerUserId: string, enabled: boolean) => Promise<void>

  // AI Configuration (multi-provider)
  loadAIConfig: () => Promise<void>
  loadAIProviders: () => Promise<void>
  setAIFunctionConfig: (fn: AIFunction, config: AIFunctionConfig | null) => void
  testAIConnection: (fn: AIFunction) => Promise<boolean>
  saveAIConfig: () => Promise<void>
  getModelsForProvider: (providerId: string, fn: AIFunction) => Promise<AIModelOption[]>

  // Top Picks
  setTopPicks: React.Dispatch<React.SetStateAction<TopPicksConfig>>
  saveTopPicks: () => Promise<void>

  // Jobs
  runInitialJobs: () => Promise<void>
  runSingleJob: (jobId: string) => Promise<void>

  // Complete
  handleCompleteSetup: () => Promise<void>

  // Progress
  updateProgress: (opts: { currentStep?: SetupStepId | null; completedStep?: SetupStepId }) => Promise<void>
}

export type SetupWizardContext = SetupWizardState & SetupWizardActions

