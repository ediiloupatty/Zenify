"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { Track } from "@/lib/cloudflare";
import { cleanTitle } from "@/lib/cleanTitle";
import { isRenderingActive, onRenderingActiveChange } from "@/lib/renderGate";

type ParsedLyric = { time: number; text: string };

export function parseLrc(lrcText: string): ParsedLyric[] | null {
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
export function countSyllables(word: string): number {
  const groups = word.toLowerCase().match(/[aeiouyà-ÿ]+/gi);
  return Math.max(1, groups ? groups.length : 1);
}

/**
 * Manages all lyrics-related state: fetching, parsing, offset, active index,
 * and the RAF loop that drives the word-by-word sweep animation.
 */
export function useLyrics(
  currentTrack: Track | null,
  audioRef: React.RefObject<HTMLAudioElement | null>,
  audioContextRef: React.RefObject<AudioContext | null>,
  isPlaying: boolean,
  isExpanded: boolean,
) {
  const [externalLyrics, setExternalLyrics] = useState<string | null>(null);
  const [isFetchingLyrics, setIsFetchingLyrics] = useState(false);
  const [activeTab, setActiveTab] = useState<"player" | "lyrics">("player");
  const [lyricsOffset, setLyricsOffset] = useState(0);
  const lyricsOffsetRef = useRef(0);

  // Driven by RAF (not timeupdate) for zero-latency sync
  const [activeLyricIndex, setActiveLyricIndex] = useState(-1);

  const lyricsContainerRef = useRef<HTMLDivElement>(null);
  const parsedLyricsRef = useRef<ParsedLyric[] | null>(null);
  const activeLyricIndexRef = useRef(-1);
  const activeLineElRef = useRef<HTMLElement | null>(null);

  const parsedLyrics = useMemo(() => {
    const sourceLyrics = externalLyrics || currentTrack?.lyrics;
    if (!sourceLyrics) return null;
    return parseLrc(sourceLyrics);
  }, [externalLyrics, currentTrack?.lyrics]);

  parsedLyricsRef.current = parsedLyrics;

  // Auto-fetch synced lyrics when track changes
  useEffect(() => {
    setExternalLyrics(null);
    setIsFetchingLyrics(false);
    // The sweep loop is only alive while the player is expanded, so a track that
    // changes in the background would otherwise leave the previous song's line
    // highlighted for the first frame after re-opening.
    activeLyricIndexRef.current = -1;
    activeLineElRef.current = null;
    setActiveLyricIndex(-1);

    if (!currentTrack) return;

    const hasTimestamps = currentTrack.lyrics && /\[\d{2}:\d{2}\.\d{2,3}\]/.test(currentTrack.lyrics);
    if (hasTimestamps) return;

    const cleanedTitle = cleanTitle(currentTrack.title);
    if (!cleanedTitle) return;

    const controller = new AbortController();
    setIsFetchingLyrics(true);

    const dur = Math.round(currentTrack.duration || audioRef.current?.duration || 0);
    const url = `/api/lyrics?id=${encodeURIComponent(currentTrack.id)}&artist=${encodeURIComponent(currentTrack.artist || '')}&title=${encodeURIComponent(cleanedTitle)}&q=${encodeURIComponent(`${currentTrack.artist || ''} ${cleanedTitle}`.trim())}${dur > 0 ? `&duration=${dur}` : ''}&t=${Date.now()}`;

    fetch(url, { signal: controller.signal })
      .then(res => res.json())
      .then(data => { if (data.syncedLyrics) setExternalLyrics(data.syncedLyrics); })
      .catch(err => { if (err.name !== 'AbortError') console.error("Failed to fetch synced lyrics", err); })
      .finally(() => setIsFetchingLyrics(false));

    return () => controller.abort();
  }, [currentTrack?.id, currentTrack?.title, currentTrack?.artist, currentTrack?.lyrics, audioRef]);

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
  const isPlayingRef = useRef(isPlaying);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  // The loop below is the most expensive thing in the app while it runs: every
  // frame it re-scans the lyric list and rewrites a handful of inline styles per
  // word (each write is a style recalc + paint). None of that is observable
  // unless the fullscreen player is open — the compact bar renders no lyrics at
  // all — and "collapsed, playing for hours" is the state the app actually sits
  // in. So the loop only exists while `isExpanded`; otherwise it isn't scheduled
  // and the sweep costs exactly nothing. (On desktop the lyrics column is
  // visible in both tabs of the expanded player, so `isExpanded` is the gate,
  // not `activeTab`.) Re-entering recomputes from audio.currentTime on the very
  // first frame, so nothing has to be caught up.
  useEffect(() => {
    if (!isExpanded) return;

    let rafId: number;
    let backoffId: ReturnType<typeof setTimeout> | null = null;
    let active = true;

    const scheduleNext = (audio: HTMLAudioElement | null) => {
      if (!active) return;
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
      const lyrics = parsedLyricsRef.current;
      const container = lyricsContainerRef.current;
      const audio = audioRef.current;

      if (lyrics && audio && !audio.paused && isRenderingActive()) {
        const ctx = audioContextRef.current;
        const outputLatency = ctx ? (ctx.outputLatency || (ctx as any).baseLatency || 0) : 0;
        const t = audio.currentTime - outputLatency + lyricsOffsetRef.current;

        // Active index — computed every frame, no timeupdate delay
        let newIdx = -1;
        for (let i = lyrics.length - 1; i >= 0; i--) {
          if (t >= lyrics[i].time) { newIdx = i; break; }
        }
        if (newIdx !== activeLyricIndexRef.current) {
          activeLyricIndexRef.current = newIdx;
          activeLineElRef.current = null;
          setActiveLyricIndex(newIdx);
        }

        // Sweep + per-word scale, weighted by syllables with held-note absorption
        if (container && newIdx >= 0) {
          const lineEl = activeLineElRef.current;
          const wordSpans = lineEl?.querySelectorAll<HTMLElement>("[data-wi]");

          const lineStart = lyrics[newIdx].time;
          const rawEnd = lyrics[newIdx + 1]?.time ?? (lineStart + 5);
          const lineGap = Math.max(0.001, rawEnd - lineStart);

          if (lineEl && wordSpans && wordSpans.length > 0) {
            const n = wordSpans.length;
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
              const k = lineGap / sumBase;
              for (let i = 0; i < n; i++) dur[i] *= k;
              totalDur = lineGap;
            } else {
              const surplus = Math.min(lineGap - sumBase, HELD_NOTE_MAX);
              dur[n - 1] += surplus;
              totalDur = sumBase + surplus;
            }

            const p = Math.min(1, Math.max(0, (t - lineStart) / totalDur));
            container.style.setProperty("--sweep", `${(p * 100).toFixed(2)}%`);

            let acc = 0;
            for (let i = 0; i < n; i++) {
              const wStart = acc / totalDur;
              acc += dur[i];
              const wEnd = acc / totalDur;
              const wordCov = Math.min(1, Math.max(0, (p - wStart) / Math.max(0.0001, wEnd - wStart)));
              const s = wordSpans[i];

              let scale: number;
              if (wordCov >= 1) {
                s.style.color = "white";
                s.style.removeProperty("background-image");
                s.style.removeProperty("-webkit-background-clip");
                s.style.removeProperty("background-clip");
                s.style.removeProperty("-webkit-text-fill-color");
                scale = 1.04;
              } else if (wordCov > 0) {
                const pct = (wordCov * 100).toFixed(2);
                s.style.backgroundImage = `linear-gradient(to right, white ${pct}%, rgba(255,255,255,0.28) ${pct}%)`;
                s.style.setProperty("-webkit-background-clip", "text");
                s.style.setProperty("background-clip", "text");
                s.style.setProperty("-webkit-text-fill-color", "transparent");
                s.style.removeProperty("color");
                scale = 1 + 0.07 * Math.sin(wordCov * Math.PI) + 0.04 * wordCov;
              } else {
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
            const p = Math.min(1, Math.max(0, (t - lineStart) / lineGap));
            container.style.setProperty("--sweep", `${(p * 100).toFixed(2)}%`);
          }
        } else if (container) {
          container.style.setProperty("--sweep", "0%");
        }
      }

      scheduleNext(audioRef.current);
    };

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
  }, [isExpanded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll lyric container to active line
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

  const hasLyrics = !!currentTrack;

  return {
    parsedLyrics,
    activeLyricIndex,
    lyricsOffset,
    externalLyrics,
    isFetchingLyrics,
    activeTab,
    setActiveTab,
    lyricsContainerRef,
    adjustOffset,
    hasLyrics,
  };
}
