"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, ReactNode } from "react";
import { Track } from "@/lib/cloudflare";
import { cleanTitle } from "@/lib/cleanTitle";
import { healTrackYear } from "@/lib/trackYear";

const STORAGE_KEY_QUEUE = "zenify_queue";
const STORAGE_KEY_STATE = "zenify_state";
// Legacy key — read-only for migration, never written to.
const STORAGE_KEY_LEGACY = "zenify_player";
const HISTORY_LIMIT = 100;

type RepeatMode = "off" | "all" | "one";

// ---------------------------------------------------------------------------
// Playback model
//
// `tracks` always holds the queue in its ORIGINAL order — components read the
// current song as `tracks[currentTrackIndex]`, so that contract must hold.
//
// Ordering is decoupled into `playOrder`: a permutation of indices into
// `tracks`. `position` points into `playOrder`, so the real current track is
// `tracks[playOrder[position]]`. This lets us shuffle without touching the
// queue, toggle shuffle on/off losslessly, and walk a proper history.
//
//   Layer 1 (shuffle engine): each track is visited once per pass before any
//   repeat (no more "random per-step" with accidental repeats), and `history`
//   makes Previous return to the actually-previous track.
//
//   Layer 2 (vibe ordering): the shuffled order isn't uniform random — it's a
//   weighted walk that tends to place tracks of the same genre/category and
//   popular tracks (high play_count) near each other, so the next song "fits",
//   while keeping enough randomness that it still feels shuffled.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Dithered Shuffle with Cooldown, Decay & Genre Spread
// ---------------------------------------------------------------------------
// Weights for the vibe walk. Tune freely.
const W_BASE = 1;      // every track always has a baseline chance
const W_GENRE = 4;     // pull toward the same genre
const W_CATEGORY = 3;  // pull toward the same category (mood/suasana)
const W_POPULAR = 2;   // gentle bias toward songs the user plays a lot

// Anti-monotony constraints
const ARTIST_COOLDOWN = 3;     // same artist can't appear within N slots
const GENRE_RUN_MAX = 2;       // max consecutive tracks of same genre before penalty
const RECENCY_DECAY = 0.4;     // penalty floor for recently played tracks (lower = stronger)
const COOLDOWN_PENALTY = 0.05; // near-zero weight for tracks violating cooldown

const identityOrder = (length: number): number[] =>
  Array.from({ length }, (_, i) => i);

// Remove duplicate tracks from a queue so the same song can't appear more than
// once. Collapses BOTH exact id matches AND entries that would DISPLAY
// identically (same cleaned title + artist) — the latter is what surfaces as
// "judul c, judul c, judul c" in the queue when a library holds the same
// recording uploaded more than once under different ids. Keeps the first
// occurrence and preserves order.
function dedupeTracks(list: Track[]): Track[] {
  const seenIds = new Set<string>();
  const seenDisplay = new Set<string>();
  const out: Track[] = [];
  for (const t of list) {
    if (t.id && seenIds.has(t.id)) continue;
    const title = cleanTitle(t.title || "").toLowerCase().trim();
    const displayKey = title ? `${title}|${(t.artist || "").toLowerCase().trim()}` : "";
    if (displayKey && seenDisplay.has(displayKey)) continue;
    if (t.id) seenIds.add(t.id);
    if (displayKey) seenDisplay.add(displayKey);
    out.push(t);
  }
  return out;
}

// Pick one item index by weight (roulette-wheel selection).
function weightedPick(items: number[], weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return items[Math.floor(Math.random() * items.length)];
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

// Count how many hours ago a track was last played (0 = never played = no penalty).
function hoursSinceLastPlayed(track: Track): number {
  const lp = (track as Record<string, unknown>).last_played_at;
  if (!lp) return 0;
  const diff = Date.now() - new Date(lp as string).getTime();
  return Math.max(0, diff / (1000 * 60 * 60));
}

// Build a play order starting at `anchor`, using a greedy weighted-random walk
// with artist cooldown, genre spread, and recency decay so the queue never
// feels monotonous.
function buildVibeOrder(tracks: Track[], anchor: number): number[] {
  const n = tracks.length;
  if (n <= 1) return n === 1 ? [0] : [];

  const maxPlays = Math.max(1, ...tracks.map((t) => t.play_count || 0));

  // Pre-compute recency factor for each track: 1.0 (never played / long ago)
  // down to RECENCY_DECAY (just played). Uses exponential decay over ~24h.
  const recencyFactor = tracks.map((t) => {
    const h = hoursSinceLastPlayed(t);
    if (h === 0) return 1; // never played — full weight
    // Within the last ~2 hours → heavy penalty; decays back to 1.0 over ~24h
    return RECENCY_DECAY + (1 - RECENCY_DECAY) * (1 - Math.exp(-h / 8));
  });

  const remaining = new Set<number>();
  for (let i = 0; i < n; i++) if (i !== anchor) remaining.add(i);

  const order = [anchor];
  // Recent artist ring-buffer for cooldown checks
  const recentArtists: (string | undefined)[] = [tracks[anchor].artist];
  // Track consecutive genre runs
  let genreRun = 1;
  let lastGenre = tracks[anchor].genre;
  let last = tracks[anchor];

  while (remaining.size > 0) {
    const candidates = [...remaining];
    const weights = candidates.map((idx) => {
      const t = tracks[idx];
      let w = W_BASE;

      // --- Vibe affinity ---
      if (last.genre && t.genre && last.genre === t.genre) w += W_GENRE;
      if (last.category && t.category && last.category === t.category) w += W_CATEGORY;
      w += W_POPULAR * ((t.play_count || 0) / maxPlays);

      // --- Artist cooldown penalty ---
      // If this artist appeared in the last ARTIST_COOLDOWN slots, heavily penalize
      if (t.artist) {
        const cooldownWindow = recentArtists.slice(-ARTIST_COOLDOWN);
        if (cooldownWindow.includes(t.artist)) {
          w *= COOLDOWN_PENALTY;
        }
      }

      // --- Genre spread penalty ---
      // After GENRE_RUN_MAX consecutive tracks of the same genre, penalize
      // adding another of that genre to encourage variety
      if (genreRun >= GENRE_RUN_MAX && t.genre && t.genre === lastGenre) {
        w *= 0.2;
      }

      // --- Recency decay ---
      // Recently played tracks get lower weight so "forgotten" tracks surface
      w *= recencyFactor[idx];

      return Math.max(w, 0.001); // never fully zero
    });

    const pick = weightedPick(candidates, weights);
    order.push(pick);
    remaining.delete(pick);

    const picked = tracks[pick];
    recentArtists.push(picked.artist);
    // Keep the ring-buffer bounded
    if (recentArtists.length > ARTIST_COOLDOWN + 1) recentArtists.shift();

    // Track genre runs
    if (picked.genre && picked.genre === lastGenre) {
      genreRun++;
    } else {
      genreRun = 1;
      lastGenre = picked.genre;
    }
    last = picked;
  }
  return order;
}

interface PlayerContextType {
  tracks: Track[];
  currentTrackIndex: number;
  isPlaying: boolean;
  repeatMode: RepeatMode;
  shuffle: boolean;
  playTrack: (tracks: Track[], startIndex: number) => void;
  playNextTrack: (auto?: boolean) => void;
  playPrevTrack: () => void;
  setIsPlaying: (isPlaying: boolean) => void;
  setCurrentTrackIndex: (index: number) => void;
  toggleRepeat: () => void;
  toggleShuffle: () => void;
  showQueue: boolean;
  setShowQueue: React.Dispatch<React.SetStateAction<boolean>>;
  // Upcoming tracks in play order (after the current one). `index` is the index
  // into `tracks`, so a UI can jump straight there via setCurrentTrackIndex.
  upcoming: { track: Track; index: number }[];
  reorderUpcoming: (fromUpcomingIndex: number, toUpcomingIndex: number) => void;
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playOrder, setPlayOrder] = useState<number[]>([]);
  const [position, setPosition] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("off");
  const [shuffle, setShuffle] = useState(false);
  const [showQueue, setShowQueue] = useState(false);

  // The real index into `tracks` of the currently playing song.
  const currentTrackIndex = playOrder[position] ?? 0;

  // Upcoming tracks in the current play order (respects shuffle). Memoised:
  // a fresh array identity here would bust the context-value useMemo below on
  // every provider render, re-rendering all consumers for nothing.
  const upcoming = useMemo(
    () =>
      playOrder
        .slice(position + 1)
        .map((trackIdx) => ({ track: tracks[trackIdx], index: trackIdx }))
        .filter((u) => u.track),
    [playOrder, position, tracks]
  );

  // ── Restore the last session on reload ─────────────────────────────────────
  // Reads from the split keys first, then falls back to the legacy single key
  // for seamless migration. Old saves (pre-playOrder) are handled by
  // rebuilding an identity order and mapping the saved index.
  useEffect(() => {
    try {
      // Try split storage first
      const qRaw = localStorage.getItem(STORAGE_KEY_QUEUE);
      const sRaw = localStorage.getItem(STORAGE_KEY_STATE);
      // Fall back to legacy single-key format
      const legRaw = !qRaw ? localStorage.getItem(STORAGE_KEY_LEGACY) : null;

      const queue = qRaw ? JSON.parse(qRaw) : (legRaw ? JSON.parse(legRaw) : null);
      const state = sRaw ? JSON.parse(sRaw) : (legRaw ? JSON.parse(legRaw) : null);
      if (!queue || !Array.isArray(queue.tracks) || queue.tracks.length === 0) return;

      // A saved queue is a snapshot of what the database served at the time, so it
      // can still carry a year the server now filters out (see lib/trackYear) — it
      // would survive every reload until the user replaced the queue.
      const saved = (queue.tracks as Track[]).map(healTrackYear);
      const n = saved.length;

      const order =
        Array.isArray(queue.playOrder) && queue.playOrder.length === n
          ? queue.playOrder
          : identityOrder(n);

      let pos = 0;
      if (typeof (state?.position) === "number") {
        pos = state.position;
      } else if (typeof (state?.currentTrackIndex) === "number") {
        const mapped = order.indexOf(state.currentTrackIndex);
        pos = mapped >= 0 ? mapped : state.currentTrackIndex;
      }
      pos = Math.min(Math.max(0, pos), n - 1);

      // Heal queues saved before dedup shipped: if the restored list still holds
      // duplicates, clean it and rebuild a fresh order anchored on whatever was
      // playing, so the "up next" list doesn't show the same song repeatedly.
      const cleaned = dedupeTracks(saved);
      if (cleaned.length !== n) {
        const currentId = saved[order[pos]]?.id;
        const anchor = Math.max(0, currentId ? cleaned.findIndex((t) => t.id === currentId) : 0);
        const wasShuffled = state?.shuffle === true;
        setTracks(cleaned);
        if (wasShuffled) {
          setPlayOrder(buildVibeOrder(cleaned, anchor));
          setPosition(0);
        } else {
          setPlayOrder(identityOrder(cleaned.length));
          setPosition(anchor);
        }
        setHistory([]);
        if (state?.repeatMode) setRepeatMode(state.repeatMode);
        setShuffle(wasShuffled);
        if (typeof state?.isPlaying === "boolean") setIsPlaying(state.isPlaying);
        if (legRaw) { try { localStorage.removeItem(STORAGE_KEY_LEGACY); } catch {} }
        return;
      }

      setTracks(saved);
      setPlayOrder(order);
      setPosition(pos);

      if (Array.isArray(queue.history)) setHistory(queue.history);
      if (state?.repeatMode) setRepeatMode(state.repeatMode);
      if (typeof state?.shuffle === "boolean") setShuffle(state.shuffle);
      if (typeof state?.isPlaying === "boolean") setIsPlaying(state.isPlaying);

      // Clean up legacy key after successful migration
      if (legRaw) {
        try { localStorage.removeItem(STORAGE_KEY_LEGACY); } catch {}
      }
    } catch {}
  }, []);

  // ── Persist: lightweight state (written immediately) ──────────────────────
  // position/repeatMode/shuffle/isPlaying change often (every play/pause) but
  // serialize to a tiny payload (<100 bytes). No debounce needed.
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY_STATE,
        JSON.stringify({ position, repeatMode, shuffle, isPlaying })
      );
    } catch {}
  }, [position, repeatMode, shuffle, isPlaying]);

  // ── Persist: heavy queue data (debounced 2 s) ─────────────────────────────
  // tracks/playOrder/history are large arrays that change infrequently (only on
  // queue load / shuffle toggle / track end). Debouncing avoids the expensive
  // JSON.stringify of potentially hundreds of Track objects on every tick.
  const queueSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (tracks.length === 0) return;
    if (queueSaveTimer.current) clearTimeout(queueSaveTimer.current);
    queueSaveTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(
          STORAGE_KEY_QUEUE,
          JSON.stringify({ tracks, playOrder, history })
        );
      } catch {}
    }, 2000);
    return () => { if (queueSaveTimer.current) clearTimeout(queueSaveTimer.current); };
  }, [tracks, playOrder, history]);

  // ── Stable callbacks (useCallback) ─────────────────────────────────────────
  // Wrapping action handlers in useCallback prevents the useMemo'd context
  // value from busting on every render, which would cascade re-renders to
  // all 37+ consumer components.

  const playTrack = useCallback((newTracks: Track[], startIndex: number) => {
    // Drop duplicates before building the queue. Removal can shift indices (or
    // remove the very track the user clicked, if it was the duplicate), so remap
    // the requested start onto the deduped list by track id.
    const anchorId = newTracks[startIndex]?.id;
    const deduped = dedupeTracks(newTracks);
    let start = anchorId ? deduped.findIndex((t) => t.id === anchorId) : startIndex;
    if (start < 0) start = Math.min(startIndex, deduped.length - 1);
    start = Math.max(0, start);

    setTracks(deduped);
    if (shuffle) {
      setPlayOrder(buildVibeOrder(deduped, start));
      setPosition(0);
    } else {
      setPlayOrder(identityOrder(deduped.length));
      setPosition(start);
    }
    setHistory([]);
    setIsPlaying(true);
  }, [shuffle]);

  // `auto` = triggered by a track ending (vs the user clicking next). When a
  // track ends with repeat off and we're at the end of the order, playback
  // stops. (Repeat-one is handled in BottomPlayer and never reaches here.)
  const playNextTrack = useCallback((auto = false) => {
    if (tracks.length === 0) return;
    const atEnd = position >= playOrder.length - 1;
    if (atEnd) {
      if (auto && repeatMode === "off") {
        setIsPlaying(false);
        return;
      }
      if (shuffle) {
        const curIdx = playOrder[position] ?? 0;
        const fresh = buildVibeOrder(tracks, curIdx);
        setPlayOrder(fresh);
        setPosition(fresh.length > 1 ? 1 : 0);
      } else {
        setPosition(0);
      }
      setHistory((h) => [...h, position].slice(-HISTORY_LIMIT));
      setIsPlaying(true);
    } else {
      setHistory((h) => [...h, position].slice(-HISTORY_LIMIT));
      setPosition(position + 1);
      setIsPlaying(true);
    }
  }, [tracks, playOrder, position, repeatMode, shuffle]);

  const playPrevTrack = useCallback(() => {
    if (tracks.length === 0) return;
    if (history.length > 0) {
      const prevPos = history[history.length - 1];
      setPosition(prevPos);
      setHistory(history.slice(0, -1));
    } else {
      setPosition((position - 1 + playOrder.length) % playOrder.length);
    }
    setIsPlaying(true);
  }, [tracks, playOrder, position, history]);

  const toggleRepeat = useCallback(() => {
    setRepeatMode((prev) => (prev === "off" ? "all" : prev === "all" ? "one" : "off"));
  }, []);

  const toggleShuffle = useCallback(() => {
    const turningOn = !shuffle;
    if (turningOn) {
      const curIdx = playOrder[position] ?? 0;
      const newOrder = buildVibeOrder(tracks, curIdx);
      setPlayOrder(newOrder);
      setPosition(0);
    } else {
      const curIdx = playOrder[position] ?? 0;
      setPlayOrder(identityOrder(tracks.length));
      setPosition(curIdx);
    }
    setShuffle(turningOn);
    setHistory([]);
  }, [tracks, playOrder, position, shuffle]);

  // Kept for API compatibility: callers pass an index into `tracks`; we map it
  // onto the current play order.
  const setCurrentTrackIndex = useCallback((index: number) => {
    const pos = playOrder.indexOf(index);
    if (pos < 0) return;
    setHistory((h) => [...h, position].slice(-HISTORY_LIMIT));
    setPosition(pos);
  }, [playOrder, position]);

  const reorderUpcoming = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex < 0 || toIndex < 0) return;
    const pastAndCurrent = playOrder.slice(0, position + 1);
    const upcomingIds = playOrder.slice(position + 1);
    if (fromIndex >= upcomingIds.length || toIndex >= upcomingIds.length) return;
    const [moved] = upcomingIds.splice(fromIndex, 1);
    upcomingIds.splice(toIndex, 0, moved);
    setPlayOrder([...pastAndCurrent, ...upcomingIds]);
  }, [playOrder, position]);

  // ── Memoised context value ─────────────────────────────────────────────────
  // Without useMemo, every render of PlayerProvider creates a fresh object
  // reference, causing ALL 37+ consumer components to re-render even when
  // nothing they read actually changed. Functions are stable (useCallback)
  // so they don't bust the memo.
  const value = useMemo<PlayerContextType>(() => ({
    tracks,
    currentTrackIndex,
    isPlaying,
    repeatMode,
    shuffle,
    playTrack,
    playNextTrack,
    playPrevTrack,
    setIsPlaying,
    setCurrentTrackIndex,
    toggleRepeat,
    toggleShuffle,
    showQueue,
    setShowQueue,
    upcoming,
    reorderUpcoming,
  }), [
    tracks, currentTrackIndex, isPlaying, repeatMode, shuffle,
    playTrack, playNextTrack, playPrevTrack, setIsPlaying,
    setCurrentTrackIndex, toggleRepeat, toggleShuffle,
    showQueue, setShowQueue, upcoming, reorderUpcoming,
  ]);

  return (
    <PlayerContext.Provider value={value}>
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const context = useContext(PlayerContext);
  if (context === undefined) {
    throw new Error("usePlayer must be used within a PlayerProvider");
  }
  return context;
}
