import { useState } from 'react'
import { Autocomplete, Chip, TextField } from '@mui/material'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import { useTranslation } from 'react-i18next'
import { SettingsCard } from '../SettingsCard'
import type { CustomInterest } from './useTasteData'

interface InterestsCardProps {
  interests: CustomInterest[]
  onAdd: (text: string) => void
  onRemove: (interest: CustomInterest) => void
}

/**
 * Free-text interests. One list per viewer: it used to sit under both the
 * Movies and the TV sub-tab, which made it look like two lists that happened
 * to agree, while editing either changed both.
 */
export function InterestsCard({ interests, onAdd, onRemove }: InterestsCardProps) {
  const { t } = useTranslation()
  const [input, setInput] = useState('')

  const add = (text: string) => {
    if (!text.trim()) return
    setInput('')
    onAdd(text)
  }

  return (
    <SettingsCard
      icon={<AutoAwesomeIcon />}
      title={t('userSettings.recs.interestsTitle')}
      description={t('userSettings.recs.interestsBody')}
      footer={interests.length === 0 ? t('watcherIdentity.interestExamples') : undefined}
    >
      <Autocomplete
        multiple
        freeSolo
        // No clear-all button: the list is controlled, so it would do nothing but look like it should.
        disableClearable
        options={[]}
        value={interests.map((i) => i.interestText)}
        inputValue={input}
        onInputChange={(_, value) => setInput(value)}
        onChange={(_, _value, reason, details) => {
          const option = details?.option
          if (!option) return
          if (reason === 'createOption') add(option)
          if (reason === 'removeOption') {
            const interest = interests.find((i) => i.interestText === option)
            if (interest) onRemove(interest)
          }
        }}
        renderTags={(value, getTagProps) =>
          value.map((option, index) => {
            // The delete handler in these props removes through onChange above.
            const { key, ...tagProps } = getTagProps({ index })
            return <Chip key={key} {...tagProps} label={option} size="small" />
          })
        }
        renderInput={(params) => (
          <TextField
            {...params}
            placeholder={t('watcherIdentity.interestPlaceholder')}
            size="small"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && input.trim()) {
                e.preventDefault()
                // Autocomplete's own Enter handler sits on the root above this
                // one and would fire onChange with reason 'createOption' for the
                // same keystroke, adding the interest twice. preventDefault does
                // not stop that; only halting propagation does. Other keys still
                // reach it, so arrows and Escape behave normally.
                e.stopPropagation()
                add(input)
              }
            }}
          />
        )}
      />
    </SettingsCard>
  )
}
