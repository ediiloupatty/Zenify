"use client";

import { useEffect, useRef, useState } from "react";
import { useLiteMode } from "@/lib/perfMode";

// Incremental rendering for long lists: render ~`initial` items first, then
// reveal `step` more whenever the user scrolls a sentinel element near the
// viewport. Keeps the DOM small without pulling in a virtualization library.
//
// Usage:
//   const { visibleCount, sentinelRef, hasMore } = useIncrementalList(items.length);
//   {items.slice(0, visibleCount).map(...)}
//   {hasMore && <div ref={sentinelRef} />}
//
// Note: still pass the FULL array to the player/queue — only the *rendered*
// rows are sliced, not the underlying data.
export function useIncrementalList(total: number, initial = 40, step = 40) {
  // Rendered rows are never taken back once revealed, so an afternoon of
  // browsing a big library leaves thousands of them in the document. Lite mode
  // halves both the first paint and each reveal, and pulls the pre-load margin
  // in, so the DOM grows at half the rate for the same scrolling.
  const lite = useLiteMode();
  const batchInitial = lite ? Math.ceil(initial / 2) : initial;
  const batchStep = lite ? Math.ceil(step / 2) : step;

  const [visibleCount, setVisibleCount] = useState(() => Math.min(batchInitial, total));
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Read through a ref so the reset below still fires only on a list change.
  // `lite` resolves one tick after hydration, and keying the reset on it would
  // yank 20 already-painted rows back out of the document on lite devices.
  const batchInitialRef = useRef(batchInitial);
  useEffect(() => { batchInitialRef.current = batchInitial; }, [batchInitial]);

  // When the underlying list changes size (e.g. switching category/playlist),
  // start over from the top. If `total` is unchanged this does not run, so a
  // scrolled-down position is preserved across revalidations.
  useEffect(() => {
    setVisibleCount(Math.min(batchInitialRef.current, total));
  }, [total]);

  useEffect(() => {
    if (visibleCount >= total) return;
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((c) => Math.min(c + batchStep, total));
        }
      },
      // Load a bit before the sentinel is actually on screen for a seamless feel.
      { rootMargin: lite ? "300px 0px" : "600px 0px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [visibleCount, total, batchStep, lite]);

  return { visibleCount, sentinelRef, hasMore: visibleCount < total };
}
