"use client";

import useSWR from "swr";
import { hashString, PALETTES } from "@/lib/utils";
import { usePlayer } from "@/context/PlayerContext";
import CoverImage from "@/components/CoverImage";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type CoverTrack = {
  id: string;
  cover_url?: string;
  title: string;
  artist?: string;
  category: string;
};

type MixPayload = {
  id: string;
  title: string;
  description: string;
  tracks: any[];
  coverTracks: CoverTrack[];
};

// 2×2 mosaic cover from the first 4 tracks
function MixCover({ tracks }: { tracks: CoverTrack[] }) {
  const cells = tracks.slice(0, 4);
  // Pad to 4 if fewer
  while (cells.length < 4) cells.push(cells[cells.length - 1]);

  return (
    <div className="w-full aspect-square rounded-xl overflow-hidden grid grid-cols-2 grid-rows-2">
      {cells.map((t, i) => {
        if (t.cover_url) {
          return (
            <div key={`${t.id}-${i}`} className="relative w-full h-full">
              <CoverImage src={t.cover_url} alt={t.title} />
            </div>
          );
        }
        const [c1, c2] = PALETTES[hashString(t.title + t.category) % PALETTES.length];
        return (
          <div
            key={`${t.id}-${i}`}
            className="w-full h-full flex items-center justify-center"
            style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}
          >
            <svg width="28%" height="28%" viewBox="0 0 24 24" fill="white" className="opacity-80">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
            </svg>
          </div>
        );
      })}
    </div>
  );
}

export default function DailyMixSection({ fallbackData }: { fallbackData?: { mixes: MixPayload[] } }) {
  const { data, isLoading } = useSWR<{ mixes: MixPayload[] }>("/api/daily-mix", fetcher, {
    fallbackData,
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  });
  const { playTrack } = usePlayer();

  const mixes = data?.mixes || [];

  if (isLoading) {
    return (
      <section className="mb-10">
        <h2 className="text-xl font-black mb-5" style={{ color: "var(--text-primary)" }}>
          Daily Mix
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="w-full aspect-square rounded-xl mb-3" style={{ background: "var(--bg-card)" }} />
              <div className="h-4 rounded w-3/4 mb-2" style={{ background: "var(--bg-card)" }} />
              <div className="h-3 rounded w-1/2" style={{ background: "var(--bg-card)" }} />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (mixes.length === 0) return null;

  return (
    <section className="mb-10">
      <h2 className="text-xl font-black mb-5" style={{ color: "var(--text-primary)" }}>
        Daily Mix
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
        {mixes.map((mix) => (
          <div
            key={mix.id}
            role="button"
            tabIndex={0}
            onClick={() => playTrack(mix.tracks, 0)}
            onKeyDown={(e) => e.key === "Enter" && playTrack(mix.tracks, 0)}
            className="group cursor-pointer flex flex-col"
          >
            {/* Cover */}
            <div className="relative mb-3 shadow-lg group-hover:shadow-xl transition-shadow">
              <MixCover tracks={mix.coverTracks} />
              {/* Play overlay */}
              <div className="absolute inset-0 rounded-xl bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <span
                  className="w-12 h-12 rounded-full flex items-center justify-center shadow-lg transform translate-y-2 group-hover:translate-y-0 transition-all duration-300"
                  style={{ background: "var(--accent)" }}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="white" className="ml-1">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </span>
              </div>
            </div>
            {/* Info */}
            <h3 className="font-semibold text-[15px] truncate" style={{ color: "var(--text-primary)" }}>
              {mix.title}
            </h3>
            <p className="text-[13px] truncate mt-0.5" style={{ color: "var(--text-muted)" }}>
              {mix.description}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
