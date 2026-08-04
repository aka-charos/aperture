import React, { useState, useRef } from 'react'
import { Box, Typography, Tooltip, IconButton, Popper, Paper, ClickAwayListener, Fade } from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'
import Star from '@mui/icons-material/Star'
import StarBorder from '@mui/icons-material/StarBorder'

const FilledStar = Star as unknown as React.ComponentType<{
  fontSize?: 'small' | 'medium' | 'large' | 'inherit'
  sx?: object
}>
const EmptyStar = StarBorder as unknown as React.ComponentType<{
  fontSize?: 'small' | 'medium' | 'large' | 'inherit'
  sx?: object
}>

// The user's personal rating uses the theme's secondary color — deliberately distinct
// from the red "favorite" heart, the gold community-rating star, and primary (used for
// match-score/watching indicators elsewhere), so each reads as its own action. The
// filled star and empty-star fade are both sourced live via useTheme() (see
// FillableStar and StarRating below) so an admin-configured secondary color propagates
// here too.

export interface StarRatingProps {
  /** Current rating value (1-10), null if not rated */
  value: number | null
  /** Callback when rating changes */
  onChange?: (rating: number | null) => void
  /** Size variant */
  size?: 'small' | 'medium' | 'large'
  /** Compact mode - shows only the rating badge, not interactive */
  compact?: boolean
  /** Whether the component is read-only */
  readOnly?: boolean
  /** Whether the component is disabled */
  disabled?: boolean
  /** Whether a rating operation is in progress */
  loading?: boolean
  /** Show the rating number next to the star */
  showValue?: boolean
  /** Max stars to show in picker (default 10) */
  maxStars?: number
  /** Notified when the rating picker opens/closes (lets a parent keep the control visible) */
  onOpenChange?: (open: boolean) => void
  /** Additional sx props */
  sx?: object
}

const sizeConfig = {
  small: {
    iconSize: 'small' as const,
    starSize: 20,
    popperStarSize: 16,
    spacing: 0.25,
    fontSize: '0.75rem',
    popperPadding: 1,
  },
  medium: {
    iconSize: 'medium' as const,
    starSize: 28,
    popperStarSize: 20,
    spacing: 0.5,
    fontSize: '0.875rem',
    popperPadding: 1.5,
  },
  large: {
    iconSize: 'large' as const,
    starSize: 36,
    popperStarSize: 24,
    spacing: 0.75,
    fontSize: '1rem',
    popperPadding: 2,
  },
}

const ratingLabels: Record<number, string> = {
  1: 'Terrible',
  2: 'Awful',
  3: 'Bad',
  4: 'Poor',
  5: 'Meh',
  6: 'Fair',
  7: 'Good',
  8: 'Great',
  9: 'Amazing',
  10: 'Perfect',
}

/**
 * Single star icon that fills up based on the rating percentage
 */
function FillableStar({
  fillPercent,
  size,
  onClick,
  disabled,
  interactive,
}: {
  fillPercent: number
  size: number
  onClick?: () => void
  disabled?: boolean
  interactive?: boolean
}) {
  const theme = useTheme()
  return (
    <Box
      onClick={interactive ? onClick : undefined}
      sx={{
        position: 'relative',
        width: size,
        height: size,
        cursor: interactive && !disabled ? 'pointer' : 'default',
        transition: 'transform 0.15s ease',
        '&:hover': interactive && !disabled ? {
          transform: 'scale(1.15)',
        } : {},
      }}
    >
      {/* Background empty star */}
      <EmptyStar
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: size,
          height: size,
          fontSize: size,
          color: alpha(theme.palette.secondary.light, 0.75),
        }}
      />
      {/* Filled star with clip-path for partial fill */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: size,
          height: size,
          clipPath: `inset(${100 - fillPercent}% 0 0 0)`,
          transition: 'clip-path 0.3s ease',
        }}
      >
        <FilledStar
          sx={{
            width: size,
            height: size,
            fontSize: size,
            color: theme.palette.secondary.main,
          }}
        />
      </Box>
    </Box>
  )
}

export function StarRating({
  value,
  onChange,
  size = 'medium',
  compact = false,
  readOnly = false,
  disabled = false,
  loading = false,
  showValue = false,
  maxStars = 10,
  onOpenChange,
  sx = {},
}: StarRatingProps) {
  const theme = useTheme()
  const [popperOpen, setPopperOpen] = useState(false)
  const [hoverValue, setHoverValue] = useState<number | null>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const config = sizeConfig[size]

  const isInteractive = !readOnly && !disabled && !loading && !!onChange
  const fillPercent = value ? (value / maxStars) * 100 : 0

  const setOpen = (open: boolean) => {
    setPopperOpen(open)
    onOpenChange?.(open)
  }

  // Compact mode - just show a badge with the rating value
  if (compact) {
    if (value === null) return null

    return (
      <Tooltip title={`Your rating: ${value}/10 - ${ratingLabels[value]}`} arrow>
        <Box
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.5,
            backgroundColor: theme.palette.secondary.main,
            borderRadius: 1,
            px: 0.75,
            py: 0.25,
            ...sx,
          }}
        >
          <FilledStar
            fontSize="small"
            sx={{
              color: 'white',
              fontSize: size === 'small' ? 12 : 14,
            }}
          />
          <Typography
            sx={{
              color: 'white',
              fontWeight: 700,
              fontSize: size === 'small' ? '0.65rem' : '0.75rem',
              lineHeight: 1,
            }}
          >
            {value}
          </Typography>
        </Box>
      </Tooltip>
    )
  }

  const handleStarClick = () => {
    if (isInteractive) {
      setOpen(true)
    }
  }

  const handleSelectRating = (rating: number) => {
    if (!onChange) return
    // If clicking the same rating, clear it
    if (rating === value) {
      onChange(null)
    } else {
      onChange(rating)
    }
    setOpen(false)
    setHoverValue(null)
  }

  const handleClickAway = () => {
    setOpen(false)
    setHoverValue(null)
  }

  const handleMouseEnter = (rating: number) => {
    setHoverValue(rating)
  }

  const handleMouseLeave = () => {
    setHoverValue(null)
  }

  const displayValue = hoverValue ?? value
  const displayFillPercent = displayValue ? (displayValue / maxStars) * 100 : fillPercent

  return (
    <ClickAwayListener onClickAway={handleClickAway}>
      <Box
        ref={anchorRef}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: config.spacing,
          opacity: disabled || loading ? 0.5 : 1,
          ...sx,
        }}
      >
        {/* Single fillable star */}
        <Box>
          <FillableStar
            fillPercent={popperOpen ? displayFillPercent : fillPercent}
            size={config.starSize}
            onClick={handleStarClick}
            disabled={disabled || loading}
            interactive={isInteractive}
          />
        </Box>

        {/* Value label */}
        {showValue && (
          <Typography
            sx={{
              fontSize: config.fontSize,
              fontWeight: 600,
              color: value ? theme.palette.secondary.main : 'text.secondary',
              minWidth: '2em',
            }}
          >
            {value ? `${value}` : '—'}
          </Typography>
        )}

        {/* Rating picker popper */}
        <Popper
          open={popperOpen}
          anchorEl={anchorRef.current}
          placement="bottom-start"
          transition
          sx={{ zIndex: 1300 }}
        >
          {({ TransitionProps }) => (
            <Fade {...TransitionProps} timeout={200}>
              <Paper
                elevation={8}
                sx={{
                  p: config.popperPadding,
                  mt: 1,
                  borderRadius: 2,
                  backgroundColor: 'background.paper',
                  border: '1px solid',
                  borderColor: 'divider',
                }}
                onMouseLeave={handleMouseLeave}
              >
                {/* Stars row */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                  {Array.from({ length: maxStars }, (_, i) => {
                    const starValue = i + 1
                    const isFilled = displayValue !== null && starValue <= displayValue
                    const isHovered = hoverValue !== null && starValue <= hoverValue

                    const StarIcon = isFilled ? FilledStar : EmptyStar

                    const starColor = isFilled
                      ? isHovered
                        ? theme.palette.secondary.light
                        : theme.palette.secondary.main
                      : isHovered
                        ? theme.palette.secondary.light
                        : alpha(theme.palette.secondary.light, 0.75)

                    return (
                      <IconButton
                        key={starValue}
                        size="small"
                        onClick={() => handleSelectRating(starValue)}
                        onMouseEnter={() => handleMouseEnter(starValue)}
                        sx={{
                          p: 0.5,
                          transition: 'transform 0.1s ease',
                          '&:hover': {
                            transform: 'scale(1.2)',
                            backgroundColor: 'transparent',
                          },
                        }}
                      >
                        <StarIcon
                          sx={{
                            fontSize: config.popperStarSize,
                            color: starColor,
                            transition: 'color 0.15s ease',
                          }}
                        />
                      </IconButton>
                    )
                  })}
                </Box>

                {/* Rating label */}
                <Box sx={{
                  mt: 1,
                  pt: 1,
                  borderTop: '1px solid',
                  borderColor: 'divider',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}>
                  <Typography
                    sx={{
                      fontSize: config.fontSize,
                      color: 'text.secondary',
                    }}
                  >
                    {displayValue ? `${displayValue}/10` : 'Select rating'}
                  </Typography>
                  {displayValue && (
                    <Typography
                      sx={{
                        fontSize: config.fontSize,
                        fontWeight: 600,
                        color: theme.palette.secondary.main,
                      }}
                    >
                      {ratingLabels[displayValue]}
                    </Typography>
                  )}
                </Box>
              </Paper>
            </Fade>
          )}
        </Popper>
      </Box>
    </ClickAwayListener>
  )
}
