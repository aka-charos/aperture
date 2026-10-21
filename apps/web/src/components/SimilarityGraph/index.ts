// Barrel file - re-exports all public API from the SimilarityGraph module

// Component
export { SimilarityGraph } from './SimilarityGraph'

// Types
export type {
  GraphNode,
  GraphEdge,
  GraphData,
  ConnectionType,
  ConnectionReason,
  LoadingStatus,
} from './types'
export { CONNECTION_COLORS, CONNECTION_LABELS } from './types'

// Legend
export { GraphLegend } from './GraphLegend'
export { useLegendTypes } from './connectionHighlightStore'

// Hooks
export { useGraphData, useSimilarityData } from './useGraphData'
export type { BreadcrumbItem } from './useGraphData'
