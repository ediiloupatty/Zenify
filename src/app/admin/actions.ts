"use server";

import { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { r2Client, queryD1, initializeD1Tables } from "@/lib/cloudflare";
import { revalidatePath, revalidateTag } from "next/cache";
import * as mm from "music-metadata";

function revalidateAll(customPath?: string) {
  revalidatePath("/");
  revalidatePath("/admin");
  if (customPath) revalidatePath(customPath);
  revalidateTag("tracks", "max");
  revalidateTag("albums", "max");
  revalidateTag("artists", "max");
  revalidateTag("playlists", "max");
}
import sharp from "sharp";
import { cleanTitle } from "@/lib/cleanTitle";
import { fetchCoverArt, fetchArtistImage } from "@/lib/coverArt";
import { assertAdmin } from "@/lib/admin";

// Normalize a text value for duplicate comparison: lowercase, collapse
// whitespace, drop surrounding spaces. Null/empty all map to "".
function normalizeForMatch(value: string | null | undefined): string {
  return (value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Reliable MIME type from extension — browsers often report empty or wrong
 *  file.type for lossless formats like FLAC. */
const AUDIO_MIME: Record<string, string> = {
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".aac": "audio/aac",
  ".webm": "audio/webm",
  ".opus": "audio/opus",
};
function resolveAudioMime(filename: string, browserType: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot !== -1) {
    const ext = filename.slice(dot).toLowerCase();
    if (AUDIO_MIME[ext]) return AUDIO_MIME[ext];
  }
  return browserType || "application/octet-stream";
}

// Cover / profile art is only ever shown small, so we cap it at 800px and
// re-encode as JPEG. This keeps stored files tiny (faster loads, fewer failures
// over an unstable connection) while staying visually sharp. Always JPEG.
const COVER_MAX = 800;
const COVER_QUALITY = 82;
async function compressCoverImage(input: Buffer | Uint8Array): Promise<Buffer> {
  return sharp(input)
    .rotate() // honour EXIF orientation before stripping metadata
    .resize(COVER_MAX, COVER_MAX, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: COVER_QUALITY })
    .toBuffer();
}

export async function uploadTrackAction(formData: FormData) {
  await assertAdmin();
  try {
    // 1. Get form data
    const title = formData.get("title") as string;
    const category = formData.get("category") as string;
    const file = formData.get("file") as File;
    // When the user explicitly confirms, allow re-uploading a known duplicate.
    const allowDuplicate = formData.get("allowDuplicate") === "true";

    if (!title || !category || !file || file.size === 0) {
      return { success: false, error: "Missing required fields" };
    }

    const bucketName = process.env.R2_BUCKET_NAME || "zenify";
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 2. Extract metadata up front — needed both for the DB row and for the
    //    duplicate check below. Cover art is parsed here but only uploaded to
    //    R2 after we know the track isn't a duplicate (avoids orphan files).
    let finalTitle = cleanTitle(title); // fallback: cleaned filename
    let artist: string | null = null;
    let lyrics: string | null = null;
    let album: string | null = null;
    let year: number | null = null;
    let genre: string | null = null;
    let duration: number | null = null;
    let bitDepth: number | null = null;
    let sampleRate: number | null = null;
    let picture: { format: string; data: Uint8Array } | null = null;

    try {
      const metadata = await mm.parseBuffer(buffer, file.type);
      const c = metadata.common;
      const f = metadata.format;

      // Prefer embedded title over filename — embedded tags are already clean
      if (c.title) finalTitle = c.title;
      if (c.artist) artist = c.artist;
      if (c.album) album = c.album;
      // Guarded, not just truthy-checked: the Go uploader wrote year = 1 to 2805
      // rows before anyone noticed, and a bogus year is worse than no year — the
      // UI printed it verbatim ("The Life of a Showgirl · 1").
      if (c.year && c.year >= 1900 && c.year <= new Date().getFullYear() + 1) {
        year = c.year;
      }
      if (c.genre && c.genre.length > 0) genre = c.genre[0];
      if (f.duration) duration = Math.round(f.duration);
      if (f.bitsPerSample) bitDepth = f.bitsPerSample;
      if (f.sampleRate) sampleRate = f.sampleRate;

      if (c.lyrics && c.lyrics.length > 0) {
        lyrics = c.lyrics.map((l: any) => l.text).join('\n\n');
      }

      if (c.picture && c.picture.length > 0) {
        picture = { format: c.picture[0].format, data: c.picture[0].data };
      }
    } catch (metaErr) {
      console.warn("Failed to extract metadata:", metaErr);
    }

    await initializeD1Tables();

    // 3. Duplicate detection — a track is considered a duplicate when its
    //    title + artist + album match an existing row (case/whitespace
    //    insensitive). Runs before any R2 upload so duplicates leave no files.
    if (!allowDuplicate) {
      const existing = (await queryD1(
        `SELECT title, artist, album FROM tracks`
      )) as { title: string; artist: string | null; album: string | null }[];

      const nTitle = normalizeForMatch(finalTitle);
      const nArtist = normalizeForMatch(artist);
      const nAlbum = normalizeForMatch(album);

      const isDuplicate = existing.some(
        (t) =>
          normalizeForMatch(cleanTitle(t.title)) === nTitle &&
          normalizeForMatch(t.artist) === nArtist &&
          normalizeForMatch(t.album) === nAlbum
      );

      if (isDuplicate) {
        return {
          success: false,
          duplicate: true,
          error: `"${finalTitle}"${artist ? ` — ${artist}` : ""} already exists in the library`,
        };
      }
    }

    // 4. Upload audio file to R2
    const fileExtension = file.name.split('.').pop();
    const uniqueFilename = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExtension}`;

    await r2Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: uniqueFilename,
        Body: buffer,
        ContentType: resolveAudioMime(file.name, file.type),
      })
    );

    // Provide the public URL (Assume public bucket mapping)
    // Note: R2 requires a custom domain or public bucket URL for direct access
    const publicR2Url = process.env.R2_PUBLIC_URL || `https://pub-xxxxxxxx.r2.dev`;
    const fileUrl = `${publicR2Url}/${uniqueFilename}`;

    // 5. Resolve cover art now that the track is confirmed new. Prefer the
    //    file's embedded artwork; if there is none, auto-look it up online
    //    (iTunes/Deezer) so tracks downloaded without art still get a cover.
    let coverUrl: string | null = null;
    let rawCover: Uint8Array | null = picture ? picture.data : null;
    if (!rawCover) {
      try {
        const found = await fetchCoverArt({ artist, album, title: finalTitle });
        if (found) rawCover = found.data;
      } catch (lookupErr) {
        console.warn("Auto cover lookup failed:", lookupErr);
      }
    }
    if (rawCover) {
      try {
        const coverData = await compressCoverImage(rawCover);
        const coverFilename = `cover_${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`;
        await r2Client.send(
          new PutObjectCommand({
            Bucket: bucketName,
            Key: coverFilename,
            Body: coverData,
            ContentType: "image/jpeg",
            // Cover filenames are unique & never overwritten, so the bytes can
            // be cached forever. This header rides along on the presigned GET.
            CacheControl: "public, max-age=31536000, immutable",
          })
        );
        coverUrl = `/api/cover/${coverFilename}`;
      } catch (coverErr) {
        console.warn("Failed to upload cover art:", coverErr);
      }
    }

    // 6. Save metadata to D1
    const trackId = crypto.randomUUID();
    await queryD1(
      `INSERT INTO tracks (id, title, category, file_url, artist, cover_url, lyrics, album, year, genre, duration, bit_depth, sample_rate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [trackId, finalTitle, category, fileUrl, artist, coverUrl, lyrics, album, year, genre, duration, bitDepth, sampleRate]
    );

    revalidateAll();

    return { success: true };
  } catch (error: any) {
    console.error("Upload error:", error);
    return { success: false, error: error.message || "An error occurred during upload" };
  }
}

export async function updateTrackAction(
  id: string,
  data: { title?: string; artist?: string; category?: string }
): Promise<{ success: boolean; error?: string }> {
  await assertAdmin();
  try {
    const fields: string[] = [];
    const params: any[] = [];

    if (data.title !== undefined) { fields.push("title = ?"); params.push(cleanTitle(data.title.trim())); }
    if (data.artist !== undefined) { fields.push("artist = ?"); params.push(data.artist.trim() || null); }
    if (data.category !== undefined) { fields.push("category = ?"); params.push(data.category.trim()); }

    if (!fields.length) return { success: true };

    params.push(id);
    await queryD1(`UPDATE tracks SET ${fields.join(", ")} WHERE id = ?`, params);
    revalidateAll();
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// One-shot cleanup: re-apply cleanTitle to every stored title and persist the
// ones that change. Fixes legacy rows like "01 Kasih Aba Aba" saved before
// title cleaning existed.
export async function recleanAllTitlesAction(): Promise<{ success: boolean; updated?: number; error?: string }> {
  await assertAdmin();
  try {
    const rows = await queryD1(`SELECT id, title FROM tracks`) as { id: string; title: string }[];
    let updated = 0;
    for (const row of rows) {
      const cleaned = cleanTitle(row.title);
      if (cleaned !== row.title) {
        await queryD1(`UPDATE tracks SET title = ? WHERE id = ?`, [cleaned, row.id]);
        updated++;
      }
    }
    if (updated > 0) {
      revalidateAll();
    }
    return { success: true, updated };
  } catch (error: any) {
    console.error("Re-clean error:", error);
    return { success: false, error: error.message || "Failed to re-clean titles" };
  }
}

// Backfill duration for tracks uploaded before duration was extracted. Called
// from the player once the audio element reports its duration. Lightweight,
// metadata-only — no auth gate needed.
export async function saveDurationAction(trackId: string, duration: number): Promise<{ success: boolean }> {
  try {
    if (!trackId || !Number.isFinite(duration) || duration <= 0) return { success: false };
    await queryD1(`UPDATE tracks SET duration = ? WHERE id = ? AND (duration IS NULL OR duration = 0)`, [Math.round(duration), trackId]);
    return { success: true };
  } catch {
    return { success: false };
  }
}

// Backfill bit depth + sample rate for tracks uploaded before these specs were
// extracted. Downloads only the first chunk of each file from R2 (enough for the
// audio header) and parses it. Per-track try/catch so one bad file doesn't abort.
export async function backfillAudioSpecsAction(): Promise<{ success: boolean; updated?: number; error?: string }> {
  await assertAdmin();
  try {
    await initializeD1Tables();
    const bucketName = process.env.R2_BUCKET_NAME || "zenify";
    const rows = (await queryD1(
      `SELECT id, file_url FROM tracks WHERE bit_depth IS NULL OR sample_rate IS NULL`
    )) as { id: string; file_url: string }[];

    let updated = 0;
    for (const row of rows) {
      try {
        const filename = row.file_url.split("/").pop();
        if (!filename) continue;

        const obj = await r2Client.send(
          new GetObjectCommand({
            Bucket: bucketName,
            Key: filename,
            Range: "bytes=0-524287", // first 512KB — plenty for the header
          })
        );
        if (!obj.Body) continue;

        const bytes = await obj.Body.transformToByteArray();
        const buffer = Buffer.from(bytes);

        const metadata = await mm.parseBuffer(buffer, undefined, { duration: false });
        const f = metadata.format;
        const bitDepth = f.bitsPerSample ?? null;
        const sampleRate = f.sampleRate ?? null;

        if (bitDepth != null || sampleRate != null) {
          await queryD1(`UPDATE tracks SET bit_depth = ?, sample_rate = ? WHERE id = ?`, [
            bitDepth,
            sampleRate,
            row.id,
          ]);
          updated++;
        }
      } catch (trackErr) {
        console.warn(`Failed to backfill specs for track ${row.id}:`, trackErr);
      }
    }

    if (updated > 0) {
      revalidateAll();
    }
    return { success: true, updated };
  } catch (error: any) {
    console.error("Backfill specs error:", error);
    return { success: false, error: error.message || "Failed to backfill audio specs" };
  }
}

// Auto-find covers for tracks/albums that currently have NO art at all (no
// embedded art, no sibling-track art, no manual album cover). Looks each one up
// online (iTunes/Deezer) and stores the result. Album-level whenever an album
// tag exists (one cover serves the whole record via the resolve JOIN), else
// per-track. Safe to re-run — only touches items that still lack a cover.
export async function backfillMissingCoversAction(): Promise<{
  success: boolean;
  updated?: number;
  notFound?: number;
  error?: string;
}> {
  await assertAdmin();
  try {
    await initializeD1Tables();
    const bucketName = process.env.R2_BUCKET_NAME || "music";

    // Resolve each track's effective cover exactly like the app does, then keep
    // only the ones that come up empty.
    const rows = (await queryD1(`
      SELECT t.id, t.title, t.artist, t.album,
        COALESCE(a.cover_url, t.cover_url, ec.embedded_cover) AS effective_cover
      FROM tracks t
      LEFT JOIN albums a ON a.name = t.album
      LEFT JOIN (
        SELECT album, MAX(cover_url) AS embedded_cover
        FROM tracks
        WHERE cover_url IS NOT NULL AND album IS NOT NULL AND album != ''
        GROUP BY album
      ) ec ON ec.album = t.album
    `)) as {
      id: string;
      title: string;
      artist: string | null;
      album: string | null;
      effective_cover: string | null;
    }[];

    const missing = rows.filter((r) => !r.effective_cover);

    let updated = 0;
    let notFound = 0;
    const handledAlbums = new Set<string>();

    for (const row of missing) {
      const album = (row.album || "").trim();
      // An earlier track in this run already covered the whole album — skip.
      if (album && handledAlbums.has(album.toLowerCase())) continue;

      const found = await fetchCoverArt({ artist: row.artist, album, title: row.title });
      if (!found) {
        notFound++;
        continue;
      }

      try {
        const coverData = await compressCoverImage(found.data);
        const prefix = album ? "album" : "cover";
        const filename = `${prefix}_${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`;
        await r2Client.send(
          new PutObjectCommand({
            Bucket: bucketName,
            Key: filename,
            Body: coverData,
            ContentType: "image/jpeg",
            // Cover filenames are unique & never overwritten, so the bytes can
            // be cached forever. This header rides along on the presigned GET.
            CacheControl: "public, max-age=31536000, immutable",
          })
        );
        const coverUrl = `/api/cover/${filename}`;

        if (album) {
          await queryD1(
            `INSERT INTO albums (name, cover_url) VALUES (?, ?)
             ON CONFLICT(name) DO UPDATE SET cover_url = excluded.cover_url`,
            [album, coverUrl]
          );
          handledAlbums.add(album.toLowerCase());
        } else {
          await queryD1(`UPDATE tracks SET cover_url = ? WHERE id = ?`, [coverUrl, row.id]);
        }
        updated++;
      } catch (e) {
        console.warn("Backfill cover failed for track", row.id, e);
        notFound++;
      }
    }

    revalidateAll();
    return { success: true, updated, notFound };
  } catch (error: any) {
    console.error("Backfill covers error:", error);
    return { success: false, error: error.message || "Failed to backfill covers" };
  }
}

// Find a profile photo (Deezer) for every distinct track artist that doesn't
// already have one, download it server-side, store it in R2 and upsert the
// artists table. One lookup per artist; safe to re-run (only fills the blanks).
export async function backfillMissingArtistImagesAction(): Promise<{
  success: boolean;
  updated?: number;
  notFound?: number;
  error?: string;
}> {
  await assertAdmin();
  try {
    await initializeD1Tables();
    const bucketName = process.env.R2_BUCKET_NAME || "music";

    // Distinct artists from the library, joined to any existing artist photo.
    const rows = (await queryD1(`
      SELECT DISTINCT t.artist AS artist, a.image_url AS image_url
      FROM tracks t
      LEFT JOIN artists a ON a.name = t.artist
      WHERE t.artist IS NOT NULL AND t.artist != ''
    `)) as { artist: string; image_url: string | null }[];

    const missing = rows.filter((r) => !r.image_url);

    let updated = 0;
    let notFound = 0;
    const handled = new Set<string>();

    for (const row of missing) {
      const name = (row.artist || "").trim();
      if (!name || handled.has(name.toLowerCase())) continue;
      handled.add(name.toLowerCase());

      const found = await fetchArtistImage(name);
      if (!found) {
        notFound++;
        continue;
      }

      try {
        const imgData = await compressCoverImage(found.data);
        const filename = `artist_${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`;
        await r2Client.send(
          new PutObjectCommand({
            Bucket: bucketName,
            Key: filename,
            Body: imgData,
            ContentType: "image/jpeg",
            CacheControl: "public, max-age=31536000, immutable",
          })
        );
        const imageUrl = `/api/cover/${filename}`;
        await queryD1(
          `INSERT INTO artists (name, image_url) VALUES (?, ?)
           ON CONFLICT(name) DO UPDATE SET image_url = excluded.image_url`,
          [name, imageUrl]
        );
        updated++;
      } catch (e) {
        console.warn("Backfill artist image failed for", name, e);
        notFound++;
      }
    }

    revalidateAll();
    return { success: true, updated, notFound };
  } catch (error: any) {
    console.error("Backfill artist images error:", error);
    return { success: false, error: error.message || "Failed to backfill artist images" };
  }
}

// Upload (or replace) a manual cover image for an album. Used when the album
// has no embedded art. Stored in R2 and upserted into the albums table by name.
export async function setAlbumCoverAction(formData: FormData): Promise<{ success: boolean; error?: string }> {
  await assertAdmin();
  try {
    const albumName = formData.get("album") as string;
    const file = formData.get("file") as File;

    if (!albumName || !file || file.size === 0) {
      return { success: false, error: "Missing album name or image" };
    }
    if (!file.type.startsWith("image/")) {
      return { success: false, error: "File must be an image" };
    }

    await initializeD1Tables();

    const bucketName = process.env.R2_BUCKET_NAME || "zenify";
    const filename = `album_${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`;
    const buffer = await compressCoverImage(Buffer.from(await file.arrayBuffer()));

    await r2Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: filename,
        Body: buffer,
        ContentType: "image/jpeg",
      })
    );

    const coverUrl = `/api/cover/${filename}`;
    await queryD1(
      `INSERT INTO albums (name, cover_url) VALUES (?, ?)
       ON CONFLICT(name) DO UPDATE SET cover_url = excluded.cover_url`,
      [albumName, coverUrl]
    );

    revalidateAll();
    return { success: true };
  } catch (error: any) {
    console.error("Set album cover error:", error);
    return { success: false, error: error.message || "Failed to set album cover" };
  }
}

// Remove a manually-uploaded album cover (reverts to embedded art / placeholder).
export async function removeAlbumCoverAction(albumName: string): Promise<{ success: boolean; error?: string }> {
  await assertAdmin();
  try {
    if (!albumName) return { success: false, error: "Missing album name" };

    const rows = (await queryD1(`SELECT cover_url FROM albums WHERE name = ?`, [albumName])) as { cover_url?: string }[];
    const coverUrl = rows[0]?.cover_url;

    if (coverUrl) {
      const filename = coverUrl.split("/").pop();
      if (filename) {
        try {
          await r2Client.send(
            new DeleteObjectCommand({
              Bucket: process.env.R2_BUCKET_NAME || "zenify",
              Key: decodeURIComponent(filename),
            })
          );
        } catch (e) {
          console.warn("Failed to delete album cover from R2:", e);
        }
      }
    }

    await queryD1(`DELETE FROM albums WHERE name = ?`, [albumName]);
    revalidateAll();
    return { success: true };
  } catch (error: any) {
    console.error("Remove album cover error:", error);
    return { success: false, error: error.message || "Failed to remove album cover" };
  }
}

// Upload (or replace) an artist profile photo. Stored in R2, upserted by name.
export async function setArtistImageAction(formData: FormData): Promise<{ success: boolean; error?: string }> {
  await assertAdmin();
  try {
    const artistName = formData.get("artist") as string;
    const file = formData.get("file") as File;

    if (!artistName || !file || file.size === 0) {
      return { success: false, error: "Missing artist name or image" };
    }
    if (!file.type.startsWith("image/")) {
      return { success: false, error: "File must be an image" };
    }

    await initializeD1Tables();

    const bucketName = process.env.R2_BUCKET_NAME || "zenify";
    const filename = `artist_${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`;
    const buffer = await compressCoverImage(Buffer.from(await file.arrayBuffer()));

    await r2Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: filename,
        Body: buffer,
        ContentType: "image/jpeg",
      })
    );

    const imageUrl = `/api/cover/${filename}`;
    await queryD1(
      `INSERT INTO artists (name, image_url) VALUES (?, ?)
       ON CONFLICT(name) DO UPDATE SET image_url = excluded.image_url`,
      [artistName, imageUrl]
    );

    revalidateAll(`/artist/${encodeURIComponent(artistName)}`);
    return { success: true };
  } catch (error: any) {
    console.error("Set artist image error:", error);
    return { success: false, error: error.message || "Failed to set artist image" };
  }
}

// Save / update an artist bio.
export async function setArtistBioAction(artistName: string, bio: string): Promise<{ success: boolean; error?: string }> {
  await assertAdmin();
  try {
    if (!artistName) return { success: false, error: "Missing artist name" };
    await initializeD1Tables();
    await queryD1(
      `INSERT INTO artists (name, bio) VALUES (?, ?)
       ON CONFLICT(name) DO UPDATE SET bio = excluded.bio`,
      [artistName, bio.trim() || null]
    );
    revalidateAll(`/artist/${encodeURIComponent(artistName)}`);
    return { success: true };
  } catch (error: any) {
    console.error("Set artist bio error:", error);
    return { success: false, error: error.message || "Failed to save bio" };
  }
}

// Remove an artist's uploaded photo (reverts to initial avatar).
export async function removeArtistImageAction(artistName: string): Promise<{ success: boolean; error?: string }> {
  await assertAdmin();
  try {
    if (!artistName) return { success: false, error: "Missing artist name" };

    const rows = (await queryD1(`SELECT image_url FROM artists WHERE name = ?`, [artistName])) as { image_url?: string }[];
    const imageUrl = rows[0]?.image_url;

    if (imageUrl) {
      const filename = imageUrl.split("/").pop();
      if (filename) {
        try {
          await r2Client.send(
            new DeleteObjectCommand({
              Bucket: process.env.R2_BUCKET_NAME || "zenify",
              Key: decodeURIComponent(filename),
            })
          );
        } catch (e) {
          console.warn("Failed to delete artist image from R2:", e);
        }
      }
    }

    // Keep the row only if a bio exists; otherwise drop it entirely.
    await queryD1(`UPDATE artists SET image_url = NULL WHERE name = ?`, [artistName]);
    revalidateAll(`/artist/${encodeURIComponent(artistName)}`);
    return { success: true };
  } catch (error: any) {
    console.error("Remove artist image error:", error);
    return { success: false, error: error.message || "Failed to remove artist image" };
  }
}

export async function deleteTrackAction(trackId: string, fileUrl: string) {
  await assertAdmin();
  try {
    const bucketName = process.env.R2_BUCKET_NAME || "music";
    
    // Extract filename from fileUrl
    const urlParts = fileUrl.split("/");
    const filename = urlParts[urlParts.length - 1];

    if (filename) {
      await r2Client.send(
        new DeleteObjectCommand({
          Bucket: bucketName,
          Key: filename,
        })
      );
    }

    await queryD1(`DELETE FROM tracks WHERE id = ?`, [trackId]);
    await queryD1(`DELETE FROM favorites WHERE track_id = ?`, [trackId]); // Clean up favorites too

    revalidateAll();

    return { success: true };
  } catch (error: any) {
    console.error("Delete error:", error);
    return { success: false, error: error.message || "An error occurred during deletion" };
  }
}

// One-time cleanup: shrink every cover/profile image already in R2. Downloads
// each object, compresses it with sharp, and overwrites the SAME key — no DB
// changes, no deletions, audio untouched. Skips images that are already small,
// so it's safe to run more than once.
export async function compressAllCoversAction(): Promise<{ success: boolean; updated?: number; failed?: number; skipped?: number; error?: string }> {
  await assertAdmin();
  try {
    await initializeD1Tables();
    const bucketName = process.env.R2_BUCKET_NAME || "music";

    const rows = (await queryD1(`
      SELECT cover_url AS url FROM tracks  WHERE cover_url LIKE '/api/cover/%'
      UNION
      SELECT cover_url AS url FROM albums  WHERE cover_url LIKE '/api/cover/%'
      UNION
      SELECT image_url AS url FROM artists WHERE image_url LIKE '/api/cover/%'
    `)) as { url: string }[];

    const keys = Array.from(
      new Set(rows.map((r) => decodeURIComponent(r.url.replace("/api/cover/", ""))).filter(Boolean))
    );

    let updated = 0, failed = 0, skipped = 0;
    for (const key of keys) {
      try {
        const obj = await r2Client.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
        if (!obj.Body) { failed++; continue; }
        const original = Buffer.from(await obj.Body.transformToByteArray());

        // Already small enough? leave it (keeps the action idempotent).
        const meta = await sharp(original).metadata();
        const oversized = (meta.width || 0) > COVER_MAX || (meta.height || 0) > COVER_MAX;
        if (!oversized && original.length < 150 * 1024) { skipped++; continue; }

        const compressed = await compressCoverImage(original);
        if (compressed.length >= original.length && !oversized) { skipped++; continue; }

        await r2Client.send(new PutObjectCommand({
          Bucket: bucketName, Key: key, Body: compressed, ContentType: "image/jpeg",
          CacheControl: "public, max-age=31536000, immutable",
        }));
        updated++;
      } catch (e) {
        console.warn("Failed to compress cover:", key, e);
        failed++;
      }
    }

    revalidateAll();
    return { success: true, updated, failed, skipped };
  } catch (error: any) {
    console.error("Compress covers error:", error);
    return { success: false, error: error.message || "Failed to compress covers" };
  }
}
