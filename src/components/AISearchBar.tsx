"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import useSWRImmutable from "swr/immutable";
import Fuse from "fuse.js";
import { Track } from "@/lib/cloudflare";
import { usePlayer } from "@/context/PlayerContext";
import CoverImage from "@/components/CoverImage";
import { cleanTitle } from "@/lib/cleanTitle";
import { hashString, PALETTES } from "@/lib/utils";

type AISearchBarProps = {
  // Optional immediate index (e.g. the home page's current list). Used only as
  // a fallback while the full-library index below is still loading, so search
  // always covers the WHOLE library — not just the page's subset.
  allTracks?: Track[];
  onFilteredTracks: (tracks: Track[] | null) => void;
};

const indexFetcher = (url: string) =>
  fetch(url).then((r) => r.json() as Promise<{ tracks: Track[] }>);

// Stable identity for the no-prop case. An inline `= []` default would mint a
// new array every render, which cascades into a new Fuse index every render
// and turns the prevFuse render-adjustment below into an infinite loop
// (React #301) whenever the lazy index hasn't arrived yet.
const NO_TRACKS: Track[] = [];

// Mood / intent words (ID + EN) that should route a query to the AI even when
// it's short — e.g. "lagu sedih", "musik santai", "happy songs".
const AI_INTENT_PATTERN =
  /\b(lagu|lagu2|musik|music|songs?|playlist|buat|untuk|yang|mirip|kayak|seperti|rekomendasi|recommend|mood|vibe|sedih|galau|patah\s*hati|rindu|kangen|nostalgia|santai|chill|tenang|relax|semangat|energik|enerjik|upbeat|happy|senang|ceria|romantis|romantic|cinta|love|sad|mellow|melow|sendu|fokus|focus|belajar|study|tidur|sleep|workout|olahraga|gym|party|pesta|jalan|nyetir|driving)\b/i;

function SearchTrackCover({ track }: { track: Track }) {
  return (
    <div className="relative w-11 h-11 rounded-md overflow-hidden flex-shrink-0 shadow-sm">
      {track.cover_url ? (
        <CoverImage src={track.cover_url} alt={track.title} />
      ) : (
        (() => {
          const [c1, c2] = PALETTES[hashString(track.title + track.category) % PALETTES.length];
          return (
            <div className="w-full h-full flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="white" className="opacity-90 drop-shadow">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
              </svg>
            </div>
          );
        })()
      )}
    </div>
  );
}

export default function AISearchBar({ allTracks = NO_TRACKS, onFilteredTracks }: AISearchBarProps) {
  // Lazy full-library index: fetched once per session on the first focus of
  // the input, then cached by SWR. Searching over this instead of the page's
  // own (often partial) track list fixes "no results" on filtered pages.
  const [activated, setActivated] = useState(false);
  const { data: indexData } = useSWRImmutable(activated ? "/api/tracks" : null, indexFetcher);
  const library = indexData?.tracks?.length ? indexData.tracks : allTracks;

  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Track[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [recentSearches, setRecentSearches] = useState<Track[]>([]);
  const [isAILoading, setIsAILoading] = useState(false);
  const [aiMessage, setAiMessage] = useState<string | null>(null);
  const [isAIMode, setIsAIMode] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const { playTrack } = usePlayer();

  // Load recent searches from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem("zenify_recent_searches");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setRecentSearches(parsed);
        }
      }
    } catch (err) {
      console.error("Failed to load recent searches", err);
    }
  }, []);

  // Handle outside click to close dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const saveRecentSearch = (track: Track) => {
    try {
      const updated = [track, ...recentSearches.filter((t) => t.id !== track.id)].slice(0, 10);
      setRecentSearches(updated);
      localStorage.setItem("zenify_recent_searches", JSON.stringify(updated));
    } catch (err) {
      console.error("Failed to save recent search", err);
    }
  };

  const removeRecentSearch = (e: React.MouseEvent, trackId: string) => {
    e.stopPropagation();
    try {
      const updated = recentSearches.filter((t) => t.id !== trackId);
      setRecentSearches(updated);
      localStorage.setItem("zenify_recent_searches", JSON.stringify(updated));
    } catch (err) {
      console.error("Failed to remove recent search", err);
    }
  };

  // Build a Fuse index whenever the track list changes.
  const fuse = useMemo(
    () =>
      new Fuse(library, {
        keys: [
          { name: "title", weight: 0.5 },
          { name: "artist", weight: 0.3 },
          { name: "genre", weight: 0.1 },
          { name: "category", weight: 0.1 },
        ],
        threshold: 0.4,
        includeScore: true,
        minMatchCharLength: 2,
        ignoreLocation: true,
      }),
    [library]
  );

  // Local search: fuzzy filter using Fuse.js
  const localSearch = useCallback(
    (q: string) => {
      const results = fuse.search(q);
      const filtered = results.map((r) => r.item);
      setSearchResults(filtered);
      setAiMessage(null);
      setIsAIMode(false);
    },
    [fuse]
  );

  // The track index is lazy-loaded on first focus, so it can arrive AFTER the
  // user has already typed. When the index (and thus `fuse`) changes under an
  // active plain query, re-run it so results appear without another keystroke.
  // Done as a during-render state adjustment (not an effect) per React's
  // derived-state pattern — avoids an extra commit and the set-state-in-effect
  // lint rule.
  const [prevFuse, setPrevFuse] = useState(fuse);
  if (prevFuse !== fuse) {
    setPrevFuse(fuse);
    const trimmed = query.trim();
    if (trimmed && !isAIMode) {
      setSearchResults(fuse.search(trimmed).map((r) => r.item));
    }
  }

  // AI search: send to /api/ai/search
  const aiSearch = useCallback(
    async (q: string) => {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsAILoading(true);
      setIsAIMode(true);
      setAiMessage(null);

      try {
        const res = await fetch("/api/ai/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q }),
          signal: controller.signal,
        });

        const data = await res.json();
        const uniqueIds = Array.from(new Set<string>(data.trackIds || []));

        if (uniqueIds.length > 0) {
          const idSet = new Set<string>(uniqueIds);
          const ordered = uniqueIds
            .map((id: string) => library.find((t) => t.id === id))
            .filter(Boolean) as Track[];
          const localResults = fuse.search(q).map((r) => r.item);
          const remaining = localResults.filter((t) => !idSet.has(t.id));
          setSearchResults([...ordered, ...remaining]);
        } else {
          const localResults = fuse.search(q).map((r) => r.item);
          setSearchResults(localResults);
        }

        setAiMessage(data.message || null);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        console.error("AI search failed:", err);
        setAiMessage("AI sedang tidak tersedia. Menampilkan hasil pencarian biasa.");
        localSearch(q);
      } finally {
        setIsAILoading(false);
      }
    },
    [library, localSearch, fuse]
  );

  // Handle input change with smart routing
  const handleChange = (value: string) => {
    setQuery(value);
    setIsOpen(true);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!value.trim()) {
      setSearchResults([]);
      setAiMessage(null);
      setIsAIMode(false);
      setIsAILoading(false);
      return;
    }

    const trimmed = value.trim();
    const isAIQuery =
      trimmed.startsWith("/ai ") ||
      trimmed.length > 20 ||
      AI_INTENT_PATTERN.test(trimmed);

    if (isAIQuery) {
      const aiQuery = trimmed.startsWith("/ai ") ? trimmed.slice(4) : trimmed;
      localSearch(trimmed);
      debounceRef.current = setTimeout(() => aiSearch(aiQuery), 800);
    } else {
      localSearch(trimmed);
    }
  };

  // Handle Enter key for immediate AI search
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && query.trim()) {
      e.preventDefault();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const trimmed = query.trim();
      const aiQuery = trimmed.startsWith("/ai ") ? trimmed.slice(4) : trimmed;
      aiSearch(aiQuery);
    } else if (e.key === "Escape") {
      setIsOpen(false);
    }
  };

  // Clear search
  const handleClear = () => {
    setQuery("");
    setSearchResults([]);
    setAiMessage(null);
    setIsAIMode(false);
    setIsAILoading(false);
    inputRef.current?.focus();
    setIsOpen(true);
  };

  const handleTrackClick = (track: Track, list: Track[], idx: number) => {
    playTrack(list, idx);
    saveRecentSearch(track);
    setIsOpen(false);
  };

  const handleRecentClick = (track: Track) => {
    const idx = library.findIndex((t) => t.id === track.id);
    // Index may still be loading (lazy fetch) — play just this track then.
    if (idx >= 0) playTrack(library, idx);
    else playTrack([track], 0);
    saveRecentSearch(track);
    setIsOpen(false);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  return (
    <div ref={containerRef} className="flex-1 max-w-[480px] relative">
      {/* Search Input */}
      <div
        className="flex items-center gap-2 rounded-full px-4 py-2.5 transition-all"
        style={{
          background: "var(--bg-card)",
          border: isAIMode
            ? "1px solid rgba(99,102,241,0.4)"
            : "1px solid var(--border-subtle)",
          backdropFilter: "blur(12px)",
          boxShadow: isAIMode
            ? "0 0 20px rgba(99,102,241,0.15)"
            : "none",
        }}
      >
        {/* Icon: Search or AI sparkle */}
        {isAILoading ? (
          <span className="ai-sparkle flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="url(#ai-gradient)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <defs>
                <linearGradient id="ai-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#6366f1" />
                  <stop offset="100%" stopColor="#a855f7" />
                </linearGradient>
              </defs>
              <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
            </svg>
          </span>
        ) : isAIMode ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
            <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ color: "var(--text-muted)", flexShrink: 0 }}>
            <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
          </svg>
        )}

        <input
          ref={inputRef}
          type="text"
          placeholder="Search or ask AI... (e.g. 'lagu sedih tentang rindu')"
          className="bg-transparent border-none outline-none text-sm w-full"
          style={{ color: "var(--text-primary)" }}
          value={query}
          onFocus={() => { setIsOpen(true); setActivated(true); }}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
        />

        {/* Clear button */}
        {query && (
          <button
            onClick={handleClear}
            className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center transition-all hover:scale-110 active:scale-95"
            style={{ background: "var(--bg-card-hover)", color: "var(--text-muted)" }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" />
            </svg>
          </button>
        )}

        {/* AI badge */}
        {isAILoading && (
          <span className="flex items-center gap-1 flex-shrink-0">
            <span className="ai-dot w-1.5 h-1.5 rounded-full" style={{ background: "#6366f1", animationDelay: "0ms" }} />
            <span className="ai-dot w-1.5 h-1.5 rounded-full" style={{ background: "#8b5cf6", animationDelay: "150ms" }} />
            <span className="ai-dot w-1.5 h-1.5 rounded-full" style={{ background: "#a855f7", animationDelay: "300ms" }} />
          </span>
        )}
      </div>

      {/* Popover / Dropdown Menu */}
      {isOpen && (
        <div
          className="absolute left-0 right-0 top-full mt-2 bg-[var(--bg-secondary)] border border-[var(--border-card)] rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.7)] z-50 p-4 max-h-[420px] overflow-y-auto scrollbar-thin text-left"
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-[var(--border-subtle)]">
            <span className="font-bold text-sm" style={{ color: "var(--text-primary)" }}>
              {query.trim() ? (isAIMode ? "AI Search Results" : "Search Results") : "Recent Searches"}
            </span>
            <button
              onClick={() => setIsOpen(false)}
              className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-[var(--bg-card-hover)] transition-colors"
              style={{ color: "var(--text-muted)" }}
              title="Close"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* AI Message Bubble inside dropdown */}
          {aiMessage && (
            <div
              className="mb-4 px-4 py-3 rounded-xl text-sm"
              style={{
                background: "var(--bg-card)",
                border: "1px solid rgba(99,102,241,0.3)",
                color: "var(--text-primary)",
              }}
            >
              <div className="flex items-start gap-2.5">
                <span className="flex-shrink-0 mt-0.5">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
                  </svg>
                </span>
                <p className="leading-relaxed flex-1 whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>
                  {aiMessage}
                </p>
              </div>
            </div>
          )}

          {/* List Content */}
          {!query.trim() ? (
            recentSearches.length > 0 ? (
              <div className="flex flex-col gap-1">
                {recentSearches.map((track) => (
                  <div
                    key={track.id}
                    onClick={() => handleRecentClick(track)}
                    className="group flex items-center gap-3 p-2 rounded-xl cursor-pointer hover:bg-[var(--bg-card-hover)] transition-colors"
                  >
                    <SearchTrackCover track={track} />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm truncate" style={{ color: "var(--text-primary)" }}>
                        {cleanTitle(track.title)}
                      </p>
                      <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                        Song • {track.artist || track.category}
                      </p>
                    </div>
                    <button
                      onClick={(e) => removeRecentSearch(e, track.id)}
                      className="w-7 h-7 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-[var(--bg-card)] transition-all"
                      style={{ color: "var(--text-muted)" }}
                      title="Remove"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                No recent searches
              </div>
            )
          ) : (
            searchResults.length > 0 ? (
              <div className="flex flex-col gap-1">
                {searchResults.map((track, idx) => (
                  <div
                    key={track.id}
                    onClick={() => handleTrackClick(track, searchResults, idx)}
                    className="group flex items-center gap-3 p-2 rounded-xl cursor-pointer hover:bg-[var(--bg-card-hover)] transition-colors"
                  >
                    <SearchTrackCover track={track} />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm truncate" style={{ color: "var(--text-primary)" }}>
                        {cleanTitle(track.title)}
                      </p>
                      <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                        Song • {track.artist || track.category}
                      </p>
                    </div>
                    <span
                      className="w-8 h-8 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
                      style={{ border: "1px solid var(--border-card)", color: "var(--accent)" }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="ml-0.5">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-12 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                No matching tracks found for &quot;{query}&quot;
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
