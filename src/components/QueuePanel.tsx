"use client";

import { useState, useEffect } from "react";
import { usePlayer } from "@/context/PlayerContext";
import { cleanTitle } from "@/lib/cleanTitle";
import { formatDuration } from "@/lib/utils";
import CoverImage from "@/components/CoverImage";
import type { Track } from "@/lib/cloudflare";
import { describePlayback, isLosslessSource, audioFormat, formatKhz } from "@/lib/formatSpecs";
import TrackDuration from "@/components/TrackDuration";

function MiniCover({ track }: { track: Track }) {
  if (track.cover_url) {
    return <CoverImage src={track.cover_url} alt="" />;
  }
  return (
    <div className="w-full h-full flex items-center justify-center" style={{ background: "linear-gradient(135deg, var(--accent), #6366f1)" }}>
      <svg width="40%" height="40%" viewBox="0 0 24 24" fill="white" className="opacity-90">
        <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
      </svg>
    </div>
  );
}

function HiResDetail({ track, accent, coverColor }: { 
  track: Track; 
  accent?: string; 
  coverColor?: { r: number; g: number; b: number }; 
}) {
  const specs = describePlayback(track);
  if (!specs) return null;

  // A lossy file has no real bit depth, so it can't be hi-res no matter what
  // the decoder reported at upload time — describePlayback already knows this.
  const isHiRes = specs.hiRes;
  const lossless = isLosslessSource(track);

  return (
    <div
      className="mx-3 mb-3 rounded-xl p-3"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
    >
      <div className="flex items-center gap-2 mb-2.5">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: "var(--bg-card-hover)" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ color: "var(--text-secondary)" }}>
            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
          </svg>
        </div>
        <span className="text-[10px] font-black tracking-[0.15em] uppercase" style={{ color: "var(--text-secondary)" }}>
          Audio Quality
        </span>
        {isHiRes && (
          <span className="ml-auto px-2 py-0.5 rounded text-[9px] font-black tracking-wider" style={{ background: "var(--bg-card-hover)", color: "var(--text-primary)" }}>
            HI-RES
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {lossless && track.bit_depth && (
          <div className="rounded-lg px-2.5 py-2" style={{ background: "var(--bg-card-hover)" }}>
            <p className="text-[9px] font-bold uppercase tracking-wider mb-0.5" style={{ color: "var(--text-secondary)" }}>
              Bit Depth
            </p>
            <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              {track.bit_depth}-bit
            </p>
          </div>
        )}
        {track.sample_rate && (
          <div className="rounded-lg px-2.5 py-2" style={{ background: "var(--bg-card-hover)" }}>
            <p className="text-[9px] font-bold uppercase tracking-wider mb-0.5" style={{ color: "var(--text-secondary)" }}>
              Sample Rate
            </p>
            <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              {formatKhz(track.sample_rate)} kHz
            </p>
          </div>
        )}
        {audioFormat(track.file_url) && (
          <div className="rounded-lg px-2.5 py-2" style={{ background: "var(--bg-card-hover)" }}>
            <p className="text-[9px] font-bold uppercase tracking-wider mb-0.5" style={{ color: "var(--text-secondary)" }}>
              Format
            </p>
            <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              {audioFormat(track.file_url)!.label}
            </p>
          </div>
        )}
        {track.duration && (
          <div className="rounded-lg px-2.5 py-2" style={{ background: "var(--bg-card-hover)" }}>
            <p className="text-[9px] font-bold uppercase tracking-wider mb-0.5" style={{ color: "var(--text-secondary)" }}>
              Duration
            </p>
            <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              {formatDuration(track.duration)}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// Slide-in "Up Next" drawer. Reads the upcoming queue from the player and lets
// the user jump straight to any track (respects shuffle order).
export default function QueuePanel({
  open,
  onClose,
  expanded = false,
  accent = "var(--accent)",
  accentSoft = "rgba(45, 212, 191, 0.5)",
  coverColor = { r: 45, g: 212, b: 191 }
}: {
  open: boolean;
  onClose: () => void;
  // True while the fullscreen ExpandedPlayer is open. There the queue can't sit
  // in a shifted content column (there is none) — it would slide in transparent
  // right over the lyrics. So we make it a proper opaque drawer with its own
  // dimming backdrop instead of colliding with the lyrics behind it.
  expanded?: boolean;
  accent?: string;
  accentSoft?: string;
  coverColor?: { r: number; g: number; b: number };
}) {
  const { tracks, currentTrackIndex, upcoming, setCurrentTrackIndex, reorderUpcoming } = usePlayer();
  const current = tracks[currentTrackIndex];

  const [desktopOffset, setDesktopOffset] = useState(0);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [activeDragHandle, setActiveDragHandle] = useState<number | null>(null);
  useEffect(() => {
    if ((window as { __ZENIFY_DESKTOP__?: boolean }).__ZENIFY_DESKTOP__) setDesktopOffset(32);
  }, []);

  return (
    <>
      {/* Click-away backdrop. Normal view: mobile-only (desktop shifts the main
          layout to make room). Fullscreen (expanded): always shown, covering the
          whole player so the drawer reads as a modal over it, not a collision. */}
      {open && (
        <div
          className={
            expanded
              ? "fixed inset-0 z-[105] bg-black/50 queue-backdrop-in"
              : "fixed inset-x-0 bottom-0 top-[77px] md:top-[89px] z-[105] bg-black/30 queue-backdrop-in md:hidden"
          }
          style={expanded ? undefined : { marginTop: `${desktopOffset}px` }}
          onClick={onClose}
        />
      )}

      <aside
        role="dialog"
        aria-label="Play queue"
        className={`fixed right-0 w-[300px] max-w-[88vw] z-[110] flex flex-col shadow-2xl transition-transform duration-500 ease-in-out ${
          expanded ? "" : "top-[77px] md:top-[89px] bottom-24"
        } ${open ? "translate-x-0" : "translate-x-full"}`}
        style={{
          // Fullscreen: a full-height, opaque frosted drawer so the lyrics behind
          // never show through. Normal: transparent — it lives in a content column
          // over the page's own dynamic background.
          ...(expanded
            ? {
                top: desktopOffset,
                bottom: 0,
                background: "rgba(13, 17, 28, 0.94)",
                backdropFilter: "blur(24px)",
                WebkitBackdropFilter: "blur(24px)",
              }
            : { marginTop: `${desktopOffset}px`, background: "transparent" }),
          borderLeft: "1px solid var(--border-subtle)",
        }}
      >
        {/* ─── Sticky Header ─── */}
        <header
          className="flex items-center justify-between px-5 py-4 flex-shrink-0 sticky top-0 z-20"
          style={{
            background: "transparent",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          <h2 className="text-base font-black" style={{ color: "var(--text-primary)" }}>
            Queue
          </h2>
          <button
            onClick={onClose}
            aria-label="Close queue"
            className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
            style={{ color: "var(--text-muted)", background: "var(--bg-card-hover)" }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </header>

        {/* ─── Scrollable Content ─── */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {current && (
            <div className="px-3 pt-5">
              <p className="px-2 mb-2.5 text-[10px] font-bold tracking-[0.15em] uppercase" style={{ color: "var(--text-secondary)" }}>
                Now playing
              </p>
              <div className="flex items-center gap-3 p-2.5 rounded-xl mb-2" style={{ 
                background: "var(--bg-card)",
                border: "1px solid var(--border-card)",
              }}>
                <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 shadow-md">
                  <MiniCover track={current} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-sm truncate" style={{ color: "var(--text-primary)" }}>
                    {cleanTitle(current.title)}
                  </p>
                  <p className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>
                    {current.artist || current.category}
                  </p>
                  <TrackDuration
                    track={current}
                    className="text-[10px] mt-0.5 block"
                    style={{ color: "var(--text-secondary)" }}
                  />
                </div>
                {/* Equalizer animation */}
                <div className="flex items-end gap-[2px] h-4 flex-shrink-0 pr-1">
                  <span className="eq-bar" style={{ background: "var(--text-secondary)", animationDelay: "0s" }} />
                  <span className="eq-bar" style={{ background: "var(--text-secondary)", animationDelay: "0.2s" }} />
                  <span className="eq-bar" style={{ background: "var(--text-secondary)", animationDelay: "0.4s" }} />
                </div>
              </div>
            </div>
          )}

          {/* Hi-Res Detail */}
          {current && <HiResDetail track={current} accent={accent} coverColor={coverColor} />}

          {/* ─── Up Next ─── */}
          <div className="px-3 pb-32">
            <div className="flex items-center justify-between px-2 mb-2 mt-1">
              <p className="text-[10px] font-bold tracking-[0.15em] uppercase" style={{ color: "var(--text-secondary)" }}>
                Up next
              </p>
              {upcoming.length > 0 && (
                <span className="text-[10px] font-semibold" style={{ color: "var(--text-secondary)" }}>
                  {upcoming.length} track{upcoming.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            {upcoming.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center mb-1"
                  style={{ background: "var(--bg-card)" }}
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" style={{ color: "var(--text-muted)" }}>
                    <path d="M3 18h13v-2H3v2zm0-5h10v-2H3v2zm0-7v2h13V6H3zm18 9.59L17.42 12 21 8.41 19.59 7l-5 5 5 5L21 15.59z" />
                  </svg>
                </div>
                <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                  No more tracks
                </p>
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  This is the last track in the queue.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-0.5">
                {upcoming.map((u, i) => (
                  <div
                    key={`${u.index}-${i}`}
                    draggable={activeDragHandle === i}
                    onDragStart={(e) => {
                      e.stopPropagation();
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", i.toString());
                      setDraggedIndex(i);
                    }}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDragOverIndex(i);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      e.dataTransfer.dropEffect = "move";
                      setDragOverIndex(i);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDragOverIndex(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const fromIdx = draggedIndex !== null ? draggedIndex : parseInt(e.dataTransfer.getData("text/plain"), 10);
                      if (fromIdx !== null && !isNaN(fromIdx) && fromIdx !== i) {
                        reorderUpcoming(fromIdx, i);
                      }
                      setDraggedIndex(null);
                      setDragOverIndex(null);
                      setActiveDragHandle(null);
                    }}
                    onDragEnd={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDraggedIndex(null);
                      setDragOverIndex(null);
                      setActiveDragHandle(null);
                    }}
                    className={`group queue-item-in flex items-center gap-3 p-2 rounded-xl text-left transition-all hover:bg-[var(--bg-card-hover)] ${
                      dragOverIndex === i ? "border-t-2 border-[var(--accent)] bg-[var(--bg-card)]" : ""
                    } ${draggedIndex === i ? "opacity-50" : ""}`}
                    style={{ animationDelay: `${0.08 + Math.min(i, 8) * 0.04}s` }}
                  >
                    {/* Clickable track info */}
                    <div 
                      className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
                      onClick={() => setCurrentTrackIndex(u.index)}
                      title="Play track"
                    >
                      <span
                        className="w-5 text-center text-[11px] font-semibold flex-shrink-0 tabular-nums group-hover:text-[var(--accent)] transition-colors"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        {i + 1}
                      </span>
                      <div className="w-10 h-10 rounded-md overflow-hidden flex-shrink-0">
                        <MiniCover track={u.track} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm truncate group-hover:text-[var(--accent)] transition-colors" style={{ color: "var(--text-primary)" }}>
                          {cleanTitle(u.track.title)}
                        </p>
                        <p className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>
                          {u.track.artist || u.track.category}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <TrackDuration
                        track={u.track}
                        className="text-[10px] font-medium tabular-nums"
                        style={{ color: "var(--text-secondary)" }}
                      />
                      <div 
                        className="w-6 h-6 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing" 
                        style={{ color: "var(--text-muted)", background: "var(--bg-card)" }}
                        title="Drag to reorder"
                        onMouseEnter={() => setActiveDragHandle(i)}
                        onMouseLeave={() => setActiveDragHandle(null)}
                        onTouchStart={() => setActiveDragHandle(i)}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="9" cy="12" r="1" />
                          <circle cx="9" cy="5" r="1" />
                          <circle cx="9" cy="19" r="1" />
                          <circle cx="15" cy="12" r="1" />
                          <circle cx="15" cy="5" r="1" />
                          <circle cx="15" cy="19" r="1" />
                        </svg>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
