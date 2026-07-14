import { Track } from "@/lib/cloudflare";
import CoverImage from "@/components/CoverImage";

// ── Hash & Palette helpers ─────────────────────────────────────────────────
export function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  return Math.abs(hash);
}

export const COVER_PALETTES = [
  { from: "#6366f1", to: "#8b5cf6", mid: "#7c3aed" },
  { from: "#14b8a6", to: "#06b6d4", mid: "#0891b2" },
  { from: "#f43f5e", to: "#ec4899", mid: "#db2777" },
  { from: "#f59e0b", to: "#f97316", mid: "#ea580c" },
  { from: "#10b981", to: "#059669", mid: "#047857" },
  { from: "#3b82f6", to: "#6366f1", mid: "#4f46e5" },
  { from: "#a855f7", to: "#ec4899", mid: "#c026d3" },
  { from: "#06b6d4", to: "#3b82f6", mid: "#2563eb" },
  { from: "#84cc16", to: "#10b981", mid: "#16a34a" },
  { from: "#f97316", to: "#ef4444", mid: "#dc2626" },
];

export const MUSIC_ICON_PATHS = [
  "M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z",
  "M12 1c-4.97 0-9 4.03-9 9v7c0 1.66 1.34 3 3 3h3v-8H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-4v8h3c1.66 0 3-1.34 3-3v-7c0-4.97-4.03-9-9-9z",
  "M10 20h4V4h-4v16zm-6 0h4v-8H4v8zM16 9v11h4V9h-4z",
  "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z",
  "M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z",
];

// Lift a dark cover colour so it stays legible as text/accent on the near-black
// fullscreen UI. Light/mid colours pass through unchanged; very dark ones are
// scaled up along their own hue, and a pure-black cover falls back to a neutral
// light grey (so the text never turns invisible against the dark background).
export function readableAccent(r: number, g: number, b: number): { r: number; g: number; b: number } {
  const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
  const MIN = 150;
  if (brightness >= MIN) return { r, g, b };
  if (brightness <= 0) return { r: 203, g: 213, b: 225 }; // slate-300 for black covers
  const scale = MIN / brightness;
  return {
    r: Math.min(255, Math.round(r * scale)),
    g: Math.min(255, Math.round(g * scale)),
    b: Math.min(255, Math.round(b * scale)),
  };
}

// Crossfade overlap (seconds) between the outgoing and incoming track. Always on.
export const CROSSFADE_SEC = 6;

// Sleep timer: "off", a number of minutes, or "end" (stop after the current track).
export type SleepMode = "off" | "15" | "30" | "45" | "60" | "end";
export const SLEEP_OPTIONS: { value: SleepMode; label: string }[] = [
  { value: "15", label: "15 minutes" },
  { value: "30", label: "30 minutes" },
  { value: "45", label: "45 minutes" },
  { value: "60", label: "1 hour" },
  { value: "end", label: "End of track" },
];

export function formatTime(time: number) {
  if (isNaN(time)) return "0:00";
  const minutes = Math.floor(time / 60);
  const seconds = Math.floor(time % 60);
  return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
}

// Compute accent colours from a cover colour.
export function computeAccentColors(coverColor: { r: number; g: number; b: number } | null) {
  const cc = coverColor || { r: 45, g: 212, b: 191 };
  const ca = readableAccent(cc.r, cc.g, cc.b);
  const accent = `rgb(${ca.r}, ${ca.g}, ${ca.b})`;
  const accentSoft = `rgba(${ca.r}, ${ca.g}, ${ca.b}, 0.5)`;
  const accentFill = `rgb(${cc.r}, ${cc.g}, ${cc.b})`;
  const ambientBg =
    `radial-gradient(120% 75% at 50% -10%, rgba(${cc.r}, ${cc.g}, ${cc.b}, 0.42), transparent 55%),` +
    `linear-gradient(180deg, rgba(${cc.r}, ${cc.g}, ${cc.b}, 0.16) 0%, #0a0c11 62%)`;
  return { cc, accent, accentSoft, accentFill, ambientBg };
}
