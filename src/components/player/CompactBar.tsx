"use client";

import Link from "next/link";
import { Track } from "@/lib/cloudflare";
import { cleanTitle } from "@/lib/cleanTitle";
import { formatAudioSpecs } from "@/lib/formatSpecs";
import { type StreamQuality } from "@/lib/useStreamQuality";
import { formatTime, SLEEP_OPTIONS, type SleepMode } from "./playerUtils";
import LargeCoverArt from "./LargeCoverArt";

type CompactBarProps = {
  barTrack: Track;
  currentTrack: Track;
  accent: string;
  accentSoft: string;
  accentFill: string;
  isPlaying: boolean;
  showQueue: boolean;
  volume: number;
  progress: number;
  duration: number;
  progressPercent: number;
  repeatMode: "off" | "all" | "one";
  shuffle: boolean;
  barSpecs: string | null;
  streamQuality: StreamQuality;
  // Sleep timer
  sleepMode: SleepMode;
  sleepLeftMs: number | null;
  showSleepMenu: boolean;
  sleepMenuRef: React.RefObject<HTMLDivElement | null>;
  // Handlers
  onExpand: () => void;
  onTogglePlay: (e?: React.MouseEvent) => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleRepeat: () => void;
  onToggleShuffle: () => void;
  onToggleQueue: () => void;
  onVolumeChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onToggleMute: (e: React.MouseEvent) => void;
  onShareTrack: () => void;
  onChooseSleep: (value: SleepMode) => void;
  onToggleSleepMenu: () => void;
  onSeek: (time: number) => void;
  formatTime: (time: number) => string;
};

export default function CompactBar(props: CompactBarProps) {
  const {
    barTrack, currentTrack, accent, accentSoft, accentFill,
    isPlaying, showQueue, volume,
    progress, duration, progressPercent,
    repeatMode, shuffle, barSpecs, streamQuality,
    sleepMode, sleepLeftMs, showSleepMenu, sleepMenuRef,
    onExpand, onTogglePlay, onPrev, onNext,
    onToggleRepeat, onToggleShuffle, onToggleQueue,
    onVolumeChange, onToggleMute, onShareTrack,
    onChooseSleep, onToggleSleepMenu, onSeek,
    formatTime: fmt,
  } = props;

  return (
    <div
      className="glass-panel glass-chrome fixed bottom-[4rem] md:bottom-0 left-0 w-full h-auto min-h-[6rem] py-3 md:py-0 md:h-24 border-t-0 border-b-0 border-l-0 border-r-0 px-4 md:px-8 flex flex-col md:flex-row items-center justify-between z-50 gap-4 md:gap-0 cursor-pointer backdrop-blur-xl transition-colors shadow-[0_-10px_40px_rgba(0,0,0,0.5)]"
      onContextMenu={(e) => e.preventDefault()}
      onClick={onExpand}
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
          <button onClick={(e) => { e.stopPropagation(); onTogglePlay(); }} aria-label={isPlaying ? "Pause" : "Play"} className="w-10 h-10 rounded-full flex items-center justify-center text-white bg-white/10 hover:bg-white/20 active:scale-95 transition-all shadow-md">
            {isPlaying ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="ml-0.5"><path d="M8 5v14l11-7z"/></svg>
            )}
          </button>
          <button onClick={(e) => { e.stopPropagation(); onExpand(); }} className="w-9 h-9 flex items-center justify-center text-slate-400 hover:text-white transition-colors">
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
          <button
            onClick={(e) => { e.stopPropagation(); onToggleShuffle(); }}
            className="hover:opacity-80 transition-opacity"
            style={{ color: shuffle ? accent : "var(--text-muted)" }}
            aria-label={shuffle ? "Shuffle on" : "Shuffle off"} aria-pressed={shuffle} title={shuffle ? "Shuffle: on" : "Shuffle: off"}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
          </button>
          <button onClick={onPrev} aria-label="Previous track" className="hover:opacity-80 transition-opacity" style={{ color: "var(--text-primary)" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
          </button>
          <button
            onClick={onTogglePlay} aria-label={isPlaying ? "Pause" : "Play"}
            className="w-10 h-10 rounded-full text-white flex items-center justify-center hover:scale-105 transition-transform"
            style={{ background: accentFill, boxShadow: `0 0 15px ${accentSoft}` }}
          >
            {isPlaying ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="ml-1"><path d="M8 5v14l11-7z"/></svg>
            )}
          </button>
          <button onClick={() => onNext()} aria-label="Next track" className="hover:opacity-80 transition-opacity" style={{ color: "var(--text-primary)" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onToggleRepeat(); }}
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

        {/* Progress bar */}
        <div className="flex-1 flex items-center gap-4 min-w-0">
          <span className="text-xs font-mono w-10 text-right" style={{ color: "var(--text-muted)" }}>{fmt(progress)}</span>

          <div className="h-10 flex-1 relative flex items-center cursor-pointer group"
               onClick={(e) => {
                 if (duration) {
                   const rect = e.currentTarget.getBoundingClientRect();
                   onSeek(((e.clientX - rect.left) / rect.width) * duration);
                 }
               }}>

            {/* Track + played fill */}
            <div className="w-full h-1 rounded-full bg-white/15 overflow-hidden transition-[height] group-hover:h-1.5">
              <div className="h-full rounded-full" style={{ width: `${progressPercent}%`, background: accent }}></div>
            </div>

            {/* Playhead knob — grows on hover */}
            <div
              className="absolute w-3 h-3 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.6)] pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity -translate-x-1/2"
              style={{ left: `${progressPercent}%` }}
            ></div>
          </div>

          <span className="text-xs font-mono w-10" style={{ color: "var(--text-muted)" }}>{fmt(duration)}</span>
        </div>
      </div>

      {/* Extra controls */}
      <div className="hidden md:flex items-center justify-end gap-4 w-1/3 order-2 md:order-3" onClick={e => e.stopPropagation()}>
        {barSpecs && (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[9px] font-extrabold bg-gradient-to-r from-teal-400 to-indigo-500 text-white tracking-wider border border-white/20 shadow-[0_0_10px_rgba(45,212,191,0.3)] flex-shrink-0">
            {barSpecs}
          </span>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onShareTrack(); }}
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
            onClick={(e) => { e.stopPropagation(); onToggleSleepMenu(); }}
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
                  ? fmt(Math.ceil(sleepLeftMs / 1000))
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
                  onClick={() => onChooseSleep(opt.value)}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg text-sm transition-colors hover:bg-[var(--bg-card-hover)]"
                  style={{ color: sleepMode === opt.value ? accent : "var(--text-primary)" }}
                >
                  {opt.label}
                </button>
              ))}
              {sleepMode !== "off" && (
                <button
                  onClick={() => onChooseSleep("off")}
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
          onClick={(e) => { e.stopPropagation(); onToggleQueue(); }}
          aria-label="Queue" aria-pressed={showQueue} title="Queue"
          className="transition-colors hover:text-[var(--text-primary)]"
          style={{ color: showQueue ? accent : "var(--text-muted)" }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 18h13v-2H3v2zm0-5h10v-2H3v2zm0-7v2h13V6H3zm18 9.59L17.42 12 21 8.41 19.59 7l-5 5 5 5L21 15.59z" />
          </svg>
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleMute}
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
            type="range" min="0" max="1" step="0.01" value={volume}
            onChange={onVolumeChange} title={`${Math.round(volume * 100)}%`}
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
  );
}
