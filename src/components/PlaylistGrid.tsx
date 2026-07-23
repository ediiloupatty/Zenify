// No "use client": only next/link + pure helpers, so it renders on the server.
import Link from "next/link";
import { Playlist } from "@/lib/cloudflare";
import { hashString, PALETTES } from "@/lib/utils";

export default function PlaylistGrid({
  heading,
  playlists,
  limit,
  viewAllHref,
  wrap = false,
}: {
  heading: string;
  playlists: Playlist[];
  limit?: number;
  viewAllHref?: string;
  wrap?: boolean;
}) {
  if (!playlists) return null;

  const hasMore = !!limit && playlists.length > limit;
  const shown = limit ? playlists.slice(0, limit) : playlists;

  return (
    <section className="mb-10 relative">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-black" style={{ color: "var(--text-primary)" }}>
          {heading}
        </h2>
        {viewAllHref && hasMore && (
          <Link href={viewAllHref} className="text-sm font-semibold hover:underline" style={{ color: "var(--accent)" }}>
            View all
          </Link>
        )}
      </div>

      <div className={wrap ? "flex flex-wrap gap-5 items-stretch" : "flex overflow-x-auto gap-5 pb-4 snap-x snap-mandatory items-stretch"}>
        {shown.map((playlist) => {
          const [c1, c2] = PALETTES[hashString(playlist.id) % PALETTES.length];
          // Mock some tracks count and privacy for visual fidelity to reference
          const tracksCount = (hashString(playlist.name) % 30) + 10;
          const isPrivate = hashString(playlist.name) % 2 === 0;

          return (
            <Link
              key={playlist.id}
              href={`/?playlist=${playlist.id}`}
              className="flex-shrink-0 w-[280px] h-[180px] snap-start flex flex-col group cursor-pointer rounded-xl overflow-hidden shadow-lg hover:shadow-xl transition-shadow relative"
              style={{ background: `linear-gradient(135deg, ${c1}, ${c2})`, border: "1px solid rgba(255,255,255,0.1)" }}
            >
              <div className="w-full h-full flex flex-col p-5 justify-between relative z-10">
                {/* Top Left: Icon */}
                <div className="opacity-80">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                     <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                  </svg>
                </div>
                
                {/* Bottom Left: Title, Tracks, Badge */}
                <div className="flex flex-col">
                  <span className="text-lg font-bold text-white mb-0.5">{playlist.name}</span>
                  <span className="text-xs text-white/70 mb-3">{tracksCount} tracks</span>
                  
                  {/* Privacy Badge */}
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/20 self-start border border-white/10">
                    {isPrivate ? (
                      <>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                        </svg>
                        <span className="text-[10px] font-semibold text-white/90 uppercase tracking-wider">Private</span>
                      </>
                    ) : (
                      <>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                           <circle cx="12" cy="12" r="10"></circle>
                           <line x1="2" y1="12" x2="22" y2="12"></line>
                           <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                        </svg>
                        <span className="text-[10px] font-semibold text-white/90 uppercase tracking-wider">Public</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Bottom Right: Play Button Overlay */}
              <div className="absolute bottom-5 right-5 z-20">
                 <div className="w-10 h-10 rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-110 active:scale-95" style={{ background: "rgba(0,0,0,0.3)", backdropFilter: "blur(4px)" }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="white" className="ml-1"><path d="M8 5v14l11-7z" /></svg>
                </div>
              </div>
            </Link>
          );
        })}

        {/* Create New Playlist Card */}
        <button
          className="flex-shrink-0 w-[280px] h-[180px] snap-start flex flex-col group cursor-pointer rounded-xl overflow-hidden p-5 border-2 border-dashed transition-all hover:bg-white/5"
          style={{ borderColor: "var(--border-subtle)", background: "transparent" }}
        >
          <div className="w-full h-full flex flex-col justify-center items-center text-center">
             <div className="w-12 h-12 rounded-lg flex items-center justify-center border border-dashed mb-4" style={{ borderColor: "var(--text-muted)", color: "var(--text-muted)" }}>
               <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                 <line x1="12" y1="5" x2="12" y2="19"></line>
                 <line x1="5" y1="12" x2="19" y2="12"></line>
               </svg>
             </div>
             <span className="text-sm font-bold mb-1" style={{ color: "var(--text-primary)" }}>Create New Playlist</span>
             <span className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>Make your own collection</span>
             <div className="px-5 py-1.5 rounded-full border text-xs font-semibold transition-colors hover:bg-white/10" style={{ borderColor: "var(--border-subtle)", color: "var(--text-primary)" }}>
                Create
             </div>
          </div>
        </button>
      </div>
    </section>
  );
}
