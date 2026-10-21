import { useState } from 'react'
import { Box, IconButton } from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { useTranslation } from 'react-i18next'
import { getProxiedImageUrl } from '@aperture/ui'
import { backdropFootFade, backdropImageFilter, backdropPlaceholder } from '@/theme'

interface MediaBackdropProps {
  backdropUrl: string | null
  title: string
  onBack: () => void
}

export function MediaBackdrop({ backdropUrl, title, onBack }: MediaBackdropProps) {
  const { t } = useTranslation()
  const [imageError, setImageError] = useState(false)
  const proxiedBackdropUrl = backdropUrl ? getProxiedImageUrl(backdropUrl, '') : null

  return (
    <Box
      sx={{
        position: 'relative',
        height: { xs: 250, md: 350 },
        mx: { xs: -2, sm: -3 },
        mt: { xs: -2, sm: -3 },
        mb: 0,
        overflow: 'hidden',
      }}
    >
      {proxiedBackdropUrl && !imageError ? (
        <Box
          component="img"
          src={proxiedBackdropUrl}
          alt={title}
          onError={() => setImageError(true)}
          sx={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            filter: backdropImageFilter,
          }}
        />
      ) : (
        <Box
          sx={{
            width: '100%',
            height: '100%',
            background: backdropPlaceholder,
          }}
        />
      )}

      {/* Gradient overlay */}
      <Box
        sx={(theme) => ({
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          ...backdropFootFade(theme),
        })}
      />

      {/* Back button */}
      <IconButton
        onClick={onBack}
        aria-label={t('common.back')}
        sx={{
          position: 'absolute',
          top: 16,
          left: 16,
          bgcolor: 'rgba(0,0,0,0.5)',
          color: 'white',
          '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' },
        }}
      >
        <ArrowBackIcon />
      </IconButton>
    </Box>
  )
}

