import { useTranslation } from 'react-i18next'
import { Box, Checkbox, FormControlLabel, FormGroup, Typography } from '@mui/material'
import { AnalysisPartsPicker } from './AnalysisPartsPicker'
import { fieldLabelKey } from './fields'

/**
 * Checkboxes for which facts a card shows and, when it shows the film
 * analysis, which parts of it.
 */
export function TitleFieldPicker({
  fields,
  available,
  mediaType,
  onChange,
  analysisParts,
  availableAnalysisParts,
  onAnalysisPartsChange,
}: {
  fields: string[]
  available: string[]
  mediaType: 'movie' | 'series'
  onChange: (fields: string[]) => void
  analysisParts: string[]
  availableAnalysisParts: string[]
  onAnalysisPartsChange: (parts: string[]) => void
}) {
  const { t } = useTranslation()
  // Runtime is a film's; network and a show's creator are a show's. Offered
  // where they mean something, read harmlessly by the server either way.
  const shown = available.filter((field) =>
    mediaType === 'series' ? field !== 'runtime' : field !== 'network'
  )
  return (
    <Box>
      <FormGroup sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', columnGap: 1 }}>
        {shown.map((field) => (
          <FormControlLabel
            key={field}
            control={
              <Checkbox
                size="small"
                checked={fields.includes(field)}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? available.filter((f) => f === field || fields.includes(f))
                      : fields.filter((f) => f !== field)
                  )
                }
              />
            }
            label={
              <Typography variant="body2">
                {t(fieldLabelKey(field, mediaType))}
              </Typography>
            }
          />
        ))}
      </FormGroup>
      {fields.includes('analysis') && (
        <AnalysisPartsPicker
          parts={analysisParts}
          available={availableAnalysisParts}
          onChange={onAnalysisPartsChange}
        />
      )}
    </Box>
  )
}

