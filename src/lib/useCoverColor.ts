"use client";

import { useEffect, useState } from "react";

export type RGB = { r: number; g: number; b: number };

// Global in-memory cache to prevent re-fetching and re-calculating canvas pixels
// for cover URLs that have already been processed in the session.
//
// Bounded, because a session that never reloads never drops entries: shuffling a
// large library for an evening walks through every cover in it. Map preserves
// insertion order, so evicting from the front is a plain FIFO — and re-reading a
// hit moves it to the back, which makes it an LRU in practice.
const COLOR_CACHE_MAX = 300;
const colorCache = new Map<string, RGB | null>();

function cacheGet(url: string): RGB | null | undefined {
  if (!colorCache.has(url)) return undefined;
  const v = colorCache.get(url);
  colorCache.delete(url);
  colorCache.set(url, v ?? null);
  return v ?? null;
}

function cacheSet(url: string, value: RGB | null) {
  colorCache.set(url, value);
  while (colorCache.size > COLOR_CACHE_MAX) {
    const oldest = colorCache.keys().next().value;
    if (oldest === undefined) break;
    colorCache.delete(oldest);
  }
}

// Extracts a vibrant dominant colour from a cover image so the UI can tint
// itself to match the artwork (covers are served cross-origin via R2, which
// sends the CORS headers canvas pixel reading needs).
export function useCoverColor(coverUrl?: string): RGB | null {
  const [color, setColor] = useState<RGB | null>(() => (coverUrl ? (cacheGet(coverUrl) ?? null) : null));

  useEffect(() => {
    if (!coverUrl) {
      setColor(null);
      return;
    }
    const cached = cacheGet(coverUrl);
    if (cached !== undefined) {
      setColor(cached);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    // Sample on a DISTINCT cache key so we never reuse the cache entry a plain
    // (non-CORS) <img> of the same cover populated — that entry is opaque to the
    // canvas and taints getImageData, which is why the tint intermittently fell
    // back to teal (and only worked after a hard reload that happened to fetch
    // the CORS copy first). A dedicated CORS-mode request avoids the poisoning.
    const sep = coverUrl.includes("?") ? "&" : "?";
    img.src = `${coverUrl}${sep}ccsample=1`;

    img.onload = () => {
      if (cancelled) return;
      try {
        const size = 28;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);

        let best = { score: -1, r: 0, g: 0, b: 0 };
        let sr = 0, sg = 0, sb = 0, n = 0;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
          if (a < 200) continue;
          sr += r; sg += g; sb += b; n++;
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          const sat = max === 0 ? 0 : (max - min) / max;
          const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
          // Prefer saturated, mid-bright colours (avoid near-black / near-white).
          const score = sat * (1 - Math.abs(lum - 0.5) * 1.1);
          if (score > best.score) best = { score, r, g, b };
        }
        if (n === 0) return;

        // Fall back to the average colour if nothing vibrant was found.
        const chosen = best.score > 0.12 ? best : { r: sr / n, g: sg / n, b: sb / n };
        const finalColor = { r: Math.round(chosen.r), g: Math.round(chosen.g), b: Math.round(chosen.b) };
        cacheSet(coverUrl, finalColor);
        if (!cancelled) {
          setColor(finalColor);
        }
      } catch {
        /* tainted canvas / decode error — keep the previous/null colour */
        cacheSet(coverUrl, null);
      }
    };
    img.onerror = () => {
      cacheSet(coverUrl, null);
      if (!cancelled) setColor(null);
    };

    return () => { cancelled = true; };
  }, [coverUrl]);

  return color;
}
