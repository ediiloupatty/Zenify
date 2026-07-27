"use client";

import { useEffect, useRef } from "react";
import { usePlayer } from "@/context/PlayerContext";
import { cleanTitle } from "@/lib/cleanTitle";
import type { Track } from "@/lib/cloudflare";

type RemoteCommand = {
  id: number;
  action: "play" | "pause" | "next" | "prev" | "playTrack";
  track?: Track;
};

// Poll cadence while the remote is worth watching closely: audio is running, or
// the phone touched us recently.
const SYNC_MS = 2000;
// Cadence once nothing is playing and no phone has said anything for a while.
// Left at 2s this loop alone is ~1,800 requests/hour for a tab that is doing
// nothing — the single biggest background cost of leaving the app open all day.
// The first command off a cold remote lands up to 6s later; any command (or a
// local play/pause) drops it straight back to SYNC_MS, so an actual remote
// session is never slow.
const IDLE_SYNC_MS = 6000;
// Cadence for a machine that has been sitting there with nothing playing and no
// phone in sight for half an hour — the state a browser left open overnight is
// actually in. Most sessions never pair a phone at all, and for them this loop
// is the only thing still running; 6s forever is ~14,000 requests a day for
// commands that never come. A cold remote's first command still lands within
// 15s, and it snaps back to SYNC_MS immediately after.
const STALE_SYNC_MS = 15_000;
// How long a received command keeps us on the fast cadence.
const ENGAGED_MS = 60_000;
// No commands for this long (and nothing playing) means nobody is out there.
const STALE_AFTER_MS = 30 * 60_000;
// When /api/remote/sync says 401 (not logged in), don't hammer the server.
const BACKOFF_MS = 30_000;
// State is included in the sync body only when it changed, or every HEARTBEAT_MS
// as a keep-alive — each included state is a D1 write on the server, and the
// free tier caps daily writes.
const HEARTBEAT_MS = 10_000;

/**
 * Invisible bridge between this browser tab (the device that actually plays
 * audio) and the Zenify Remote phone app. Every ~2s it reports the
 * now-playing state and executes any commands the phone queued server-side.
 */
export default function RemoteBridge() {
  const player = usePlayer();

  // The interval callback must always see the latest player state without
  // re-arming the timer on every context change.
  const playerRef = useRef(player);
  playerRef.current = player;

  const inFlightRef = useRef(false);
  const backoffUntilRef = useRef(0);
  const lastSentKeyRef = useRef("");
  const lastSentAtRef = useRef(0);
  const lastCommandAtRef = useRef(0);
  // `lastCommandAtRef` starts at 0, which reads as "no command in 56 years" — so
  // the stale tier also needs to know this tab hasn't just opened. Stamped on
  // the first effect run rather than at construction, which would be a
  // side effect during render.
  const mountedAtRef = useRef(0);

  // Fast-path: when the track or play state changes locally, sync immediately
  // so the phone UI updates without waiting for the next tick.
  const currentTrack = player.tracks[player.currentTrackIndex] ?? null;
  const stateKey = `${currentTrack?.id ?? ""}|${player.isPlaying}`;

  useEffect(() => {
    if (!mountedAtRef.current) mountedAtRef.current = Date.now();

    const sync = async () => {
      if (inFlightRef.current || Date.now() < backoffUntilRef.current) return;
      inFlightRef.current = true;
      try {
        const p = playerRef.current;
        const track = p.tracks[p.currentTrackIndex] ?? null;
        const key = `${track?.id ?? ""}|${p.isPlaying}`;
        const includeState =
          key !== lastSentKeyRef.current ||
          Date.now() - lastSentAtRef.current > HEARTBEAT_MS;
        const res = await fetch("/api/remote/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            includeState
              ? {
                  state: {
                    trackId: track?.id ?? null,
                    title: track ? cleanTitle(track.title || "") : "",
                    artist: track?.artist || track?.category || "",
                    album: track?.album || "",
                    cover: track?.cover_url || "",
                    isPlaying: p.isPlaying,
                  },
                }
              : {}
          ),
        });
        if (res.status === 401) {
          backoffUntilRef.current = Date.now() + BACKOFF_MS;
          return;
        }
        if (!res.ok) return;
        if (includeState) {
          lastSentKeyRef.current = key;
          lastSentAtRef.current = Date.now();
        }
        const data = await res.json();
        const commands: RemoteCommand[] = Array.isArray(data?.commands) ? data.commands : [];
        if (commands.length > 0) lastCommandAtRef.current = Date.now();
        for (const cmd of commands) runCommand(cmd);
      } catch {
        // Network hiccup — next tick retries.
      } finally {
        inFlightRef.current = false;
      }
    };

    const runCommand = (cmd: RemoteCommand) => {
      const p = playerRef.current;
      switch (cmd.action) {
        case "play":
          p.setIsPlaying(true);
          break;
        case "pause":
          p.setIsPlaying(false);
          break;
        case "next":
          p.playNextTrack();
          break;
        case "prev":
          p.playPrevTrack();
          break;
        case "playTrack": {
          const track = cmd.track;
          if (!track) break;
          const idx = p.tracks.findIndex((t) => t.id === track.id);
          if (idx >= 0) {
            p.setCurrentTrackIndex(idx);
            p.setIsPlaying(true);
          } else if (p.tracks.length > 0) {
            // Not in the current queue: append and jump to it.
            p.playTrack([...p.tracks, track], p.tracks.length);
          } else {
            p.playTrack([track], 0);
          }
          break;
        }
      }
    };

    // Self-scheduling chain rather than a fixed setInterval, so the gap after
    // each round trip reflects how engaged the remote actually is. A 401 backoff
    // now really means "sleep" instead of a no-op tick every 2s.
    const nextDelay = () => {
      const wait = backoffUntilRef.current - Date.now();
      if (wait > 0) return wait;
      if (playerRef.current.isPlaying) return SYNC_MS;
      const sinceCommand = Date.now() - lastCommandAtRef.current;
      if (sinceCommand < ENGAGED_MS) return SYNC_MS;
      if (sinceCommand > STALE_AFTER_MS && Date.now() - mountedAtRef.current > STALE_AFTER_MS) {
        return STALE_SYNC_MS;
      }
      return IDLE_SYNC_MS;
    };

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const loop = async () => {
      await sync();
      if (stopped) return;
      timer = setTimeout(loop, nextDelay());
    };

    loop();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
    // stateKey re-arms the effect so a local change syncs right away.
  }, [stateKey]);

  return null;
}
