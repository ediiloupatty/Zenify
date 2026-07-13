import type { Track } from "@/lib/cloudflare";

// One rule for what counts as a real release year, shared by every boundary a
// Track can enter the app through.
//
// The Go uploader wrote `year = 1` to 2805 rows: dhowden/tag's Vorbis Year()
// switches on the *length* of the date comment, and for anything it doesn't know
// it leaves the layout empty, time.Parse fails, the error is discarded, and it
// returns the zero time's year — 1. The UI rendered that verbatim, so the home
// hero read "The Life of a Showgirl · 1".
//
// The database is repaired (scripts/backfill-years.mjs) and the uploader no longer
// produces it, but a value can still arrive from a snapshot taken before either
// fix — which is why this is applied at the boundaries rather than trusted once.
const MIN_YEAR = 1900;

export function plausibleYear(year: unknown): number | undefined {
  const n = typeof year === "number" ? year : Number(year);
  if (!Number.isInteger(n) || n < MIN_YEAR || n > new Date().getFullYear() + 1) {
    return undefined;
  }
  return n;
}

export function healTrackYear<T extends Partial<Track>>(track: T): T {
  const year = plausibleYear(track.year);
  return year === track.year ? track : { ...track, year };
}
