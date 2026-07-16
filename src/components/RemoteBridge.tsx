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

const SYNC_MS = 2000;
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

  // Fast-path: when the track or play state changes locally, sync immediately
  // so the phone UI updates without waiting for the next tick.
  const currentTrack = player.tracks[player.currentTrackIndex] ?? null;
  const stateKey = `${currentTrack?.id ?? ""}|${player.isPlaying}`;

  useEffect(() => {
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

    sync();
    const id = setInterval(sync, SYNC_MS);
    return () => clearInterval(id);
    // stateKey re-arms the effect so a local change syncs right away.
  }, [stateKey]);

  return null;
}
