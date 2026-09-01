import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Badge,
  Box,
  Button,
  Chip,
  Collapse,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Tooltip,
  Typography,
} from '@mui/material'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import SearchIcon from '@mui/icons-material/Search'
import {
  ADMIN_GROUPS,
  adminEntriesInGroup,
  adminEntryForPath,
  adminEntryPath,
  type AdminGroupId,
} from '@/pages/admin/nav/registry'
import { ADMIN_ELEMENTS } from '@/pages/admin/nav/elements'
import { countRunning, useActiveJobs } from '@/hooks/activeJobs'
import { GATE_TOOLTIP_KEYS, useAdminGates } from '@/pages/admin/nav/gates'

/**
 * The admin console's navigation, as a vertical tree instead of the three
 * stacked horizontal tab strips it replaces.
 *
 * Two rules keep it legible. One group is open at a time, so the column is a
 * list of eight headings rather than forty-two rows — but expanding another
 * group does *not* navigate, so browsing the tree costs nothing and never
 * loses your place. And depth stops at two: a group that outgrows about a
 * dozen leaves splits rather than growing a third tier, which is the rule that
 * keeps the failure this replaced from coming back in a new shape.
 *
 * Integrations is at eleven and is the one group that still needs an inner
 * scrollbar on a short screen. It is the next thing to split.
 */

interface AdminNavColumnProps {
  /** Opens the settings palette. Same target as the app bar's ⌘⇧K. */
  onOpenSearch: () => void
  /** Mobile drawer dismissal; desktop passes nothing. */
  onNavigate?: () => void
}

export function AdminNavColumn({ onOpenSearch, onNavigate }: AdminNavColumnProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()

  const activeEntry = adminEntryForPath(location.pathname)
  const activeGroup = activeEntry?.group

  // Only rendered inside the console, and the console is admin-only. Reads the
  // same poll the app bar's jobs widget uses, so the badge is free.
  const runningJobs = countRunning(useActiveJobs(true))

  /**
   * A count worth interrupting the reader for. Kept as a lookup rather than a
   * special case in the JSX so a second badge is a line here, not a new branch.
   */
  const badgeFor = (entryId: string): number =>
    entryId === 'jobs' && runningJobs > 0 ? runningJobs : 0

  const gates = useAdminGates()

  /**
   * A section whose precondition is known to fail. Dimmed and explained rather
   * than disabled: the old tab was unclickable, so the only way to learn what it
   * needed was to hover it, and the route says so plainly on arrival.
   */
  const unmetGate = (entry: { gate?: keyof typeof gates }): string | null => {
    if (!entry.gate) return null
    const state = gates[entry.gate]
    return state.ready && !state.passed ? t(GATE_TOOLTIP_KEYS[entry.gate]) : null
  }

  /**
   * One group open at a time.
   *
   * This started as a list of open groups, which meant expansion accumulated:
   * browsing opened a group and nothing ever closed one, so after visiting a
   * few sections the column held forty rows in a viewport-height box and grew
   * an inner scrollbar it could never lose. Measured, the content ran from 676
   * to 1461 pixels with everything open — no arrangement of eight groups and
   * forty-two leaves fits on a screen, so the fix has to be to show less rather
   * than to find more room.
   *
   * Expansion is still the reader's rather than the route's — opening a group
   * does not navigate, so the tree can be browsed without losing your place —
   * and arriving somewhere new opens the group it lives in, or the current page
   * would sit inside a collapsed heading.
   */
  const [expanded, setExpanded] = useState<AdminGroupId | null>(activeGroup ?? null)

  // Keyed on the entry as well as the group: someone who collapsed the group
  // they are standing in and then jumped to another page inside it — which is
  // what a search result does — would otherwise arrive with the selected row
  // hidden, since the group itself never changed.
  useEffect(() => {
    if (activeGroup) setExpanded(activeGroup)
  }, [activeGroup, activeEntry?.id])

  const toggleGroup = (id: AdminGroupId) => {
    setExpanded((prev) => (prev === id ? null : id))
  }

  const go = (path: string) => {
    navigate(path)
    onNavigate?.()
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <Box sx={{ px: 2, pt: 2, pb: 1 }}>
        <Button
          fullWidth
          onClick={onOpenSearch}
          startIcon={<SearchIcon fontSize="small" />}
          sx={{
            justifyContent: 'flex-start',
            textTransform: 'none',
            color: 'text.secondary',
            borderColor: 'divider',
            fontWeight: 400,
          }}
          variant="outlined"
          size="small"
        >
          {t('adminNav.searchPlaceholder')}
        </Button>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', pb: 1 }}>
        <List dense disablePadding>
          {ADMIN_GROUPS.map((group) => {
            const entries = adminEntriesInGroup(group.id)
            if (entries.length === 0) return null

            // A one-entry group is its own destination; a heading you expand to
            // reveal a single row repeating the heading is pure ceremony.
            if (entries.length === 1) {
              const entry = entries[0]
              const path = adminEntryPath(entry)
              return (
                <ListItemButton
                  key={group.id}
                  selected={activeEntry?.id === entry.id}
                  onClick={() => go(path)}
                  sx={{ px: 2, py: 0.75 }}
                >
                  <ListItemIcon sx={{ minWidth: 34, color: 'inherit' }}>
                    {ADMIN_ELEMENTS[entry.id]?.icon}
                  </ListItemIcon>
                  <ListItemText
                    primary={t(entry.titleKey)}
                    primaryTypographyProps={{
                      fontSize: '0.875rem',
                      fontWeight: activeEntry?.id === entry.id ? 600 : 500,
                    }}
                  />
                </ListItemButton>
              )
            }

            const isOpen = expanded === group.id
            const holdsActive = activeGroup === group.id

            return (
              <Box key={group.id}>
                <ListItemButton onClick={() => toggleGroup(group.id)} sx={{ px: 2, py: 0.75 }}>
                  <ListItemText
                    primary={t(group.labelKey)}
                    primaryTypographyProps={{
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      letterSpacing: '.06em',
                      textTransform: 'uppercase',
                      color: holdsActive ? 'primary.main' : 'text.secondary',
                    }}
                  />
                  {/* The count is what makes a collapsed group informative
                      rather than just closed — and a collapsed group must
                      not be able to hide a badge one of its entries is showing,
                      which is the whole reason to badge anything. */}
                  {!isOpen && (
                    <Badge
                      color="primary"
                      badgeContent={entries.reduce((n, e) => n + badgeFor(e.id), 0)}
                      sx={{ mr: 1.5, '& .MuiBadge-badge': { fontSize: '0.65rem', height: 16, minWidth: 16 } }}
                    >
                      <Typography variant="caption" color="text.disabled" sx={{ mr: 0.5 }}>
                        {entries.length}
                      </Typography>
                    </Badge>
                  )}
                  {isOpen ? (
                    <ExpandLessIcon fontSize="small" sx={{ color: 'text.disabled' }} />
                  ) : (
                    <ExpandMoreIcon fontSize="small" sx={{ color: 'text.disabled' }} />
                  )}
                </ListItemButton>

                <Collapse in={isOpen} unmountOnExit>
                  <List dense disablePadding>
                    {entries.map((entry) => {
                      const path = adminEntryPath(entry)
                      const selected = activeEntry?.id === entry.id
                      const blockedReason = unmetGate(entry)
                      return (
                        <Tooltip
                          key={entry.id}
                          title={blockedReason ?? ''}
                          placement="right"
                        >
                          <ListItemButton
                            selected={selected}
                            onClick={() => go(path)}
                            sx={{ pl: 2, pr: 2, py: 0.5, opacity: blockedReason ? 0.5 : 1 }}
                          >
                            <ListItemIcon
                              sx={{
                                minWidth: 34,
                                color: selected ? 'primary.main' : 'text.secondary',
                              }}
                            >
                              {ADMIN_ELEMENTS[entry.id]?.icon}
                            </ListItemIcon>
                            <ListItemText
                              primary={t(entry.titleKey)}
                              primaryTypographyProps={{
                                fontSize: '0.875rem',
                                fontWeight: selected ? 600 : 400,
                              }}
                            />
                            {badgeFor(entry.id) > 0 && (
                              <Chip
                                size="small"
                                color="primary"
                                label={badgeFor(entry.id)}
                                sx={{ height: 18, '& .MuiChip-label': { px: 0.75, fontSize: '0.7rem' } }}
                              />
                            )}
                          </ListItemButton>
                        </Tooltip>
                      )
                    })}
                  </List>
                </Collapse>
              </Box>
            )
          })}
        </List>
      </Box>

      {/* The wizard is not a section, so it is not a leaf — but it is the one
          admin action with no home in the tree, and it used to live on the tab
          this replaced. */}
      <Box sx={{ px: 2, py: 1.5, borderTop: 1, borderColor: 'divider' }}>
        <Button
          size="small"
          onClick={() => navigate('/setup', { state: { from: '/admin' } })}
          sx={{ textTransform: 'none', color: 'text.secondary', fontWeight: 400 }}
        >
          {t('settingsPage.rerunSetup')}
        </Button>
      </Box>
    </Box>
  )
}
