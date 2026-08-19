import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  Divider,
  Chip,
  Avatar,
  Stack,
} from '@mui/material'
import PersonIcon from '@mui/icons-material/Person'
import BusinessIcon from '@mui/icons-material/Business'
import PublicIcon from '@mui/icons-material/Public'
import LanguageIcon from '@mui/icons-material/Language'
import LinkIcon from '@mui/icons-material/Link'
import LocalOfferIcon from '@mui/icons-material/LocalOffer'
import StreamIcon from '@mui/icons-material/Stream'
import CollectionsIcon from '@mui/icons-material/Collections'
import CameraRollIcon from '@mui/icons-material/CameraRoll'
import MusicNoteIcon from '@mui/icons-material/MusicNote'
import ContentCutIcon from '@mui/icons-material/ContentCut'
import { Link as RouterLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { getProxiedImageUrl } from '@aperture/ui'
import type { Media, Actor, StudioItem } from '../types'
import { isMovie } from '../types'
import { badgeLinksTo, imdbUrl, personPath, studioPath, tmdbUrl, tvdbUrl } from '../helpers'

interface MediaInfoCardProps {
  media: Media
}

/** Cast shown before the count takes over. */
const CAST_SHOWN = 12

function getActors(media: Media): Actor[] {
  return media.actors || []
}

function getStudios(media: Media): StudioItem[] {
  return media.studios || []
}

/**
 * One metadata group: a label in a fixed gutter, its values beside it.
 *
 * Every group here used to be a `subtitle1` heading with an icon, a divider
 * above it and a chip row below — three lines and a rule to show, in the worst
 * case, a single name. Ten of those stacked was most of the card's height and
 * all of its noise.
 *
 * The gutter is a flex basis rather than a breakpoint, so the values drop
 * under the label when the *container* is narrow — which is what a phone does,
 * and also what the assistant dock and MediaDetailModal do at full window
 * width.
 */
function FactRow({
  icon,
  label,
  children,
}: {
  icon: ReactNode
  label: string
  children: ReactNode
}) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'flex-start',
        // 3 everywhere a label meets its values, including the one nested
        // inside the languages/countries row. The gutter is the basis PLUS
        // this gap, so a row using 2 puts its values 8px off the rail every
        // other row sits on.
        columnGap: 3,
        rowGap: 0.5,
        py: 1,
      }}
    >
      <FactLabel icon={icon} label={label} />
      <Box sx={{ flex: '1 1 14rem', minWidth: 0 }}>{children}</Box>
    </Box>
  )
}

/**
 * The label half of a row, on its own so two of them can share one line.
 *
 * Always the same 7rem gutter, wherever it appears. That is what lets the
 * values line up down a single rail: when languages and countries stack on a
 * narrow container, "English" and "Argentina" start at the same x, and a label
 * that sized itself to its own text put them 26px apart instead.
 *
 * `minHeight` is one chip tall. Rows align their label to the TOP of the block
 * it names — a "Countries" that centred itself against twelve countries ended
 * up beside the seventh one, naming nothing — and without a floor the caption
 * would sit 3px high against a first row of chips.
 */
function FactLabel({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <Box
      sx={{
        flex: '0 0 7rem',
        minHeight: 24,
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        color: 'text.secondary',
        '& .MuiSvgIcon-root': { fontSize: 16 },
      }}
    >
      {icon}
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Box>
  )
}

export function MediaInfoCard({ media }: MediaInfoCardProps) {
  const { t } = useTranslation()
  // Critic scores, awards and the director/writer credits are not here any
  // more: they render once, at the top of the page, beside the community
  // rating and under the title. See MediaHero.
  //
  // Community watch counts left for the same reason — they are a line in the
  // hero now. See CommunityStrip.
  const hasStreamingProviders =
    media.streaming_providers && media.streaming_providers.length > 0
  const hasLanguages = Boolean(media.languages && media.languages.length > 0)
  const hasCountries = Boolean(
    media.production_countries && media.production_countries.length > 0
  )
  const actors = getActors(media)
  const studios = getStudios(media)
  const extraActors = Math.max(0, actors.length - CAST_SHOWN)
  // The cut used to be silent, then it was a count, and a count is a question
  // with no way to answer it — the twelfth name is where a supporting cast
  // starts being the interesting part. Collapsed by default because a full
  // cast is forty rows and most readers want the leads.
  const [castExpanded, setCastExpanded] = useState(false)
  const shownActors = castExpanded ? actors : actors.slice(0, CAST_SHOWN)

  // The three below-the-line craft credits. They share a row because each one
  // is a name or two: given a heading and a rule apiece they cost about 180px
  // to say "Robby Müller", "Björk", "François Gédigier".
  //
  // auto-fit rather than three fixed columns — the row becomes two-up and then
  // one-up on its own as the container narrows, with no media query.
  const crewGroups: Array<{ id: string; icon: ReactNode; label: string; names: string[] }> = []
  if (isMovie(media)) {
    if (media.cinematographers && media.cinematographers.length > 0) {
      crewGroups.push({
        id: 'cinematography',
        icon: <CameraRollIcon />,
        label: t('mediaDetail.infoCard.cinematography'),
        names: media.cinematographers,
      })
    }
    if (media.composers && media.composers.length > 0) {
      crewGroups.push({
        id: 'music',
        icon: <MusicNoteIcon />,
        label: t('mediaDetail.infoCard.music'),
        names: media.composers,
      })
    }
    if (media.editors && media.editors.length > 0) {
      crewGroups.push({
        id: 'editing',
        icon: <ContentCutIcon />,
        label: t('mediaDetail.infoCard.editing'),
        names: media.editors,
      })
    }
  }

  // What the hero's score badges do not already link. IMDb and TMDb are
  // reachable from the badge that carries their score, which is where a reader
  // looks for them — but a badge only exists where we hold a score, so an
  // un-enriched title would otherwise lose the link along with the number.
  // This row is that fallback, not a second copy of it.
  const externalLinks: Array<{ id: string; label: string; href: string }> = []
  const imdb = imdbUrl(media)
  if (imdb && !badgeLinksTo(media, 'imdb')) {
    externalLinks.push({ id: 'imdb', label: t('mediaDetail.infoCard.linkImdb'), href: imdb })
  }
  const tmdb = tmdbUrl(media)
  if (tmdb && !badgeLinksTo(media, 'tmdb')) {
    externalLinks.push({ id: 'tmdb', label: t('mediaDetail.infoCard.linkTmdb'), href: tmdb })
  }
  // No badge carries a TVDb score, so this one is always the only route to it.
  const tvdb = tvdbUrl(media)
  if (tvdb) {
    externalLinks.push({ id: 'tvdb', label: t('mediaDetail.infoCard.linkTvdb'), href: tvdb })
  }

  return (
    <Card sx={{ backgroundColor: 'background.paper', borderRadius: 2 }}>
      <CardContent>
        {isMovie(media) && media.collection_name && (
          <FactRow icon={<CollectionsIcon />} label={t('mediaDetail.infoCard.partOfCollection')}>
            <Typography variant="body2" fontWeight={500}>
              {media.collection_name}
            </Typography>
          </FactRow>
        )}

        {media.keywords && media.keywords.length > 0 && (
          <FactRow icon={<LocalOfferIcon />} label={t('mediaDetail.infoCard.keywords')}>
            <Stack direction="row" flexWrap="wrap" gap={0.5}>
              {media.keywords.slice(0, 10).map((keyword) => (
                <Chip
                  key={keyword}
                  label={keyword}
                  size="small"
                  variant="outlined"
                  sx={{ fontSize: '0.7rem' }}
                />
              ))}
            </Stack>
          </FactRow>
        )}

        {/* Language and country sit above the cast rather than at the very
            bottom of the card. They say what the film is — a Danish-language
            co-production is the kind of thing a reader wants before a list of
            twenty production companies, not after it.

            They also share a line, because a title has a handful of languages
            and can have a dozen countries: two full rows meant one of them was
            three-quarters empty whichever way round they went.

            Sharing is conditional, and the condition is width, not a
            breakpoint. Countries claim 24rem before they will sit beside the
            languages; below that the whole group — label and chips together —
            drops to its own line and takes the full card, which is the right
            shape for twelve of them anyway. What it must never do is squeeze
            into a narrow column beside three languages and wrap into five
            rows, which is what an 18rem claim produced.

            Both labels keep the card's 7rem gutter either way, so stacked they
            line their chips up on one rail instead of 26px apart. */}
        {(hasLanguages || hasCountries) && (
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'flex-start',
              columnGap: 3,
              // Wide enough to read as two separate facts once they stack —
              // at 0.5 they ran together into one twelve-chip paragraph.
              rowGap: 2,
              py: 1,
            }}
          >
            {hasLanguages && (
              <>
                <FactLabel icon={<LanguageIcon />} label={t('mediaDetail.infoCard.languages')} />
                <Stack
                  direction="row"
                  flexWrap="wrap"
                  gap={0.5}
                  sx={{ flex: '0 1 auto', minWidth: 0 }}
                >
                  {media.languages!.map((language) => (
                    <Chip key={language} label={language} size="small" variant="outlined" />
                  ))}
                </Stack>
              </>
            )}

            {hasCountries && (
              <Box
                sx={{
                  flex: '1 1 24rem',
                  minWidth: 0,
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'flex-start',
                  columnGap: 3,
                  rowGap: 0.5,
                }}
              >
                <FactLabel icon={<PublicIcon />} label={t('mediaDetail.infoCard.countries')} />
                <Stack
                  direction="row"
                  flexWrap="wrap"
                  gap={0.5}
                  sx={{ flex: '1 1 12rem', minWidth: 0 }}
                >
                  {media.production_countries!.map((country) => (
                    <Chip key={country} label={country} size="small" variant="outlined" />
                  ))}
                </Stack>
              </Box>
            )}
          </Box>
        )}

        {actors.length > 0 && (
          <>
            <Divider sx={{ my: 1.5 }} />
            <FactRow icon={<PersonIcon />} label={t('mediaDetail.infoCard.cast')}>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
                {shownActors.map((actor, idx) => (
                  <Box
                    key={idx}
                    component={RouterLink}
                    to={personPath(actor.name)}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      textDecoration: 'none',
                      color: 'inherit',
                      borderRadius: 1,
                    }}
                  >
                    <Avatar
                      src={getProxiedImageUrl(actor.thumb)}
                      sx={{ width: 32, height: 32, bgcolor: 'grey.700' }}
                    >
                      <PersonIcon fontSize="small" />
                    </Avatar>
                    <Box>
                      <Typography variant="body2" fontWeight={500} color="primary" lineHeight={1.3}>
                        {actor.name}
                      </Typography>
                      {actor.role && (
                        <Typography variant="caption" color="text.secondary" lineHeight={1.2}>
                          {actor.role}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                ))}
                {extraActors > 0 && (
                  <Button
                    size="small"
                    variant="text"
                    onClick={() => setCastExpanded((open) => !open)}
                    sx={{ minWidth: 0, px: 0.5, fontSize: '0.75rem', textTransform: 'none' }}
                  >
                    {castExpanded
                      ? t('common.showLess')
                      : t('mediaDetail.hero.plusMore', { count: extraActors })}
                  </Button>
                )}
              </Box>
            </FactRow>
          </>
        )}

        {crewGroups.length > 0 && (
          <>
            <Divider sx={{ my: 1.5 }} />
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))',
                gap: 2,
                py: 1,
              }}
            >
              {crewGroups.map(({ id, icon, label, names }) => (
                <Box key={id}>
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.75,
                      mb: 0.75,
                      color: 'text.secondary',
                      '& .MuiSvgIcon-root': { fontSize: 16 },
                    }}
                  >
                    {icon}
                    <Typography variant="caption" color="text.secondary">
                      {label}
                    </Typography>
                  </Box>
                  <Stack direction="row" flexWrap="wrap" gap={0.5}>
                    {names.map((name) => (
                      <Chip
                        key={name}
                        label={name}
                        size="small"
                        variant="outlined"
                        component={RouterLink}
                        to={personPath(name)}
                        clickable
                      />
                    ))}
                  </Stack>
                </Box>
              ))}
            </Box>
          </>
        )}

        {(studios.length > 0 || externalLinks.length > 0 || hasStreamingProviders) && (
          <Divider sx={{ my: 1.5 }} />
        )}

        {studios.length > 0 && (
          <FactRow icon={<BusinessIcon />} label={t('mediaDetail.infoCard.studios')}>
            <Stack direction="row" flexWrap="wrap" gap={0.5}>
              {studios.map((studio, idx) => {
                const studioName = typeof studio === 'string' ? studio : studio.name
                return (
                  <Chip
                    key={`${studioName}-${idx}`}
                    label={studioName}
                    size="small"
                    variant="outlined"
                    component={RouterLink}
                    to={studioPath(studioName)}
                    clickable
                  />
                )
              })}
            </Stack>
          </FactRow>
        )}

        {externalLinks.length > 0 && (
          <FactRow icon={<LinkIcon />} label={t('mediaDetail.infoCard.externalLinks')}>
            <Stack direction="row" flexWrap="wrap" gap={0.5}>
              {externalLinks.map(({ id, label, href }) => (
                <Chip
                  key={id}
                  label={label}
                  size="small"
                  component="a"
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  clickable
                />
              ))}
            </Stack>
          </FactRow>
        )}

        {/* Last, and it opened the card until now. Where else this title can be
            streamed is about other services, not about the film — it is the
            one row here a reader who came for the film itself never wanted
            first. */}
        {hasStreamingProviders && (
          <FactRow icon={<StreamIcon />} label={t('mediaDetail.infoCard.alsoAvailableOn')}>
            <Stack direction="row" flexWrap="wrap" gap={0.5}>
              {media.streaming_providers!.map((provider) => (
                <Chip
                  key={provider.id}
                  label={provider.name}
                  size="small"
                  variant="outlined"
                  sx={{ fontSize: '0.7rem' }}
                />
              ))}
            </Stack>
          </FactRow>
        )}
      </CardContent>
    </Card>
  )
}
