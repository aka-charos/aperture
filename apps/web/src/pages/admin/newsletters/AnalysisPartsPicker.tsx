import { useTranslation } from 'react-i18next'
import { Box, Checkbox, FormControlLabel, Radio, RadioGroup, Typography } from '@mui/material'

/**
 * Which parts of a film analysis a card shows: all of it, or only some parts
 * (just the context, say). An empty list means all of it, which is how a card
 * saved before this choice existed reads, so "some" always holds at least one
 * part: picking it starts on the first, and the last ticked part cannot be
 * unticked.
 */
export function AnalysisPartsPicker({
  parts,
  available,
  onChange,
}: {
  parts: string[]
  available: string[]
  onChange: (parts: string[]) => void
}) {
  const { t } = useTranslation()
  const some = parts.length > 0
  return (
    <Box sx={{ mt: 1, pl: 1.5, borderInlineStart: 2, borderColor: 'divider' }}>
      <Typography variant="caption" color="text.secondary">
        {t('newsletters.analysisParts.title')}
      </Typography>
      <RadioGroup
        row
        value={some ? 'some' : 'all'}
        onChange={(event) => onChange(event.target.value === 'all' ? [] : available.slice(0, 1))}
      >
        <FormControlLabel
          value="all"
          control={<Radio size="small" />}
          label={<Typography variant="body2">{t('newsletters.analysisParts.all')}</Typography>}
        />
        <FormControlLabel
          value="some"
          control={<Radio size="small" />}
          label={<Typography variant="body2">{t('newsletters.analysisParts.some')}</Typography>}
        />
      </RadioGroup>
      {some && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 1 }}>
          {available.map((part) => {
            const checked = parts.includes(part)
            return (
              <FormControlLabel
                key={part}
                control={
                  <Checkbox
                    size="small"
                    checked={checked}
                    disabled={checked && parts.length === 1}
                    onChange={(event) =>
                      onChange(
                        event.target.checked
                          ? available.filter((p) => p === part || parts.includes(p))
                          : parts.filter((p) => p !== part)
                      )
                    }
                  />
                }
                label={<Typography variant="body2">{t(`mediaDetail.analysis.section.${part}`)}</Typography>}
              />
            )
          })}
        </Box>
      )}
      {some && (
        <Typography variant="caption" color="text.secondary" component="p">
          {t('newsletters.analysisParts.unlabelledNote')}
        </Typography>
      )}
    </Box>
  )
}
