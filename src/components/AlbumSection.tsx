"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import { hashString, PALETTES } from "@/lib/utils";
import CoverImage from "@/components/CoverImage";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type Album = {
  name: string;
  trackCount: number;
  artist?: string;
  cover_url?: string;
  source: "embedded" | "uploaded" | "none";
};

export default function AlbumSection({
  currentAlbum,
  heading = "Albums",
  limit,
  allowHorizontal = false,
  fillRow = false,
  viewAllHref,
  fallbackData,
}: {
  currentAlbum: string | null;
  heading?: string;
  limit?: number;
  allowHorizontal?: boolean;
  fillRow?: boolean;
  viewAllHref?: string;
  fallbackData?: { albums: Album[] };
}) {
  const router = useRouter();
  const { data } = useSWR<{ albums: Album[] }>("/api/albums", fetcher, {
    fallbackData,
    revalidateOnFocus: false,
  });

  const allAlbums = data?.albums || [];
  const hasMore = !!limit && allAlbums.length > limit;
  let albums = allAlbums;
  if (limit) albums = albums.slice(0, limit);
  if (albums.length === 0) return null;

  function openAlbum(name: string) {
    router.push(`/album/${encodeURIComponent(name)}`);
  }

  const containerClasses = fillRow
    ? "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-4"
    : allowHorizontal
      ? "flex overflow-x-auto gap-5 pb-4 snap-x snap-mandatory"
      : "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3";

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-black" style={{ color: "var(--text-primary)" }}>
          {heading}
        </h2>
        {viewAllHref && hasMore && (
          <Link href={viewAllHref} prefetch={true} className="text-sm font-semibold hover:underline" style={{ color: "var(--accent)" }}>
            View all
          </Link>
        )}
      </div>

      <div className={containerClasses}>
        {albums.map((album) => {
          const isSelected = currentAlbum === album.name;
          const [c1, c2] = PALETTES[hashString(album.name) % PALETTES.length];
          return (
            <div
              key={album.name}
              role="button"
              tabIndex={0}
              onClick={() => openAlbum(album.name)}
              onKeyDown={(e) => e.key === "Enter" && openAlbum(album.name)}
              className={`flex-shrink-0 ${allowHorizontal ? "w-[150px] snap-start" : ""} flex flex-col group cursor-pointer transition-colors`}
            >
              <div
                className="relative w-full aspect-square rounded-xl overflow-hidden mb-3 shadow-lg group-hover:shadow-xl transition-shadow"
                style={{
                  border: isSelected ? "2px solid var(--accent)" : "1px solid var(--border-subtle)",
                }}
              >
                {album.cover_url ? (
                  <CoverImage src={album.cover_url} alt={album.name} />
                ) : (
                  <div
                    className="w-full h-full flex items-center justify-center"
                    style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}
                  >
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="white" className="opacity-90 drop-shadow">
                      <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                    </svg>
                  </div>
                )}
                <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
                  <span
                    className="w-9 h-9 rounded-full flex items-center justify-center shadow-lg"
                    style={{ background: "var(--accent)" }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="white" className="ml-0.5">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </span>
                </div>
              </div>

              <div>
                <h3
                  className="font-semibold text-[15px] truncate w-full"
                  style={{ color: isSelected ? "var(--accent)" : "var(--text-primary)" }}
                >
                  {album.name}
                </h3>
                <p className="text-[13px] truncate w-full mt-0.5" style={{ color: "var(--text-muted)" }}>
                  {album.artist || "Various Artists"} · {album.trackCount} track{album.trackCount !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
