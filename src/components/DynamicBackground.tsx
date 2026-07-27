"use client";

import { useEffect, useState, useRef, useSyncExternalStore } from "react";
import { usePlayer } from "@/context/PlayerContext";
import { useLiteMode } from "@/lib/perfMode";

// Returns false during SSR and true once running on the client, without a
// setState-in-effect. Used to gate the player-reading layer below to client-only.
const noopSubscribe = () => () => {};
function useIsClient() {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

// Thumbnails already produced this session. A 32x32 JPEG data URL is ~1 KB, so
// the cap exists only to keep an all-day shuffle from growing without bound;
// the point is that replaying a track skips the fetch, decode, canvas draw and
// base64 encode entirely. FIFO eviction — see useCoverColor for the same shape.
const THUMB_CACHE_MAX = 120;
const thumbCache = new Map<string, string>();

// Downscale the cover to a tiny thumbnail before blurring. A 140px CSS blur on
// a 32x32 canvas looks identical to blurring the full-resolution image but uses
// a fraction of the GPU memory and compositing cost — especially on mobile.
function downscaleCover(src: string, size: number): Promise<string> {
  const hit = thumbCache.get(src);
  if (hit) return Promise.resolve(hit);

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = size;
      c.height = size;
      const ctx = c.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, 0, 0, size, size);
        const url = c.toDataURL("image/jpeg", 0.5);
        thumbCache.set(src, url);
        while (thumbCache.size > THUMB_CACHE_MAX) {
          const oldest = thumbCache.keys().next().value;
          if (oldest === undefined) break;
          thumbCache.delete(oldest);
        }
        resolve(url);
      } else {
        resolve(src); // fallback: use original
      }
    };
    img.onerror = () => resolve(src); // fallback: use original
    img.src = src;
  });
}

// The cover-blur layer reads live player state, so it only exists on the client:
// usePlayer() consumes a client Context that doesn't cross the server-component
// {children} boundary during SSR (it would throw "must be used within a
// PlayerProvider" and force a recoverable client re-render). Splitting it out
// means the parent can SSR the static backdrop while this mounts client-only.
function CoverBlurLayer() {
  const { tracks, currentTrackIndex } = usePlayer();
  const [bgImage, setBgImage] = useState<string>("");
  const lastUrlRef = useRef<string>("");

  useEffect(() => {
    if (tracks.length > 0 && currentTrackIndex >= 0 && currentTrackIndex < tracks.length) {
      const coverUrl = tracks[currentTrackIndex].cover_url || "";

      // Skip if the same cover is already displayed
      if (coverUrl === lastUrlRef.current) return;
      lastUrlRef.current = coverUrl;

      if (!coverUrl) {
        setBgImage("");
        return;
      }

      // Downscale to 32x32 — blur makes details irrelevant
      downscaleCover(coverUrl, 32).then(setBgImage);
    }
  }, [tracks, currentTrackIndex]);

  if (!bgImage) return null;

  return (
    <div
      className="dynamic-bg-blur absolute inset-0 w-full h-full transition-all duration-[1500ms] ease-in-out"
      style={{
        backgroundImage: `url(${bgImage})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        // The source is already a 32px thumbnail upscaled to fill the screen,
        // so it's extremely soft to begin with — a 60px blur looks identical
        // to the old 140px but costs the compositor a fraction as much.
        filter: "blur(60px)",
        transform: "scale(1.4)",
        opacity: 0.45,
        // No `willChange` here: it pinned this element to a permanently-live
        // GPU layer that kept re-compositing even while idle (a constant drain
        // while gaming). Without it the blurred layer is painted once and
        // cached; the 1.5s cross-track fade still runs fine.
      }}
    />
  );
}

export default function DynamicBackground() {
  // Gate the player-reading layer to the client so it never runs during SSR.
  const isClient = useIsClient();
  // Lite mode drops the cover backdrop outright rather than just shrinking its
  // blur. Even at a 20px radius it is a full-viewport, permanently-composited
  // filtered layer sitting under everything that scrolls — and producing it
  // costs an image fetch, decode, canvas draw and base64 encode per track. The
  // flat gradient below already carries the whole layout on its own.
  const lite = useLiteMode();

  return (
    <div
      className="absolute inset-0 w-full h-full z-0 overflow-hidden"
      style={{ background: "#0d111c" }}
    >
      {isClient && !lite && <CoverBlurLayer />}

      {/* Gradient overlay: biarkan warna tembus di atas, makin gelap ke bawah untuk keterbacaan */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, rgba(13,17,28,0.45) 0%, rgba(13,17,28,0.65) 40%, rgba(13,17,28,0.88) 100%)",
        }}
      />
    </div>
  );
}
