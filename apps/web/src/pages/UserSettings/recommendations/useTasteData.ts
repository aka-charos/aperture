import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/useAuth'

export type MediaType = 'movie' | 'series'

export const MEDIA_TYPES: readonly MediaType[] = ['movie', 'series']

/** The library collection type each media type's watch history comes from. */
const COLLECTION_TYPE: Record<MediaType, string> = { movie: 'movies', series: 'tvshows' }

export interface TasteProfileSettings {
  hasEmbedding: boolean
  autoUpdatedAt: string | null
  isLocked: boolean
  refreshIntervalDays: number
  minFranchiseItems: number
  minFranchiseSize: number
}

export interface Franchise {
  id: string
  franchiseName: string
  preferenceScore: number
}

export interface GenreWeight {
  id: string
  genre: string
  weight: number
}

export interface CustomInterest {
  id: string
  interestText: string
}

export interface AccessibleLibrary {
  id: string
  name: string
  collectionType: string | null
  isExcluded: boolean
}

export type RescanMode = 'reset' | 'merge'

export interface RescanOutcome {
  /** Media types whose rebuild failed. Empty means everything asked for was rescanned. */
  failed: MediaType[]
  franchisesFound: number
  genresFound: number
  newFranchises: number
  newGenres: number
}

type PerType<T> = Record<MediaType, T>
type SaveKind = 'genres' | 'franchises'

const SLIDER_SAVE_DELAY_MS = 500

interface TasteProfileResponse {
  profile: Partial<TasteProfileSettings> | null
  franchises?: Franchise[]
  genres?: GenreWeight[]
  customInterests?: CustomInterest[]
}

function toSettings(profile: Partial<TasteProfileSettings> | null): TasteProfileSettings | null {
  if (!profile) return null
  return {
    hasEmbedding: profile.hasEmbedding === true,
    autoUpdatedAt: profile.autoUpdatedAt ?? null,
    isLocked: profile.isLocked === true,
    refreshIntervalDays: profile.refreshIntervalDays ?? 30,
    minFranchiseItems: profile.minFranchiseItems ?? 1,
    minFranchiseSize: profile.minFranchiseSize ?? 2,
  }
}

async function send(url: string, method: string, body?: unknown): Promise<void> {
  const response = await fetch(url, {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  // fetch only rejects on a network failure, so a 4xx/5xx has to be turned
  // into one here or it reads exactly like success.
  if (!response.ok) throw new Error(String(response.status))
}

/**
 * Everything the Recommendations tab edits about a viewer's taste, loaded once
 * for both media types.
 *
 * It used to be loaded per media type by a component rendered under a Movies
 * and a TV sub-tab, which made per-user data (interests, genre weights, the
 * library list) look per-type and fetched it twice. Here each value lives once,
 * at the scope it is actually stored at: interests, genres and libraries per
 * user, profiles and franchises per media type.
 */
export function useTasteData() {
  const { t } = useTranslation()
  const { user } = useAuth()

  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [profiles, setProfiles] = useState<PerType<TasteProfileSettings | null>>({ movie: null, series: null })
  const [franchises, setFranchises] = useState<PerType<Franchise[]>>({ movie: [], series: [] })
  const [newFranchises, setNewFranchises] = useState<PerType<string[]>>({ movie: [], series: [] })
  const [genres, setGenres] = useState<GenreWeight[]>([])
  const [newGenres, setNewGenres] = useState<string[]>([])
  const [interests, setInterests] = useState<CustomInterest[]>([])
  // null = could not be read; the tab then offers both media types rather than neither.
  const [libraries, setLibraries] = useState<AccessibleLibrary[] | null>(null)
  const [savingLibrary, setSavingLibrary] = useState<string | null>(null)
  const [busy, setBusy] = useState<Record<SaveKind, number>>({ genres: 0, franchises: 0 })

  /**
   * `quiet` re-reads without the full-tab spinner and without replacing the
   * tab with an error: it is how a failed edit puts back the server's truth,
   * and blanking the page for that would close every list the viewer had open.
   */
  const load = useCallback(async (quiet = false) => {
    if (!user?.id) return
    if (!quiet) setLoading(true)
    try {
      const [movie, series, libs] = await Promise.all([
        fetch('/api/settings/taste-profile?mediaType=movie', { credentials: 'include' }),
        fetch('/api/settings/taste-profile?mediaType=series', { credentials: 'include' }),
        fetch(`/api/users/${user.id}/accessible-libraries`, { credentials: 'include' }).catch(() => null),
      ])
      if (!movie.ok || !series.ok) throw new Error()
      const movieData = (await movie.json()) as TasteProfileResponse
      const seriesData = (await series.json()) as TasteProfileResponse
      setProfiles({ movie: toSettings(movieData.profile), series: toSettings(seriesData.profile) })
      setFranchises({ movie: movieData.franchises ?? [], series: seriesData.franchises ?? [] })
      // Genres and interests are per user, so either response carries the same list.
      setGenres(movieData.genres ?? [])
      setInterests(movieData.customInterests ?? [])
      if (libs?.ok) {
        const data = (await libs.json()) as { libraries?: AccessibleLibrary[] }
        setLibraries(data.libraries ?? [])
      }
      setLoadFailed(false)
    } catch {
      if (!quiet) setLoadFailed(true)
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    void load()
  }, [load])

  const refresh = useCallback(() => load(true), [load])

  /**
   * Media types this viewer has a library for. A franchise list, a refresh
   * setting or a rescan for a kind of title they cannot watch is noise, so
   * those controls are offered only for these. Unknown libraries (the list
   * could not be read) or none at all offer both, never neither.
   */
  const mediaTypes = useMemo<MediaType[]>(() => {
    if (!libraries) return [...MEDIA_TYPES]
    const present = MEDIA_TYPES.filter((type) => libraries.some((lib) => lib.collectionType === COLLECTION_TYPE[type]))
    return present.length > 0 ? present : [...MEDIA_TYPES]
  }, [libraries])

  // --- Debounced slider saves -------------------------------------------------

  const pending = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; fire: () => Promise<void> }>())

  const schedule = useCallback(
    (key: string, kind: SaveKind, run: () => Promise<void>) => {
      const existing = pending.current.get(key)
      if (existing) clearTimeout(existing.timer)
      else setBusy((prev) => ({ ...prev, [kind]: prev[kind] + 1 }))
      const fire = async () => {
        pending.current.delete(key)
        try {
          await run()
        } catch {
          setError(t('userSettings.recs.errSaveWeight'))
        } finally {
          setBusy((prev) => ({ ...prev, [kind]: prev[kind] - 1 }))
        }
      }
      pending.current.set(key, { timer: setTimeout(() => void fire(), SLIDER_SAVE_DELAY_MS), fire })
    },
    [t]
  )

  /** Send every save still waiting out its delay, now. */
  const flushPending = useCallback(async () => {
    const waiting = [...pending.current.values()]
    for (const { timer } of waiting) clearTimeout(timer)
    await Promise.all(waiting.map(({ fire }) => fire()))
  }, [])

  /**
   * Drop a save still waiting for an entry that is being deleted. Sent after
   * the delete, it would write the entry straight back.
   */
  const cancelPending = useCallback((key: string, kind: SaveKind) => {
    const waiting = pending.current.get(key)
    if (!waiting) return
    clearTimeout(waiting.timer)
    pending.current.delete(key)
    setBusy((prev) => ({ ...prev, [kind]: prev[kind] - 1 }))
  }, [])

  // Flush rather than drop: a slider let go just before switching tabs unmounts
  // this hook inside the debounce window, and clearing the timer would lose the
  // change without a word.
  useEffect(() => () => void flushPending(), [flushPending])

  // --- Genres -----------------------------------------------------------------

  const setGenreWeight = useCallback(
    (genre: string, weight: number) => {
      setGenres((prev) => prev.map((g) => (g.genre === genre ? { ...g, weight } : g)))
      schedule(`genre:${genre}`, 'genres', () =>
        send('/api/settings/taste-profile/genres', 'PUT', { genres: [{ genre, weight }] })
      )
    },
    [schedule]
  )

  const removeGenre = useCallback(
    async (genre: string) => {
      cancelPending(`genre:${genre}`, 'genres')
      setGenres((prev) => prev.filter((g) => g.genre !== genre))
      try {
        await send(`/api/settings/taste-profile/genres/${encodeURIComponent(genre)}`, 'DELETE')
      } catch {
        setError(t('userSettings.recs.errRemove'))
        void refresh()
      }
    },
    [cancelPending, refresh, t]
  )

  // --- Franchises -------------------------------------------------------------

  const setFranchiseScore = useCallback(
    (type: MediaType, franchiseName: string, preferenceScore: number) => {
      setFranchises((prev) => ({
        ...prev,
        [type]: prev[type].map((f) => (f.franchiseName === franchiseName ? { ...f, preferenceScore } : f)),
      }))
      schedule(`franchise:${type}:${franchiseName}`, 'franchises', () =>
        send('/api/settings/taste-profile/franchises', 'PUT', {
          franchises: [{ franchiseName, mediaType: type, preferenceScore }],
        })
      )
    },
    [schedule]
  )

  const removeFranchise = useCallback(
    async (type: MediaType, franchiseName: string) => {
      cancelPending(`franchise:${type}:${franchiseName}`, 'franchises')
      setFranchises((prev) => ({ ...prev, [type]: prev[type].filter((f) => f.franchiseName !== franchiseName) }))
      try {
        await send(
          `/api/settings/taste-profile/franchises/${encodeURIComponent(franchiseName)}?mediaType=${type}`,
          'DELETE'
        )
      } catch {
        setError(t('userSettings.recs.errRemove'))
        void refresh()
      }
    },
    [cancelPending, refresh, t]
  )

  // --- Interests --------------------------------------------------------------

  const addInterest = useCallback(
    async (text: string) => {
      const interestText = text.trim()
      if (!interestText || interests.some((i) => i.interestText === interestText)) return
      // Shown at once under a placeholder id; the reload replaces it with the stored row.
      const placeholder: CustomInterest = { id: `pending:${interestText}`, interestText }
      setInterests((prev) => [placeholder, ...prev])
      try {
        await send('/api/settings/taste-profile/interests', 'POST', { interestText })
      } catch {
        setInterests((prev) => prev.filter((i) => i.id !== placeholder.id))
        setError(t('watcherIdentity.errSaveInterest'))
        return
      }
      // Saved. Read the list back for the stored id; if that read fails the
      // chip stays (it is saved) and the next load gives it its id.
      try {
        const response = await fetch('/api/settings/taste-profile?mediaType=movie', { credentials: 'include' })
        if (response.ok) {
          const data = (await response.json()) as TasteProfileResponse
          setInterests(data.customInterests ?? [])
        }
      } catch {
        // See above: nothing was lost.
      }
    },
    [interests, t]
  )

  const removeInterest = useCallback(
    async (interest: CustomInterest) => {
      // A chip still waiting for its stored id cannot be deleted by id yet.
      if (interest.id.startsWith('pending:')) return
      setInterests((prev) => prev.filter((i) => i.id !== interest.id))
      try {
        await send(`/api/settings/taste-profile/interests/${interest.id}`, 'DELETE')
      } catch {
        setInterests((prev) => [interest, ...prev])
        setError(t('watcherIdentity.errRemoveInterest'))
      }
    },
    [t]
  )

  // --- Profile settings (per media type) --------------------------------------

  const saveProfile = useCallback(
    async (type: MediaType, patch: Partial<Pick<TasteProfileSettings, 'isLocked' | 'refreshIntervalDays' | 'minFranchiseItems' | 'minFranchiseSize'>>) => {
      const before = profiles[type]
      if (!before) return
      setProfiles((prev) => {
        const current = prev[type]
        return current ? { ...prev, [type]: { ...current, ...patch } } : prev
      })
      try {
        // Only the changed field is sent. The old form posted every field from
        // a closure captured before the change, so each save stored the value
        // it was replacing.
        await send('/api/settings/taste-profile', 'PATCH', { mediaType: type, ...patch })
      } catch {
        setProfiles((prev) => ({ ...prev, [type]: before }))
        setError(t('userSettings.errSavePreference'))
      }
    },
    [profiles, t]
  )

  // --- Libraries --------------------------------------------------------------

  const toggleLibrary = useCallback(
    async (library: AccessibleLibrary) => {
      if (!user?.id) return
      const excluded = !library.isExcluded
      setSavingLibrary(library.id)
      setLibraries((prev) => prev?.map((l) => (l.id === library.id ? { ...l, isExcluded: excluded } : l)) ?? prev)
      try {
        await send(`/api/users/${user.id}/excluded-libraries/${library.id}`, 'PATCH', { excluded })
      } catch {
        setLibraries((prev) => prev?.map((l) => (l.id === library.id ? { ...l, isExcluded: !excluded } : l)) ?? prev)
        setError(t('userSettings.errSavePreference'))
      } finally {
        setSavingLibrary(null)
      }
    },
    [t, user?.id]
  )

  // --- Rescan -----------------------------------------------------------------

  const rescan = useCallback(
    async (mode: RescanMode): Promise<RescanOutcome> => {
      const outcome: RescanOutcome = { failed: [], franchisesFound: 0, genresFound: 0, newFranchises: 0, newGenres: 0 }
      const detectedGenres = new Set<string>()
      setNewFranchises({ movie: [], series: [] })
      setNewGenres([])
      // A slider save still waiting would otherwise land AFTER the rebuild and
      // undo part of a reset; sent first, the rebuild sees it (and a merge keeps it).
      await flushPending()

      // One type at a time: each rebuild rereads the whole watch history, and
      // the genre list both return is the same per-user list, so the second
      // answer is the current one.
      for (const type of mediaTypes) {
        try {
          const response = await fetch('/api/settings/taste-profile/rebuild', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mediaType: type, mode }),
          })
          if (!response.ok) throw new Error(String(response.status))
          const result = (await response.json()) as {
            franchises?: Franchise[]
            genres?: GenreWeight[]
            newFranchises?: string[]
            newGenres?: string[]
            franchisesUpdated?: number
          }
          const scannedFranchises = result.franchises
          if (scannedFranchises) setFranchises((prev) => ({ ...prev, [type]: scannedFranchises }))
          const scannedGenres = result.genres
          if (scannedGenres) {
            setGenres(scannedGenres)
            outcome.genresFound = scannedGenres.length
          }
          const freshFranchises = result.newFranchises ?? []
          setNewFranchises((prev) => ({ ...prev, [type]: freshFranchises }))
          outcome.newFranchises += freshFranchises.length
          for (const genre of result.newGenres ?? []) detectedGenres.add(genre)
          outcome.franchisesFound += result.franchisesUpdated ?? result.franchises?.length ?? 0
        } catch {
          outcome.failed.push(type)
          continue
        }
        // The rebuild answers with a partial profile, and a first scan is what
        // creates the row at all, so the settings are read back rather than
        // pieced together from defaults that might not be the stored ones.
        try {
          const response = await fetch(`/api/settings/taste-profile?mediaType=${type}`, { credentials: 'include' })
          if (response.ok) {
            const data = (await response.json()) as TasteProfileResponse
            setProfiles((prev) => ({ ...prev, [type]: toSettings(data.profile) }))
          }
        } catch {
          // The scan itself succeeded; a stale "analysed on" date is all this costs.
        }
      }

      setNewGenres([...detectedGenres])
      outcome.newGenres = detectedGenres.size
      return outcome
    },
    [flushPending, mediaTypes]
  )

  const hasPreferences = genres.length > 0 || franchises.movie.length > 0 || franchises.series.length > 0

  return {
    loading,
    loadFailed,
    error,
    clearError: () => setError(null),
    reload: load,
    mediaTypes,
    profiles,
    saveProfile,
    franchises,
    newFranchises,
    setFranchiseScore,
    removeFranchise,
    genres,
    newGenres,
    setGenreWeight,
    removeGenre,
    savingGenres: busy.genres > 0,
    savingFranchises: busy.franchises > 0,
    interests,
    addInterest,
    removeInterest,
    libraries,
    savingLibrary,
    toggleLibrary,
    rescan,
    hasPreferences,
  }
}

export type TasteData = ReturnType<typeof useTasteData>
