"use client";

import Link from "next/link";
import { Track } from "@/lib/cloudflare";
import { cleanTitle } from "@/lib/cleanTitle";
import { formatAudioSpecs } from "@/lib/formatSpecs";
import { type StreamQuality } from "@/lib/useStreamQuality";
import { formatTime, SLEEP_OPTIONS, type SleepMode } from "./playerUtils";
import LargeCoverArt from "./LargeCoverArt";
import TrackActions from "./TrackActions";
import QualityBadgePicker from "./QualityBadgePicker";
import { countSyllables } from "@/hooks/useLyrics";
import type { RGB } from "@/lib/useCoverColor";

type ParsedLyric = { time: number; text: string };

type ExpandedPlayerProps = {
  currentTrack: Track;
  accent: string;
  accentSoft: string;
  accentFill: string;
  ambientBg: string;
  desktopOffset: number;
  isPlaying: boolean;
  showQueue: boolean;
  liked: boolean;
  streamQuality: StreamQuality;
  progress: number;
  duration: number;
  progressPercent: number;
  volume: number;
  repeatMode: "off" | "all" | "one";
  shuffle: boolean;
  // Lyrics
  parsedLyrics: ParsedLyric[] | null;
  activeLyricIndex: number;
  lyricsOffset: number;
  externalLyrics: string | null;
  isFetchingLyrics: boolean;
  activeTab: "player" | "lyrics";
  hasLyrics: boolean;
  lyricsContainerRef: React.RefObject<HTMLDivElement | null>;
  // Handlers
  onClose: () => void;
  onToggleQueue: () => void;
  onTogglePlay: (e?: React.MouseEvent) => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleRepeat: () => void;
  onToggleShuffle: () => void;
  onToggleLike: () => void;
  onVolumeChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onToggleMute: (e: React.MouseEvent) => void;
  onSetActiveTab: (tab: "player" | "lyrics") => void;
  onAdjustOffset: (delta: number) => void;
  onStreamQualityChange: (q: StreamQuality) => void;
  onSeek: (time: number) => void;
  formatTime: (time: number) => string;
};

export default function ExpandedPlayer(props: ExpandedPlayerProps) {
  const {
    currentTrack, accent, accentSoft, accentFill, ambientBg,
    desktopOffset, isPlaying, showQueue, liked,
    streamQuality, progress, duration, progressPercent, volume,
    repeatMode, shuffle,
    parsedLyrics, activeLyricIndex, lyricsOffset,
    externalLyrics, isFetchingLyrics, activeTab, hasLyrics,
    lyricsContainerRef,
    onClose, onToggleQueue, onTogglePlay, onPrev, onNext,
    onToggleRepeat, onToggleShuffle, onToggleLike,
    onVolumeChange, onToggleMute,
    onSetActiveTab, onAdjustOffset, onStreamQualityChange,
    onSeek, formatTime: fmt,
  } = props;

  return (
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
        <button
          onClick={onClose}
          className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white backdrop-blur-md transition-all active:scale-95"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
          </svg>
        </button>

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

        <button
          onClick={(e) => { e.stopPropagation(); onToggleQueue(); }}
          aria-label="Queue" aria-pressed={showQueue} title="Queue"
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

        {/* ─── MOBILE TAB SWITCHER ──────────── */}
        {hasLyrics && (
          <div className="lg:hidden flex items-center bg-white/5 mx-5 rounded-xl p-1 gap-1 flex-shrink-0 mb-2">
            <button
              onClick={() => onSetActiveTab("player")}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${activeTab === "player" ? "bg-white/15 text-white" : "text-slate-400"}`}
            >
              Player
            </button>
            <button
              onClick={() => onSetActiveTab("lyrics")}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${activeTab === "lyrics" ? "bg-white/15 text-white" : "text-slate-400"}`}
            >
              Lyrics
              {isFetchingLyrics && <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" />}
            </button>
          </div>
        )}

        {/* ─── LEFT: track info (desktop) ────────── */}
        <div className="hidden lg:flex lg:flex-col lg:justify-center lg:w-[30%] xl:w-[26%] flex-shrink-0 px-10 gap-2">
          <h2 className="font-black text-4xl xl:text-5xl text-white leading-[1.05] tracking-tight drop-shadow-lg mb-1">
            {cleanTitle(currentTrack.title)}
          </h2>
          {currentTrack.artist ? (
            <Link href={`/artist/${encodeURIComponent(currentTrack.artist)}`} onClick={onClose} className="text-xl font-bold hover:underline w-fit mb-1" style={{ color: accent }}>
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
          <QualityBadgePicker track={currentTrack} quality={streamQuality} onChange={onStreamQualityChange} />
          <div className="mt-4">
            <TrackActions
              track={currentTrack} liked={liked} onToggleLike={onToggleLike}
              accentFill={accentFill} iconSize={28} gapClass="gap-7" onNavigate={onClose}
            />
          </div>
        </div>

        {/* ─── CENTER: cover + controls ────────── */}
        <div className={`flex flex-col items-center justify-center lg:flex-1 px-6 overflow-y-auto ${hasLyrics && activeTab === "lyrics" ? "hidden lg:flex" : "flex"}`}>
          <div className="relative flex items-center justify-center mt-2 mb-12">
            <div className="absolute rounded-full blur-[100px] pointer-events-none" style={{ width: "130%", height: "130%", background: `radial-gradient(circle, ${accentSoft}, transparent 66%)` }} />
            <div
              className="relative w-72 h-72 sm:w-80 sm:h-80 lg:w-[24rem] lg:h-[24rem] xl:w-[28rem] xl:h-[28rem] rounded-2xl overflow-hidden flex-shrink-0"
              style={{ boxShadow: `0 40px 100px rgba(0,0,0,0.6), 0 0 80px ${accentSoft}` }}
            >
              <LargeCoverArt title={currentTrack.title} category={currentTrack.category} coverUrl={currentTrack.cover_url} size="lg" />
            </div>
          </div>

          {/* Mobile-only meta */}
          <div className="lg:hidden w-full flex flex-col items-center text-center mt-4 mb-2 px-4">
            <h2 className="font-black text-2xl text-white leading-tight tracking-tight mb-1">
              {cleanTitle(currentTrack.title)}
            </h2>
            {currentTrack.artist ? (
              <Link href={`/artist/${encodeURIComponent(currentTrack.artist)}`} onClick={onClose} className="text-base font-bold hover:underline mb-1" style={{ color: accent }}>
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
            <QualityBadgePicker track={currentTrack} quality={streamQuality} onChange={onStreamQualityChange} />
            <div className="mt-3 mb-2">
              <TrackActions
                track={currentTrack} liked={liked} onToggleLike={onToggleLike}
                accentFill={accentFill} iconSize={26} gapClass="gap-8" onNavigate={onClose}
              />
            </div>
          </div>

          {/* PROGRESS BAR */}
          <div className="w-full mb-5">
            <div
              className="h-1.5 w-full bg-white/15 rounded-full overflow-hidden relative cursor-pointer group mb-2"
              onClick={(e) => {
                if (duration) {
                  const rect = e.currentTarget.getBoundingClientRect();
                  onSeek(((e.clientX - rect.left) / rect.width) * duration);
                }
              }}
            >
              <div
                className="absolute top-0 left-0 h-full rounded-full transition-all"
                style={{ width: `${progressPercent}%`, background: accent, boxShadow: `0 0 10px ${accentSoft}` }}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white shadow-md -ml-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ left: `${progressPercent}%` }}
              />
            </div>
            <div className="flex justify-between text-xs font-mono tabular-nums">
              <span className="text-slate-200">{fmt(progress)}</span>
              <span className="text-slate-500">{fmt(duration)}</span>
            </div>
          </div>

          {/* CONTROLS */}
          <div className="flex items-center justify-center gap-5 sm:gap-7 w-full mb-6">
            <button
              onClick={(e) => { e.stopPropagation(); onToggleShuffle(); }}
              className="transition-all active:scale-90 hover:scale-110"
              style={{ color: shuffle ? accent : "#94a3b8" }}
              aria-label={shuffle ? "Shuffle on" : "Shuffle off"} aria-pressed={shuffle} title={shuffle ? "Shuffle: on" : "Shuffle: off"}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
            </button>

            <button
              onClick={(e) => { e.stopPropagation(); onPrev(); }}
              aria-label="Previous track"
              className="text-slate-300 hover:text-white transition-all active:scale-90 hover:scale-110"
            >
              <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
            </button>

            <button
              onClick={onTogglePlay} aria-label={isPlaying ? "Pause" : "Play"}
              className="w-20 h-20 rounded-full text-white flex items-center justify-center hover:scale-105 active:scale-95 transition-all"
              style={{ background: accentFill, boxShadow: `0 0 35px ${accentSoft}` }}
            >
              {isPlaying ? (
                <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
              ) : (
                <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor" className="ml-1.5"><path d="M8 5v14l11-7z"/></svg>
              )}
            </button>

            <button
              onClick={(e) => { e.stopPropagation(); onNext(); }}
              aria-label="Next track"
              className="text-slate-300 hover:text-white transition-all active:scale-90 hover:scale-110"
            >
              <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
            </button>

            <button
              onClick={(e) => { e.stopPropagation(); onToggleRepeat(); }}
              className="relative transition-all active:scale-90 hover:scale-110"
              style={{ color: repeatMode !== "off" ? accent : "#94a3b8" }}
              aria-label={`Repeat ${repeatMode}`} aria-pressed={repeatMode !== "off"} title={`Repeat: ${repeatMode}`}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>
              {repeatMode === "one" && (
                <span className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full text-[8px] font-black flex items-center justify-center" style={{ background: accent, color: "#0d111c" }}>1</span>
              )}
            </button>
          </div>

          {/* EXTRA CONTROLS */}
          <div className="flex items-center w-full px-2" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2.5 w-full max-w-xs mx-auto">
              <button
                onClick={onToggleMute}
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
                type="range" min="0" max="1" step="0.01" value={volume}
                onChange={onVolumeChange} title={`${Math.round(volume * 100)}%`}
                className="flex-1 h-1.5 rounded-full appearance-none outline-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, ${accent} ${volume * 100}%, rgba(255,255,255,0.18) ${volume * 100}%)`,
                  accentColor: accent,
                }}
              />
              <span className="text-[10px] font-mono tabular-nums w-7 text-right text-slate-400">
                {Math.round(volume * 100)}
              </span>
            </div>
          </div>
        </div>

        {/* ─── LYRICS PANEL ─────────────────────────────────────────── */}
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
                        onClick={() => onAdjustOffset(-0.5)}
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
                            onClick={() => onAdjustOffset(-lyricsOffset)}
                            className="text-slate-500 hover:text-teal-400 transition-colors flex items-center"
                            title="Reset to 0"
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" /></svg>
                          </button>
                        )}
                      </div>
                      <button
                        onClick={() => onAdjustOffset(+0.5)}
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
                          onClick={() => onSeek(lyric.time)}
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
                  <div className="text-sm font-semibold leading-relaxed text-white/70 whitespace-pre-wrap pb-32">
                    {externalLyrics || currentTrack.lyrics}
                  </div>
                ) : isFetchingLyrics ? (
                  <div className="flex items-center gap-2 text-sm font-semibold text-white/50 pb-32">
                    <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" />
                    Searching for lyrics…
                  </div>
                ) : (
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
  );
}
