"use client";

import { useState } from "react";
import { useAudioEngine } from "@/hooks/useAudioEngine";
import { useLyrics } from "@/hooks/useLyrics";
import { useFavorites } from "@/hooks/useFavorites";
import { useCoverColor } from "@/lib/useCoverColor";
import { formatAudioSpecs } from "@/lib/formatSpecs";
import { computeAccentColors } from "@/components/player/playerUtils";
import dynamic from "next/dynamic";
import CompactBar from "@/components/player/CompactBar";

// The compact bar is the default, always-visible view, so it loads eagerly.
// The expanded player and the queue panel are opened on demand and carry a lot
// of their own markup — split them into their own chunks so the initial /player
// payload doesn't pay for UI most sessions never open. Both live inside this
// already client-only (ssr:false) tree, so their chunks are client-only too.
const ExpandedPlayer = dynamic(() => import("@/components/player/ExpandedPlayer"), {
  loading: () => null,
});
const QueuePanel = dynamic(() => import("@/components/QueuePanel"), {
  loading: () => null,
});

export default function BottomPlayer() {
  // ── Core audio engine ──────────────────────────────────────────────────────
  const engine = useAudioEngine();
  const {
    currentTrack, audioRef, tailRef,
    audioContextRef, gainNodeRef,
    isExpanded, setIsExpanded, desktopOffset,
    isPlaying, volume, progress, duration, progressPercent,
    crossfadePrevTrack,
    sleepMode, sleepLeftMs, showSleepMenu, sleepMenuRef,
    showQueue, setShowQueue,
    streamQuality, setStreamQuality,
    audioSrc, nextAudioSrc, nativeActive,
    togglePlay, handlePrev,
    handleTimeUpdate, handleLoadedMetadata,
    handleEnded, handleAudioError, handlePlaying,
    reportPositionState,
    handleVolumeChange, toggleMute,
    chooseSleep, setShowSleepMenu,
    shareTrack, formatTime,
    playNextTrack, repeatMode, shuffle,
    toggleRepeat, toggleShuffle, upcoming, tracks,
  } = engine;

  // ── Cover colour & accent derivation ───────────────────────────────────────
  const coverColor = useCoverColor(currentTrack?.cover_url);
  const { cc, accent, accentSoft, accentFill, ambientBg } = computeAccentColors(coverColor);

  // ── Favorites ──────────────────────────────────────────────────────────────
  const { liked, toggleLike } = useFavorites(currentTrack);

  // ── Lyrics ─────────────────────────────────────────────────────────────────
  const lyrics = useLyrics(currentTrack, audioRef, audioContextRef, isPlaying, isExpanded);

  // Latch the queue panel's first open so its dynamic chunk isn't fetched on
  // load; once mounted it stays mounted so the slide-out still animates on close.
  const [queueMounted, setQueueMounted] = useState(false);

  // ── Bail if nothing loaded ─────────────────────────────────────────────────
  if (!currentTrack) return null;

  // The track shown in the compact bottom bar. During a crossfade this lags on
  // the outgoing track so the bar doesn't reveal the ~6s audio overlap.
  const barTrack = crossfadePrevTrack ?? currentTrack;
  const barSpecs = formatAudioSpecs(barTrack, streamQuality);

  // ── Seek handler (shared by both views) ────────────────────────────────────
  const handleSeek = (time: number) => {
    if (audioRef.current) audioRef.current.currentTime = time;
  };

  // Opening the queue mounts its chunk on demand (see queueMounted latch above).
  const toggleQueue = () => {
    setQueueMounted(true);
    setShowQueue((v) => !v);
  };

  return (
    <>
      {/* In native mode (desktop Direct Mode) the Go engine plays the audio —
          no elements are mounted and audioRef points at the native shim. */}
      {!nativeActive && (
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
          {/* Outgoing-track tail player for crossfade */}
          <audio
            ref={tailRef}
            crossOrigin="anonymous"
            preload="auto"
            controlsList="nodownload"
          />
          {/* Warms up the NEXT track */}
          {nextAudioSrc && (
            <audio
              src={nextAudioSrc}
              crossOrigin="anonymous"
              preload="metadata"
              muted
              controlsList="nodownload"
            />
          )}
        </>
      )}

      {queueMounted && (
        <QueuePanel
          open={showQueue}
          onClose={() => setShowQueue(false)}
          accent={accent}
          accentSoft={accentSoft}
          coverColor={cc}
        />
      )}

      {isExpanded ? (
        <ExpandedPlayer
          currentTrack={currentTrack}
          accent={accent}
          accentSoft={accentSoft}
          accentFill={accentFill}
          ambientBg={ambientBg}
          desktopOffset={desktopOffset}
          isPlaying={isPlaying}
          showQueue={showQueue}
          liked={liked}
          streamQuality={streamQuality}
          progress={progress}
          duration={duration}
          progressPercent={progressPercent}
          volume={volume}
          repeatMode={repeatMode}
          shuffle={shuffle}
          // Lyrics
          parsedLyrics={lyrics.parsedLyrics}
          activeLyricIndex={lyrics.activeLyricIndex}
          lyricsOffset={lyrics.lyricsOffset}
          externalLyrics={lyrics.externalLyrics}
          isFetchingLyrics={lyrics.isFetchingLyrics}
          activeTab={lyrics.activeTab}
          hasLyrics={lyrics.hasLyrics}
          lyricsContainerRef={lyrics.lyricsContainerRef}
          // Handlers
          onClose={() => setIsExpanded(false)}
          onToggleQueue={toggleQueue}
          onTogglePlay={togglePlay}
          onPrev={handlePrev}
          onNext={() => playNextTrack()}
          onToggleRepeat={toggleRepeat}
          onToggleShuffle={toggleShuffle}
          onToggleLike={toggleLike}
          onVolumeChange={handleVolumeChange}
          onToggleMute={toggleMute}
          onSetActiveTab={lyrics.setActiveTab}
          onAdjustOffset={lyrics.adjustOffset}
          onStreamQualityChange={setStreamQuality}
          onSeek={handleSeek}
          formatTime={formatTime}
        />
      ) : (
        <CompactBar
          barTrack={barTrack}
          currentTrack={currentTrack}
          accent={accent}
          accentSoft={accentSoft}
          accentFill={accentFill}
          isPlaying={isPlaying}
          showQueue={showQueue}
          volume={volume}
          progress={progress}
          duration={duration}
          progressPercent={progressPercent}
          repeatMode={repeatMode}
          shuffle={shuffle}
          barSpecs={barSpecs}
          streamQuality={streamQuality}
          sleepMode={sleepMode}
          sleepLeftMs={sleepLeftMs}
          showSleepMenu={showSleepMenu}
          sleepMenuRef={sleepMenuRef}
          // Handlers
          onExpand={() => setIsExpanded(true)}
          onTogglePlay={togglePlay}
          onPrev={handlePrev}
          onNext={() => playNextTrack()}
          onToggleRepeat={toggleRepeat}
          onToggleShuffle={toggleShuffle}
          onToggleQueue={toggleQueue}
          onVolumeChange={handleVolumeChange}
          onToggleMute={toggleMute}
          onShareTrack={shareTrack}
          onChooseSleep={chooseSleep}
          onToggleSleepMenu={() => setShowSleepMenu(!showSleepMenu)}
          onSeek={handleSeek}
          formatTime={formatTime}
        />
      )}
    </>
  );
}
