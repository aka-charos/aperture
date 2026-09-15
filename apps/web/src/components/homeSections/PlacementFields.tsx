/**
 * Where a managed Emby home row goes: a mode, and a position or a row to sit
 * next to. Shared by the admin defaults and a viewer's own settings — the admin
 * picks from rows found across accounts, a viewer from their own home screen.
 */
import { MenuItem, Stack, TextField } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { isAnchorMode, rowName, type HomeRowOption, type PlacementMode, type PlacementValue } from './placement'

interface PlacementFieldsProps {
  idPrefix: string
  value: PlacementValue
  onChange: (next: PlacementValue) => void
  modes: readonly string[]
  rows: readonly HomeRowOption[]
  maxPosition: number
  disabled?: boolean
  rowsLoading?: boolean
  /** Label each row with how many accounts have it (the admin list). */
  showAccounts?: boolean
}

export function PlacementFields({
  idPrefix,
  value,
  onChange,
  modes,
  rows,
  maxPosition,
  disabled = false,
  rowsLoading = false,
  showAccounts = false,
}: PlacementFieldsProps) {
  const { t } = useTranslation()
  const anchor = value.anchor

  // A saved anchor that is not in the list must still be an option: a Select
  // whose value matches nothing renders blank, and the next save writes that
  // blank over a real setting.
  const missingAnchor = anchor && !rows.some((row) => row.id === anchor.id) ? anchor : null
  const options = missingAnchor
    ? [...rows, { id: missingAnchor.id, type: missingAnchor.type, name: missingAnchor.name ?? missingAnchor.id }]
    : rows

  const rowLabel = (row: HomeRowOption) => {
    const name = rowName(t, row)
    if (missingAnchor && row.id === missingAnchor.id) {
      return t('homeScreenPlacement.anchorMissing', { name })
    }
    return showAccounts && row.accounts != null
      ? t('homeScreenPlacement.rowWithAccounts', { name, accounts: row.accounts })
      : name
  }

  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'flex-start' }}>
      <TextField
        select
        size="small"
        id={`${idPrefix}-mode`}
        label={t('homeScreenPlacement.mode')}
        value={value.mode}
        disabled={disabled}
        sx={{ minWidth: 180 }}
        onChange={(e) => {
          const mode = e.target.value as PlacementMode
          onChange({
            mode,
            position: mode === 'position' ? value.position : 0,
            anchor: isAnchorMode(mode) ? value.anchor : null,
          })
        }}
      >
        {modes.map((mode) => (
          <MenuItem key={mode} value={mode}>
            {t(`homeScreenPlacement.modes.${mode}`)}
          </MenuItem>
        ))}
      </TextField>

      {value.mode === 'position' && (
        <TextField
          type="number"
          size="small"
          id={`${idPrefix}-position`}
          label={t('homeScreenPlacement.position')}
          helperText={t('homeScreenPlacement.positionHelp')}
          value={value.position}
          disabled={disabled}
          sx={{ width: { xs: '100%', sm: 170 } }}
          onChange={(e) => {
            const parsed = Number.parseInt(e.target.value, 10)
            if (Number.isFinite(parsed)) {
              onChange({ ...value, position: Math.min(Math.max(parsed, 0), maxPosition) })
            }
          }}
          slotProps={{ htmlInput: { min: 0, max: maxPosition } }}
        />
      )}

      {isAnchorMode(value.mode) && (
        <TextField
          select
          size="small"
          id={`${idPrefix}-anchor`}
          label={t('homeScreenPlacement.anchor')}
          value={anchor?.id ?? ''}
          disabled={disabled || rowsLoading || options.length === 0}
          sx={{ minWidth: 240, flex: 1 }}
          helperText={
            rowsLoading
              ? t('homeScreenPlacement.rowsLoading')
              : options.length === 0
                ? t('homeScreenPlacement.noRows')
                : undefined
          }
          onChange={(e) => {
            const row = options.find((candidate) => candidate.id === e.target.value)
            if (row) onChange({ ...value, anchor: { id: row.id, type: row.type, name: row.name } })
          }}
        >
          {options.map((row) => (
            <MenuItem key={row.id} value={row.id}>
              {rowLabel(row)}
            </MenuItem>
          ))}
        </TextField>
      )}
    </Stack>
  )
}
