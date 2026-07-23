import Link from "next/link";
import { auth } from "@/auth";
import Sidebar from "@/components/Sidebar";
import { getUserFavorites, getUserStats, getTracksByCategory, getRecentlyPlayed, getPlaylists } from "@/lib/cloudflare";
import CompactTrackList from "@/components/CompactTrackList";
import PlaylistGrid from "@/components/PlaylistGrid";
import QueueAwareMain from "@/components/QueueAwareMain";
import { hashString, PALETTES } from "@/lib/utils";
import TopHeader from "@/components/TopHeader";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await auth();
  const isLoggedIn = !!session?.user;

  if (!isLoggedIn) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center px-6 gap-6"
        style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}
      >
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center shadow-lg"
          style={{ background: "linear-gradient(135deg, var(--accent), #6366f1)" }}
        >
          <svg width="36" height="36" viewBox="0 0 24 24" fill="white">
             <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
          </svg>
        </div>
        <div className="text-center">
          <h2 className="text-2xl font-black mb-2" style={{ color: "var(--text-primary)" }}>
            Your Profile
          </h2>
          <p className="text-sm max-w-xs" style={{ color: "var(--text-muted)" }}>
            Sign in to view your profile, favorites, and playlists.
          </p>
        </div>
        <Link
          href="/login"
          className="px-8 py-3 rounded-full font-bold text-sm text-white transition-all hover:scale-105 active:scale-95"
          style={{ background: "linear-gradient(135deg, var(--accent), var(--accent-dark))" }}
        >
          Sign In
        </Link>
        <Link href="/player" className="text-sm" style={{ color: "var(--text-muted)" }}>
          Back to Player
        </Link>
      </div>
    );
  }

  const userEmail = session.user?.email || "";
  const userName = session.user?.name || "User";
  const userInitial = userName.charAt(0).toUpperCase();

  // Fetch data (all realtime from D1)
  const [userFavorites, allTracks, { joinedAt, totalPlays }, recentlyPlayed] = await Promise.all([
    getUserFavorites(userEmail),
    getTracksByCategory(null),
    getUserStats(userEmail),
    getRecentlyPlayed(userEmail, 4),
  ]);

  // Filter and limit favorites (e.g., top 12)
  const favoriteTracks = allTracks.filter((t) => userFavorites.includes(t.id)).slice(0, 12);

  // "Joined <Month> <Year>" from the account's created_at (falls back gracefully).
  const joinedLabel = joinedAt
    ? new Date(joinedAt.includes("T") || joinedAt.includes(" ") ? joinedAt.replace(" ", "T") + "Z" : joinedAt)
        .toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : null;

  // The user's own playlists (already scoped to this user by getPlaylists).
  const userPlaylists = await getPlaylists(userEmail);

  const [c1, c2] = PALETTES[hashString(userEmail || userName) % PALETTES.length];

  return (
    <div
      className="flex h-screen font-sans overflow-hidden relative"
      style={{ background: "var(--bg-primary)", color: "var(--text-primary)" }}
    >
      <Sidebar currentCategory={null} />

      {/* ─── MAIN AREA ────────────────────────────────────────────── */}
      <QueueAwareMain className="relative z-10 flex-1 flex flex-col overflow-hidden">
        <TopHeader />
        <div className="flex-1 overflow-y-auto pb-44" style={{ background: "var(--bg-base)" }}>
      {/* ── Top Right Actions ── */}
      <div className="absolute top-24 right-6 z-30 flex items-center gap-3">
        <button
          className="flex items-center gap-2 px-4 py-2 rounded-full border transition-colors hover:bg-white/10"
          style={{ borderColor: "var(--border-subtle)", color: "var(--text-primary)" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          <span className="text-sm font-semibold">Edit Profile</span>
        </button>
        <button
          className="w-10 h-10 rounded-full flex items-center justify-center border transition-colors hover:bg-white/10"
          style={{ borderColor: "var(--border-subtle)", color: "var(--text-primary)" }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
          </svg>
        </button>
      </div>

      {/* ── Hero Profile Header ── */}
      <div className="relative pt-20 pb-6 px-6 md:px-14 flex flex-col md:flex-row items-center md:items-start gap-8 overflow-hidden min-h-[320px]">
        
        {/* Fake Wave Background (SVG) */}
        <div className="absolute top-0 right-0 w-[60%] h-full opacity-40 pointer-events-none flex items-center justify-end overflow-hidden" style={{ zIndex: 0 }}>
           <svg viewBox="0 0 800 300" preserveAspectRatio="none" className="w-full h-full" style={{ filter: "drop-shadow(0 0 20px #06b6d4)" }}>
              <path d="M0 150 Q 200 50 400 150 T 800 150" fill="none" stroke="#06b6d4" strokeWidth="2" strokeOpacity="0.7" />
              <path d="M0 150 Q 200 100 400 150 T 800 150" fill="none" stroke="#06b6d4" strokeWidth="4" strokeOpacity="0.3" />
              <path d="M0 150 Q 200 0 400 150 T 800 150" fill="none" stroke="#06b6d4" strokeWidth="1" strokeOpacity="0.5" strokeDasharray="5,5" />
           </svg>
        </div>
        
        {/* Massive Avatar */}
        <div className="relative z-10 flex-shrink-0 mt-4 md:mt-0">
          <div 
            className="w-40 h-40 md:w-56 md:h-56 rounded-full flex items-center justify-center shadow-2xl"
            style={{ background: `linear-gradient(135deg, #14b8a6, #06b6d4)` }}
          >
            <span className="text-6xl md:text-8xl font-black text-white drop-shadow-md">
              {userInitial}
            </span>
            <div className="absolute inset-0 rounded-full shadow-[inset_0_0_40px_rgba(0,0,0,0.2)]" />
          </div>
          {/* Edit Badge */}
          <button 
            className="absolute bottom-2 right-4 w-10 h-10 rounded-full flex items-center justify-center border-4 shadow-lg transition-transform hover:scale-110 active:scale-95"
            style={{ background: "var(--bg-secondary)", borderColor: "var(--bg-base)", color: "var(--text-primary)" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          </button>
        </div>

        {/* User Info */}
        <div className="relative z-10 flex flex-col items-center md:items-start text-center md:text-left min-w-0 mt-4">
          <span className="text-xs font-bold uppercase tracking-widest mb-1 opacity-80" style={{ color: "#14b8a6" }}>Profile</span>
          <h1 className="text-4xl md:text-5xl font-black truncate max-w-full leading-tight mb-2" style={{ color: "var(--text-primary)" }}>
            {userName}
          </h1>
          
          <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 text-sm opacity-80 mb-4" style={{ color: "var(--text-muted)" }}>
             <span>{userEmail}</span>
             {joinedLabel && (
               <>
                 <span className="w-1 h-1 rounded-full bg-current opacity-50" />
                 <span>Joined {joinedLabel}</span>
               </>
             )}
          </div>

          <p className="italic text-sm mb-6" style={{ color: "var(--text-muted)" }}>
            &apos;Music is what feelings sound like.&apos;
          </p>

          {/* Stats Row */}
          <div className="flex items-center gap-8 md:gap-12 mt-auto pb-2">
            <div className="flex flex-col">
              <span className="text-2xl font-bold" style={{ color: "#14b8a6" }}>{userPlaylists.length}</span>
              <span className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>Playlists</span>
            </div>
            <div className="flex flex-col">
              <span className="text-2xl font-bold" style={{ color: "#14b8a6" }}>{allTracks.length}</span>
              <span className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>Tracks</span>
            </div>
            <div className="flex flex-col">
              <span className="text-2xl font-bold" style={{ color: "#14b8a6" }}>{totalPlays.toLocaleString()}</span>
              <span className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>Total Plays</span>
            </div>
            <div className="flex flex-col">
              <span className="text-2xl font-bold" style={{ color: "#14b8a6" }}>{userFavorites.length}</span>
              <span className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>Favorites</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Tabs Navigation ── */}
      <div className="px-6 md:px-14 border-b mb-8 flex gap-8" style={{ borderColor: "var(--border-subtle)" }}>
         <button className="py-4 text-sm font-bold relative transition-colors" style={{ color: "var(--text-primary)" }}>
            Overview
            <span className="absolute bottom-[-1px] left-0 w-full h-[3px] rounded-t-md" style={{ background: "#14b8a6" }} />
         </button>
         <button className="py-4 text-sm font-semibold transition-colors hover:text-white" style={{ color: "var(--text-muted)" }}>
            Playlists
         </button>
         <button className="py-4 text-sm font-semibold transition-colors hover:text-white" style={{ color: "var(--text-muted)" }}>
            Liked Songs
         </button>
         <button className="py-4 text-sm font-semibold transition-colors hover:text-white" style={{ color: "var(--text-muted)" }}>
            History
         </button>
      </div>

      {/* ── Content Sections ── */}
      <div className="px-6 md:px-14">
        
        {/* My Playlists (Wide Cards) */}
        <div className="mb-10">
          <PlaylistGrid heading="My Playlists" playlists={userPlaylists} />
        </div>

        {/* 2-Column Track Lists */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-14 mb-10">
          <div>
            <CompactTrackList heading="Recently Played" tracks={recentlyPlayed} actionType="play" />
          </div>
          <div>
            <CompactTrackList heading="Favorite Tracks" tracks={favoriteTracks.slice(0, 4)} actionType="heart" />
          </div>
        </div>
      </div>
        </div>
      </QueueAwareMain>
    </div>
  );
}
