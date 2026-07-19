"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { isRenderingActive, onRenderingActiveChange } from "@/lib/renderGate";

// "auto" = decide from the device, "on" = always lite, "off" = always full glass.
type PerfMode = "auto" | "on" | "off";

interface ThemeContextType {
  reducedMotion: boolean;
  toggleReducedMotion: () => void;
  performanceMode: PerfMode;
  setPerformanceMode: (m: PerfMode) => void;
  // Whether lite mode is currently in effect (what the UI actually renders as).
  liteActive: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// Heuristic for a low-power machine: few CPU cores or little RAM. Both signals
// are advisory (deviceMemory is Chromium-only, capped at 8) but together they
// catch the budget laptops where heavy backdrop-blur stutters.
function detectWeakDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
  const cores = navigator.hardwareConcurrency;
  if (mem && mem <= 4) return true;
  if (cores && cores <= 4) return true;
  return false;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [reducedMotion, setReducedMotion] = useState(false);
  const [performanceMode, setPerformanceModeState] = useState<PerfMode>("auto");
  const [weakDevice, setWeakDevice] = useState(false);

  // Load saved prefs + probe the device on mount
  useEffect(() => {
    const savedMotion = localStorage.getItem("zenify-reduced-motion");
    if (savedMotion === "true") setReducedMotion(true);

    const savedPerf = localStorage.getItem("zenify-perf-mode");
    if (savedPerf === "on" || savedPerf === "off" || savedPerf === "auto") {
      setPerformanceModeState(savedPerf);
    }

    setWeakDevice(detectWeakDevice());
  }, []);

  // Force dark theme
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "dark");
  }, []);

  // Apply reduced motion to <html>
  useEffect(() => {
    document.documentElement.setAttribute("data-reduced-motion", String(reducedMotion));
    localStorage.setItem("zenify-reduced-motion", String(reducedMotion));
  }, [reducedMotion]);

  const liteActive = performanceMode === "on" || (performanceMode === "auto" && weakDevice);

  // Toggle the single attribute that drives all the lite-mode CSS overrides.
  useEffect(() => {
    if (liteActive) document.documentElement.setAttribute("data-perf", "lite");
    else document.documentElement.removeAttribute("data-perf");
  }, [liteActive]);

  // Mark the document idle while the app is in the background (hidden tab, or a
  // window that lost OS focus — see renderGate) so CSS can pause every
  // animation: no animation means no repaints, so a backgrounded player costs
  // almost nothing while the audio thread keeps playing. Going idle waits a
  // couple of seconds to ride out brief focus changes; waking is instant so
  // nothing ever looks frozen to the user.
  useEffect(() => {
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const apply = () => {
      if (isRenderingActive()) {
        if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
        document.documentElement.removeAttribute("data-render-idle");
      } else if (!idleTimer) {
        idleTimer = setTimeout(() => {
          idleTimer = null;
          document.documentElement.setAttribute("data-render-idle", "true");
        }, 2000);
      }
    };
    apply();
    const stop = onRenderingActiveChange(apply);
    return () => {
      stop();
      if (idleTimer) clearTimeout(idleTimer);
    };
  }, []);

  const setPerformanceMode = (m: PerfMode) => {
    setPerformanceModeState(m);
    localStorage.setItem("zenify-perf-mode", m);
  };

  const toggleReducedMotion = () => setReducedMotion((m) => !m);

  return (
    <ThemeContext.Provider
      value={{ reducedMotion, toggleReducedMotion, performanceMode, setPerformanceMode, liteActive }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
