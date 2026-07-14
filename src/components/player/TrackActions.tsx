"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { Track } from "@/lib/cloudflare";
import { useToast } from "@/context/ToastContext";
import { addTrackToPlaylistAction } from "@/app/actions/playlists";

type PlaylistOption = { id: string; name: string };

export default function TrackActions({
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
