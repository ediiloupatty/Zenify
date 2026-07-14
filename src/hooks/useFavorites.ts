"use client";

import { useState, useRef, useEffect } from "react";
import { toggleFavoriteAction, getFavoriteIdsAction } from "@/app/actions/favorites";
import { useToast } from "@/context/ToastContext";
import { Track } from "@/lib/cloudflare";

/**
 * Manages the fullscreen player's "liked" heart state.
 * Fetches all favorite IDs once, then toggles optimistically with revert on failure.
 */
export function useFavorites(currentTrack: Track | null) {
  const { showToast } = useToast();
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const favLoggedInRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getFavoriteIdsAction()
      .then(({ loggedIn, ids }) => {
        if (cancelled) return;
        favLoggedInRef.current = loggedIn;
        setFavoriteIds(new Set(ids));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const liked = currentTrack ? favoriteIds.has(currentTrack.id) : false;

  const toggleLike = async () => {
    if (!currentTrack) return;
    if (!favLoggedInRef.current) {
      showToast("Sign in to save favorites", "error");
      return;
    }
    const id = currentTrack.id;
    const wasLiked = favoriteIds.has(id);
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (wasLiked) next.delete(id); else next.add(id);
      return next;
    });
    const result = await toggleFavoriteAction(id, wasLiked);
    if (result.success) {
      showToast(wasLiked ? "Removed from favorites" : "Added to favorites");
    } else {
      setFavoriteIds((prev) => {
        const next = new Set(prev);
        if (wasLiked) next.add(id); else next.delete(id);
        return next;
      });
      showToast(result.error || "Couldn't update favorites", "error");
    }
  };

  return { liked, toggleLike };
}
