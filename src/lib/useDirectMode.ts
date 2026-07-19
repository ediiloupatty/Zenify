"use client";

import { useSyncExternalStore, useCallback } from "react";

// Direct (bit-perfect-leaning) playback mode, picked in Settings → Playback.
// When on, the engine skips the Web Audio graph entirely — no analyser, no
// gain node, no crossfade — and locks element volume at 1.0 so the decoded
// samples reach the OS mixer untouched. Stored per-device in localStorage.
//
// Caveat the UI must surface: once createMediaElementSource has claimed the
// <audio> element, it is routed through the graph for the life of the page —
// turning direct mode ON after playback has started only applies on the next
// reload. The engine sets window.__zenifyAudioGraphActive when the graph is
// built so the settings page knows when to say so.
const STORAGE_KEY = "zenify_direct_mode";
const CHANGE_EVENT = "zenify-direct-mode-change";

function readDirectMode(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function subscribe(onChange: () => void): () => void {
  // Same-tab changes (custom event) + other-tab changes (storage event).
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useDirectMode(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, readDirectMode, () => false);

  const setOn = useCallback((next: boolean) => {
    try {
      if (next) localStorage.setItem(STORAGE_KEY, "1");
      else localStorage.removeItem(STORAGE_KEY);
    } catch {}
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return [on, setOn];
}
