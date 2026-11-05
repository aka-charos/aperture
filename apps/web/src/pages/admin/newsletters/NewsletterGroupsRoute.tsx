import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  LinearProgress,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Radio,
  RadioGroup,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import PeopleOutlineIcon from '@mui/icons-material/PeopleOutline'
import { api, type GroupMemberRow, type GroupRules, type NewsletterGroup, type NewsletterOptions } from './api'

const EMPTY_RULES: GroupRules = { match: 'rules', languages: [], role: 'any' }

function GroupDialog({
  group,
  languages,
  onClose,
  onSaved,
}: {
  group: NewsletterGroup | 'new'
  languages: NewsletterOptions['languages']
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(group === 'new' ? '' : group.name)
  const [description, setDescription] = useState(group === 'new' ? '' : group.description)
  const [rules, setRules] = useState<GroupRules>(group === 'new' ? EMPTY_RULES : group.rules)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const body = { name, description, rules }
      if (group === 'new') await api('/api/newsletter-groups', { method: 'POST', json: body })
      else await api(`/api/newsletter-groups/${group.id}`, { method: 'PUT', json: body })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{group === 'new' ? t('admin.newsletters.groups.newTitle') : t('admin.newsletters.groups.editTitle')}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            autoFocus
            label={t('admin.newsletters.groups.name')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            inputProps={{ maxLength: 80 }}
            placeholder={t('admin.newsletters.groups.namePlaceholder')}
          />
          <TextField
            label={t('admin.newsletters.groups.descriptionLabel')}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            inputProps={{ maxLength: 500 }}
            multiline
            minRows={2}
          />
          <RadioGroup
            value={rules.match}
            onChange={(event) => setRules({ ...rules, match: event.target.value as GroupRules['match'] })}
          >
            <FormControlLabel
              value="rules"
              control={<Radio size="small" />}
              label={
                <ListItemText
                  primary={t('admin.newsletters.groups.matchRules')}
                  secondary={t('admin.newsletters.groups.matchRulesHelp')}
                />
              }
            />
            <FormControlLabel
              value="none"
              control={<Radio size="small" />}
              label={
                <ListItemText primary={t('admin.newsletters.groups.matchNone')} secondary={t('admin.newsletters.groups.matchNoneHelp')} />
              }
            />
          </RadioGroup>
          {rules.match === 'rules' && (
            <>
              <FormControl fullWidth>
                <InputLabel id="group-languages-label">{t('admin.newsletters.groups.languages')}</InputLabel>
                <Select
                  labelId="group-languages-label"
                  multiple
                  value={rules.languages}
                  onChange={(event) => {
                    const value = event.target.value
                    setRules({ ...rules, languages: typeof value === 'string' ? value.split(',') : value })
                  }}
                  input={<OutlinedInput label={t('admin.newsletters.groups.languages')} />}
                  renderValue={(selected) =>
                    selected.length === 0 ? (
                      t('admin.newsletters.groups.anyLanguage')
                    ) : (
                      <Stack direction="row" gap={0.5} flexWrap="wrap">
                        {selected.map((code) => (
                          <Chip key={code} size="small" label={languages.find((l) => l.code === code)?.label ?? code} />
                        ))}
                      </Stack>
                    )
                  }
                  displayEmpty
                >
                  {languages.map((language) => (
                    <MenuItem key={language.code} value={language.code}>
                      <Checkbox size="small" checked={rules.languages.includes(language.code)} />
                      <ListItemText primary={language.label} />
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                select
                label={t('admin.newsletters.groups.role')}
                value={rules.role}
                onChange={(event) => setRules({ ...rules, role: event.target.value as GroupRules['role'] })}
              >
                <MenuItem value="any">{t('admin.newsletters.groups.roleAny')}</MenuItem>
                <MenuItem value="viewers">{t('admin.newsletters.groups.roleViewers')}</MenuItem>
                <MenuItem value="admins">{t('admin.newsletters.groups.roleAdmins')}</MenuItem>
              </TextField>
            </>
          )}
          <Typography variant="caption" color="text.secondary">
            {t('admin.newsletters.groups.optInNote')}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" disabled={saving || !name.trim()} onClick={() => void save()}>
          {t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function MembersDialog({
  group,
  languages,
  onClose,
}: {
  group: NewsletterGroup
  languages: NewsletterOptions['languages']
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [rows, setRows] = useState<GroupMemberRow[] | null>(null)
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await api<{ users: GroupMemberRow[] }>(`/api/newsletter-groups/${group.id}/members`)
      setRows(data.users)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [group.id])

  useEffect(() => {
    void load()
  }, [load])

  const setMode = async (row: GroupMemberRow, mode: 'include' | 'exclude' | null) => {
    try {
      await api(`/api/newsletter-groups/${group.id}/members/${row.id}`, { method: 'PUT', json: { mode } })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return (rows ?? []).filter(
      (row) =>
        !needle ||
        row.username.toLowerCase().includes(needle) ||
        (row.displayName ?? '').toLowerCase().includes(needle) ||
        (row.email ?? '').toLowerCase().includes(needle)
    )
  }, [filter, rows])

  const members = rows?.filter((row) => row.member) ?? []
  const receiving = members.filter((row) => row.ineligible === null)
  const languageLabel = (code: string) => languages.find((l) => l.code === code)?.label ?? code

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>
        {t('admin.newsletters.groups.membersTitle', { name: group.name })}
        <Typography variant="body2" color="text.secondary">
          {t('admin.newsletters.groups.counts', { members: members.length, recipients: receiving.length })}
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        <TextField
          size="small"
          fullWidth
          placeholder={t('admin.newsletters.groups.filter')}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          sx={{ mb: 1 }}
        />
        {!rows ? (
          <LinearProgress />
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('admin.newsletters.groups.person')}</TableCell>
                <TableCell>{t('admin.newsletters.editor.language')}</TableCell>
                <TableCell>{t('admin.newsletters.groups.inGroup')}</TableCell>
                <TableCell>{t('admin.newsletters.groups.receives')}</TableCell>
                <TableCell align="right">{t('admin.newsletters.groups.override')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Typography variant="body2">
                      {row.displayName || row.username}
                      {row.isAdmin && (
                        <Chip size="small" variant="outlined" label={t('admin.newsletters.groups.admin')} sx={{ ml: 1 }} />
                      )}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {row.email || t('admin.newsletters.groups.noEmail')}
                    </Typography>
                  </TableCell>
                  <TableCell>{languageLabel(row.language)}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      color={row.member ? 'primary' : 'default'}
                      variant={row.member ? 'filled' : 'outlined'}
                      label={t(`admin.newsletters.groups.reason.${row.reason}`)}
                    />
                  </TableCell>
                  <TableCell>
                    {row.member ? (
                      row.ineligible === null ? (
                        <Typography variant="body2" color="success.main">
                          {t('admin.newsletters.groups.yes')}
                        </Typography>
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          {t(`admin.newsletters.groups.ineligible.${row.ineligible}`)}
                        </Typography>
                      )
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <ToggleButtonGroup
                      size="small"
                      exclusive
                      value={row.mode ?? 'auto'}
                      onChange={(_, value: 'include' | 'exclude' | 'auto' | null) => {
                        if (value === null) return
                        void setMode(row, value === 'auto' ? null : value)
                      }}
                    >
                      <ToggleButton value="auto">{t('admin.newsletters.groups.modeAuto')}</ToggleButton>
                      <ToggleButton value="include">{t('admin.newsletters.groups.modeInclude')}</ToggleButton>
                      <ToggleButton value="exclude">{t('admin.newsletters.groups.modeExclude')}</ToggleButton>
                    </ToggleButtonGroup>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.close')}</Button>
      </DialogActions>
    </Dialog>
  )
}

/** Send groups: who a newsletter can go to, by rules and by hand. */
export default function NewsletterGroupsRoute() {
  const { t } = useTranslation()
  const [groups, setGroups] = useState<NewsletterGroup[] | null>(null)
  const [options, setOptions] = useState<NewsletterOptions | null>(null)
  const [editing, setEditing] = useState<NewsletterGroup | 'new' | null>(null)
  const [members, setMembers] = useState<NewsletterGroup | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await api<{ groups: NewsletterGroup[] }>('/api/newsletter-groups')
      setGroups(data.groups)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void load()
    api<NewsletterOptions>('/api/newsletters/options')
      .then(setOptions)
      .catch(() => undefined)
  }, [load])

  const remove = async (group: NewsletterGroup) => {
    if (!window.confirm(t('admin.newsletters.groups.confirmDelete', { name: group.name }))) return
    try {
      await api(`/api/newsletter-groups/${group.id}`, { method: 'DELETE' })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const languages = options?.languages ?? []
  const describe = (group: NewsletterGroup) => {
    if (group.rules.match === 'none') return t('admin.newsletters.groups.summaryManual')
    const langs =
      group.rules.languages.length === 0
        ? t('admin.newsletters.groups.anyLanguage')
        : group.rules.languages.map((code) => languages.find((l) => l.code === code)?.label ?? code).join(', ')
    return t(`admin.newsletters.groups.summary.${group.rules.role}`, { languages: langs })
  }

  return (
    <Stack spacing={2}>
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <Card variant="outlined">
        <CardContent>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle1" fontWeight={600}>
                {t('admin.newsletters.groups.title')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('admin.newsletters.groups.description')}
              </Typography>
            </Box>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing('new')}>
              {t('admin.newsletters.groups.new')}
            </Button>
          </Stack>
          {!groups ? (
            <LinearProgress />
          ) : groups.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t('admin.newsletters.groups.empty')}
            </Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('admin.newsletters.groups.name')}</TableCell>
                  <TableCell>{t('admin.newsletters.groups.who')}</TableCell>
                  <TableCell>{t('admin.newsletters.groups.size')}</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {groups.map((group) => (
                  <TableRow key={group.id} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>
                        {group.name}
                      </Typography>
                      {group.description && (
                        <Typography variant="caption" color="text.secondary">
                          {group.description}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>{describe(group)}</TableCell>
                    <TableCell>
                      {t('admin.newsletters.groups.counts', {
                        members: group.memberCount ?? 0,
                        recipients: group.recipientCount ?? 0,
                      })}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      <Tooltip title={t('admin.newsletters.groups.members')}>
                        <IconButton size="small" onClick={() => setMembers(group)}>
                          <PeopleOutlineIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t('admin.newsletters.groups.edit')}>
                        <IconButton size="small" onClick={() => setEditing(group)}>
                          <EditOutlinedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t('admin.common.delete')}>
                        <IconButton size="small" onClick={() => void remove(group)}>
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {editing && (
        <GroupDialog
          group={editing}
          languages={languages}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void load()
          }}
        />
      )}
      {members && (
        <MembersDialog
          group={members}
          languages={languages}
          onClose={() => {
            setMembers(null)
            void load()
          }}
        />
      )}
    </Stack>
  )
}
