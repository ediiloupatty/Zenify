"use client";

import { useSyncExternalStore } from "react";

// Lite mode, readable from anywhere — including plain modules and hooks that
// sit outside the React tree that owns ThemeContext.
//
// The single source of truth is the `data-perf="lite"` attribute on <html>.
// ThemeContext writes it, and the inline boot script in layout.tsx writes it
// BEFORE the first paint, so reading the DOM here is both cheaper and earlier
// than threading a context value down. `data-perf` only ever changes when the
// user picks a different mode in Settings, so one MutationObserver for the
// whole app is all the reactivity anyone needs.
//
// Lite is not just "drop the blur" (that part is pure CSS, see globals.css).
// It's also the switch that stops per-track and per-frame WORK from being
// scheduled at all: cover-colour sampling, the blurred backdrop, the lyrics
// word-sweep RAF loop, crossfade's second decode. Those are what a machine
// actually feels after the app has been open all day.

export function isLiteMode(): boolean {
  if (typeof document === "undefined") return false; // SSR — assume full
  return document.documentElement.getAttribute("data-perf") === "lite";
}

// Subscribe to lite-mode flips. Returns an unsubscribe function.
export function onLiteModeChange(onChange: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  const obs = new MutationObserver(onChange);
  obs.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-perf"],
  });
  return () => obs.disconnect();
}

// React binding. Returns false on the server and on the hydration pass, then
// settles to the real value — the same shape renderGate consumers use.
export function useLiteMode(): boolean {
  return useSyncExternalStore(onLiteModeChange, isLiteMode, () => false);
}
