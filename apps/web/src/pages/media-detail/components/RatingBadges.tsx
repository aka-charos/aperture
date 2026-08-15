/**
 * Every external score this app holds, as one row of badges.
 *
 * These lived in the sidebar's own "Critic Ratings" panel, several hundred
 * pixels below the star rating in the hero — so a page showed the same kind of
 * fact twice, in two formats, in two places. The row now sits beside the
 * community rating it belongs with, and the panel is gone.
 *
 * `!= null` throughout rather than a truthiness test: pg hands NUMERIC back as
 * a string, so a stored 0 arrives as '0.0' and passes a truthy test, while a
 * genuine 0 arriving as a number fails one. Both directions are wrong, and the
 * old panel had one guard of each kind.
 */
import { Box, Tooltip } from '@mui/material'
import { useTranslation } from 'react-i18next'
import type { Media } from '../types'

/** Rotten Tomatoes, both halves of it. */
function RTScoreBadge({ score, type }: { score: number | string; type: 'critic' | 'audience' }) {
  const { t } = useTranslation()
  const numScore = typeof score === 'string' ? parseFloat(score) : score
  if (isNaN(numScore)) return null

  const isFresh = numScore >= 60
  const icon = type === 'critic' ? '🍅' : '🍿'
  const tooltipTitle =
    type === 'critic'
      ? t('mediaDetail.infoCard.scoreTooltipTomatometer', { pct: Math.round(numScore) })
      : t('mediaDetail.infoCard.scoreTooltipAudience', { pct: Math.round(numScore) })

  return (
    <Tooltip title={tooltipTitle}>
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          bgcolor: isFresh ? 'success.main' : 'error.main',
          color: 'white',
          px: 1,
          py: 0.25,
          borderRadius: 1,
          fontSize: '0.75rem',
          fontWeight: 600,
        }}
      >
        <span>{icon}</span>
        <span>{Math.round(numScore)}%</span>
      </Box>
    </Tooltip>
  )
}

function MetacriticBadge({ score }: { score: number | string }) {
  const { t } = useTranslation()
  const numScore = typeof score === 'string' ? parseFloat(score) : score
  if (isNaN(numScore)) return null

  const getColor = () => {
    if (numScore >= 75) return '#66cc33'
    if (numScore >= 50) return '#ffcc33'
    return '#ff0000'
  }

  return (
    <Tooltip
      title={t('mediaDetail.infoCard.scoreTooltipMetacritic', { score: Math.round(numScore) })}
    >
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          bgcolor: getColor(),
          color: numScore >= 50 ? 'black' : 'white',
          px: 1,
          py: 0.25,
          borderRadius: 1,
          fontSize: '0.75rem',
          fontWeight: 700,
        }}
      >
        <span>Ⓜ️</span>
        <span>{Math.round(numScore)}</span>
      </Box>
    </Tooltip>
  )
}

function LetterboxdBadge({ score }: { score: number | string }) {
  const { t } = useTranslation()
  const numScore = typeof score === 'string' ? parseFloat(score) : score
  if (isNaN(numScore)) return null

  const displayScore = numScore.toFixed(1)
  const percentage = (numScore / 5) * 100

  const getColor = () => {
    if (percentage >= 80) return '#00e054'
    if (percentage >= 60) return '#40bcf4'
    if (percentage >= 40) return '#ee9b00'
    return '#ff8000'
  }

  return (
    <Tooltip title={t('mediaDetail.infoCard.scoreTooltipLetterboxd', { score: displayScore })}>
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          bgcolor: getColor(),
          color: 'white',
          px: 1,
          py: 0.25,
          borderRadius: 1,
          fontSize: '0.75rem',
          fontWeight: 600,
        }}
      >
        <span>📽️</span>
        <span>{displayScore}</span>
      </Box>
    </Tooltip>
  )
}

/**
 * A 0-10 score with the number of votes behind it on hover.
 *
 * The vote count is the reason this exists rather than a bare number: 8.2 from
 * 22,000 votes and 8.2 from six are not the same claim, and a badge showing
 * only the score gives the reader no way to tell them apart. Every other score
 * on this line has the same ambiguity — these are the two where we hold the
 * count.
 */
function VoteRatingBadge({
  score,
  votes,
  source,
}: {
  score: number | string
  votes?: number | string | null
  source: 'tmdb' | 'imdb'
}) {
  const { t } = useTranslation()
  const numScore = typeof score === 'string' ? parseFloat(score) : score
  if (isNaN(numScore)) return null

  const numVotes = votes == null ? null : typeof votes === 'string' ? parseInt(votes, 10) : votes
  const hasVotes = numVotes != null && Number.isFinite(numVotes) && numVotes > 0

  const tooltip = hasVotes
    ? t(`mediaDetail.infoCard.scoreTooltip${source === 'tmdb' ? 'Tmdb' : 'Imdb'}Votes`, {
        score: numScore.toFixed(1),
        votes: numVotes.toLocaleString(),
      })
    : t(`mediaDetail.infoCard.scoreTooltip${source === 'tmdb' ? 'Tmdb' : 'Imdb'}`, {
        score: numScore.toFixed(1),
      })

  // Each service's own brand colour, like the RT and Metacritic badges beside
  // them — these are not theme colours and are not admin-configurable.
  const bgcolor = source === 'tmdb' ? '#01b4e4' : '#f5c518'

  return (
    <Tooltip title={tooltip}>
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          bgcolor,
          color: source === 'tmdb' ? 'white' : 'black',
          px: 1,
          py: 0.25,
          borderRadius: 1,
          fontSize: '0.75rem',
          fontWeight: 700,
        }}
      >
        <span>{source === 'tmdb' ? 'TMDB' : 'IMDb'}</span>
        <span>{numScore.toFixed(1)}</span>
      </Box>
    </Tooltip>
  )
}

/**
 * Renders as a fragment, not a container: the caller decides the line these
 * sit on, which is the whole point of moving them next to the star rating.
 */
export function RatingBadges({ media }: { media: Media }) {
  return (
    <>
      {media.rt_critic_score != null && <RTScoreBadge score={media.rt_critic_score} type="critic" />}
      {media.rt_audience_score != null && (
        <RTScoreBadge score={media.rt_audience_score} type="audience" />
      )}
      {media.metacritic_score != null && <MetacriticBadge score={media.metacritic_score} />}
      {media.imdb_rating != null && (
        <VoteRatingBadge score={media.imdb_rating} votes={media.imdb_vote_count} source="imdb" />
      )}
      {media.tmdb_rating != null && (
        <VoteRatingBadge score={media.tmdb_rating} votes={media.tmdb_vote_count} source="tmdb" />
      )}
      {media.letterboxd_score != null && <LetterboxdBadge score={media.letterboxd_score} />}
    </>
  )
}
