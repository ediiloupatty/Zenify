import { S3Client } from "@aws-sdk/client-s3";
import { unstable_cache } from "next/cache";
import {
  USE_MOCK_DATA as USE_MOCK,
  MOCK_TRACKS, MOCK_ALBUMS, MOCK_ARTISTS, MOCK_PLAYLISTS, MOCK_CATEGORY_COUNTS,
} from "./mockData";

// In mock mode, skip unstable_cache entirely so regenerated sample data appears
// immediately (no 30s stale window). In real mode, use the real cache.
const cacheFn: typeof unstable_cache = USE_MOCK ? (((fn: any) => fn) as any) : unstable_cache;

// --- Cloudflare R2 Client ---
// Requires: CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || "";
const accessKeyId = process.env.R2_ACCESS_KEY_ID || "";
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || "";

export const r2Client = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
});

// --- Cloudflare D1 Helper (REST API) ---
// Requires: CLOUDFLARE_ACCOUNT_ID, D1_DATABASE_ID, CLOUDFLARE_API_TOKEN
// `silent` suppresses the error log for queries that are EXPECTED to fail
// (e.g. ALTER TABLE ADD COLUMN on a column that already exists).
export async function queryD1(sql: string, params: any[] = [], opts: { silent?: boolean } = {}) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const dbId = process.env.D1_DATABASE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !dbId || !apiToken) {
    throw new Error("Missing Cloudflare D1 environment variables");
  }

  // Single attempt with a hard timeout. Retrying was a mistake here: when the
  // connection to Cloudflare is down, each attempt blocks for ~10s, so retries
  // stacked up to 30-50s before failing. Failing fast keeps the app responsive.
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify({ sql, params }),
      signal: AbortSignal.timeout(20000),
    }
  );

  const data = await response.json();
  if (!data.success) {
    if (!opts.silent) console.error("D1 Query Error:", data.errors);
    throw new Error("Failed to execute D1 query");
  }

  return data.result[0].results;
}

// Run the schema setup at most once per server process. Every D1 round-trip is
// slow + flaky over the network, and re-running ~17 DDL statements on every API
// request was both spamming "duplicate column" logs and adding seconds of
// latency (raising the chance of a connect timeout that blanks the page).
// The promise is cached on success; on failure it's cleared so a later request
// can retry.
let initPromise: Promise<void> | null = null;
export function initializeD1Tables(): Promise<void> {
  if (USE_MOCK) return Promise.resolve();
  if (initPromise) return initPromise;
  initPromise = runInitializeD1Tables().then(
    () => { console.log("Tables initialized successfully."); },
    (error) => { initPromise = null; console.error("Error initializing tables:", error); }
  );
  return initPromise;
}

async function runInitializeD1Tables() {
  const tracksTable = `
    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      file_url TEXT NOT NULL,
      artist TEXT,
      cover_url TEXT,
      lyrics TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `;
  const usersTable = `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `;
  const favoritesTable = `
    CREATE TABLE IF NOT EXISTS favorites (
      user_email TEXT NOT NULL,
      track_id TEXT NOT NULL,
      PRIMARY KEY (user_email, track_id)
    );
  `;
  const playlistsTable = `
    CREATE TABLE IF NOT EXISTS playlists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      user_email TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `;
  // Explicit playlist membership. Playlists were originally backed purely by
  // the track `category` field; this table lets users add arbitrary tracks to
  // a playlist. Reads union both sources (see getPlaylistTracks).
  const playlistTracksTable = `
    CREATE TABLE IF NOT EXISTS playlist_tracks (
      playlist_id TEXT NOT NULL,
      track_id TEXT NOT NULL,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (playlist_id, track_id)
    );
  `;
  // Album art keyed by album name. cover_url here is a MANUAL upload used only
  // when the album has no embedded cover from any of its tracks.
  const albumsTable = `
    CREATE TABLE IF NOT EXISTS albums (
      name TEXT PRIMARY KEY,
      cover_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `;
  // Artist profile (photo + bio), keyed by artist name. Manually managed in admin.
  const artistsTable = `
    CREATE TABLE IF NOT EXISTS artists (
      name TEXT PRIMARY KEY,
      image_url TEXT,
      bio TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `;
  // Per-user listening history for personalized Daily Mix generation.
  const playHistoryTable = `
    CREATE TABLE IF NOT EXISTS user_play_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email TEXT NOT NULL,
      track_id TEXT NOT NULL,
      played_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `;
  await queryD1(tracksTable);
  await queryD1(favoritesTable);
  await queryD1(usersTable);
  await queryD1(playlistsTable);
  await queryD1(playlistTracksTable);
  await queryD1(albumsTable);
  await queryD1(artistsTable);
  await queryD1(playHistoryTable);
  // Index for fast per-user history lookups (recent plays).
  try { await queryD1(`CREATE INDEX IF NOT EXISTS idx_uph_email_played ON user_play_history (user_email, played_at DESC);`, [], { silent: true }); } catch { /* already exists */ }

  // SQLite has no "ADD COLUMN IF NOT EXISTS", so attempt each and ignore the
  // expected "duplicate column" failure (silenced so it doesn't spam the log).
  const newColumns = [
    "artist TEXT", "cover_url TEXT", "lyrics TEXT", "album TEXT", "year INTEGER",
    "genre TEXT", "duration REAL", "bit_depth INTEGER", "sample_rate INTEGER",
    "play_count INTEGER DEFAULT 0", "last_played_at DATETIME",
  ];
  for (const col of newColumns) {
    try { await queryD1(`ALTER TABLE tracks ADD COLUMN ${col};`, [], { silent: true }); } catch { /* already exists */ }
  }
}

// Playlists are personal: only the signed-in owner's playlists are returned.
// `userEmail` is part of the cache key (it's a function argument), so one user's
// list can never be served to another. Logged out → empty (nothing personal to
// show). Playlists with no owner (legacy rows) are hidden by the filter.
export const getPlaylists = cacheFn(
  async (userEmail: string | null = null): Promise<Playlist[]> => {
    if (USE_MOCK) return MOCK_PLAYLISTS;
    if (!userEmail) return [];
    try {
      const rows = await queryD1(
        "SELECT * FROM playlists WHERE user_email = ? ORDER BY created_at ASC",
        [userEmail]
      );
      return rows as Playlist[];
    } catch (error) {
      console.error("Error fetching playlists:", error);
      return [];
    }
  },
  ["playlists"],
  { revalidate: 30, tags: ["playlists"] }
);

export const getPlaylistById = cacheFn(
  async (id: string, userEmail: string | null = null): Promise<Playlist | null> => {
    if (USE_MOCK) return MOCK_PLAYLISTS.find((p) => p.id === id) || null;
    try {
      const rows = await queryD1("SELECT * FROM playlists WHERE id = ?", [id]);
      const pl = rows.length > 0 ? (rows[0] as Playlist) : null;
      if (!pl) return null;
      // Personal playlist: only the owner may open it (blocks reading someone
      // else's playlist by guessing its id via ?playlist=<id>).
      if (!userEmail || !pl.user_email || pl.user_email !== userEmail) return null;
      return pl;
    } catch (error) {
      console.error("Error fetching playlist:", error);
      return null;
    }
  },
  ["playlist-by-id"],
  { revalidate: 30, tags: ["playlists"] }
);

// Tracks in a playlist: the legacy category-named tracks UNION tracks the user
// explicitly added via playlist_tracks. Explicitly added tracks keep working
// even if the playlist was renamed away from a category.
export const getPlaylistTracks = cacheFn(
  async (playlistId: string, playlistName: string): Promise<Track[]> => {
    if (USE_MOCK) return MOCK_TRACKS.filter((t) => t.category === playlistName);
    try {
      const sql = `
        ${TRACK_SELECT_WITH_COVER}
        LEFT JOIN playlist_tracks pt ON pt.track_id = t.id AND pt.playlist_id = ?
        WHERE t.category = ? OR pt.playlist_id IS NOT NULL
        ORDER BY t.created_at DESC
      `;
      const rows = await queryD1(sql, [playlistId, playlistName]);
      return await normalizeTracks(rows);
    } catch (error) {
      // The playlist_tracks table is created lazily (initializeD1Tables runs on
      // the first write action). Until then the JOIN fails — fall back to the
      // legacy category-based lookup so existing playlists keep working.
      console.error("Error fetching playlist tracks:", error);
      return getTracksByCategory(playlistName);
    }
  },
  ["playlist-tracks"],
  { revalidate: 30, tags: ["tracks", "playlists"] }
);


export type Track = {
  id: string;
  title: string;
  category: string;
  file_url: string;
  artist?: string;
  cover_url?: string;
  lyrics?: string;
  album?: string;
  year?: number;
  genre?: string;
  duration?: number;
  bit_depth?: number;
  sample_rate?: number;
  play_count?: number;
};

export type Playlist = {
  id: string;
  name: string;
  user_email?: string;
  created_at?: string;
};

export type Album = {
  name: string;
  trackCount: number;
  artist?: string;
  cover_url?: string; // resolved cover: embedded art preferred, else manual upload
  source: "embedded" | "uploaded" | "none";
};

// Tracks SELECT that resolves an effective cover for every row:
//   1. a manually uploaded album cover (explicit override), else
//   2. the track's own embedded cover, else
//   3. any sibling track's embedded cover in the same album.
// Because the result column is still named `cover_url`, every existing component
// gets the album fallback for free.
const TRACK_SELECT_WITH_COVER = `
  SELECT t.id, t.title, t.category, t.file_url, t.artist,
    COALESCE(a.cover_url, t.cover_url, ec.embedded_cover) AS cover_url,
    t.lyrics, t.album, t.year, t.genre, t.duration, t.bit_depth, t.sample_rate, t.play_count
  FROM tracks t
  LEFT JOIN albums a ON a.name = t.album
  LEFT JOIN (
    SELECT album, MAX(cover_url) AS embedded_cover
    FROM tracks
    WHERE cover_url IS NOT NULL AND album IS NOT NULL AND album != ''
    GROUP BY album
  ) ec ON ec.album = t.album
`;

// ─── Media URL normalization ────────────────────────────────────────────────
// The public R2 bucket (pub-*.r2.dev) is blocked by some ISPs, so rewrite every
// media URL to go through our signed-redirect proxy routes (/api/cover, /api/audio)
// which hit the *.r2.cloudflarestorage.com endpoint instead.
//
// CDN fast path: if R2_CDN_URL is set (a custom domain connected to the R2
// bucket and cached at Cloudflare's edge), covers are served straight from that
// domain — no proxy, no redirect, no presign. Audio always stays on the proxy
// route (it has referer protection and the files are large). When R2_CDN_URL is
// unset, behavior is identical to before. Safe + idempotent: unknown external
// URLs and non-media local paths are returned untouched.
const R2_CDN_BASE = (process.env.R2_CDN_URL || "").replace(/\/+$/, "");

// Pull the underlying R2 object key out of whatever form the URL currently has:
// an r2.dev/pub URL, an already-proxied "/api/cover|audio/<key>" path, or a
// CDN URL. Returns null for anything we don't manage (so it passes through).
function r2KeyFromUrl(url: string): string | null {
  if (url.startsWith("/api/cover/")) return url.slice("/api/cover/".length) || null;
  if (url.startsWith("/api/audio/")) return url.slice("/api/audio/".length) || null;
  if (url.includes(".r2.dev/")) return url.split(".r2.dev/").pop() || null;
  const pub = (process.env.R2_PUBLIC_URL || "").replace(/\/+$/, "");
  if (pub && url.startsWith(pub)) return url.slice(pub.length).replace(/^\/+/, "");
  if (R2_CDN_BASE && url.startsWith(R2_CDN_BASE)) return url.slice(R2_CDN_BASE.length).replace(/^\/+/, "");
  return null;
}
function toProxyUrl(url: string | null | undefined, kind: "audio" | "cover"): string | undefined {
  if (!url) return undefined;
  const rawKey = r2KeyFromUrl(url);
  if (rawKey === null) return url; // local path or external URL we don't manage — leave it
  let key = rawKey;
  try { key = decodeURIComponent(rawKey); } catch { /* keep as-is */ }
  const path = key.split("/").map(encodeURIComponent).join("/");
  if (kind === "cover" && R2_CDN_BASE) return `${R2_CDN_BASE}/${path}`;
  return `/api/${kind}/${path}`;
}
// 2805 of the library's rows carry `year = 1`, and the UI rendered it literally
// ("The Life of a Showgirl · 1"). The Go uploader got it from dhowden/tag, whose
// Vorbis Year() only knows date strings of length 4, 7 or 10; anything else (an
// ISO timestamp, say) leaves the format empty, time.Parse fails, the error is
// discarded, and it returns the zero time's year — which is 1.
//
// The uploader now rejects those, but the rows already in D1 outlive that fix,
// and any tagger can produce a new one. Filtering here — the single gate every
// track passes through on its way out of the database — means no render site has
// to remember to guard, and a seventh one can't reintroduce the bug.
function plausibleYear(year: unknown): number | undefined {
  const n = typeof year === "number" ? year : Number(year);
  if (!Number.isInteger(n) || n < 1900 || n > new Date().getFullYear() + 1) {
    return undefined;
  }
  return n;
}

function normalizeTrack(t: any): Track {
  return {
    ...t,
    year: plausibleYear(t.year),
    file_url: toProxyUrl(t.file_url, "audio") ?? t.file_url,
    cover_url: toProxyUrl(t.cover_url, "cover"),
  };
}

async function normalizeTracks(rows: any[]): Promise<Track[]> {
  // Pure, synchronous URL normalization — no per-track R2 reads. Earlier this
  // function fanned out a 64KB R2 GET (plus a D1 write) for every track missing
  // audio specs, so loading any list cost dozens of small round-trips on a cold
  // library. Specs now come straight from the DB (written at upload time and by
  // the admin backfill in app/admin/actions.ts); when a row has none, the player
  // falls back to a format-based heuristic (see BottomPlayer / QueuePanel). That
  // keeps list loads to a single D1 query with zero R2 traffic.
  return rows.map(normalizeTrack);
}

// Fetch tracks based on category or fetch all if none provided
export const getTracksByCategory = cacheFn(
  async (category: string | null = null): Promise<Track[]> => {
    if (USE_MOCK) return category ? MOCK_TRACKS.filter((t) => t.category === category) : MOCK_TRACKS;
    try {
      let sql = `${TRACK_SELECT_WITH_COVER} ORDER BY t.created_at DESC`;
      let params: string[] = [];

      if (category) {
        sql = `${TRACK_SELECT_WITH_COVER} WHERE t.category = ? ORDER BY t.created_at DESC`;
        params = [category];
      }

      const rows = await queryD1(sql, params);
      return await normalizeTracks(rows);
    } catch (error) {
      console.error("Error fetching tracks:", error);
      return [];
    }
  },
  ["tracks-by-category"],
  { revalidate: 30, tags: ["tracks", "albums", "artists"] }
);

export async function getTrackById(id: string): Promise<Track | null> {
  if (USE_MOCK) return MOCK_TRACKS.find((t) => t.id === id) ?? null;
  try {
    const rows = await queryD1(`${TRACK_SELECT_WITH_COVER} WHERE t.id = ? LIMIT 1`, [id]);
    const tracks = await normalizeTracks(rows);
    return tracks[0] ?? null;
  } catch {
    return null;
  }
}

// Fetch all tracks belonging to a single album.
export const getTracksByAlbum = cacheFn(
  async (album: string): Promise<Track[]> => {
    if (USE_MOCK) return MOCK_TRACKS.filter((t) => t.album === album);
    try {
      const sql = `${TRACK_SELECT_WITH_COVER} WHERE t.album = ? ORDER BY t.created_at DESC`;
      const rows = await queryD1(sql, [album]);
      return await normalizeTracks(rows);
    } catch (error) {
      console.error("Error fetching album tracks:", error);
      return [];
    }
  },
  ["tracks-by-album"],
  { revalidate: 30, tags: ["tracks", "albums"] }
);

export type Artist = {
  name: string;
  trackCount: number;
  albumCount: number;
  image_url?: string;
  bio?: string;
};

// Fetch all tracks by a single artist, most-played first (covers resolved).
export const getTracksByArtist = cacheFn(
  async (artist: string): Promise<Track[]> => {
    if (USE_MOCK) return MOCK_TRACKS.filter((t) => t.artist === artist);
    try {
      const sql = `${TRACK_SELECT_WITH_COVER} WHERE t.artist = ? ORDER BY COALESCE(t.play_count, 0) DESC, t.created_at ASC`;
      const rows = await queryD1(sql, [artist]);
      return await normalizeTracks(rows);
    } catch (error) {
      console.error("Error fetching artist tracks:", error);
      return [];
    }
  },
  ["tracks-by-artist"],
  { revalidate: 30, tags: ["tracks", "albums", "artists"] }
);

// Increment a track's play counter and stamp last-played (best-effort).
// When userEmail is provided, also logs the play to user_play_history for
// personalized Daily Mix generation.
export async function incrementPlayCount(trackId: string, userEmail?: string): Promise<void> {
  if (USE_MOCK) return;
  try {
    if (!trackId) return;
    const promises: Promise<any>[] = [
      queryD1(
        `UPDATE tracks SET play_count = COALESCE(play_count, 0) + 1, last_played_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [trackId]
      ),
    ];
    if (userEmail) {
      promises.push(
        queryD1(
          `INSERT INTO user_play_history (user_email, track_id) VALUES (?, ?)`,
          [userEmail, trackId]
        )
      );
    }
    await Promise.all(promises);
  } catch (error) {
    console.error("Error incrementing play count:", error);
  }
}

// Per-user recently played (most recent first), sourced from user_play_history
// (populated per-user by /api/play) instead of the shared tracks.last_played_at
// column — otherwise one listener's plays would show up for everyone.
// `userEmail` is part of the cache key, so users never see each other's history.
//
// Fallback when there is no personal history yet (or the visitor is logged out):
// the globally most-played tracks. This is meaningful and intentionally NOT the
// newest additions (those already appear as "Recently Added" elsewhere).
export const getRecentlyPlayed = cacheFn(
  async (userEmail: string | null = null, limit = 9): Promise<Track[]> => {
    if (USE_MOCK) return MOCK_TRACKS.slice(0, limit);
    try {
      if (userEmail) {
        const sql = `
          ${TRACK_SELECT_WITH_COVER}
          INNER JOIN (
            SELECT track_id, MAX(played_at) AS last_played
            FROM user_play_history
            WHERE user_email = ?
            GROUP BY track_id
          ) h ON h.track_id = t.id
          ORDER BY h.last_played DESC
          LIMIT ${Number(limit)}
        `;
        const rows = await queryD1(sql, [userEmail]);
        const tracks = await normalizeTracks(rows);
        if (tracks.length > 0) return tracks;
      }
      // Fallback: globally most-played tracks.
      const popSql = `${TRACK_SELECT_WITH_COVER} WHERE COALESCE(t.play_count, 0) > 0 ORDER BY t.play_count DESC LIMIT ${Number(limit)}`;
      const popRows = await queryD1(popSql);
      return await normalizeTracks(popRows);
    } catch (error) {
      console.error("Error fetching recently played:", error);
      return [];
    }
  },
  ["recently-played"],
  { revalidate: 30, tags: ["tracks", "albums"] }
);

// Newest additions to the library (most recent first).
export const getNewTracks = cacheFn(
  async (limit = 12): Promise<Track[]> => {
    if (USE_MOCK) return MOCK_TRACKS.slice(0, limit);
    try {
      const sql = `${TRACK_SELECT_WITH_COVER} ORDER BY t.created_at DESC LIMIT ${Number(limit)}`;
      const rows = await queryD1(sql);
      return await normalizeTracks(rows);
    } catch (error) {
      console.error("Error fetching new tracks:", error);
      return [];
    }
  },
  ["new-tracks"],
  { revalidate: 30, tags: ["tracks", "albums"] }
);

// List every artist (derived from tracks) with counts + profile image/bio.
export const getArtists = cacheFn(
  async (): Promise<Artist[]> => {
  if (USE_MOCK) return MOCK_ARTISTS;
  try {
    const rows = (await queryD1(`
      SELECT t.artist AS name,
        COUNT(*) AS trackCount,
        COUNT(DISTINCT t.album) AS albumCount,
        ar.image_url AS image_url,
        ar.bio AS bio
      FROM tracks t
      LEFT JOIN artists ar ON ar.name = t.artist
      WHERE t.artist IS NOT NULL AND t.artist != ''
      GROUP BY t.artist
      ORDER BY trackCount DESC, t.artist ASC
    `)) as any[];
    return rows.map((r) => ({
      name: r.name as string,
      trackCount: Number(r.trackCount) || 0,
      albumCount: Number(r.albumCount) || 0,
      image_url: toProxyUrl(r.image_url, "cover"),
      bio: r.bio || undefined,
    }));
  } catch (error) {
    console.error("Error fetching artists:", error);
    return [];
  }
  },
  ["artists"],
  { revalidate: 30, tags: ["tracks", "artists"] }
);

// Single artist's profile + counts (null if the artist has no tracks).
export async function getArtistInfo(name: string): Promise<Artist | null> {
  if (USE_MOCK) return MOCK_ARTISTS.find((a) => a.name === name) ?? null;
  try {
    const rows = (await queryD1(`
      SELECT t.artist AS name,
        COUNT(*) AS trackCount,
        COUNT(DISTINCT t.album) AS albumCount,
        ar.image_url AS image_url,
        ar.bio AS bio
      FROM tracks t
      LEFT JOIN artists ar ON ar.name = t.artist
      WHERE t.artist = ?
      GROUP BY t.artist
    `, [name])) as any[];
    if (!rows || rows.length === 0) return null;
    const r = rows[0];
    return {
      name: r.name as string,
      trackCount: Number(r.trackCount) || 0,
      albumCount: Number(r.albumCount) || 0,
      image_url: toProxyUrl(r.image_url, "cover"),
      bio: r.bio || undefined,
    };
  } catch (error) {
    console.error("Error fetching artist info:", error);
    return null;
  }
}

// Track count per category/playlist name (cached — used by the playlists API).
export const getCategoryCounts = cacheFn(
  async (): Promise<{ category: string; count: number }[]> => {
    if (USE_MOCK) return MOCK_CATEGORY_COUNTS;
    try {
      const rows = await queryD1("SELECT category, COUNT(*) as count FROM tracks GROUP BY category");
      return rows as { category: string; count: number }[];
    } catch (error) {
      console.error("Error fetching category counts:", error);
      return [];
    }
  },
  ["category-counts"],
  { revalidate: 30, tags: ["tracks"] }
);

// List every album (derived from tracks) with its resolved cover + source.
export const getAlbums = cacheFn(
  async (): Promise<Album[]> => {
  if (USE_MOCK) return MOCK_ALBUMS;
  try {
    const rows = (await queryD1(`
      SELECT t.album AS name,
        COUNT(*) AS trackCount,
        MAX(t.artist) AS artist,
        ec.embedded_cover AS embedded_cover,
        a.cover_url AS uploaded_cover
      FROM tracks t
      LEFT JOIN albums a ON a.name = t.album
      LEFT JOIN (
        SELECT album, MAX(cover_url) AS embedded_cover
        FROM tracks
        WHERE cover_url IS NOT NULL AND album IS NOT NULL AND album != ''
        GROUP BY album
      ) ec ON ec.album = t.album
      WHERE t.album IS NOT NULL AND t.album != ''
      GROUP BY t.album
      ORDER BY trackCount DESC, t.album ASC
    `)) as any[];

    return rows.map((r) => {
      // A manual upload is an explicit override; otherwise fall back to embedded art.
      const cover = r.uploaded_cover || r.embedded_cover || undefined;
      const source: Album["source"] = r.uploaded_cover
        ? "uploaded"
        : r.embedded_cover
          ? "embedded"
          : "none";
      return {
        name: r.name as string,
        trackCount: Number(r.trackCount) || 0,
        artist: r.artist || undefined,
        cover_url: toProxyUrl(cover, "cover"),
        source,
      };
    });
  } catch (error) {
    console.error("Error fetching albums:", error);
    return [];
  }
  },
  ["albums"],
  { revalidate: 30, tags: ["tracks", "albums"] }
);

// Realtime stats for the profile header: when the account was created and the
// total number of plays across the whole library (sum of every track's counter).
export async function getUserStats(
  email: string
): Promise<{ joinedAt: string | null; totalPlays: number }> {
  if (USE_MOCK) return { joinedAt: null, totalPlays: 0 };
  try {
    const [userRows, playRows] = await Promise.all([
      queryD1("SELECT created_at FROM users WHERE email = ?", [email]),
      queryD1("SELECT COALESCE(SUM(play_count), 0) AS total FROM tracks"),
    ]);
    const joinedAt = userRows.length > 0 ? ((userRows[0] as any).created_at ?? null) : null;
    const totalPlays = Number((playRows[0] as any)?.total) || 0;
    return { joinedAt, totalPlays };
  } catch (error) {
    console.error("Error fetching user stats:", error);
    return { joinedAt: null, totalPlays: 0 };
  }
}

export async function getUserFavorites(email: string): Promise<string[]> {
  if (USE_MOCK) return [];
  try {
    const rows = await queryD1("SELECT track_id FROM favorites WHERE user_email = ?", [email]);
    return rows.map((r: any) => r.track_id);
  } catch (error) {
    console.error("Error fetching favorites:", error);
    return [];
  }
}

// Fetch full track objects for a user's favorites in a single JOIN query,
// avoiding the need to fetch ALL tracks and filter client-side.
export async function getFavoriteTracks(email: string): Promise<Track[]> {
  if (USE_MOCK) return [];
  try {
    const sql = `
      ${TRACK_SELECT_WITH_COVER}
      INNER JOIN favorites f ON f.track_id = t.id
      WHERE f.user_email = ?
      ORDER BY t.title ASC
    `;
    const rows = await queryD1(sql, [email]);
    return await normalizeTracks(rows);
  } catch (error) {
    console.error("Error fetching favorite tracks:", error);
    return [];
  }
}

export async function toggleFavoriteInD1(email: string, trackId: string, isFavorited: boolean) {
  if (USE_MOCK) return;
  try {
    if (isFavorited) {
      await queryD1("DELETE FROM favorites WHERE user_email = ? AND track_id = ?", [email, trackId]);
    } else {
      await queryD1("INSERT OR IGNORE INTO favorites (user_email, track_id) VALUES (?, ?)", [email, trackId]);
    }
  } catch (error) {
    console.error("Error toggling favorite:", error);
    throw error;
  }
}

// ─── Daily Mix generation ──────────────────────────────────────────────────

export type DailyMix = {
  id: string;           // "daily-mix-1", etc.
  title: string;        // "Daily Mix 1"
  description: string;  // "Keshi, NIKI, and more"
  tracks: Track[];      // 7-10 tracks
  coverTracks: Track[]; // first 4 tracks for the 2×2 cover grid
};

// Simple deterministic hash for date-based shuffling.
function seedHash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// Seeded pseudo-random shuffle (Fisher-Yates with deterministic seed).
function seededShuffle<T>(arr: T[], seed: number): T[] {
  const result = [...arr];
  let s = seed;
  for (let i = result.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Generate personalized daily mixes for a user. Mixes change every day
// (date-seeded) but stay consistent within a single day.
export async function getDailyMixes(
  userEmail: string | null,
  allTracks: Track[]
): Promise<DailyMix[]> {
  if (allTracks.length < 7) return []; // not enough tracks for even one mix

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // ── Gather per-user play counts (last 30 days) ──
  type PlayStat = { track_id: string; plays: number };
  let userStats: PlayStat[] = [];
  if (userEmail && !USE_MOCK) {
    try {
      userStats = (await queryD1(
        `SELECT track_id, COUNT(*) AS plays
         FROM user_play_history
         WHERE user_email = ? AND played_at >= datetime('now', '-30 days')
         GROUP BY track_id
         ORDER BY plays DESC`,
        [userEmail]
      )) as PlayStat[];
    } catch { /* no history yet — fall through to global fallback */ }
  }

  // Build a lookup: trackId → Track object
  const trackMap = new Map<string, Track>();
  for (const t of allTracks) trackMap.set(t.id, t);

  // ── Artist play frequency ──
  const artistPlays = new Map<string, number>();
  const hasUserHistory = userStats.length > 0;

  if (hasUserHistory) {
    // Per-user: count plays per artist from user_play_history
    for (const { track_id, plays } of userStats) {
      const t = trackMap.get(track_id);
      if (t?.artist) {
        artistPlays.set(t.artist, (artistPlays.get(t.artist) || 0) + plays);
      }
    }
  } else {
    // Fallback: use global play_count from tracks table
    for (const t of allTracks) {
      if (t.artist && (t.play_count || 0) > 0) {
        artistPlays.set(t.artist, (artistPlays.get(t.artist) || 0) + (t.play_count || 0));
      }
    }
  }

  // ── Cluster artists by genre/category ──
  // Group: category → [artist names], sorted by play frequency
  const artistCategory = new Map<string, string>(); // artist → primary category
  const categoryArtists = new Map<string, string[]>();
  for (const t of allTracks) {
    if (!t.artist) continue;
    if (!artistCategory.has(t.artist)) {
      artistCategory.set(t.artist, t.genre || t.category || "other");
    }
  }

  // Sort artists by play frequency (most played first)
  const rankedArtists = [...artistPlays.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);

  // If no play data at all, rank by global track count
  if (rankedArtists.length === 0) {
    const artistTrackCount = new Map<string, number>();
    for (const t of allTracks) {
      if (t.artist) artistTrackCount.set(t.artist, (artistTrackCount.get(t.artist) || 0) + 1);
    }
    const sorted = [...artistTrackCount.entries()].sort((a, b) => b[1] - a[1]);
    for (const [name] of sorted) rankedArtists.push(name);
  }

  // Group artists into clusters by their primary category
  for (const artist of rankedArtists) {
    const cat = artistCategory.get(artist) || "other";
    if (!categoryArtists.has(cat)) categoryArtists.set(cat, []);
    categoryArtists.get(cat)!.push(artist);
  }

  // ── Build mixes ──
  // Each cluster of 1-3 artists → one mix.
  // Distribute artists across multiple mixes: take top artists and fan them out.
  const clusters: string[][] = [];
  const assigned = new Set<string>();

  // First pass: create clusters from ranked artists grouped by category
  for (const [, artists] of categoryArtists) {
    for (let i = 0; i < artists.length; i += 3) {
      const chunk = artists.slice(i, i + 3).filter((a) => !assigned.has(a));
      if (chunk.length > 0) {
        clusters.push(chunk);
        chunk.forEach((a) => assigned.add(a));
      }
    }
  }

  // Second pass: any remaining unassigned ranked artists into their own cluster
  for (const artist of rankedArtists) {
    if (!assigned.has(artist)) {
      clusters.push([artist]);
      assigned.add(artist);
    }
  }

  // Cap at 6 mixes max
  const maxMixes = Math.min(clusters.length, 6);
  const usedTrackIds = new Set<string>();
  const mixes: DailyMix[] = [];

  for (let i = 0; i < maxMixes; i++) {
    const clusterArtists = clusters[i];
    const seed = seedHash(`${userEmail || "anon"}:${today}:${i}`);

    // Collect all tracks from the cluster's artists
    const pool = allTracks.filter(
      (t) => t.artist && clusterArtists.includes(t.artist) && !usedTrackIds.has(t.id)
    );

    if (pool.length < 3) continue; // skip tiny clusters

    // Deterministic shuffle, then take 7-10 tracks
    const shuffled = seededShuffle(pool, seed);
    const mixTracks = shuffled.slice(0, Math.min(10, Math.max(7, shuffled.length)));

    for (const t of mixTracks) usedTrackIds.add(t.id);

    // Description: list up to 3 artist names
    const uniqueArtists = [...new Set(mixTracks.map((t) => t.artist).filter(Boolean))];
    const desc =
      uniqueArtists.length <= 2
        ? uniqueArtists.join(" and ")
        : `${uniqueArtists.slice(0, 2).join(", ")}, and more`;

    mixes.push({
      id: `daily-mix-${mixes.length + 1}`,
      title: `Daily Mix ${mixes.length + 1}`,
      description: desc,
      tracks: mixTracks,
      coverTracks: mixTracks.slice(0, 4),
    });
  }

  // If we have leftover tracks and fewer than 3 mixes, add a "discovery" mix
  // from tracks not yet used, shuffled by today's seed.
  if (mixes.length < 3) {
    const remaining = allTracks.filter((t) => !usedTrackIds.has(t.id));
    if (remaining.length >= 7) {
      const seed = seedHash(`${userEmail || "anon"}:${today}:discover`);
      const shuffled = seededShuffle(remaining, seed);
      const mixTracks = shuffled.slice(0, 10);
      const uniqueArtists = [...new Set(mixTracks.map((t) => t.artist).filter(Boolean))];
      const desc =
        uniqueArtists.length <= 2
          ? uniqueArtists.join(" and ")
          : `${uniqueArtists.slice(0, 2).join(", ")}, and more`;
      mixes.push({
        id: `daily-mix-${mixes.length + 1}`,
        title: `Daily Mix ${mixes.length + 1}`,
        description: desc,
        tracks: mixTracks,
        coverTracks: mixTracks.slice(0, 4),
      });
    }
  }

  return mixes;
}
