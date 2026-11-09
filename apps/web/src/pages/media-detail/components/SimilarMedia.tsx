import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Box,
  Typography,
  Breadcrumbs,
  Link,
  IconButton,
  Tooltip,
  Paper,
  Dialog,
  Snackbar,
  Alert,
  Chip,
  Stack,
} from '@mui/material'
import { useNavigate } from 'react-router-dom'
import HomeIcon from '@mui/icons-material/Home'
import NavigateNextIcon from '@mui/icons-material/NavigateNext'
import FullscreenOutlinedIcon from '@mui/icons-material/FullscreenOutlined'
import {
  SimilarityGraph,
  GraphLegend,
  useSimilarityData,
  CONNECTION_COLORS,
} from '../../../components/SimilarityGraph'
import type { GraphNode, ConnectionReason, ConnectionType } from '../../../components/SimilarityGraph'
import { connectionTypeLabel } from '../../../i18n/connectionTypeLabel'
import { GraphExplorer } from '../../../components/GraphExplorer'
import type { MediaType, SimilarItem } from '../types'
import { TitlePosterCard, TitlePosterPlaceholderRow, TITLE_POSTER_GRID_SX } from './TitlePosterCard'
import { COMPACT_SIMILAR_GRAPH_LIMIT, FULLSCREEN_SIMILAR_GRAPH_LIMIT } from '../constants'
import { useGridColumns } from '../hooks/useGridColumns'
import { wholeRowCount } from '../wholeRows'

const MAX_LIST_REASON_CHIPS = 3

function ConnectionReasonChips({ reasons }: { reasons?: ConnectionReason[] }) {
  const { t } = useTranslation()
  if (!reasons?.length) return null
  const shown = reasons.slice(0, MAX_LIST_REASON_CHIPS)
  const extra = reasons.length - shown.length
  return (
    <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ mt: 0.75, justifyContent: 'center' }}>
      {shown.map((r, i) => {
        const baseLabel = connectionTypeLabel(r.type as ConnectionType, t)
        const detail = r.value
          ? `${baseLabel}: ${r.value}`
          : r.values?.length
            ? `${baseLabel} (${r.values.slice(0, 2).join(', ')}${r.values.length > 2 ? '…' : ''})`
            : baseLabel
        return (
          <Tooltip key={i} title={detail}>
            <Chip
              size="small"
              label={baseLabel}
              sx={{
                height: 22,
                maxWidth: '100%',
                fontSize: '0.65rem',
                borderLeft: 3,
                borderColor: CONNECTION_COLORS[r.type] ?? 'grey.500',
                bgcolor: 'action.hover',
                '& .MuiChip-label': { px: 0.75, overflow: 'hidden', textOverflow: 'ellipsis' },
              }}
            />
          </Tooltip>
        )
      })}
      {extra > 0 && (
        <Chip size="small" label={`+${extra}`} sx={{ height: 22, fontSize: '0.65rem' }} />
      )}
    </Stack>
  )
}

export type SimilarViewMode = 'list' | 'graph'

interface SimilarMediaProps {
  mediaType: MediaType
  /** Chosen by the panel's List/Graph switch (`RelatedPanel`), which draws the heading. */
  viewMode: SimilarViewMode
  mediaId?: string
  mediaTitle?: string
  similar: SimilarItem[]
  /** The list is still being searched; draws placeholder posters in its place. */
  loading?: boolean
  /** Show the picked item without routing (set when this list is inside a dialog). */
  onOpenMedia?: (mediaType: MediaType, id: string) => void
}

export function SimilarMedia({
  mediaType,
  viewMode,
  mediaId,
  mediaTitle,
  similar,
  loading = false,
  onOpenMedia,
}: SimilarMediaProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  })

  // Fetch graph data with rabbit-hole navigation support (depth=1 for compact view)
  const {
    data: graphData,
    loading: graphLoading,
    loadingStatus: graphLoadingStatus,
    history,
    setFocusId,
    goToHistoryIndex,
    startOver,
  } = useSimilarityData(mediaType, viewMode === 'graph' ? mediaId || null : null, {
    limit: COMPACT_SIMILAR_GRAPH_LIMIT,
    depth: 1,
  })

  // The list draws whole rows only: the grid fits as many cards as its column
  // allows, so no fetched count can promise to fill the last row by itself.
  const [gridRef, columns] = useGridColumns()
  const shown = similar.slice(0, wholeRowCount(similar.length, columns))

  // Fetch expanded graph data for fullscreen (depth=3 - deep spider out effect)
  const {
    data: fullscreenGraphData,
    loading: fullscreenLoading,
    loadingStatus: fullscreenLoadingStatus,
    history: fullscreenHistory,
    setFocusId: fullscreenSetFocusId,
    goToHistoryIndex: fullscreenGoToHistoryIndex,
    startOver: fullscreenStartOver,
  } = useSimilarityData(mediaType, isFullscreen ? mediaId || null : null, {
    limit: FULLSCREEN_SIMILAR_GRAPH_LIMIT,
    depth: 3,
  })

  // Get current center node title
  const currentTitle =
    graphData?.nodes.find((n) => n.isCenter)?.title || mediaTitle || t('mediaDetail.similar.fallbackCenterTitle')

  const openMedia = (type: MediaType, id: string) => {
    if (onOpenMedia) {
      onOpenMedia(type, id)
      return
    }
    navigate(`/${type === 'movie' ? 'movies' : 'series'}/${id}`)
  }

  // Rabbit hole navigation: Shift+click (or the node's corner button)
  // re-centres the graph on a title
  const handleNodeExplore = (node: GraphNode) => {
    if (!node.isCenter) {
      setFocusId(node.id, node.type)
    }
  }

  // A plain click shows the title itself. The page's own title is already on
  // screen, so its poster does nothing; anything else closes the fullscreen
  // graph first, since on the title route opening a title navigates and this
  // component (not remounted per title) would keep the dialog over the page.
  const handleNodeOpen = (node: GraphNode) => {
    if (node.id === mediaId) return
    setIsFullscreen(false)
    openMedia(node.type, node.id)
  }

  const handleFullscreenNodeExplore = useCallback(
    (node: GraphNode) => {
      if (!node.isCenter) {
        fullscreenSetFocusId(node.id, node.type)
      }
    },
    [fullscreenSetFocusId]
  )

  if (similar.length === 0 && !mediaId) {
    return null
  }

  return (
    <Box>
      {viewMode === 'list' && loading && similar.length === 0 ? (
        // One row of placeholders, as Next from here shows: how many titles
        // come back is not known yet.
        <TitlePosterPlaceholderRow />
      ) : viewMode === 'list' ? (
        <Box ref={gridRef} sx={TITLE_POSTER_GRID_SX}>
          {shown.map((item) => (
            <TitlePosterCard
              key={item.id}
              mediaType={mediaType}
              id={item.id}
              title={item.title}
              year={item.year}
              posterUrl={item.poster_url}
              genres={item.genres}
              onOpen={() => openMedia(mediaType, item.id)}
            >
              <ConnectionReasonChips reasons={item.reasons} />
            </TitlePosterCard>
          ))}
        </Box>
      ) : (
        <>
          {/* Compact graph in Paper */}
          <Paper
            sx={{
              p: 2,
              borderRadius: 2,
              bgcolor: 'background.paper',
              position: 'relative',
            }}
          >
            {/* Fullscreen button */}
            <Tooltip title="Fullscreen">
              <IconButton
                size="small"
                onClick={() => setIsFullscreen(true)}
                sx={{
                  position: 'absolute',
                  top: 8,
                  right: 8,
                  zIndex: 10,
                  bgcolor: 'rgba(0,0,0,0.5)',
                  color: 'white',
                  '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' },
                }}
              >
                <FullscreenOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            {/* Breadcrumb navigation for rabbit-hole exploration */}
            {history.length > 0 && (
              <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                <Tooltip title={t('mediaDetail.similar.tooltipStartOver')}>
                  <IconButton size="small" onClick={startOver} sx={{ color: 'primary.main' }}>
                    <HomeIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Breadcrumbs
                  separator={<NavigateNextIcon fontSize="small" />}
                  sx={{
                    '& .MuiBreadcrumbs-separator': { mx: 0.5 },
                    '& .MuiBreadcrumbs-li': { fontSize: '0.875rem' },
                  }}
                >
                  {history.map((item, index) => (
                    <Link
                      key={item.id}
                      component="button"
                      variant="body2"
                      onClick={() => goToHistoryIndex(index)}
                      sx={{
                        cursor: 'pointer',
                        color: 'text.secondary',
                        '&:hover': { color: 'primary.main' },
                      }}
                    >
                      {item.title}
                    </Link>
                  ))}
                  <Typography variant="body2" color="text.primary" fontWeight={500}>
                    {currentTitle}
                  </Typography>
                </Breadcrumbs>
              </Box>
            )}

            <SimilarityGraph
              data={graphData}
              loading={graphLoading}
              loadingStatus={graphLoadingStatus || undefined}
              onNodeOpen={handleNodeOpen}
              onNodeExplore={handleNodeExplore}
              compact
            />
            <Box
              sx={{ mt: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <GraphLegend edges={graphData?.edges} compact />
              <Typography variant="caption" color="text.secondary">
                {t('mediaDetail.similar.graphHintOpen')}
              </Typography>
            </Box>
          </Paper>

          {/* Fullscreen Dialog - uses GraphExplorer */}
          <Dialog
            open={isFullscreen}
            onClose={() => setIsFullscreen(false)}
            maxWidth={false}
            fullScreen
            PaperProps={{
              sx: {
                bgcolor: 'background.default',
                m: 0,
              },
            }}
          >
            <GraphExplorer
              data={fullscreenGraphData}
              loading={fullscreenLoading}
              loadingStatus={fullscreenLoadingStatus}
              title={
                mediaType === 'movie'
                  ? t('mediaDetail.similar.titleMovies')
                  : t('mediaDetail.similar.titleSeries')
              }
              subtitle={t('mediaDetail.similar.expandedSubtitle', {
                count: fullscreenGraphData?.nodes.length || 0,
              })}
              history={fullscreenHistory}
              onHistoryNavigate={(index) =>
                index === 0 ? fullscreenStartOver() : fullscreenGoToHistoryIndex(index)
              }
              onStartOver={fullscreenStartOver}
              onNodeOpen={handleNodeOpen}
              onNodeExplore={handleFullscreenNodeExplore}
              showCreatePlaylist
              showExitFullscreen
              onExitFullscreen={() => setIsFullscreen(false)}
              sourceItemId={mediaId}
              sourceItemType={mediaType}
            />
          </Dialog>
        </>
      )}

      {/* Success/Error Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}
