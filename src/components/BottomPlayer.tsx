"use client";

import { useAudioEngine } from "@/hooks/useAudioEngine";
import { useLyrics } from "@/hooks/useLyrics";
import { useFavorites } from "@/hooks/useFavorites";
import { useBarVisualizer } from "@/hooks/useBarVisualizer";
import { useCoverColor } from "@/lib/useCoverColor";
import { formatAudioSpecs } from "@/lib/formatSpecs";
import { computeAccentColors } from "@/components/player/playerUtils";
import QueuePanel from "@/components/QueuePanel";
import ExpandedPlayer from "@/components/player/ExpandedPlayer";
import CompactBar from "@/components/player/CompactBar";

export default function BottomPlayer() {
  // ── Core audio engine ──────────────────────────────────────────────────────
  const engine = useAudioEngine();
  const {
    currentTrack, audioRef, tailRef, canvasRef,
    analyserRef, audioContextRef, gainNodeRef,
    isExpanded, setIsExpanded, desktopOffset,
    isPlaying, volume, progress, duration, progressPercent,
    crossfadePrevTrack,
    sleepMode, sleepLeftMs, showSleepMenu, sleepMenuRef,
    showQueue, setShowQueue,
    streamQuality, setStreamQuality,
    audioSrc, nextAudioSrc,
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

  // ── Compact bar visualizer ─────────────────────────────────────────────────
  useBarVisualizer(canvasRef, analyserRef, audioRef, coverColor, isExpanded, isPlaying);

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

      <QueuePanel
        open={showQueue}
        onClose={() => setShowQueue(false)}
        accent={accent}
        accentSoft={accentSoft}
        coverColor={cc}
      />

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
          onToggleQueue={() => setShowQueue((v) => !v)}
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
          canvasRef={canvasRef}
          // Handlers
          onExpand={() => setIsExpanded(true)}
          onTogglePlay={togglePlay}
          onPrev={handlePrev}
          onNext={() => playNextTrack()}
          onToggleRepeat={toggleRepeat}
          onToggleShuffle={toggleShuffle}
          onToggleQueue={() => setShowQueue((v) => !v)}
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
