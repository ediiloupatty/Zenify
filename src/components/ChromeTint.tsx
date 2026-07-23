"use client";

import { useEffect } from "react";
import { usePlayer } from "@/context/PlayerContext";
import { useCoverColor } from "@/lib/useCoverColor";

/**
 * Bleeds a whisper of the current cover's colour into the "chrome" (sidebar +
 * top header) so they feel part of the now-playing mood — far subtler than the
 * main area's DynamicBackground, just a faint shift you notice when the song
 * changes. Renders nothing; it only publishes the colour as the `--chrome-tint`
 * CSS variable on :root, which the sidebar/header ::before layers consume. The
 * variable is registered via @property so the swap cross-fades over ~1.2s.
 */
export default function ChromeTint() {
  const { tracks, currentTrackIndex } = usePlayer();
  const coverUrl =
    currentTrackIndex >= 0 && currentTrackIndex < tracks.length
      ? tracks[currentTrackIndex]?.cover_url
      : undefined;
  const color = useCoverColor(coverUrl);

  useEffect(() => {
    const root = document.documentElement;
    if (color) {
      root.style.setProperty("--chrome-tint", `rgb(${color.r}, ${color.g}, ${color.b})`);
    } else {
      root.style.removeProperty("--chrome-tint");
    }
  }, [color]);

  return null;
}
