// No "use client": only next/link + pure helpers, so it renders on the server.
import Link from "next/link";
import { hashString, PALETTES } from "@/lib/utils";
import CoverImage from "@/components/CoverImage";

type Artist = {
  name: string;
  image_url?: string;
};

export default function ArtistGrid({
  heading,
  artists,
  limit,
  viewAllHref,
  wrap = false,
}: {
  heading: string;
  artists: Artist[];
  limit?: number;
  viewAllHref?: string;
  wrap?: boolean;
}) {
  if (!artists || artists.length === 0) return null;

  const hasMore = !!limit && artists.length > limit;
  const shown = limit ? artists.slice(0, limit) : artists;

  return (
    <section className="mb-10 relative">
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

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-5">
        {shown.map((artist) => {
          const [c1, c2] = PALETTES[hashString(artist.name) % PALETTES.length];
          return (
            <Link
              key={artist.name}
              href={`/artist/${encodeURIComponent(artist.name)}`}
              className="flex flex-col items-center group cursor-pointer"
            >
              <div className="relative w-full aspect-square rounded-full overflow-hidden mb-3 shadow-lg group-hover:shadow-xl transition-shadow" style={{ border: "1px solid var(--border-subtle)" }}>
                {artist.image_url ? (
                  <CoverImage src={artist.image_url} alt={artist.name} />
                ) : (
                  <div className="w-full h-full flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}>
                    <span className="text-4xl font-black text-white drop-shadow">{artist.name.charAt(0).toUpperCase()}</span>
                  </div>
                )}
                {/* Play button overlay */}
                <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                   <span className="w-12 h-12 rounded-full flex items-center justify-center shadow-lg transform translate-y-2 group-hover:translate-y-0 transition-all duration-300" style={{ background: "var(--accent)" }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="white" className="ml-1"><path d="M8 5v14l11-7z" /></svg>
                  </span>
                </div>
              </div>
              <h3 className="font-semibold text-[15px] truncate w-full text-center" style={{ color: "var(--text-primary)" }}>
                {artist.name}
              </h3>
              <p className="text-[13px] truncate w-full text-center mt-1" style={{ color: "var(--text-muted)" }}>
                Artist
              </p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
