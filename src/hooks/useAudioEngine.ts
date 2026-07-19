"use client";

import { useState, useRef, useEffect, useCallback, useReducer, useSyncExternalStore } from "react";
import { Track } from "@/lib/cloudflare";
import { usePlayer } from "@/context/PlayerContext";
import { useToast } from "@/context/ToastContext";
import { cleanTitle } from "@/lib/cleanTitle";
import { isRenderingActive, onRenderingActiveChange } from "@/lib/renderGate";
import { formatQualityLine } from "@/lib/formatSpecs";
import { useStreamQuality, withQuality, type StreamQuality } from "@/lib/useStreamQuality";
import { useDirectMode } from "@/lib/useDirectMode";
import {
  nativeEngineAvailable, nativeAudioShim, nativeLoad, nativeStop, onNativeEvent,
  nativeSetExclusive, subscribeNativeStatus, getNativeStatus,
  type NativeEventDetail,
} from "@/lib/nativeEngine";
import { useExclusiveMode } from "@/lib/useExclusiveMode";
import { saveDurationAction } from "@/app/admin/actions";
import { CROSSFADE_SEC, type SleepMode, SLEEP_OPTIONS, formatTime } from "@/components/player/playerUtils";

type EngineState = {
  isExpanded: boolean;
  desktopOffset: number;
  volume: number;
  progress: number;
  duration: number;
  sleepMode: SleepMode;
  sleepLeftMs: number | null;
  showSleepMenu: boolean;
  crossfadePrevTrack: Track | null;
};

type EngineAction =
  | { type: "SET_EXPANDED"; payload: boolean }
  | { type: "SET_DESKTOP_OFFSET"; payload: number }
  | { type: "SET_VOLUME"; payload: number }
  | { type: "SET_PROGRESS"; payload: number }
  | { type: "SET_DURATION"; payload: number }
  | { type: "SET_SLEEP_MODE"; payload: { mode: SleepMode; leftMs: number | null } }
  | { type: "SET_SLEEP_LEFT"; payload: number | null }
  | { type: "SET_SHOW_SLEEP_MENU"; payload: boolean }
  | { type: "SET_CROSSFADE_PREV_TRACK"; payload: Track | null };

function engineReducer(state: EngineState, action: EngineAction): EngineState {
  switch (action.type) {
    case "SET_EXPANDED": return { ...state, isExpanded: action.payload };
    case "SET_DESKTOP_OFFSET": return { ...state, desktopOffset: action.payload };
    case "SET_VOLUME": return { ...state, volume: action.payload };
    case "SET_PROGRESS": return { ...state, progress: action.payload };
    case "SET_DURATION": return { ...state, duration: action.payload };
    case "SET_SLEEP_MODE": return { ...state, sleepMode: action.payload.mode, sleepLeftMs: action.payload.leftMs, showSleepMenu: false };
    case "SET_SLEEP_LEFT": return { ...state, sleepLeftMs: action.payload };
    case "SET_SHOW_SLEEP_MENU": return { ...state, showSleepMenu: action.payload };
    case "SET_CROSSFADE_PREV_TRACK": return { ...state, crossfadePrevTrack: action.payload };
    default: return state;
  }
}

/**
 * Core audio engine hook. Manages:
 * - HTML5 Audio + Web Audio API (AudioContext, analyser, gain)
 * - Crossfade between tracks
 * - Volume, mute, persistence
 * - Sleep timer
 * - Keyboard shortcuts
 * - Media Session API (lock screen / notification)
 * - Discord Rich Presence bridge
 * - Position persistence & restoration
 * - Play count tracking
 * - Error handling & auto-skip
 */
export function useAudioEngine() {
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
  const currentTrack = tracks && tracks.length > 0 ? (tracks[currentTrackIndex] || tracks[0]) : null;

  const [state, dispatch] = useReducer(engineReducer, {
    isExpanded: false,
    desktopOffset: 0,
    volume: typeof window === "undefined" ? 0.8 : (function() {
      const saved = parseFloat(window.localStorage.getItem("player_volume") || "");
      return Number.isFinite(saved) ? Math.min(1, Math.max(0, saved)) : 0.8;
    })(),
    progress: 0,
    duration: 0,
    sleepMode: "off",
    sleepLeftMs: null,
    showSleepMenu: false,
    crossfadePrevTrack: null,
  });

  const {
    isExpanded, desktopOffset, volume, progress, duration,
    sleepMode, sleepLeftMs, showSleepMenu, crossfadePrevTrack
  } = state;

  // Direct mode: skip the Web Audio graph and lock volume at 1.0 so decoded
  // samples leave the element untouched (as close to bit-perfect as a browser
  // allows — the OS shared-mode mixer is still downstream).
  const [directMode] = useDirectMode();

  // ── Native engine (desktop Direct Mode) ────────────────────────────────────
  // Inside the desktop shell, Direct Mode goes one step further: playback moves
  // out of the browser into the Go engine (WASAPI). audioRef then points at
  // nativeAudioShim so every existing element-based code path keeps working.
  // A track the engine can't decode marks itself broken and falls back to the
  // <audio> element — never less playable than before.
  // The shell's bindings exist before any page script runs, so availability is
  // constant for the whole session — the store never emits a change.
  const nativeReady = useSyncExternalStore(
    () => () => {},
    nativeEngineAvailable,
    () => false,
  );
  const [nativeBrokenId, setNativeBrokenId] = useState<string | null>(null);
  const nativeActive =
    nativeReady && directMode && !!currentTrack && currentTrack.id !== nativeBrokenId;
  const nativeActiveRef = useRef(false);
  useEffect(() => { nativeActiveRef.current = nativeActive; }, [nativeActive]);

  // WASAPI exclusive-mode preference → engine (applies to the next Load), and
  // the live status the engine reports back (what the DAC is actually getting).
  const [exclusiveMode] = useExclusiveMode();
  useEffect(() => {
    if (nativeReady) nativeSetExclusive(exclusiveMode);
  }, [nativeReady, exclusiveMode]);
  const nativeStatus = useSyncExternalStore(
    subscribeNativeStatus, getNativeStatus, () => getNativeStatus(),
  );

  useEffect(() => {
    if (!nativeActive) return;
    audioRef.current = nativeAudioShim as unknown as HTMLAudioElement;
    return () => {
      // Only clear if the element hasn't already reclaimed the ref (React
      // attaches the real <audio> before this cleanup runs on deactivation).
      if (audioRef.current === (nativeAudioShim as unknown as HTMLAudioElement)) {
        audioRef.current = null;
      }
    };
  }, [nativeActive]);

  useEffect(() => {
    if ((window as { __ZENIFY_DESKTOP__?: boolean }).__ZENIFY_DESKTOP__) {
      dispatch({ type: "SET_DESKTOP_OFFSET", payload: 32 });
    }
  }, []);

  const audioRef = useRef<HTMLAudioElement>(null);
  const tailRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  // ── Sleep timer ────────────────────────────────────────────────────────────
  const sleepMenuRef = useRef<HTMLDivElement>(null);
  const sleepEndOfTrackRef = useRef(false);

  const chooseSleep = (value: SleepMode) => {
    const mins = Number(value);
    dispatch({ type: "SET_SLEEP_MODE", payload: { mode: value, leftMs: mins ? mins * 60_000 : null } });
  };

  // Minute-based countdown
  useEffect(() => {
    sleepEndOfTrackRef.current = sleepMode === "end";
    const mins = Number(sleepMode);
    if (!mins) return;
    const deadline = Date.now() + mins * 60_000;
    const id = setInterval(() => {
      const left = deadline - Date.now();
      if (left <= 0) {
        clearInterval(id);
        dispatch({ type: "SET_SLEEP_MODE", payload: { mode: "off", leftMs: null } });
        audioRef.current?.pause();
        setIsPlaying(false);
        showToast("Sleep timer ended — playback paused", "info");
      } else if (isRenderingActive()) {
        // The countdown display is pure UI — skip the per-second re-render
        // while the app is in the background. The deadline check above still
        // runs every tick, so the timer itself never drifts.
        dispatch({ type: "SET_SLEEP_LEFT", payload: left });
      }
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sleepMode]);

  // Close sleep menu on outside click
  useEffect(() => {
    if (!showSleepMenu) return;
    const onDown = (e: MouseEvent) => {
      if (sleepMenuRef.current && !sleepMenuRef.current.contains(e.target as Node)) {
        dispatch({ type: "SET_SHOW_SLEEP_MENU", payload: false });
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showSleepMenu]);

  // ── Crossfade ───────────────────────────────────────────────────────────────
  const crossfadingRef = useRef(false);
  const fadeInPendingRef = useRef(false);
  const tailFadeIdRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const primaryFadeIdRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const crossfadeSafetyRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const crossfadeUiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const restoreGainNow = () => {
    const ctx = audioContextRef.current;
    const g = gainNodeRef.current;
    if (g && ctx) {
      g.gain.cancelScheduledValues(ctx.currentTime);
      g.gain.setValueAtTime(volume, ctx.currentTime);
    } else if (audioRef.current) {
      audioRef.current.volume = directMode ? 1 : volume;
    }
  };

  const stopCrossfadeTail = () => {
    if (tailFadeIdRef.current) { clearInterval(tailFadeIdRef.current); tailFadeIdRef.current = null; }
    const tail = tailRef.current;
    if (tail && !tail.paused) { try { tail.pause(); } catch {} }
    if (crossfadeUiTimerRef.current) { clearTimeout(crossfadeUiTimerRef.current); crossfadeUiTimerRef.current = null; }
    dispatch({ type: "SET_CROSSFADE_PREV_TRACK", payload: null });
  };

  const startCrossfade = () => {
    const audio = audioRef.current;
    const tail = tailRef.current;
    if (!audio || !tail) return;
    crossfadingRef.current = true;
    fadeInPendingRef.current = true;

    dispatch({ type: "SET_CROSSFADE_PREV_TRACK", payload: currentTrack });
    if (crossfadeUiTimerRef.current) clearTimeout(crossfadeUiTimerRef.current);
    crossfadeUiTimerRef.current = setTimeout(
      () => dispatch({ type: "SET_CROSSFADE_PREV_TRACK", payload: null }),
      CROSSFADE_SEC * 1000,
    );

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

    const ctx = audioContextRef.current;
    if (gainNodeRef.current && ctx) {
      gainNodeRef.current.gain.cancelScheduledValues(ctx.currentTime);
      gainNodeRef.current.gain.setValueAtTime(0.0001, ctx.currentTime);
    } else {
      audio.volume = 0;
    }

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

  const handlePlaying = () => {
    if (!fadeInPendingRef.current) return;
    fadeInPendingRef.current = false;
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

  // ── Audio context init ─────────────────────────────────────────────────────
  const initAudioContext = () => {
    if (directMode) {
      if (audioRef.current) audioRef.current.volume = 1;
      return;
    }
    if (!audioContextRef.current && audioRef.current) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;

      const ctx = new AudioContextClass();
      audioContextRef.current = ctx;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.82;
      analyserRef.current = analyser;

      const gain = ctx.createGain();
      gain.gain.value = volume;
      gainNodeRef.current = gain;

      const source = ctx.createMediaElementSource(audioRef.current);
      sourceRef.current = source;
      source.connect(analyser);
      analyser.connect(gain);
      gain.connect(ctx.destination);

      audioRef.current.volume = 1;

      // createMediaElementSource claims the element for the page's lifetime, so
      // enabling direct mode from here on only applies after a reload — the
      // settings toggle checks this flag to warn about that.
      (window as { __zenifyAudioGraphActive?: boolean }).__zenifyAudioGraphActive = true;
    }

    if (audioContextRef.current?.state === "suspended") {
      audioContextRef.current.resume();
    }
  };

  // ── Controls ───────────────────────────────────────────────────────────────
  const togglePlay = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!audioRef.current) return;
    initAudioContext();
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      fadeInPendingRef.current = false;
      crossfadingRef.current = false;
      if (crossfadeSafetyRef.current) { clearTimeout(crossfadeSafetyRef.current); crossfadeSafetyRef.current = null; }
      restoreGainNow();
      audioRef.current.play().catch(() => {});
    }
    setIsPlaying(!isPlaying);
  };

  const handlePrev = () => {
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    playPrevTrack();
  };

  // ── Share ──────────────────────────────────────────────────────────────────
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

  useEffect(() => {
    const stop = onRenderingActiveChange(() => {
      if (isRenderingActive() && audioRef.current) {
        dispatch({ type: "SET_PROGRESS", payload: audioRef.current.currentTime });
        dispatch({ type: "SET_DURATION", payload: audioRef.current.duration || 0 });
      }
    });
    return stop;
  }, []);

  // ── Time update handler ────────────────────────────────────────────────────
  const lastPosSaveRef = useRef(0);
  const restoredPosRef = useRef(false);

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      if (isRenderingActive()) {
        dispatch({ type: "SET_PROGRESS", payload: audioRef.current.currentTime });
        dispatch({ type: "SET_DURATION", payload: audioRef.current.duration || 0 });
      }

      const d = audioRef.current.duration;
      const hasNext =
        !!upcoming[0]?.track || (repeatMode === "all" && tracks.length > 1);
      if (
        isPlaying &&
        !directMode &&
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

  // ── Position state reporting ───────────────────────────────────────────────
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

  // ── Loaded metadata handler ────────────────────────────────────────────────
  const backfilledRef = useRef<Set<string>>(new Set());
  const playCountedRef = useRef<string | null>(null);

  const handleLoadedMetadata = () => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;

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

  // ── Ended handler ──────────────────────────────────────────────────────────
  const handleEnded = () => {
    if (sleepEndOfTrackRef.current) {
      sleepEndOfTrackRef.current = false;
      dispatch({ type: "SET_SLEEP_MODE", payload: { mode: "off", leftMs: null } });
      setIsPlaying(false);
      showToast("Sleep timer ended — playback paused", "info");
      return;
    }
    if (repeatMode === "one" && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
      setIsPlaying(true);
      return;
    }
    playNextTrack(true);
  };

  // ── Error handler ──────────────────────────────────────────────────────────
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

  // ── Play/pause effect ──────────────────────────────────────────────────────
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
          if (e.name === 'NotAllowedError' || e.name === 'NotSupportedError') {
            setIsPlaying(false);
          } else if (e.name !== 'AbortError') {
            console.error("Playback failed:", e);
          }
        });
      }
    } else if (!isPlaying && audioRef.current) {
      audioRef.current.pause();
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

  // Unmount-only cleanup for crossfade timers
  useEffect(() => {
    return () => {
      if (tailFadeIdRef.current) clearInterval(tailFadeIdRef.current);
      if (primaryFadeIdRef.current) clearInterval(primaryFadeIdRef.current);
      if (crossfadeUiTimerRef.current) clearTimeout(crossfadeUiTimerRef.current);
      if (crossfadeSafetyRef.current) clearTimeout(crossfadeSafetyRef.current);
    };
  }, []);

  // ── Stream quality ─────────────────────────────────────────────────────────
  const [streamQuality, setStreamQuality] = useStreamQuality();

  // Direct mode streams the original file regardless of the saved quality —
  // an untouched output path is pointless when it's fed a lossy transcode. The
  // saved preference is left alone so it comes back when direct mode goes off.
  const effectiveQuality: StreamQuality = directMode ? "lossless" : streamQuality;

  const chooseStreamQuality = (q: StreamQuality) => {
    if (directMode && q !== "lossless") {
      showToast("Direct Mode always streams the original file", "info");
    }
    setStreamQuality(q);
  };

  // ── Discord Rich Presence bridge ───────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    const audio = audioRef.current;
    const detail = currentTrack
      ? {
          id: currentTrack.id,
          title: cleanTitle(currentTrack.title),
          artist: currentTrack.artist || currentTrack.category || "",
          album: currentTrack.album || "",
          quality: formatQualityLine(currentTrack, effectiveQuality) || "",
          cover: currentTrack.cover_url
            ? new URL(currentTrack.cover_url, window.location.origin).href
            : "",
          state: isPlaying ? "playing" : "paused",
          position: audio?.currentTime || 0,
          duration: audio?.duration || currentTrack.duration || 0,
          appUrl: window.location.origin,
        }
      : { id: "", title: "", artist: "", album: "", quality: "", cover: "", state: "stopped", position: 0, duration: 0, appUrl: "" };
    window.dispatchEvent(new CustomEvent("zenify:nowplaying", { detail }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id, isPlaying, effectiveQuality]);

  // ── Media Session ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;

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
    reportPositionState();

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

  // ── Volume ─────────────────────────────────────────────────────────────────
  const prevVolumeRef = useRef(volume || 0.8);

  const applyVolume = (v: number) => {
    if (directMode) {
      if (audioRef.current) audioRef.current.volume = 1;
      return;
    }
    const clamped = Math.min(1, Math.max(0, v));
    dispatch({ type: "SET_VOLUME", payload: clamped });
    if (typeof window !== "undefined") window.localStorage.setItem("player_volume", String(clamped));
    if (gainNodeRef.current) gainNodeRef.current.gain.value = clamped;
    else if (audioRef.current) audioRef.current.volume = clamped;
  };

  useEffect(() => {
    if (!gainNodeRef.current && audioRef.current) audioRef.current.volume = directMode ? 1 : volume;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Entering direct mode pins element volume and the slider at 100%; leaving it
  // restores the saved volume. localStorage is left alone in both directions so
  // the user's level survives a round-trip through direct mode.
  useEffect(() => {
    const audio = audioRef.current;
    if (directMode) {
      if (audio) audio.volume = 1;
      // If the graph already claimed the element (toggled on before a reload),
      // unity gain at least matches what the 100% slider now shows.
      if (gainNodeRef.current) gainNodeRef.current.gain.value = 1;
      dispatch({ type: "SET_VOLUME", payload: 1 });
    } else {
      const saved = parseFloat(window.localStorage.getItem("player_volume") || "");
      const v = Number.isFinite(saved) ? Math.min(1, Math.max(0, saved)) : 0.8;
      dispatch({ type: "SET_VOLUME", payload: v });
      if (gainNodeRef.current) gainNodeRef.current.gain.value = v;
      else if (audio) audio.volume = v;
    }
  }, [directMode]);

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const v = parseFloat(e.target.value);
    if (v > 0) prevVolumeRef.current = v;
    applyVolume(v);
  };

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

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
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

  // ── Compute audio src ──────────────────────────────────────────────────────
  const rawUrl = currentTrack?.file_url || "";
  const audioSrc = withQuality(
    rawUrl.includes(".r2.dev/")
      ? `/api/audio/${rawUrl.split(".r2.dev/").pop()}`
      : rawUrl,
    effectiveQuality
  );

  const nextTrack = upcoming[0]?.track;
  const nextRawUrl = nextTrack?.file_url || "";
  const nextAudioSrc = withQuality(
    nextRawUrl.includes(".r2.dev/")
      ? `/api/audio/${nextRawUrl.split(".r2.dev/").pop()}`
      : nextRawUrl,
    effectiveQuality
  );

  const progressPercent = duration ? (progress / duration) * 100 : 0;

  // ── Native engine wiring ───────────────────────────────────────────────────
  // Feed the engine the current track and translate its events into the same
  // handlers the <audio> element would have fired, via always-fresh refs.
  const prevNativeRef = useRef(false);
  useEffect(() => {
    if (prevNativeRef.current && !nativeActive) nativeStop();
    prevNativeRef.current = nativeActive;
  }, [nativeActive]);

  useEffect(() => {
    if (!nativeActive || !audioSrc) return;
    nativeLoad(new URL(audioSrc, window.location.origin).href);
  }, [nativeActive, audioSrc]);

  const nativeHandlersRef = useRef({
    loaded: () => {}, tick: () => {}, ended: () => {}, error: () => {},
  });
  useEffect(() => {
    nativeHandlersRef.current = {
      loaded: () => {
        handleLoadedMetadata();
        if (isPlaying) nativeAudioShim.play();
      },
      tick: handleTimeUpdate,
      ended: handleEnded,
      error: () => {
        setNativeBrokenId(currentTrack?.id ?? null);
        showToast("Native engine can't play this file — using browser playback", "info");
      },
    };
  });
  useEffect(() => {
    if (!nativeReady) return;
    return onNativeEvent((d: NativeEventDetail) => {
      if (!nativeActiveRef.current) return;
      const h = nativeHandlersRef.current;
      if (d.type === "loaded") h.loaded();
      else if (d.type === "position") h.tick();
      else if (d.type === "ended") h.ended();
      else if (d.type === "error") h.error();
    });
  }, [nativeReady]);

  // ── Desktop media keys ─────────────────────────────────────────────────────
  // The shell forwards hardware media keys and tray transport clicks as
  // zenify:mediakey events. Vital in native mode (no <audio> element means no
  // browser Media Session), and it also makes the tray controls work at all.
  const mediaKeyRef = useRef({
    toggle: () => {}, next: () => {}, prev: () => {}, stop: () => {},
  });
  useEffect(() => {
    mediaKeyRef.current = {
      toggle: () => togglePlay(),
      next: () => playNextTrack(),
      prev: handlePrev,
      stop: () => {
        audioRef.current?.pause();
        setIsPlaying(false);
      },
    };
  });
  useEffect(() => {
    const onMediaKey = (e: Event) => {
      const k = mediaKeyRef.current;
      switch ((e as CustomEvent<string>).detail) {
        case "play-pause": k.toggle(); break;
        case "next": k.next(); break;
        case "prev": k.prev(); break;
        case "stop": k.stop(); break;
      }
    };
    window.addEventListener("zenify:mediakey", onMediaKey);
    return () => window.removeEventListener("zenify:mediakey", onMediaKey);
  }, []);

  return {
    // Context-forwarded
    tracks, currentTrackIndex, currentTrack,
    isPlaying, setIsPlaying,
    playNextTrack, playPrevTrack,
    repeatMode, shuffle,
    toggleRepeat, toggleShuffle,
    showQueue, setShowQueue,
    upcoming,

    // Refs
    audioRef, tailRef, canvasRef,
    analyserRef, audioContextRef, gainNodeRef,

    // State
    isExpanded, setIsExpanded: (v: boolean) => dispatch({ type: "SET_EXPANDED", payload: v }), desktopOffset,
    volume, progress, duration, progressPercent,
    crossfadePrevTrack,

    // Sleep timer
    sleepMode, sleepLeftMs, showSleepMenu, sleepMenuRef,
    chooseSleep, setShowSleepMenu: (v: boolean) => dispatch({ type: "SET_SHOW_SLEEP_MENU", payload: v }),

    // Stream quality — the badge shows what actually plays (direct mode forces
    // the original), and the picker warns when a lossy choice won't take effect.
    streamQuality: effectiveQuality, setStreamQuality: chooseStreamQuality,
    directMode, nativeActive, nativeStatus,

    // Audio sources
    audioSrc, nextAudioSrc,

    // Handlers
    togglePlay, handlePrev,
    handleTimeUpdate, handleLoadedMetadata,
    handleEnded, handleAudioError, handlePlaying,
    reportPositionState,
    handleVolumeChange, toggleMute, applyVolume,
    shareTrack,

    // Utilities
    formatTime,
  };
}
