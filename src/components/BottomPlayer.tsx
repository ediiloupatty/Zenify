"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import Link from "next/link";
import { Track } from "@/lib/cloudflare";
import { usePlayer } from "@/context/PlayerContext";
import { useToast } from "@/context/ToastContext";
import QueuePanel from "@/components/QueuePanel";
import { useCoverColor } from "@/lib/useCoverColor";
import CoverImage from "@/components/CoverImage";
import { cleanTitle } from "@/lib/cleanTitle";
import { isRenderingActive, onRenderingActiveChange } from "@/lib/renderGate";
import { formatAudioSpecs, describePlayback, isLosslessSource } from "@/lib/formatSpecs";
import { useStreamQuality, withQuality, type StreamQuality } from "@/lib/useStreamQuality";
import { saveDurationAction } from "@/app/admin/actions";
import { toggleFavoriteAction, getFavoriteIdsAction } from "@/app/actions/favorites";
import { addTrackToPlaylistAction } from "@/app/actions/playlists";

type ParsedLyric = { time: number; text: string };

// Crossfade overlap (seconds) between the outgoing and incoming track. Always on.
const CROSSFADE_SEC = 6;

// Sleep timer: "off", a number of minutes, or "end" (stop after the current track).
type SleepMode = "off" | "15" | "30" | "45" | "60" | "end";
const SLEEP_OPTIONS: { value: SleepMode; label: string }[] = [
  { value: "15", label: "15 minutes" },
  { value: "30", label: "30 minutes" },
  { value: "45", label: "45 minutes" },
  { value: "60", label: "1 hour" },
  { value: "end", label: "End of track" },
];

// Lift a dark cover colour so it stays legible as text/accent on the near-black
// fullscreen UI. Light/mid colours pass through unchanged; very dark ones are
// scaled up along their own hue, and a pure-black cover falls back to a neutral
// light grey (so the text never turns invisible against the dark background).
function readableAccent(r: number, g: number, b: number): { r: number; g: number; b: number } {
  const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
  const MIN = 150;
  if (brightness >= MIN) return { r, g, b };
  if (brightness <= 0) return { r: 203, g: 213, b: 225 }; // slate-300 for black covers
  const scale = MIN / brightness;
  return {
    r: Math.min(255, Math.round(r * scale)),
    g: Math.min(255, Math.round(g * scale)),
    b: Math.min(255, Math.round(b * scale)),
  };
}

function parseLrc(lrcText: string): ParsedLyric[] | null {
  const lines = lrcText.split('\n');
  const parsed: ParsedLyric[] = [];
  const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;

  for (const line of lines) {
    const match = timeRegex.exec(line);
    if (match) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const msStr = match[3];
      const ms = parseInt(msStr, 10) * (msStr.length === 2 ? 10 : 1);
      const time = minutes * 60 + seconds + ms / 1000;
      const text = line.replace(timeRegex, '').trim();
      if (text) {
        parsed.push({ time, text });
      }
    }
  }

  return parsed.length > 0 ? parsed : null;
}

// Estimate syllables by counting vowel groups. Works well for Indonesian (where
// each vowel group is roughly one syllable: "pe-lu-kan-ku" -> 4) and acceptably
// for English ("girl-friend" -> 2). Used to weight per-word sweep duration.
function countSyllables(word: string): number {
  const groups = word.toLowerCase().match(/[aeiouyà-ÿ]+/gi);
  return Math.max(1, groups ? groups.length : 1);
}

// â”€â”€â”€ Cover Art Generator (same logic as MainTracksContainer) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  return Math.abs(hash);
}

const COVER_PALETTES = [
  { from: "#6366f1", to: "#8b5cf6", mid: "#7c3aed" },
  { from: "#14b8a6", to: "#06b6d4", mid: "#0891b2" },
  { from: "#f43f5e", to: "#ec4899", mid: "#db2777" },
  { from: "#f59e0b", to: "#f97316", mid: "#ea580c" },
  { from: "#10b981", to: "#059669", mid: "#047857" },
  { from: "#3b82f6", to: "#6366f1", mid: "#4f46e5" },
  { from: "#a855f7", to: "#ec4899", mid: "#c026d3" },
  { from: "#06b6d4", to: "#3b82f6", mid: "#2563eb" },
  { from: "#84cc16", to: "#10b981", mid: "#16a34a" },
  { from: "#f97316", to: "#ef4444", mid: "#dc2626" },
];

const MUSIC_ICON_PATHS = [
  "M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z",
  "M12 1c-4.97 0-9 4.03-9 9v7c0 1.66 1.34 3 3 3h3v-8H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-4v8h3c1.66 0 3-1.34 3-3v-7c0-4.97-4.03-9-9-9z",
  "M10 20h4V4h-4v16zm-6 0h4v-8H4v8zM16 9v11h4V9h-4z",
  "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z",
  "M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z",
];

function LargeCoverArt({ title, category, coverUrl, size = "lg" }: { title: string; category: string; coverUrl?: string; size?: "sm" | "lg" }) {
  if (coverUrl) {
    return <CoverImage src={coverUrl} alt={title} className="drop-shadow-2xl" />;
  }

  const palIdx = hashString(title + category) % COVER_PALETTES.length;
  const iconIdx = hashString(title) % MUSIC_ICON_PATHS.length;
  const palette = COVER_PALETTES[palIdx];
  const iconPath = MUSIC_ICON_PATHS[iconIdx];
  const iconSize = size === "lg" ? 80 : 28;

  return (
    <div
      className="w-full h-full relative flex items-center justify-center overflow-hidden"
      style={{
        background: `radial-gradient(ellipse at 30% 30%, ${palette.from}, ${palette.mid} 50%, ${palette.to})`,
      }}
    >
      {/* decorative circles */}
      <div className="absolute -top-8 -right-8 w-40 h-40 rounded-full opacity-20" style={{ background: palette.from, filter: "blur(30px)" }} />
      <div className="absolute -bottom-8 -left-8 w-32 h-32 rounded-full opacity-15" style={{ background: palette.to, filter: "blur(25px)" }} />
      {/* vinyl ring */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-3/4 h-3/4 rounded-full border border-white/10 opacity-40" />
        <div className="absolute w-1/2 h-1/2 rounded-full border border-white/8 opacity-30" />
      </div>
      <svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 24 24"
        fill="white"
        className="relative z-10 drop-shadow-2xl opacity-85"
      >
        <path d={iconPath} />
      </svg>
    </div>
  );
}

// ─── Fullscreen track actions: Like / Add to playlist / More ───────────────
// Rendered twice (desktop left column + mobile meta block); each instance owns
// its menus, while the liked state is lifted to BottomPlayer so both hearts
// stay in sync.
type PlaylistOption = { id: string; name: string };

function TrackActions({
  track,
  liked,
  onToggleLike,
  accentFill,
  iconSize,
  gapClass,
  onNavigate,
}: {
  track: Track;
  liked: boolean;
  onToggleLike: () => void;
  accentFill: string;
  iconSize: number;
  gapClass: string;
  onNavigate: () => void; // closes the fullscreen player before a nav away
}) {
  const { showToast } = useToast();
  const [openMenu, setOpenMenu] = useState<"playlist" | "more" | null>(null);
  const [playlists, setPlaylists] = useState<PlaylistOption[] | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close whichever menu is open on an outside click.
  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [openMenu]);

  const togglePlaylistMenu = () => {
    setOpenMenu((m) => (m === "playlist" ? null : "playlist"));
    if (playlists === null) {
      fetch("/api/playlists")
        .then((r) => r.json())
        .then((d) =>
          setPlaylists(
            (d.playlists || []).map((p: { id: string; name: string }) => ({ id: p.id, name: p.name }))
          )
        )
        .catch(() => setPlaylists([]));
    }
  };

  const addToPlaylist = async (pl: PlaylistOption) => {
    setAddingId(pl.id);
    const result = await addTrackToPlaylistAction(pl.id, track.id);
    setAddingId(null);
    setOpenMenu(null);
    if (result.success) showToast(`Added to "${pl.name}"`, "success");
    else showToast(result.error || "Couldn't add to playlist", "error");
  };

  const copyLink = async () => {
    setOpenMenu(null);
    const url = `${window.location.origin}/player?play=${encodeURIComponent(track.id)}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast("Link copied to clipboard", "success");
    } catch {
      showToast("Couldn't copy link", "error");
    }
  };

  const menuClass =
    "absolute bottom-full left-0 mb-3 w-56 rounded-xl border p-1.5 shadow-[0_20px_60px_rgba(0,0,0,0.7)] z-50";
  const menuStyle = { background: "var(--bg-secondary)", borderColor: "var(--border-card)" };
  const itemClass =
    "w-full text-left px-2.5 py-1.5 rounded-lg text-sm transition-colors hover:bg-[var(--bg-card-hover)]";

  return (
    <div ref={rootRef} className={`relative flex items-center ${gapClass}`} onClick={(e) => e.stopPropagation()}>
      {/* Like — wired to the favorites system */}
      <button
        onClick={onToggleLike}
        className="transition-all active:scale-90 hover:scale-110"
        style={{ color: liked ? accentFill : "#94a3b8" }}
        aria-pressed={liked}
        title={liked ? "Remove from favorites" : "Add to favorites"}
      >
        <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
      </button>

      {/* Add to playlist */}
      <button
        onClick={togglePlaylistMenu}
        className="text-slate-300 hover:text-white transition-all active:scale-90 hover:scale-110"
        aria-pressed={openMenu === "playlist"}
        title="Add to playlist"
      >
        <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
      </button>

      {/* More */}
      <button
        onClick={() => setOpenMenu((m) => (m === "more" ? null : "more"))}
        className="text-slate-300 hover:text-white transition-all active:scale-90 hover:scale-110"
        aria-pressed={openMenu === "more"}
        title="More"
      >
        <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="currentColor"><path d="M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
      </button>

      {openMenu === "playlist" && (
        <div className={menuClass} style={menuStyle}>
          <p className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            Add to playlist
          </p>
          {playlists === null ? (
            <p className="px-2.5 py-2 text-sm" style={{ color: "var(--text-muted)" }}>Loading…</p>
          ) : playlists.length === 0 ? (
            <p className="px-2.5 py-2 text-sm" style={{ color: "var(--text-muted)" }}>No playlists yet</p>
          ) : (
            <div className="max-h-56 overflow-y-auto">
              {playlists.map((pl) => (
                <button
                  key={pl.id}
                  onClick={() => addToPlaylist(pl)}
                  disabled={addingId === pl.id}
                  className={`${itemClass} disabled:opacity-50`}
                  style={{ color: "var(--text-primary)" }}
                >
                  {pl.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {openMenu === "more" && (
        <div className={menuClass} style={menuStyle}>
          <button onClick={copyLink} className={itemClass} style={{ color: "var(--text-primary)" }}>
            Copy link
          </button>
          {track.album && (
            <Link
              href={`/album/${encodeURIComponent(track.album)}`}
              onClick={() => { setOpenMenu(null); onNavigate(); }}
              className={`${itemClass} block`}
              style={{ color: "var(--text-primary)" }}
            >
              Go to album
            </Link>
          )}
          {track.artist && (
            <Link
              href={`/artist/${encodeURIComponent(track.artist)}`}
              onClick={() => { setOpenMenu(null); onNavigate(); }}
              className={`${itemClass} block`}
              style={{ color: "var(--text-primary)" }}
            >
              Go to artist
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

// The hi-res badge in the fullscreen player, now clickable: tapping it opens a
// small popover to switch streaming quality (Lossless / 320 / 128 kbps) without
// leaving the player. Mirrors the Settings > Playback control.
function QualityBadgePicker({
  track,
  quality,
  onChange,
}: {
  track: Track;
  quality: StreamQuality;
  onChange: (q: StreamQuality) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const playing = describePlayback(track, quality);
  const source = formatAudioSpecs(track, "lossless");
  const lossless = isLosslessSource(track);

  const options: { value: StreamQuality; title: string; desc: string }[] = [
    {
      value: "lossless",
      // The original file is only "lossless" if it actually is one — an MP3 or
      // AAC upload streams as-is, and calling that lossless would be a lie.
      title: lossless ? "Lossless" : "Original",
      desc: source ? `Original · ${source}` : "Original file",
    },
    { value: "320", title: "High", desc: "MP3 320 kbps · much lighter" },
    { value: "128", title: "Data Saver", desc: "MP3 128 kbps · smoothest on slow networks" },
  ];

  // Nothing verifiable to show, and no transcode selected — hide the badge
  // rather than invent numbers.
  if (!playing) return null;

  return (
    <div ref={ref} className="relative w-fit my-2">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Streaming quality"
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center rounded-md overflow-hidden shadow-md transition-transform hover:scale-105 active:scale-95 cursor-pointer"
      >
        <span className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-black tracking-wider text-white" style={{ background: "#0d9488" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M11 3v18h2V3h-2zM7 7v10h2V7H7zm8 2v6h2V9h-2zM3 10v4h2v-4H3zm16 1v2h2v-2h-2z"/></svg>
          <span>{playing.left}</span>
        </span>
        <span className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-black tracking-wider text-white" style={{ background: "#4338ca" }}>
          {playing.right}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className={`transition-transform ${open ? "rotate-180" : ""}`}>
            <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" />
          </svg>
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 lg:left-1/2 lg:-translate-x-1/2 top-full mt-3 z-[80] w-64 rounded-2xl p-2 shadow-[0_30px_60px_rgba(0,0,0,0.6)] backdrop-blur-2xl animate-in fade-in slide-in-from-top-2 duration-200"
          style={{ background: "rgba(15,23,42,0.6)", border: "1px solid rgba(255,255,255,0.1)" }}
        >
          {options.map((opt) => {
            const active = quality === opt.value;
            return (
              <button
                key={opt.value}
                role="option"
                aria-selected={active}
                onClick={() => { onChange(opt.value); setOpen(false); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-200 hover:bg-white/10 active:scale-95 ${active ? "bg-white/5" : ""}`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold" style={{ color: active ? "var(--accent, #2dd4bf)" : "#fff" }}>
                    {opt.title}
                  </p>
                  <p className="text-[11px] text-slate-400 font-medium">{opt.desc}</p>
                </div>
                {active && (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent, #2dd4bf)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="drop-shadow-md">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                )}
              </button>
            );
          })}
          <div className="mx-2 mt-2 mb-1 pt-2 border-t border-white/10">
            <p className="text-[10px] text-slate-400/80 font-medium text-center">
              Changing quality restarts the current song
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BottomPlayer() {
  const {
    tracks,
    currentTrackIndex,
    isPlaying,
    setIsPlaying,
    playNextTrack,
    playPrevTrack,
    repeatMode,
    shuffle,
    toggleRepeat,
    toggleShuffle,
    showQueue,
    setShowQueue,
    upcoming,
  } = usePlayer();

  const { showToast } = useToast();

  const [isExpanded, setIsExpanded] = useState(false);
  const [desktopOffset, setDesktopOffset] = useState(0);
  useEffect(() => {
    if ((window as { __ZENIFY_DESKTOP__?: boolean }).__ZENIFY_DESKTOP__) setDesktopOffset(32);
  }, []);
  // Volume persists across reloads/sessions. Lazy initialiser reads the saved
  // level (guarded for SSR where localStorage is unavailable).
  const [volume, setVolume] = useState<number>(() => {
    if (typeof window === "undefined") return 0.8;
    const saved = parseFloat(window.localStorage.getItem("player_volume") || "");
    return Number.isFinite(saved) ? Math.min(1, Math.max(0, saved)) : 0.8;
  });
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [activeTab, setActiveTab] = useState<"player" | "lyrics">("player");
  const [lyricsOffset, setLyricsOffset] = useState(0);
  const lyricsOffsetRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null); // output volume, AFTER the analyser
  
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const currentTrack = tracks && tracks.length > 0 ? (tracks[currentTrackIndex] || tracks[0]) : null;

  // Dominant colour of the current cover — used to tint the fullscreen player.
  const coverColor = useCoverColor(currentTrack?.cover_url);

  // ── Favorites (the fullscreen Like heart) ──────────────────────────────────
  // Fetched once; toggles are optimistic with revert on failure, mirroring
  // HeartButton. Derived from the current track so the heart follows the song.
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const favLoggedInRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    getFavoriteIdsAction()
      .then(({ loggedIn, ids }) => {
        if (cancelled) return;
        favLoggedInRef.current = loggedIn;
        setFavoriteIds(new Set(ids));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const liked = currentTrack ? favoriteIds.has(currentTrack.id) : false;

  const toggleLike = async () => {
    if (!currentTrack) return;
    if (!favLoggedInRef.current) {
      showToast("Sign in to save favorites", "error");
      return;
    }
    const id = currentTrack.id;
    const wasLiked = favoriteIds.has(id);
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (wasLiked) next.delete(id); else next.add(id);
      return next;
    });
    const result = await toggleFavoriteAction(id, wasLiked);
    if (result.success) {
      showToast(wasLiked ? "Removed from favorites" : "Added to favorites");
    } else {
      setFavoriteIds((prev) => {
        const next = new Set(prev);
        if (wasLiked) next.add(id); else next.delete(id);
        return next;
      });
      showToast(result.error || "Couldn't update favorites", "error");
    }
  };

  const [externalLyrics, setExternalLyrics] = useState<string | null>(null);
  const [isFetchingLyrics, setIsFetchingLyrics] = useState(false);

  useEffect(() => {
    setExternalLyrics(null);
    setIsFetchingLyrics(false);

    if (!currentTrack) return;

    const hasTimestamps = currentTrack.lyrics && /\[\d{2}:\d{2}\.\d{2,3}\]/.test(currentTrack.lyrics);
    if (hasTimestamps) return;

    const cleanedTitle = cleanTitle(currentTrack.title);
    if (!cleanedTitle) return;

    // AbortController cancels in-flight request if track changes before it resolves
    const controller = new AbortController();
    setIsFetchingLyrics(true);

    // Pass the track duration so the API can match the correct version on
    // lrclib (and reject wrong-song search hits of a different length).
    const dur = Math.round(currentTrack.duration || audioRef.current?.duration || 0);
    const url = `/api/lyrics?id=${encodeURIComponent(currentTrack.id)}&artist=${encodeURIComponent(currentTrack.artist || '')}&title=${encodeURIComponent(cleanedTitle)}&q=${encodeURIComponent(`${currentTrack.artist || ''} ${cleanedTitle}`.trim())}${dur > 0 ? `&duration=${dur}` : ''}&t=${Date.now()}`;

    fetch(url, { signal: controller.signal })
      .then(res => res.json())
      .then(data => { if (data.syncedLyrics) setExternalLyrics(data.syncedLyrics); })
      .catch(err => { if (err.name !== 'AbortError') console.error("Failed to fetch synced lyrics", err); })
      .finally(() => setIsFetchingLyrics(false));

    return () => controller.abort();
  }, [currentTrack?.id, currentTrack?.title, currentTrack?.artist, currentTrack?.lyrics]);

  // ── Sleep timer ────────────────────────────────────────────────────────────
  const [sleepMode, setSleepMode] = useState<SleepMode>("off");
  const [sleepLeftMs, setSleepLeftMs] = useState<number | null>(null);
  const [showSleepMenu, setShowSleepMenu] = useState(false);
  const sleepMenuRef = useRef<HTMLDivElement>(null);
  // The "end of track" case is read inside handleEnded, so keep it in a ref to
  // avoid re-binding the audio element's onEnded handler when the mode changes.
  const sleepEndOfTrackRef = useRef(false);

  // Pick a sleep option. Seeding the remaining-time here (an event handler,
  // where setState is allowed) keeps the countdown effect free of a synchronous
  // setState in its body.
  const chooseSleep = (value: SleepMode) => {
    const mins = Number(value);
    setSleepMode(value);
    setSleepLeftMs(mins ? mins * 60_000 : null);
    setShowSleepMenu(false);
  };

  // Minute-based countdown: tick every second, pause playback when it hits zero.
  useEffect(() => {
    sleepEndOfTrackRef.current = sleepMode === "end";
    const mins = Number(sleepMode); // "off"/"end" → NaN → falsy → no countdown
    if (!mins) return;
    const deadline = Date.now() + mins * 60_000;
    const id = setInterval(() => {
      const left = deadline - Date.now();
      if (left <= 0) {
        clearInterval(id);
        setSleepLeftMs(null);
        setSleepMode("off");
        audioRef.current?.pause();
        setIsPlaying(false);
        showToast("Sleep timer ended — playback paused", "info");
      } else {
        setSleepLeftMs(left);
      }
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sleepMode]);

  // Close the sleep menu on an outside click.
  useEffect(() => {
    if (!showSleepMenu) return;
    const onDown = (e: MouseEvent) => {
      if (sleepMenuRef.current && !sleepMenuRef.current.contains(e.target as Node)) {
        setShowSleepMenu(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showSleepMenu]);

  // ── Share: copy a deep link that auto-plays this track (?play=<id>) ─────────
  const shareTrack = async () => {
    if (!currentTrack) return;
    const url = `${window.location.origin}/player?play=${encodeURIComponent(currentTrack.id)}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast("Link copied to clipboard", "success");
    } catch {
      showToast("Couldn't copy link", "error");
    }
  };

  // ── Crossfade ───────────────────────────────────────────────────────────────
  // The primary element (audioRef) always holds the CURRENT track, so lyrics /
  // visualizer / MediaSession follow the incoming song for free. The outgoing
  // track's tail is handed to a plain secondary element (tailRef) and faded out
  // via its own .volume, while the incoming track fades IN through the Web Audio
  // gain node — giving a real overlap without rewiring the single-source graph.
  const tailRef = useRef<HTMLAudioElement>(null);
  const crossfadingRef = useRef(false);   // guards against re-triggering mid-fade
  const fadeInPendingRef = useRef(false);  // incoming track should ramp up on play
  // Fade intervals are kept in refs so pausing (or unmounting) mid-crossfade can
  // cancel them — otherwise the outgoing tail keeps playing for up to
  // CROSSFADE_SEC seconds after the user hit pause.
  const tailFadeIdRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const primaryFadeIdRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Safety timer: if a crossfade's incoming track never emits 'playing' (slow
  // buffering, autoplay throttled while backgrounded), the fade-in never runs
  // and the output gain would stay stuck near zero — the track appears to play
  // but is silent. This restores full volume if that happens.
  const crossfadeSafetyRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // While a crossfade is audible, the compact bottom bar keeps showing the
  // OUTGOING track so the title/cover don't visibly jump ahead of the audio.
  const [crossfadePrevTrack, setCrossfadePrevTrack] = useState<Track | null>(null);
  const crossfadeUiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Linearly ramp a plain element's volume from→to over `seconds`, then onDone.
  // Returns the interval id so callers can cancel the ramp early.
  const fadeElementVolume = (
    el: HTMLAudioElement,
    from: number,
    to: number,
    seconds: number,
    onDone?: () => void,
  ): ReturnType<typeof setInterval> => {
    const steps = Math.max(1, Math.round(seconds * 30));
    let i = 0;
    const id = setInterval(() => {
      i++;
      el.volume = Math.min(1, Math.max(0, from + (to - from) * (i / steps)));
      if (i >= steps) { clearInterval(id); onDone?.(); }
    }, (seconds * 1000) / steps);
    return id;
  };

  // Force the output gain straight back to the current volume, cancelling any
  // in-flight crossfade ramp. The safety net that guarantees playback is never
  // left silent by a crossfade that didn't finish its fade-in.
  const restoreGainNow = () => {
    const ctx = audioContextRef.current;
    const g = gainNodeRef.current;
    if (g && ctx) {
      g.gain.cancelScheduledValues(ctx.currentTime);
      g.gain.setValueAtTime(volume, ctx.currentTime);
    } else if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  };

  // Abort the audible half of a crossfade: silence the outgoing tail, cancel its
  // fade, and release the compact bar back to the live current track. Called on
  // pause and on unmount so nothing keeps playing behind a paused UI.
  const stopCrossfadeTail = () => {
    if (tailFadeIdRef.current) { clearInterval(tailFadeIdRef.current); tailFadeIdRef.current = null; }
    const tail = tailRef.current;
    if (tail && !tail.paused) { try { tail.pause(); } catch {} }
    if (crossfadeUiTimerRef.current) { clearTimeout(crossfadeUiTimerRef.current); crossfadeUiTimerRef.current = null; }
    setCrossfadePrevTrack(null);
  };

  const startCrossfade = () => {
    const audio = audioRef.current;
    const tail = tailRef.current;
    if (!audio || !tail) return;
    crossfadingRef.current = true;
    fadeInPendingRef.current = true;

    // Hold the compact bar on the outgoing track for the overlap, then release
    // it to the (by then dominant) incoming track.
    setCrossfadePrevTrack(currentTrack);
    if (crossfadeUiTimerRef.current) clearTimeout(crossfadeUiTimerRef.current);
    crossfadeUiTimerRef.current = setTimeout(
      () => setCrossfadePrevTrack(null),
      CROSSFADE_SEC * 1000,
    );

    // Outgoing tail → secondary element, fading out via element volume.
    try {
      tail.src = audio.currentSrc || audio.src;
      tail.currentTime = audio.currentTime;
      tail.volume = volume;
      tail.play().catch(() => {});
      if (tailFadeIdRef.current) clearInterval(tailFadeIdRef.current);
      tailFadeIdRef.current = fadeElementVolume(tail, volume, 0, CROSSFADE_SEC, () => {
        tailFadeIdRef.current = null;
        try { tail.pause(); } catch {}
      });
    } catch {}

    // Pre-silence the primary; the incoming ramp begins on its 'playing' event
    // (handlePlaying) so the fade-in lines up with where the audio actually starts.
    const ctx = audioContextRef.current;
    if (gainNodeRef.current && ctx) {
      gainNodeRef.current.gain.cancelScheduledValues(ctx.currentTime);
      gainNodeRef.current.gain.setValueAtTime(0.0001, ctx.currentTime);
    } else {
      audio.volume = 0;
    }

    // If 'playing' hasn't fired within a short grace period, the fade-in never
    // started — un-silence so the track isn't stuck quiet. (handlePlaying clears
    // this the moment the real fade-in begins.)
    if (crossfadeSafetyRef.current) clearTimeout(crossfadeSafetyRef.current);
    crossfadeSafetyRef.current = setTimeout(() => {
      crossfadeSafetyRef.current = null;
      if (fadeInPendingRef.current) {
        fadeInPendingRef.current = false;
        restoreGainNow();
      }
    }, 2500);

    playNextTrack();
  };

  // Fired when the (new) primary track actually begins playing. If we're mid
  // crossfade, ramp it up from silence; otherwise leave normal playback alone.
  const handlePlaying = () => {
    if (!fadeInPendingRef.current) return;
    fadeInPendingRef.current = false;
    // The real fade-in is starting — the stuck-silent safety net is no longer needed.
    if (crossfadeSafetyRef.current) { clearTimeout(crossfadeSafetyRef.current); crossfadeSafetyRef.current = null; }
    const ctx = audioContextRef.current;
    const audio = audioRef.current;
    if (gainNodeRef.current && ctx) {
      const g = gainNodeRef.current.gain;
      const t0 = ctx.currentTime;
      g.cancelScheduledValues(t0);
      g.setValueAtTime(0.0001, t0);
      g.linearRampToValueAtTime(Math.max(0.0001, volume), t0 + CROSSFADE_SEC);
    } else if (audio) {
      audio.volume = 0;
      if (primaryFadeIdRef.current) clearInterval(primaryFadeIdRef.current);
      primaryFadeIdRef.current = fadeElementVolume(audio, 0, volume, CROSSFADE_SEC, () => {
        primaryFadeIdRef.current = null;
      });
    }
  };

  const parsedLyrics = useMemo(() => {
    const sourceLyrics = externalLyrics || currentTrack?.lyrics;
    if (!sourceLyrics) return null;
    return parseLrc(sourceLyrics);
  }, [externalLyrics, currentTrack?.lyrics]);

  // Driven by RAF (not timeupdate) for zero-latency sync
  const [activeLyricIndex, setActiveLyricIndex] = useState(-1);

  const lyricsContainerRef = useRef<HTMLDivElement>(null);
  const parsedLyricsRef    = useRef<ParsedLyric[] | null>(null);
  parsedLyricsRef.current  = parsedLyrics;
  const activeLyricIndexRef = useRef(-1);
  const activeLineElRef     = useRef<HTMLElement | null>(null);

  // Load per-track offset from localStorage when track changes
  useEffect(() => {
    if (!currentTrack?.id) return;
    const saved = parseFloat(localStorage.getItem(`lyrics_offset_${currentTrack.id}`) || "0");
    lyricsOffsetRef.current = saved;
    setLyricsOffset(saved);
  }, [currentTrack?.id]);

  function adjustOffset(delta: number) {
    const next = Math.round((lyricsOffsetRef.current + delta) * 10) / 10;
    lyricsOffsetRef.current = next;
    setLyricsOffset(next);
    if (currentTrack?.id) {
      if (next === 0) localStorage.removeItem(`lyrics_offset_${currentTrack.id}`);
      else localStorage.setItem(`lyrics_offset_${currentTrack.id}`, String(next));
    }
  }

  // Single RAF loop: computes active lyric index + sweep from audio.currentTime directly.
  // Backs off to a 500 ms poll when audio is paused or the tab is hidden to avoid
  // spinning at 60 fps while nothing is moving, which wastes CPU / battery.
  const isPlayingRef = useRef(isPlaying);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  useEffect(() => {
    let rafId: number;
    let backoffId: ReturnType<typeof setTimeout> | null = null;
    let active = true;

    const scheduleNext = (audio: HTMLAudioElement | null) => {
      if (!active) return;
      // Back off to 500 ms when paused, the tab is hidden, or the browser window
      // has lost focus (e.g. a game is in front) — no point sweeping lyrics the
      // user can't see, and it frees the GPU/CPU for whatever's in front.
      if (!audio || audio.paused || !isRenderingActive()) {
        backoffId = setTimeout(() => {
          backoffId = null;
          if (active) rafId = requestAnimationFrame(tick);
        }, 500);
      } else {
        rafId = requestAnimationFrame(tick);
      }
    };

    const tick = () => {
      const lyrics    = parsedLyricsRef.current;
      const container = lyricsContainerRef.current;
      const audio     = audioRef.current;

      if (lyrics && audio && !audio.paused && isRenderingActive()) {
        // Compensate for audio output latency: the sound the user HEARS right now
        // corresponds to playback position (currentTime - outputLatency), since the
        // buffer at currentTime hasn't reached the speakers yet. This auto-corrects
        // the systematic "lyrics ahead of audio" drift on most devices.
        const ctx = audioContextRef.current;
        const outputLatency = ctx ? (ctx.outputLatency || ctx.baseLatency || 0) : 0;
        const t = audio.currentTime - outputLatency + lyricsOffsetRef.current;

        // Active index â€” computed every frame, no timeupdate delay
        let newIdx = -1;
        for (let i = lyrics.length - 1; i >= 0; i--) {
          if (t >= lyrics[i].time) { newIdx = i; break; }
        }
        if (newIdx !== activeLyricIndexRef.current) {
          activeLyricIndexRef.current = newIdx;
          activeLineElRef.current = null; // cleared; useEffect sets it after React commits
          setActiveLyricIndex(newIdx);
        }

        // Sweep + per-word scale, weighted by syllables with held-note absorption
        if (container && newIdx >= 0) {
          const lineEl = activeLineElRef.current;
          const wordSpans = lineEl?.querySelectorAll<HTMLElement>("[data-wi]");

          const lineStart = lyrics[newIdx].time;
          const rawEnd    = lyrics[newIdx + 1]?.time ?? (lineStart + 5);
          const lineGap   = Math.max(0.001, rawEnd - lineStart);

          if (lineEl && wordSpans && wordSpans.length > 0) {
            const n = wordSpans.length;

            // Per-word duration weighted by syllable count: fast monosyllables get
            // little time, multi-syllable words ("pe-lu-kan-ku") get proportionally
            // more, so the sweep speed tracks how the line is actually sung.
            const SECS_PER_SYL = 0.26;
            const HELD_NOTE_MAX = 2.6;
            const dur = new Array<number>(n);
            let sumBase = 0;
            for (let i = 0; i < n; i++) {
              const syl = parseInt(wordSpans[i].dataset.syl || "1") || 1;
              dur[i] = syl * SECS_PER_SYL;
              sumBase += dur[i];
            }

            let totalDur: number;
            if (sumBase > lineGap) {
              // Estimated singing is slower than the available gap: compress to fit
              // (keeps words proportional, just faster overall).
              const k = lineGap / sumBase;
              for (let i = 0; i < n; i++) dur[i] *= k;
              totalDur = lineGap;
            } else {
              // Time left over after singing => the last word is most likely a held
              // note. Absorb the surplus (capped) so a sustained final word sweeps
              // slowly to match the vocal, instead of finishing early.
              const surplus = Math.min(lineGap - sumBase, HELD_NOTE_MAX);
              dur[n - 1] += surplus;
              totalDur = sumBase + surplus;
            }

            const p = Math.min(1, Math.max(0, (t - lineStart) / totalDur));
            container.style.setProperty("--sweep", `${(p * 100).toFixed(2)}%`);

            // Walk cumulative duration fractions to find each word's coverage
            let acc = 0;
            for (let i = 0; i < n; i++) {
              const wStart = acc / totalDur;
              acc += dur[i];
              const wEnd = acc / totalDur;
              const wordCov = Math.min(1, Math.max(0, (p - wStart) / Math.max(0.0001, wEnd - wStart)));
              const s = wordSpans[i];

              let scale: number;
              if (wordCov >= 1) {
                // Fully sung - plain white
                s.style.color = "white";
                s.style.removeProperty("background-image");
                s.style.removeProperty("-webkit-background-clip");
                s.style.removeProperty("background-clip");
                s.style.removeProperty("-webkit-text-fill-color");
                scale = 1.04;
              } else if (wordCov > 0) {
                // Currently being swept - gradient only on this word
                const pct = (wordCov * 100).toFixed(2);
                s.style.backgroundImage = `linear-gradient(to right, white ${pct}%, rgba(255,255,255,0.28) ${pct}%)`;
                s.style.setProperty("-webkit-background-clip", "text");
                s.style.setProperty("background-clip", "text");
                s.style.setProperty("-webkit-text-fill-color", "transparent");
                s.style.removeProperty("color");
                scale = 1 + 0.07 * Math.sin(wordCov * Math.PI) + 0.04 * wordCov;
              } else {
                // Not yet reached - dim
                s.style.color = "rgba(255,255,255,0.28)";
                s.style.removeProperty("background-image");
                s.style.removeProperty("-webkit-background-clip");
                s.style.removeProperty("background-clip");
                s.style.removeProperty("-webkit-text-fill-color");
                scale = 1;
              }
              s.style.transform = `scale(${scale.toFixed(4)})`;
            }
          } else {
            // Word spans not committed yet - keep the container sweep moving
            const p = Math.min(1, Math.max(0, (t - lineStart) / lineGap));
            container.style.setProperty("--sweep", `${(p * 100).toFixed(2)}%`);
          }
        } else if (container) {
          container.style.setProperty("--sweep", "0%");
        }
      }

      scheduleNext(audioRef.current);
    };

    // When the tab becomes visible / the window regains focus, kick the loop back
    // to full rate — but only if it was parked in a backoff poll, to avoid
    // scheduling a duplicate RAF on top of an already-running one.
    const stopGate = onRenderingActiveChange(() => {
      if (isRenderingActive() && active && backoffId !== null) {
        clearTimeout(backoffId); backoffId = null;
        rafId = requestAnimationFrame(tick);
      }
    });

    rafId = requestAnimationFrame(tick);
    return () => {
      active = false;
      cancelAnimationFrame(rafId);
      if (backoffId !== null) clearTimeout(backoffId);
      stopGate();
    };
  }, []);

  useEffect(() => {
    const container = lyricsContainerRef.current;
    if (!container) return;

    if (activeLyricIndex === -1) {
      activeLineElRef.current = null;
      return;
    }

    // DOM is committed — safe to find the real active word spans element
    activeLineElRef.current = container.querySelector<HTMLElement>("[data-active-line-words]");

    if (isExpanded) {
      const activeElement = container.querySelector(`[data-index="${activeLyricIndex}"]`) as HTMLElement;
      if (activeElement) {
        container.scrollTo({
          top: activeElement.offsetTop - container.clientHeight / 2 + activeElement.clientHeight / 2,
          behavior: 'smooth'
        });
      }
    }
  }, [activeLyricIndex, isExpanded]);


  const initAudioContext = () => {
    if (!audioContextRef.current && audioRef.current) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      
      const ctx = new AudioContextClass();
      audioContextRef.current = ctx;
      
      const analyser = ctx.createAnalyser();
      // Restore fftSize 256 (128 frequency bins) for rich, dense, high-fidelity visualizer bars
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.82;
      analyserRef.current = analyser;

      // Chain: source -> analyser -> gain -> speakers.
      // The analyser taps the signal BEFORE the volume gain, so the visualizer
      // reflects the music itself and stays dynamic no matter how loud the user
      // sets the volume (instead of flat-lining when volume is high).
      const gain = ctx.createGain();
      gain.gain.value = volume;
      gainNodeRef.current = gain;

      const source = ctx.createMediaElementSource(audioRef.current);
      sourceRef.current = source;
      source.connect(analyser);
      analyser.connect(gain);
      gain.connect(ctx.destination);

      // The element now runs at full level; the gain node controls loudness.
      audioRef.current.volume = 1;
    }
    
    if (audioContextRef.current?.state === "suspended") {
      audioContextRef.current.resume();
    }
  };

  const togglePlay = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!audioRef.current) return;
    initAudioContext();
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      // Taking manual control voids any half-finished crossfade: clear its flags
      // and force full volume so pressing play is NEVER silent (otherwise a
      // crossfade whose fade-in never ran leaves the gain node stuck near zero).
      fadeInPendingRef.current = false;
      crossfadingRef.current = false;
      if (crossfadeSafetyRef.current) { clearTimeout(crossfadeSafetyRef.current); crossfadeSafetyRef.current = null; }
      restoreGainNow();
      audioRef.current.play().catch(() => {});
    }
    setIsPlaying(!isPlaying);
  };

  // Standard player behavior: if the track has played for a few seconds,
  // Previous restarts it; only a quick second press goes to the previous track.
  const handlePrev = () => {
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    playPrevTrack();
  };

  // When the window becomes visible/focused again, snap the progress bar and
  // duration back to the live audio position in one shot — handleTimeUpdate
  // skips these setstates while the window is unwatched, so without this the
  // bar would be stale until the next timeupdate tick.
  useEffect(() => {
    const stop = onRenderingActiveChange(() => {
      if (isRenderingActive() && audioRef.current) {
        setProgress(audioRef.current.currentTime);
        setDuration(audioRef.current.duration || 0);
      }
    });
    return stop;
  }, []);

  // Throttled persistence of the playback position so a reload / page change can
  // resume from where the user left off (keeps every view in sync).
  const lastPosSaveRef = useRef(0);
  const restoredPosRef = useRef(false);

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      // The progress bar / time readout are the ONLY consumers of these two
      // states. When the window isn't being viewed (hidden tab, or a game in
      // front) nobody sees them, so skip the setState — otherwise the whole
      // player re-renders ~4x/second behind the scenes for nothing. The bar is
      // resynced the instant focus returns (see the rendering-active effect).
      if (isRenderingActive()) {
        setProgress(audioRef.current.currentTime);
        setDuration(audioRef.current.duration || 0);
      }

      // Crossfade into the next track during the final CROSSFADE_SEC seconds.
      // Skipped for repeat-one (would fade into itself), when a sleep "end of
      // track" stop is pending, at the end of the queue with repeat off (no
      // next), and for tracks too short to overlap cleanly. With repeat-all the
      // wrap back to the start of the queue crossfades too (needs >1 track so
      // we never fade a song into itself).
      const d = audioRef.current.duration;
      const hasNext =
        !!upcoming[0]?.track || (repeatMode === "all" && tracks.length > 1);
      if (
        isPlaying &&
        !crossfadingRef.current &&
        repeatMode !== "one" &&
        !sleepEndOfTrackRef.current &&
        hasNext &&
        Number.isFinite(d) && d > CROSSFADE_SEC + 1 &&
        audioRef.current.currentTime >= d - CROSSFADE_SEC
      ) {
        startCrossfade();
      }

      const now = Date.now();
      if (currentTrack && now - lastPosSaveRef.current > 2000) {
        lastPosSaveRef.current = now;
        try {
          localStorage.setItem(
            "zenify_player_pos",
            JSON.stringify({ id: currentTrack.id, t: audioRef.current.currentTime })
          );
        } catch {}
      }
    }
  };

  // Report playback position to the OS media bar / lock screen. The OS
  // extrapolates position from (position, playbackRate) on its own clock, so
  // this only needs to run when that baseline changes — track load, seek, and
  // play/pause — not on every timeupdate tick.
  const reportPositionState = () => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const audio = audioRef.current;
    if (!audio) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: audio.duration || 0,
        position: Math.min(audio.currentTime, audio.duration || Infinity),
        playbackRate: audio.playbackRate || 1,
      });
    } catch {}
  };

  // Backfill duration into D1 for legacy tracks uploaded before it was extracted
  const backfilledRef = useRef<Set<string>>(new Set());
  // Count one play per track load (fires on each new src / track change)
  const playCountedRef = useRef<string | null>(null);
  const handleLoadedMetadata = () => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;

    // A new track is loaded — clear the crossfade guard so it can fade again
    // near this track's end. On a NORMAL (non-crossfade) load, snap the gain
    // back to full so a manually-selected track isn't stuck mid-fade.
    crossfadingRef.current = false;
    const ctxLm = audioContextRef.current;
    if (gainNodeRef.current && ctxLm && !fadeInPendingRef.current) {
      gainNodeRef.current.gain.cancelScheduledValues(ctxLm.currentTime);
      gainNodeRef.current.gain.setValueAtTime(volume, ctxLm.currentTime);
    }

    const d = audio.duration;
    if (Number.isFinite(d) && d > 0 && !currentTrack.duration && !backfilledRef.current.has(currentTrack.id)) {
      backfilledRef.current.add(currentTrack.id);
      saveDurationAction(currentTrack.id, d).catch(() => {});
    }

    // Restore the saved playback position once, for the track that was loaded on
    // page load (so a reload/navigation resumes from where it left off).
    if (!restoredPosRef.current) {
      restoredPosRef.current = true;
      try {
        const raw = localStorage.getItem("zenify_player_pos");
        if (raw) {
          const p = JSON.parse(raw);
          if (p && p.id === currentTrack.id && typeof p.t === "number" && p.t > 0 && (!d || p.t < d)) {
            audio.currentTime = p.t;
          }
        }
      } catch {}
    }
    reportPositionState();
    if (playCountedRef.current !== currentTrack.id) {
      playCountedRef.current = currentTrack.id;
      fetch("/api/play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackId: currentTrack.id }),
      }).catch(() => {});
    }
  };

  const handleEnded = () => {
    // Sleep timer set to "end of track": stop here instead of advancing.
    if (sleepEndOfTrackRef.current) {
      sleepEndOfTrackRef.current = false;
      setSleepMode("off");
      setIsPlaying(false);
      showToast("Sleep timer ended — playback paused", "info");
      return;
    }
    // Repeat-one: restart the same track instead of advancing
    if (repeatMode === "one" && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
      setIsPlaying(true);
      return;
    }
    playNextTrack(true);
  };

  const errorSkipRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleAudioError = () => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;
    const err = audio.error;
    if (!err) return;

    if (err.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
      showToast(`Cannot play "${cleanTitle(currentTrack.title)}": format not supported`, "error");
    } else if (err.code === MediaError.MEDIA_ERR_NETWORK) {
      showToast(`Network error loading "${cleanTitle(currentTrack.title)}"`, "error");
    } else {
      showToast(`Failed to load "${cleanTitle(currentTrack.title)}"`, "error");
    }

    if (tracks.length > 1) {
      const t = setTimeout(() => playNextTrack(), 800);
      errorSkipRef.current = t;
    } else {
      setIsPlaying(false);
    }
  };

  useEffect(() => {
    if (isPlaying && audioRef.current) {
      if (!audioRef.current.src) {
        setIsPlaying(false);
        return;
      }
      initAudioContext();
      const playPromise = audioRef.current.play();
      if (playPromise !== undefined) {
        playPromise.catch(e => {
          // Browser blocked autoplay (e.g. after a fresh page load) — reflect the
          // real state so the UI doesn't show "playing" while it's actually silent.
          if (e.name === 'NotAllowedError' || e.name === 'NotSupportedError') {
            setIsPlaying(false);
          } else if (e.name !== 'AbortError') {
            console.error("Playback failed:", e);
          }
        });
      }
    } else if (!isPlaying && audioRef.current) {
      audioRef.current.pause();
      // Pausing mid-crossfade must also silence the outgoing tail element,
      // otherwise it keeps playing for up to CROSSFADE_SEC after the pause.
      stopCrossfadeTail();
    }
    return () => {
      if (errorSkipRef.current) {
        clearTimeout(errorSkipRef.current);
        errorSkipRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrackIndex, isPlaying, tracks]);

  // Unmount-only cleanup for crossfade timers/intervals. Deliberately separate
  // from the effect above: its cleanup runs on every track change, which would
  // kill the tail in the middle of a legitimate crossfade.
  useEffect(() => {
    return () => {
      if (tailFadeIdRef.current) clearInterval(tailFadeIdRef.current);
      if (primaryFadeIdRef.current) clearInterval(primaryFadeIdRef.current);
      if (crossfadeUiTimerRef.current) clearTimeout(crossfadeUiTimerRef.current);
      if (crossfadeSafetyRef.current) clearTimeout(crossfadeSafetyRef.current);
    };
  }, []);

  // ── Discord Rich Presence bridge ──────────────────────────────────────────
  // Emit a "now playing" snapshot whenever the track or play/pause state changes.
  // In a normal browser this CustomEvent is simply unheard and costs nothing. The
  // desktop shell (see /desktop — Go + webview) installs a listener that forwards
  // the detail to Discord via local RPC. Cover is made absolute so the desktop can
  // optionally hand Discord a real URL; otherwise the native side falls back to the
  // uploaded `zenify_logo` art asset.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const audio = audioRef.current;
    const detail = currentTrack
      ? {
          id: currentTrack.id,
          title: cleanTitle(currentTrack.title),
          artist: currentTrack.artist || currentTrack.category || "",
          album: currentTrack.album || "",
          cover: currentTrack.cover_url
            ? new URL(currentTrack.cover_url, window.location.origin).href
            : "",
          state: isPlaying ? "playing" : "paused",
          position: audio?.currentTime || 0,
          duration: audio?.duration || currentTrack.duration || 0,
          appUrl: window.location.origin,
        }
      : { id: "", title: "", artist: "", album: "", cover: "", state: "stopped", position: 0, duration: 0, appUrl: "" };
    window.dispatchEvent(new CustomEvent("zenify:nowplaying", { detail }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id, isPlaying]);

  // ── Media Session (lock screen / notification bar / headset controls) ──────
  // Publish now-playing metadata so the OS can display it, and route the
  // hardware buttons (play/pause/next/prev on a headset, lock screen, or media
  // key) back into our controls. Without this the system has no idea what's
  // playing, so Bluetooth/lock-screen controls do nothing.
  useEffect(() => {
    if (typeof window === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;

    // Metadata + cover artwork for the system "Now Playing" surface.
    if (currentTrack) {
      const artwork = currentTrack.cover_url
        ? [{ src: currentTrack.cover_url, sizes: "512x512", type: "image/jpeg" }]
        : [];
      ms.metadata = new MediaMetadata({
        title: cleanTitle(currentTrack.title),
        artist: currentTrack.artist || currentTrack.category || "",
        album: currentTrack.album || "",
        artwork,
      });
    } else {
      ms.metadata = null;
    }

    ms.playbackState = isPlaying ? "playing" : "paused";
    // Re-baseline the OS progress bar on play/pause (and on track change via
    // this effect's deps) so it doesn't keep extrapolating a stale position.
    reportPositionState();

    // Action handlers — let OS buttons drive playback directly.
    ms.setActionHandler("play", () => {
      if (!audioRef.current) return;
      initAudioContext();
      audioRef.current.play().catch(() => {});
      setIsPlaying(true);
    });
    ms.setActionHandler("pause", () => {
      if (!audioRef.current) return;
      audioRef.current.pause();
      setIsPlaying(false);
    });
    ms.setActionHandler("previoustrack", () => handlePrev());
    ms.setActionHandler("nexttrack", () => playNextTrack());
    ms.setActionHandler("seekbackward", (details) => {
      const audio = audioRef.current;
      if (audio) audio.currentTime = Math.max(0, audio.currentTime - (details.seekOffset || 10));
    });
    ms.setActionHandler("seekforward", (details) => {
      const audio = audioRef.current;
      if (audio) audio.currentTime = Math.min(audio.duration || audio.currentTime, audio.currentTime + (details.seekOffset || 10));
    });
    try {
      ms.setActionHandler("seekto", (details) => {
        const audio = audioRef.current;
        if (audio && details.seekTime != null) audio.currentTime = details.seekTime;
      });
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id, isPlaying]);

  // remembers the level to restore after mute (seeded with the persisted volume)
  const prevVolumeRef = useRef(volume || 0.8);

  const applyVolume = (v: number) => {
    const clamped = Math.min(1, Math.max(0, v));
    setVolume(clamped);
    // Persist so the chosen level survives a page reload / next session.
    if (typeof window !== "undefined") window.localStorage.setItem("player_volume", String(clamped));
    // Once the audio graph is up, volume is the gain node (the element stays at
    // full level so the analyser/visualizer sees the real signal). Before that,
    // fall back to the element's own volume.
    if (gainNodeRef.current) gainNodeRef.current.gain.value = clamped;
    else if (audioRef.current) audioRef.current.volume = clamped;
  };

  // Apply the persisted volume to the bare <audio> element on mount, before the
  // audio graph (gain node) is built, so the first playback starts at the saved
  // level rather than the browser's default of full volume.
  useEffect(() => {
    if (!gainNodeRef.current && audioRef.current) audioRef.current.volume = volume;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const v = parseFloat(e.target.value);
    if (v > 0) prevVolumeRef.current = v;
    applyVolume(v);
  };

  // Mute (volume 0) / unmute (restore previous level). The speaker icon and the
  // "M" keyboard shortcut both go through this.
  const muteToggle = () => {
    if (volume > 0) {
      prevVolumeRef.current = volume;
      applyVolume(0);
    } else {
      applyVolume(prevVolumeRef.current || 0.5);
    }
  };
  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    muteToggle();
  };

  // Keyboard shortcuts: Space = play/pause, ←/→ = seek 5s, Shift+←/→ = prev/next,
  // ↑/↓ = volume, M = mute. Ignored while typing in a field so search still works.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable)
      ) {
        return;
      }
      if (!currentTrack) return;
      const audio = audioRef.current;

      switch (e.key) {
        case " ":
        case "Spacebar":
          // A focused button also activates on Space — bail out and let the
          // native activation run alone, otherwise one press fires both the
          // button's action and play/pause (e.g. play → instantly pause again).
          if (el && el.closest("button")) return;
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowRight":
          e.preventDefault();
          if (e.shiftKey) playNextTrack();
          else if (audio) audio.currentTime = Math.min(audio.duration || audio.currentTime, audio.currentTime + 5);
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (e.shiftKey) handlePrev();
          else if (audio) audio.currentTime = Math.max(0, audio.currentTime - 5);
          break;
        case "ArrowUp":
          e.preventDefault();
          applyVolume(Math.min(1, volume + 0.05));
          break;
        case "ArrowDown":
          e.preventDefault();
          applyVolume(Math.max(0, volume - 0.05));
          break;
        case "m":
        case "M":
          muteToggle();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack, isPlaying, volume, tracks]);

  const formatTime = (time: number) => {
    if (isNaN(time)) return "0:00";
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
  };

  const progressPercent = duration ? (progress / duration) * 100 : 0;

  // Minimal bar visualizer logic
  useEffect(() => {
    if (isExpanded) return;

    // Match the played bars to the cover colour (same as the rest of the player)
    let ar = 45, ag = 212, ab = 191; // fallback teal
    if (coverColor) { ar = coverColor.r; ag = coverColor.g; ab = coverColor.b; }

    // Maintain a persistent buffer to avoid GC pressure, dynamically resizing
    // only if the analyser's frequencyBinCount changes (e.g. 128 bins for fftSize 256).
    let dataArray = new Uint8Array(128);

    let animationFrame: number;
    let backoffId: ReturnType<typeof setTimeout> | null = null;
    let active = true;

    const scheduleNext = () => {
      if (!active) return;
      const audio = audioRef.current;
      // Pause the visualiser when audio is idle, the tab is backgrounded, or the
      // browser window has lost focus (e.g. a game is in front). This is the big
      // one for gaming: a borderless game leaves document.hidden false, so without
      // the focus check the canvas keeps redrawing at 60fps behind the game.
      if (!audio || audio.paused || !isRenderingActive()) {
        backoffId = setTimeout(() => {
          backoffId = null;
          if (active) animationFrame = requestAnimationFrame(renderFrame);
        }, 200);
      } else {
        animationFrame = requestAnimationFrame(renderFrame);
      }
    };

    const renderFrame = () => {
      const audio = audioRef.current;
      // Bail out of ALL canvas work when idle or the window isn't being viewed,
      // then just idle-poll via scheduleNext. rAF is already paused by the
      // browser for a hidden tab, but "unfocused yet visible" (e.g. a game in
      // front) keeps rAF firing — without this early exit we'd redraw the whole
      // spectrum behind the game for nothing.
      if (!analyserRef.current || !canvasRef.current || !audio || audio.paused || !isRenderingActive()) {
        scheduleNext();
        return;
      }

      const analyser = analyserRef.current;
      const bufferLength = analyser.frequencyBinCount;
      if (dataArray.length !== bufferLength) {
        dataArray = new Uint8Array(bufferLength);
      }

      // Reuse the pre-allocated buffer — no GC pressure
      analyser.getByteFrequencyData(dataArray);

      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) { scheduleNext(); return; }

      const WIDTH = canvas.width;
      const HEIGHT = canvas.height;

      ctx.clearRect(0, 0, WIDTH, HEIGHT);

      const barWidth = (WIDTH / bufferLength) * 2.5;
      let x = 0;
      // Read playback position straight from the element (not React state):
      // keeps this effect free of `progress`/`duration` deps, which would tear
      // down and rebuild the whole RAF loop on every timeupdate (~4x/s).
      const dur = audio.duration || 0;
      const currentProgressIdx = dur ? (audio.currentTime / dur) * bufferLength : 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 255;               // 0..1 — now independent of volume
        const barHeight = Math.max(2, v * HEIGHT);  // scaled to the canvas (no overflow), small floor
        const y = (HEIGHT - barHeight) / 2;         // mirrored around the centre line
        const w = Math.max(1, barWidth - 2);
        const r = Math.min(w / 2, barHeight / 2);   // rounded ends

        if (i < currentProgressIdx) {
          ctx.fillStyle = `rgba(${ar}, ${ag}, ${ab}, ${Math.max(0.45, v)})`;
        } else {
          ctx.fillStyle = `rgba(148, 163, 184, ${Math.max(0.12, v * 0.7)})`;
        }

        ctx.beginPath();
        ctx.roundRect(x, y, w, barHeight, r);
        ctx.fill();
        x += barWidth;
      }

      scheduleNext();
    };

    // Resume immediately when the tab becomes visible / window regains focus,
    // but only out of a parked backoff to avoid stacking a duplicate RAF.
    const stopGate = onRenderingActiveChange(() => {
      if (isRenderingActive() && active && backoffId !== null) {
        clearTimeout(backoffId); backoffId = null;
        animationFrame = requestAnimationFrame(renderFrame);
      }
    });

    animationFrame = requestAnimationFrame(renderFrame);
    return () => {
      active = false;
      cancelAnimationFrame(animationFrame);
      if (backoffId !== null) clearTimeout(backoffId);
      stopGate();
    };
  }, [isExpanded, coverColor, isPlaying]);

  // Streaming quality chosen in Settings or via the player's quality badge.
  // Applied via ?q= on the audio proxy; changing it mid-song reloads the
  // current track at the new quality.
  const [streamQuality, setStreamQuality] = useStreamQuality();

  const rawUrl = currentTrack?.file_url || "";
  const audioSrc = withQuality(
    rawUrl.includes(".r2.dev/")
      ? `/api/audio/${rawUrl.split(".r2.dev/").pop()}`
      : rawUrl,
    streamQuality
  );

  // Always render the Lyrics tab/panel when a track is loaded. Tracks without
  // lyrics fall back to a clear "no lyrics" message instead of the whole section
  // silently disappearing. (currentTrack is guaranteed truthy past the guard below.)
  const hasLyrics = !!currentTrack;

  if (!currentTrack) {
    return null;
  }

  // The track shown in the compact bottom bar. During a crossfade this lags on
  // the outgoing track so the bar doesn't reveal the ~6s audio overlap; the
  // fullscreen view and audio engine always use the live currentTrack.
  const barTrack = crossfadePrevTrack ?? currentTrack;

  // Tint the fullscreen player to match the cover (falls back to teal).
  // `cc` is the raw dominant colour (used for the ambient background tint).
  // `accent`/`accentSoft` are a legibility-corrected version used for all text,
  // lines and active controls so they stay readable on ANY cover — a near-black
  // cover no longer makes the accent text disappear. `accentFill` keeps the raw
  // colour for the large filled buttons (play/like), whose white icons already
  // sit fine on top regardless of brightness.
  const cc = coverColor || { r: 45, g: 212, b: 191 };
  const ca = readableAccent(cc.r, cc.g, cc.b);
  const accent = `rgb(${ca.r}, ${ca.g}, ${ca.b})`;
  const accentSoft = `rgba(${ca.r}, ${ca.g}, ${ca.b}, 0.5)`;
  const accentFill = `rgb(${cc.r}, ${cc.g}, ${cc.b})`;
  const ambientBg =
    `radial-gradient(120% 75% at 50% -10%, rgba(${cc.r}, ${cc.g}, ${cc.b}, 0.42), transparent 55%),` +
    `linear-gradient(180deg, rgba(${cc.r}, ${cc.g}, ${cc.b}, 0.16) 0%, #0a0c11 62%)`;

  // The compact bar's badge follows barTrack, so during a crossfade it can't
  // describe the incoming song while the bar still shows the outgoing one.
  const barSpecs = formatAudioSpecs(barTrack, streamQuality);

  const nextTrack = upcoming[0]?.track;
  const nextRawUrl = nextTrack?.file_url || "";
  const nextAudioSrc = withQuality(
    nextRawUrl.includes(".r2.dev/")
      ? `/api/audio/${nextRawUrl.split(".r2.dev/").pop()}`
      : nextRawUrl,
    streamQuality
  );


  return (
    <>
      <audio
        ref={audioRef}
        src={audioSrc || undefined}
        crossOrigin="anonymous"
        preload="auto"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onSeeked={reportPositionState}
        onPlaying={handlePlaying}
        onEnded={handleEnded}
        onError={handleAudioError}
        controlsList="nodownload"
      />
      {/* Outgoing-track tail player for crossfade (faded out via its own volume). */}
      <audio
        ref={tailRef}
        crossOrigin="anonymous"
        preload="auto"
        controlsList="nodownload"
      />
      {/* Warms up the NEXT track. preload="metadata" (not "auto") fetches only a
          small header instead of eagerly downloading the entire upcoming song in
          the background — the latter quietly burned data even while the window was
          behind a game. Crossfade still gets a head start without the full pull. */}
      {nextAudioSrc && (
        <audio
          src={nextAudioSrc}
          crossOrigin="anonymous"
          preload="metadata"
          muted
          controlsList="nodownload"
        />
      )}

      <QueuePanel 
        open={showQueue} 
        onClose={() => setShowQueue(false)} 
        accent={accent}
        accentSoft={accentSoft}
        coverColor={cc}
      />

      {/* ─── EXPANDED PLAYER ─────────────────────────────────────────── */}
      {isExpanded ? (
        <div
          className="fixed inset-0 h-screen w-screen z-[100] flex flex-col backdrop-blur-3xl overflow-hidden"
          style={{ background: ambientBg }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {currentTrack.cover_url && (
            <div
              className="absolute inset-0 z-0 opacity-40 mix-blend-screen pointer-events-none"
              style={{
                backgroundImage: `url(${currentTrack.cover_url})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                filter: 'blur(80px)',
                transform: 'scale(1.2)'
              }}
            />
          )}
          
          {/* ─── TOP BAR ─────────────────────────────────────────────── */}
          <div className="relative z-10 flex items-center justify-between px-5 pb-2 flex-shrink-0" style={{ paddingTop: desktopOffset > 0 ? desktopOffset + 10 : 20 }}>
            {/* Close */}
            <button 
              onClick={() => setIsExpanded(false)}
              className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white backdrop-blur-md transition-all active:scale-95"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
              </svg>
            </button>

            {/* Now Playing label */}
            <div className="flex items-center gap-2">
              {isPlaying && (
                <span className="flex items-end gap-[2px] h-3.5">
                  <span className="eq-bar" />
                  <span className="eq-bar" />
                  <span className="eq-bar" />
                </span>
              )}
              <span className="text-[10px] font-black tracking-[0.35em] uppercase" style={{ color: accent }}>Now Playing</span>
            </div>

            {/* Playlist / queue icon */}
            <button
              onClick={(e) => { e.stopPropagation(); setShowQueue((v) => !v); }}
              aria-label="Queue"
              aria-pressed={showQueue}
              title="Queue"
              className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-slate-400 hover:text-white transition-all active:scale-95"
              style={{ color: showQueue ? accent : undefined }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 18h13v-2H3v2zm0-5h10v-2H3v2zm0-7v2h13V6H3zm18 9.59L17.42 12 21 8.41 19.59 7l-5 5 5 5L21 15.59z"/>
              </svg>
            </button>
          </div>

          {/* ─── DESKTOP: side-by-side, MOBILE: tabbed ─────────────────── */}
          <div className="relative z-10 flex-1 flex flex-col lg:flex-row overflow-hidden">

            {/* ─── MOBILE TAB SWITCHER (only when lyrics exist) ──────────── */}
            {hasLyrics && (
              <div className="lg:hidden flex items-center bg-white/5 mx-5 rounded-xl p-1 gap-1 flex-shrink-0 mb-2">
                <button
                  onClick={() => setActiveTab("player")}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${activeTab === "player" ? "bg-white/15 text-white" : "text-slate-400"}`}
                >
                  Player
                </button>
                <button
                  onClick={() => setActiveTab("lyrics")}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${activeTab === "lyrics" ? "bg-white/15 text-white" : "text-slate-400"}`}
                >
                  Lyrics
                  {isFetchingLyrics && <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" />}
                </button>
              </div>
            )}

            {/* ─── PLAYER PANEL ─────────────────────────────────────────── */}
            {/* LEFT: track info + actions (desktop) */}
            <div className="hidden lg:flex lg:flex-col lg:justify-center lg:w-[30%] xl:w-[26%] flex-shrink-0 px-10 gap-2">
              <h2 className="font-black text-4xl xl:text-5xl text-white leading-[1.05] tracking-tight drop-shadow-lg mb-1">
                {cleanTitle(currentTrack.title)}
              </h2>
              {currentTrack.artist ? (
                <Link href={`/artist/${encodeURIComponent(currentTrack.artist)}`} onClick={() => setIsExpanded(false)} className="text-xl font-bold hover:underline w-fit mb-1" style={{ color: accent }}>
                  {currentTrack.artist}
                </Link>
              ) : (
                <p className="text-xl font-bold mb-1" style={{ color: accent }}>{currentTrack.category}</p>
              )}
              {(currentTrack.album || currentTrack.year) && (
                <p className="text-sm text-slate-300 mb-2 font-medium leading-snug">
                  {currentTrack.album}{currentTrack.album && currentTrack.year ? "  ·  " : ""}{currentTrack.year || ""}
                </p>
              )}
              {/* Quality badge — click to switch streaming quality */}
              <QualityBadgePicker track={currentTrack} quality={streamQuality} onChange={setStreamQuality} />
              {/* Clean Minimalist Actions */}
              <div className="mt-4">
                <TrackActions
                  track={currentTrack}
                  liked={liked}
                  onToggleLike={toggleLike}
                  accentFill={accentFill}
                  iconSize={28}
                  gapClass="gap-7"
                  onNavigate={() => setIsExpanded(false)}
                />
              </div>
            </div>

            {/* CENTER: cover + glow */}
            <div className={`flex flex-col items-center justify-center lg:flex-1 px-6 overflow-y-auto ${hasLyrics && activeTab === "lyrics" ? "hidden lg:flex" : "flex"}`}>
              <div className="relative flex items-center justify-center mt-2 mb-12">
                {/* soft ambient glow (no hard ring) */}
                <div className="absolute rounded-full blur-[100px] pointer-events-none" style={{ width: "130%", height: "130%", background: `radial-gradient(circle, ${accentSoft}, transparent 66%)` }} />
                {/* big cover */}
                <div
                  className="relative w-72 h-72 sm:w-80 sm:h-80 lg:w-[24rem] lg:h-[24rem] xl:w-[28rem] xl:h-[28rem] rounded-2xl overflow-hidden flex-shrink-0"
                  style={{ boxShadow: `0 40px 100px rgba(0,0,0,0.6), 0 0 80px ${accentSoft}` }}
                >
                  <LargeCoverArt title={currentTrack.title} category={currentTrack.category} coverUrl={currentTrack.cover_url} size="lg" />
                </div>
              </div>

              {/* Mobile-only meta (left column is desktop-only) */}
              <div className="lg:hidden w-full flex flex-col items-center text-center mt-4 mb-2 px-4">
                <h2 className="font-black text-2xl text-white leading-tight tracking-tight mb-1">
                  {cleanTitle(currentTrack.title)}
                </h2>
                {currentTrack.artist ? (
                  <Link href={`/artist/${encodeURIComponent(currentTrack.artist)}`} onClick={() => setIsExpanded(false)} className="text-base font-bold hover:underline mb-1" style={{ color: accent }}>
                    {currentTrack.artist}
                  </Link>
                ) : (
                  <p className="text-base font-bold mb-1" style={{ color: accent }}>{currentTrack.category}</p>
                )}
                {(currentTrack.album || currentTrack.year) && (
                  <p className="text-xs text-slate-300 mb-2 font-medium leading-snug max-w-[85%]">
                    {currentTrack.album}{currentTrack.album && currentTrack.year ? "  ·  " : ""}{currentTrack.year || ""}
                  </p>
                )}
                {/* Quality badge — click to switch streaming quality */}
                <QualityBadgePicker track={currentTrack} quality={streamQuality} onChange={setStreamQuality} />
                {/* Clean Minimalist Actions */}
                <div className="mt-3 mb-2">
                  <TrackActions
                    track={currentTrack}
                    liked={liked}
                    onToggleLike={toggleLike}
                    accentFill={accentFill}
                    iconSize={26}
                    gapClass="gap-8"
                    onNavigate={() => setIsExpanded(false)}
                  />
                </div>
              </div>

              {/* â”€â”€ PROGRESS BAR â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
              <div className="w-full mb-5">
                {/* Slider track */}
                <div
                  className="h-1.5 w-full bg-white/15 rounded-full overflow-hidden relative cursor-pointer group mb-2"
                  onClick={(e) => {
                    if (audioRef.current && duration) {
                      const rect = e.currentTarget.getBoundingClientRect();
                      audioRef.current.currentTime = ((e.clientX - rect.left) / rect.width) * duration;
                    }
                  }}
                >
                  <div
                    className="absolute top-0 left-0 h-full rounded-full transition-all"
                    style={{ width: `${progressPercent}%`, background: accent, boxShadow: `0 0 10px ${accentSoft}` }}
                  />
                  {/* scrubber dot */}
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white shadow-md -ml-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ left: `${progressPercent}%` }}
                  />
                </div>
                {/* Times */}
                <div className="flex justify-between text-xs font-mono tabular-nums">
                  <span className="text-slate-200">{formatTime(progress)}</span>
                  <span className="text-slate-500">{formatTime(duration)}</span>
                </div>
              </div>

              {/* â”€â”€ CONTROLS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
              <div className="flex items-center justify-center gap-5 sm:gap-7 w-full mb-6">
                {/* Shuffle */}
                <button
                  onClick={(e) => { e.stopPropagation(); toggleShuffle(); }}
                  className="transition-all active:scale-90 hover:scale-110"
                  style={{ color: shuffle ? accent : "#94a3b8" }}
                  aria-label={shuffle ? "Shuffle on" : "Shuffle off"} aria-pressed={shuffle} title={shuffle ? "Shuffle: on" : "Shuffle: off"}
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>
                  </svg>
                </button>

                {/* Prev */}
                <button
                  onClick={(e) => { e.stopPropagation(); handlePrev(); }}
                  aria-label="Previous track"
                  className="text-slate-300 hover:text-white transition-all active:scale-90 hover:scale-110"
                >
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>
                  </svg>
                </button>

                {/* Play / Pause */}
                <button
                  onClick={togglePlay} aria-label={isPlaying ? "Pause" : "Play"}
                  className="w-20 h-20 rounded-full text-white flex items-center justify-center hover:scale-105 active:scale-95 transition-all"
                  style={{ background: accentFill, boxShadow: `0 0 35px ${accentSoft}` }}
                >
                  {isPlaying ? (
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                    </svg>
                  ) : (
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor" className="ml-1.5">
                      <path d="M8 5v14l11-7z"/>
                    </svg>
                  )}
                </button>

                {/* Next */}
                <button
                  onClick={(e) => { e.stopPropagation(); playNextTrack(); }}
                  aria-label="Next track"
                  className="text-slate-300 hover:text-white transition-all active:scale-90 hover:scale-110"
                >
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
                  </svg>
                </button>

                {/* Repeat */}
                <button
                  onClick={(e) => { e.stopPropagation(); toggleRepeat(); }}
                  className="relative transition-all active:scale-90 hover:scale-110"
                  style={{ color: repeatMode !== "off" ? accent : "#94a3b8" }}
                  aria-label={`Repeat ${repeatMode}`} aria-pressed={repeatMode !== "off"} title={`Repeat: ${repeatMode}`}
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>
                  </svg>
                  {repeatMode === "one" && (
                    <span className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full text-[8px] font-black flex items-center justify-center" style={{ background: accent, color: "#0d111c" }}>1</span>
                  )}
                </button>
              </div>

              {/* â”€â”€ EXTRA CONTROLS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
              <div className="flex items-center w-full px-2" onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-2.5 w-full max-w-xs mx-auto">
                  {/* Speaker doubles as a mute toggle, like the mini player */}
                  <button
                    onClick={toggleMute}
                    aria-label={volume === 0 ? "Unmute" : "Mute"} title={volume === 0 ? "Unmute" : "Mute"}
                    className="flex-shrink-0 transition-colors"
                    style={{ color: volume === 0 ? accent : "#94a3b8" }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                      <path d={
                        volume === 0
                          ? "M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 15.91 21 14 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"
                          : volume < 0.5
                          ? "M5 9v6h4l5 5V4L9 9H5zm11.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"
                          : "M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"
                      } />
                    </svg>
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={volume}
                    onChange={handleVolumeChange}
                    title={`${Math.round(volume * 100)}%`}
                    className="flex-1 h-1.5 rounded-full appearance-none outline-none cursor-pointer"
                    style={{
                      background: `linear-gradient(to right, ${accent} ${volume * 100}%, rgba(255,255,255,0.18) ${volume * 100}%)`,
                      accentColor: accent,
                    }}
                  />
                  <span className="text-[10px] font-mono tabular-nums w-7 text-right text-slate-400">
                    {Math.round(volume * 100)}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowQueue((v) => !v); }}
                    aria-label="Queue"
                    aria-pressed={showQueue}
                    title="Queue"
                    className="flex-shrink-0 transition-colors"
                    style={{ color: showQueue ? accent : "#94a3b8" }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M3 18h13v-2H3v2zm0-5h10v-2H3v2zm0-7v2h13V6H3zm18 9.59L17.42 12 21 8.41 19.59 7l-5 5 5 5L21 15.59z" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            {/* â”€â”€ LYRICS PANEL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
            {hasLyrics && (
              <div className={`lg:w-[26%] xl:w-[23%] flex-shrink-0 lg:flex lg:flex-col lg:justify-center overflow-hidden px-6 pb-6 ${activeTab === "player" ? "hidden lg:flex" : "flex flex-col"}`}>
                <div
                  className="w-full flex-1 overflow-hidden"
                  style={{
                    WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%)',
                    maskImage: 'linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%)'
                  }}
                >
                  <div
                    ref={lyricsContainerRef}
                    className="h-full overflow-y-auto scrollbar-hide py-32 text-center lg:text-left scroll-smooth px-4 lg:px-8"
                  >
                    <div className="flex items-center justify-between mb-8">
                      <h3 className="text-[10px] font-black tracking-[0.4em] text-teal-400 uppercase flex items-center gap-2">
                        Lyrics
                        {isFetchingLyrics && (
                          <span className="flex items-center gap-1 text-[9px] normal-case tracking-normal text-slate-400 font-normal">
                            <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse" />
                            Auto-syncing...
                          </span>
                        )}
                      </h3>
                      {parsedLyrics && (
                        <div className="flex items-center gap-1" title="Sync offset: shift lyrics earlier or later to match audio">
                          <button
                            onClick={() => adjustOffset(-0.5)}
                            className="w-6 h-6 rounded-lg text-slate-300 hover:text-white transition-all flex items-center justify-center active:scale-90"
                            style={{ background: "rgba(255,255,255,0.1)" }}
                            title="Lyrics earlier"
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13H5v-2h14v2z" /></svg>
                          </button>
                          <div className="flex items-center gap-1 min-w-[54px] justify-center">
                            <span className="text-[10px] font-mono tabular-nums text-slate-300 select-none">
                              {lyricsOffset > 0 ? "+" : ""}{lyricsOffset.toFixed(1)}s
                            </span>
                            {lyricsOffset !== 0 && (
                              <button
                                onClick={() => adjustOffset(-lyricsOffset)}
                                className="text-slate-500 hover:text-teal-400 transition-colors flex items-center"
                                title="Reset to 0"
                              >
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" /></svg>
                              </button>
                            )}
                          </div>
                          <button
                            onClick={() => adjustOffset(+0.5)}
                            className="w-6 h-6 rounded-lg text-slate-300 hover:text-white transition-all flex items-center justify-center active:scale-90"
                            style={{ background: "rgba(255,255,255,0.1)" }}
                            title="Lyrics later"
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" /></svg>
                          </button>
                        </div>
                      )}
                    </div>

                    {parsedLyrics ? (
                      <div className="flex flex-col pb-32">
                        {parsedLyrics.map((lyric, idx) => {
                          const isActive = activeLyricIndex === idx;
                          const isPassed = activeLyricIndex > idx;
                          const isFuture = !isActive && !isPassed;
                          const dist = Math.abs(idx - activeLyricIndex);

                          return (
                            <div
                              key={idx}
                              data-index={idx}
                              onClick={() => {
                                if (audioRef.current) audioRef.current.currentTime = lyric.time;
                              }}
                              className="cursor-pointer origin-left lg:origin-left origin-center"
                              style={{
                                transition: "transform 550ms cubic-bezier(0.22,1,0.36,1), opacity 450ms cubic-bezier(0.22,1,0.36,1), filter 450ms ease, margin 550ms cubic-bezier(0.22,1,0.36,1)",
                                transform: isActive ? "scale(1)" : `scale(${Math.max(0.78, 0.88 - dist * 0.03)})`,
                                opacity: isActive ? 1 : isPassed ? Math.max(0.18, 0.45 - dist * 0.08) : Math.max(0.12, 0.35 - dist * 0.07),
                                filter: isActive ? "blur(0px)" : isFuture ? `blur(${Math.min(dist * 0.6, 2)}px)` : "blur(0px)",
                                marginBottom: isActive ? "2.5rem" : "1.1rem",
                                marginTop: isActive ? "0.75rem" : "0",
                              }}
                            >
                              {isActive ? (
                                /* â”€â”€ Apple Music sweep + per-word scale â”€â”€ */
                                <span
                                  data-active-line-words
                                  className="text-lg sm:text-xl lg:text-2xl font-black leading-snug block"
                                  style={{ color: "rgba(255,255,255,0.28)" }}
                                >
                                  {lyric.text.split(/\s+/).map((word, wi, arr) => (
                                    <span
                                      key={wi}
                                      data-wi={wi}
                                      data-syl={countSyllables(word)}
                                      style={{
                                        display: "inline-block",
                                        transformOrigin: "center 80%",
                                        marginRight: wi < arr.length - 1 ? "0.34em" : "0",
                                      }}
                                    >
                                      {word}
                                    </span>
                                  ))}
                                </span>
                              ) : (
                                <span className="text-sm sm:text-base lg:text-lg font-bold leading-snug block text-white/90">
                                  {lyric.text}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (externalLyrics || currentTrack.lyrics) ? (
                      /* Plain-text lyrics (no timestamps to sync against) */
                      <div className="text-sm font-semibold leading-relaxed text-white/70 whitespace-pre-wrap pb-32">
                        {externalLyrics || currentTrack.lyrics}
                      </div>
                    ) : isFetchingLyrics ? (
                      /* Still searching online for synced lyrics */
                      <div className="flex items-center gap-2 text-sm font-semibold text-white/50 pb-32">
                        <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" />
                        Searching for lyrics…
                      </div>
                    ) : (
                      /* No lyrics found anywhere — friendly empty state */
                      <div className="flex flex-col items-center lg:items-start text-center lg:text-left gap-3 pb-32">
                        <div
                          className="w-12 h-12 rounded-full flex items-center justify-center"
                          style={{ background: "rgba(255,255,255,0.07)" }}
                        >
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M9 18V5l12-2v13" />
                            <circle cx="6" cy="18" r="3" />
                            <circle cx="18" cy="16" r="3" />
                            <line x1="3" y1="3" x2="21" y2="21" />
                          </svg>
                        </div>
                        <p className="text-base font-extrabold text-white/85">No lyrics available</p>
                        <p className="text-xs leading-relaxed text-slate-400 max-w-[220px]">
                          We couldn&apos;t find lyrics for this track. Sit back and enjoy the music. 🎵
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

      ) : (
        /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
        /*  MINI PLAYER (bottom bar)                                          */
        /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
        <div 
          className="glass-panel glass-chrome fixed bottom-[4rem] md:bottom-0 left-0 w-full h-auto min-h-[6rem] py-3 md:py-0 md:h-24 border-t-0 border-b-0 border-l-0 border-r-0 px-4 md:px-8 flex flex-col md:flex-row items-center justify-between z-50 gap-4 md:gap-0 cursor-pointer backdrop-blur-xl transition-colors shadow-[0_-10px_40px_rgba(0,0,0,0.5)]"
          onContextMenu={(e) => e.preventDefault()}
          onClick={() => setIsExpanded(true)}
        >
          {/* Left: Track Info */}
          <div className="flex items-center gap-3 md:gap-4 w-full md:w-1/4 xl:w-1/5 order-1">
            <div className="w-12 h-12 md:w-14 md:h-14 rounded-xl overflow-hidden flex-shrink-0 shadow-lg">
              <LargeCoverArt title={barTrack.title} category={barTrack.category} coverUrl={barTrack.cover_url} size="sm" />
            </div>
            <div className="flex flex-col overflow-hidden flex-1 min-w-0">
              <div className="font-extrabold text-sm truncate text-white">
                {cleanTitle(barTrack.title)}
              </div>
              {barTrack.artist ? (
                <Link
                  href={`/artist/${encodeURIComponent(barTrack.artist)}`}
                  onClick={(e) => e.stopPropagation()}
                  className="text-xs truncate hover:underline w-fit max-w-full font-medium"
                  style={{ color: "var(--text-muted)" }}
                >
                  {barTrack.artist}
                </Link>
              ) : (
                <div className="text-xs truncate font-medium" style={{ color: "var(--text-muted)" }}>{barTrack.category}</div>
              )}
            </div>
            <div className="ml-auto md:hidden flex items-center gap-2">
              <button onClick={(e) => { e.stopPropagation(); togglePlay(); }} aria-label={isPlaying ? "Pause" : "Play"} className="w-10 h-10 rounded-full flex items-center justify-center text-white bg-white/10 hover:bg-white/20 active:scale-95 transition-all shadow-md">
                {isPlaying ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="ml-0.5"><path d="M8 5v14l11-7z"/></svg>
                )}
              </button>
              <button onClick={(e) => { e.stopPropagation(); setIsExpanded(true); }} className="w-9 h-9 flex items-center justify-center text-slate-400 hover:text-white transition-colors">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6 1.41 1.41z"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Center: Controls + Visualizer + Duration */}
          <div className="flex items-center gap-4 md:gap-6 w-full md:flex-1 order-3 md:order-2 px-0 md:px-8" onClick={e => e.stopPropagation()}>
            
            {/* Play Controls */}
            <div className="flex items-center gap-3 sm:gap-4 flex-shrink-0">
              {/* Shuffle */}
              <button
                onClick={(e) => { e.stopPropagation(); toggleShuffle(); }}
                className="hover:opacity-80 transition-opacity"
                style={{ color: shuffle ? accent : "var(--text-muted)" }}
                aria-label={shuffle ? "Shuffle on" : "Shuffle off"} aria-pressed={shuffle} title={shuffle ? "Shuffle: on" : "Shuffle: off"}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
              </button>
              <button onClick={handlePrev} aria-label="Previous track" className="hover:opacity-80 transition-opacity" style={{ color: "var(--text-primary)" }}>
                 <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
              </button>
              <button
                onClick={togglePlay} aria-label={isPlaying ? "Pause" : "Play"}
                className="w-10 h-10 rounded-full text-white flex items-center justify-center hover:scale-105 transition-transform"
                style={{ background: accentFill, boxShadow: `0 0 15px ${accentSoft}` }}
              >
                {isPlaying ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="ml-1"><path d="M8 5v14l11-7z"/></svg>
                )}
              </button>
              <button onClick={() => playNextTrack()} aria-label="Next track" className="hover:opacity-80 transition-opacity" style={{ color: "var(--text-primary)" }}>
                 <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
              </button>
              {/* Repeat */}
              <button
                onClick={(e) => { e.stopPropagation(); toggleRepeat(); }}
                className="relative hover:opacity-80 transition-opacity"
                style={{ color: repeatMode !== "off" ? accent : "var(--text-muted)" }}
                aria-label={`Repeat ${repeatMode}`} aria-pressed={repeatMode !== "off"} title={`Repeat: ${repeatMode}`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>
                {repeatMode === "one" && (
                  <span className="absolute -top-1.5 -right-1.5 w-3 h-3 rounded-full text-[7px] font-black flex items-center justify-center" style={{ background: accent, color: "#0d111c" }}>1</span>
                )}
              </button>
            </div>

            {/* Visualizer Waveform / Progress */}
            <div className="flex-1 flex items-center gap-4 min-w-0">
              <span className="text-xs font-mono w-10 text-right" style={{ color: "var(--text-muted)" }}>{formatTime(progress)}</span>
              
              <div className="h-10 flex-1 relative flex items-center cursor-pointer group"
                   onClick={(e) => {
                     if(audioRef.current && duration) {
                       const rect = e.currentTarget.getBoundingClientRect();
                       audioRef.current.currentTime = ((e.clientX - rect.left) / rect.width) * duration;
                     }
                   }}>
                
                <div className="absolute inset-0 w-full h-full flex items-center overflow-hidden pointer-events-none opacity-80">
                  <canvas ref={canvasRef} className="w-full h-full" width={1000} height={40} />
                </div>

                <div className="absolute inset-0 w-full h-full opacity-0 group-hover:opacity-100 flex items-center transition-opacity">
                  <div className="w-full h-1 bg-white/20 rounded-full overflow-hidden">
                    <div className="h-full" style={{ width: `${progressPercent}%`, background: accent }}></div>
                  </div>
                </div>
                
                <div 
                  className="absolute w-1 h-8 bg-white rounded-full shadow-[0_0_10px_white] pointer-events-none opacity-50 group-hover:opacity-100 transition-opacity"
                  style={{ left: `calc(${progressPercent}% - 2px)` }}
                ></div>
              </div>

              <span className="text-xs font-mono w-10" style={{ color: "var(--text-muted)" }}>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Extra controls */}
          <div className="hidden md:flex items-center justify-end gap-4 w-1/3 order-2 md:order-3" onClick={e => e.stopPropagation()}>
            {/* Quality badge — reflects the stream actually playing, so picking
                320/128 in the picker retitles this too. */}
            {barSpecs && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[9px] font-extrabold bg-gradient-to-r from-teal-400 to-indigo-500 text-white tracking-wider border border-white/20 shadow-[0_0_10px_rgba(45,212,191,0.3)] flex-shrink-0">
                {barSpecs}
              </span>
            )}
            {/* Share: copy a deep link to this track */}
            <button
              onClick={(e) => { e.stopPropagation(); shareTrack(); }}
              aria-label="Copy link to this track" title="Copy link"
              className="transition-colors hover:text-[var(--text-primary)]"
              style={{ color: "var(--text-muted)" }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z" />
              </svg>
            </button>

            {/* Sleep timer */}
            <div className="relative" ref={sleepMenuRef}>
              <button
                onClick={(e) => { e.stopPropagation(); setShowSleepMenu((v) => !v); }}
                aria-label="Sleep timer" aria-pressed={sleepMode !== "off"}
                title={sleepMode === "off" ? "Sleep timer" : "Sleep timer on"}
                className="flex items-center gap-1 transition-colors hover:text-[var(--text-primary)]"
                style={{ color: sleepMode !== "off" ? accent : "var(--text-muted)" }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.39 5.39 0 0 1-4.4 2.26 5.4 5.4 0 0 1-5.4-5.4c0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z" />
                </svg>
                {sleepMode !== "off" && (
                  <span className="text-[10px] font-mono tabular-nums">
                    {sleepMode === "end"
                      ? "track"
                      : sleepLeftMs != null
                      ? formatTime(Math.ceil(sleepLeftMs / 1000))
                      : ""}
                  </span>
                )}
              </button>
              {showSleepMenu && (
                <div
                  className="absolute bottom-full right-0 mb-2 w-44 rounded-xl border p-1.5 shadow-[0_20px_60px_rgba(0,0,0,0.7)] z-50"
                  style={{ background: "var(--bg-secondary)", borderColor: "var(--border-card)" }}
                >
                  <p className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                    Sleep timer
                  </p>
                  {SLEEP_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => chooseSleep(opt.value)}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg text-sm transition-colors hover:bg-[var(--bg-card-hover)]"
                      style={{ color: sleepMode === opt.value ? accent : "var(--text-primary)" }}
                    >
                      {opt.label}
                    </button>
                  ))}
                  {sleepMode !== "off" && (
                    <button
                      onClick={() => chooseSleep("off")}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg text-sm transition-colors hover:bg-[var(--bg-card-hover)]"
                      style={{ color: "var(--text-muted)" }}
                    >
                      Turn off
                    </button>
                  )}
                </div>
              )}
            </div>

            <button
              onClick={(e) => { e.stopPropagation(); setShowQueue((v) => !v); }}
              aria-label="Queue"
              aria-pressed={showQueue}
              title="Queue"
              className="transition-colors hover:text-[var(--text-primary)]"
              style={{ color: showQueue ? accent : "var(--text-muted)" }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 18h13v-2H3v2zm0-5h10v-2H3v2zm0-7v2h13V6H3zm18 9.59L17.42 12 21 8.41 19.59 7l-5 5 5 5L21 15.59z" />
              </svg>
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={toggleMute}
                aria-label={volume === 0 ? "Unmute" : "Mute"} title={volume === 0 ? "Unmute" : "Mute"}
                className="transition-colors hover:text-[var(--text-primary)]"
                style={{ color: volume === 0 ? accent : "var(--text-muted)" }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d={
                    volume === 0
                      ? "M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 15.91 21 14 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"
                      : volume < 0.5
                      ? "M5 9v6h4l5 5V4L9 9H5zm11.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"
                      : "M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"
                  } />
                </svg>
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volume}
                onChange={handleVolumeChange}
                title={`${Math.round(volume * 100)}%`}
                className="w-24 h-1.5 rounded-full appearance-none outline-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, ${accent} ${volume * 100}%, var(--border-card) ${volume * 100}%)`,
                  accentColor: accent,
                }}
              />
              <span className="text-[10px] font-mono tabular-nums w-7 text-right" style={{ color: "var(--text-muted)" }}>
                {Math.round(volume * 100)}
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
