"use client";

import { useSyncExternalStore, useCallback } from "react";

// WASAPI exclusive-mode preference for the desktop native engine (Fase 2).
// Only meaningful inside the desktop shell with Direct Mode + the native engine
// active; ignored everywhere else. Default ON — exclusive is the whole reason
// the native engine exists (true bit-perfect, DAC rate LED follows the file).
// Turning it off keeps the Windows mixer in the path so other apps can play at
// the same time. Stored per-device in localStorage.
const STORAGE_KEY = "zenify_wasapi_exclusive";
const CHANGE_EVENT = "zenify-exclusive-change";

function readExclusive(): boolean {
  try {
    // Absent = default ON; only an explicit "0" disables it.
    return localStorage.getItem(STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useExclusiveMode(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, readExclusive, () => true);

  const setOn = useCallback((next: boolean) => {
    try {
      if (next) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, "0");
    } catch {}
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return [on, setOn];
}
