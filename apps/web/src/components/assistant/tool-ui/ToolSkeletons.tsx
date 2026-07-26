/**
 * Skeleton loaders for tool results while loading
 */
import { Box, Paper, Skeleton } from '@mui/material'
import { useTranslation } from 'react-i18next'

// Skeleton for a single content card. Mirrors compact ContentCard geometry —
// same rail width, poster height and card width, so cards don't jump when the
// real result replaces the placeholder.
function CardSkeleton() {
  return (
    <Paper
      sx={{
        display: 'flex',
        gap: 1.5,
        p: 1.5,
        bgcolor: '#1a1a1a',
        borderRadius: 2,
        minWidth: 300,
        maxWidth: 340,
      }}
    >
      {/* Meta rail skeleton: poster, then ratings and genres */}
      <Box sx={{ width: 84, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Skeleton variant="rounded" width={84} height={126} sx={{ bgcolor: '#2a2a2a' }} />
        <Skeleton variant="text" width={44} height={14} sx={{ bgcolor: '#2a2a2a' }} />
        <Skeleton variant="text" width="100%" height={12} sx={{ bgcolor: '#2a2a2a' }} />
      </Box>
      {/* Text column skeleton */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75 }}>
          <Skeleton variant="text" width="70%" height={20} sx={{ bgcolor: '#2a2a2a', flex: 1 }} />
          <Skeleton variant="rounded" width={46} height={18} sx={{ bgcolor: '#2a2a2a', flexShrink: 0 }} />
        </Box>
        <Skeleton variant="text" width="50%" height={16} sx={{ bgcolor: '#2a2a2a' }} />
        <Skeleton variant="text" width="100%" height={14} sx={{ bgcolor: '#2a2a2a' }} />
        <Skeleton variant="text" width="95%" height={14} sx={{ bgcolor: '#2a2a2a' }} />
        <Skeleton variant="text" width="70%" height={14} sx={{ bgcolor: '#2a2a2a' }} />
        <Box sx={{ display: 'flex', gap: 1, mt: 'auto', pt: 1 }}>
          <Skeleton variant="rounded" width={60} height={24} sx={{ bgcolor: '#2a2a2a' }} />
          <Skeleton variant="rounded" width={50} height={24} sx={{ bgcolor: '#2a2a2a' }} />
        </Box>
      </Box>
    </Paper>
  )
}

// Skeleton for content carousel (searchContent, findSimilar, getRecommendations, etc.)
export function ContentCarouselSkeleton() {
  const { t } = useTranslation()
  return (
    <Box
      role="status"
      aria-busy="true"
      aria-label={t('assistantToolUi.loadingContentCarousel')}
      sx={{ my: 2, width: '100%', maxWidth: '100%', overflow: 'hidden' }}
    >
      {/* Header skeleton */}
      <Box sx={{ mb: 1.5 }}>
        <Skeleton variant="text" width={150} height={24} sx={{ bgcolor: '#2a2a2a' }} />
        <Skeleton variant="text" width={200} height={16} sx={{ bgcolor: '#2a2a2a' }} />
      </Box>
      {/* Cards row */}
      <Box sx={{ display: 'flex', gap: 1.5, px: 1 }}>
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </Box>
    </Box>
  )
}

// Skeleton for content detail (getContentDetails)
export function ContentDetailSkeleton() {
  const { t } = useTranslation()
  return (
    <Paper
      role="status"
      aria-busy="true"
      aria-label={t('assistantToolUi.loadingContentDetail')}
      sx={{ bgcolor: '#1a1a1a', borderRadius: 2, overflow: 'hidden', my: 2 }}
    >
      {/* Backdrop skeleton */}
      <Skeleton variant="rectangular" width="100%" height={150} sx={{ bgcolor: '#2a2a2a' }} />
      <Box sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', gap: 2 }}>
          {/* Poster */}
          <Skeleton variant="rounded" width={100} height={150} sx={{ bgcolor: '#2a2a2a', flexShrink: 0 }} />
          {/* Info */}
          <Box sx={{ flex: 1 }}>
            <Skeleton variant="text" width="60%" height={32} sx={{ bgcolor: '#2a2a2a' }} />
            <Skeleton variant="text" width="40%" height={20} sx={{ bgcolor: '#2a2a2a' }} />
            <Box sx={{ display: 'flex', gap: 1, my: 1 }}>
              <Skeleton variant="rounded" width={50} height={24} sx={{ bgcolor: '#2a2a2a' }} />
              <Skeleton variant="rounded" width={60} height={24} sx={{ bgcolor: '#2a2a2a' }} />
              <Skeleton variant="rounded" width={70} height={24} sx={{ bgcolor: '#2a2a2a' }} />
            </Box>
            <Skeleton variant="text" width="100%" height={16} sx={{ bgcolor: '#2a2a2a' }} />
            <Skeleton variant="text" width="90%" height={16} sx={{ bgcolor: '#2a2a2a' }} />
            <Skeleton variant="text" width="70%" height={16} sx={{ bgcolor: '#2a2a2a' }} />
          </Box>
        </Box>
      </Box>
    </Paper>
  )
}

// Skeleton for person results (searchPeople)
export function PersonResultSkeleton() {
  const { t } = useTranslation()
  return (
    <Box role="status" aria-busy="true" aria-label={t('assistantToolUi.loadingPersonResults')} sx={{ my: 2 }}>
      <Skeleton variant="text" width={120} height={24} sx={{ bgcolor: '#2a2a2a', mb: 1 }} />
      <Box sx={{ display: 'flex', gap: 2 }}>
        {[1, 2, 3].map((i) => (
          <Paper key={i} sx={{ p: 1.5, bgcolor: '#1a1a1a', borderRadius: 2, width: 100 }}>
            <Skeleton variant="circular" width={64} height={64} sx={{ bgcolor: '#2a2a2a', mx: 'auto' }} />
            <Skeleton variant="text" width="80%" height={16} sx={{ bgcolor: '#2a2a2a', mx: 'auto', mt: 1 }} />
            <Skeleton variant="text" width="60%" height={14} sx={{ bgcolor: '#2a2a2a', mx: 'auto' }} />
          </Paper>
        ))}
      </Box>
    </Box>
  )
}

// Skeleton for stats display (getLibraryStats)
export function StatsSkeleton() {
  const { t } = useTranslation()
  return (
    <Box role="status" aria-busy="true" aria-label={t('assistantToolUi.loadingStats')} sx={{ my: 2 }}>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        {[1, 2, 3, 4].map((i) => (
          <Paper key={i} sx={{ p: 2, bgcolor: '#1a1a1a', borderRadius: 2, minWidth: 120 }}>
            <Skeleton variant="text" width={60} height={32} sx={{ bgcolor: '#2a2a2a' }} />
            <Skeleton variant="text" width={80} height={16} sx={{ bgcolor: '#2a2a2a' }} />
          </Paper>
        ))}
      </Box>
    </Box>
  )
}

// Skeleton for studios/networks display
export function StudiosSkeleton() {
  const { t } = useTranslation()
  return (
    <Box role="status" aria-busy="true" aria-label={t('assistantToolUi.loadingStudios')} sx={{ my: 2 }}>
      <Skeleton variant="text" width={100} height={24} sx={{ bgcolor: '#2a2a2a', mb: 1 }} />
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} variant="rounded" width={80 + i * 10} height={32} sx={{ bgcolor: '#2a2a2a' }} />
        ))}
      </Box>
    </Box>
  )
}

