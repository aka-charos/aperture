/**
 * Generated playlists on their owner's Emby home screen.
 *
 * Two kinds may opt in: a channel (the Playlists and Collections pages) and a
 * playlist created from the assistant's suggestions. A playlist built on the
 * Explore similarity graph may not — both are stored in `graph_playlists` and
 * posted through one route, so `origin` is what separates them.
 *
 * Opting in stores a random `aperture:playlist-…` tag on the row; opting out
 * clears it. The column IS the flag: the next sync reads it, tags the playlist's
 * current items, and gives the OWNER a row. A cleared column leaves a tag nobody
 * accounts for, which the sync strips along with its row.
 */

import { randomBytes } from 'crypto'
import { query, queryOne } from '../lib/db.js'
import { getMediaServerConfig } from '../settings/systemSettings.js'
import { getHomeSectionsConfig } from './config.js'
import { playlistTagName } from './plan.js'

export type HomePlaylistSource = 'channel' | 'chat'

export interface HomePlaylist {
  source: HomePlaylistSource
  id: string
  name: string
  ownerId: string
  outputType: 'playlist' | 'collection'
  /** The media-server playlist or collection to read items from; null until a channel is generated. */
  containerId: string | null
  tagName: string
}

export function newPlaylistTagName(): string {
  return playlistTagName(randomBytes(5).toString('hex'))
}

/** Every playlist whose owner put it on their home screen. */
export async function loadHomePlaylists(): Promise<HomePlaylist[]> {
  const rows = await query<{
    source: HomePlaylistSource
    id: string
    name: string
    owner_id: string
    output_type: string
    container_id: string | null
    tag_name: string
  }>(
    `SELECT 'channel' AS source, c.id, c.name, c.owner_id, c.output_type,
            CASE WHEN c.output_type = 'collection' THEN c.collection_id ELSE c.playlist_id END AS container_id,
            c.home_section_tag AS tag_name
     FROM channels c
     WHERE c.home_section_tag IS NOT NULL
     UNION ALL
     SELECT 'chat' AS source, g.id, g.name, g.owner_id, 'playlist' AS output_type,
            g.media_server_playlist_id AS container_id, g.home_section_tag AS tag_name
     FROM graph_playlists g
     WHERE g.home_section_tag IS NOT NULL AND g.origin = 'chat'`
  )

  return rows.rows.map((row) => ({
    source: row.source,
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    outputType: row.output_type === 'collection' ? 'collection' : 'playlist',
    containerId: row.container_id,
    tagName: row.tag_name,
  }))
}

/**
 * Put a channel on its owner's home screen or take it off. Returns the resulting
 * state, or null when the channel does not exist. Switching on twice keeps the
 * tag it already has, so the row is not torn down and rebuilt.
 */
export async function setChannelOnHomeScreen(channelId: string, enabled: boolean): Promise<boolean | null> {
  const row = await queryOne<{ on_home: boolean }>(
    `UPDATE channels
     SET home_section_tag = CASE WHEN $2::boolean THEN COALESCE(home_section_tag, $3) ELSE NULL END
     WHERE id = $1
     RETURNING home_section_tag IS NOT NULL AS on_home`,
    [channelId, enabled, newPlaylistTagName()]
  )
  return row ? row.on_home : null
}

/**
 * The same for a playlist made from assistant suggestions. Null when it does not
 * exist or was built on the Explore graph, which is not offered this.
 */
export async function setChatPlaylistOnHomeScreen(
  playlistId: string,
  enabled: boolean
): Promise<boolean | null> {
  const row = await queryOne<{ on_home: boolean }>(
    `UPDATE graph_playlists
     SET home_section_tag = CASE WHEN $2::boolean THEN COALESCE(home_section_tag, $3) ELSE NULL END,
         updated_at = NOW()
     WHERE id = $1 AND origin = 'chat'
     RETURNING home_section_tag IS NOT NULL AS on_home`,
    [playlistId, enabled, newPlaylistTagName()]
  )
  return row ? row.on_home : null
}

/**
 * Whether a viewer should be offered "show on my home screen" at all. Reads
 * config only — no live server call on every page load; the version gate is
 * enforced when the feature is switched on and by every sync.
 */
export async function isPlaylistHomeSectionAvailable(userId: string): Promise<boolean> {
  const [config, server, user] = await Promise.all([
    getHomeSectionsConfig(),
    getMediaServerConfig(),
    queryOne<{ is_enabled: boolean; provider_disabled: boolean }>(
      `SELECT is_enabled, provider_disabled FROM users WHERE id = $1`,
      [userId]
    ),
  ])
  return (
    config.enabled &&
    config.playlistsEnabled &&
    server.type === 'emby' &&
    user?.is_enabled === true &&
    user.provider_disabled !== true
  )
}
