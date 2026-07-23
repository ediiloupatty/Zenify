import Link from "next/link";
import { auth, signOut } from "@/auth";
import { isAdminEmail } from "@/lib/admin";
import PlaylistSection from "@/components/PlaylistSection";
import SidebarProfile from "@/components/SidebarProfile";
import SidebarNav from "@/components/SidebarNav";

export default async function Sidebar({ currentCategory }: { currentCategory?: string | null }) {
  const session = await auth();
  const isLoggedIn = !!session?.user;
  const isAdmin = isAdminEmail(session?.user?.email);

  return (
    <aside
      className="glass-chrome chrome-tinted hidden md:flex relative z-20 flex-col w-[220px] py-7 flex-shrink-0 h-full backdrop-blur-xl transition-all duration-500"
      style={{
        background: "rgba(43, 51, 63, 0.4)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        borderRight: "1px solid var(--border-subtle)",
      }}
    >
      {/* App logo / Avatar */}
      <SidebarProfile 
        isLoggedIn={isLoggedIn}
        name={session?.user?.name}
        email={session?.user?.email}
      />

      {/* Nav icons */}
      <nav className="flex flex-col gap-1 px-2 mb-6">
        <SidebarNav isAdmin={isAdmin} />

        {/* Sign Out / Sign In */}
        {isLoggedIn ? (
          <form action={async () => {
            "use server";
            await signOut();
          }}>
            <button type="submit" className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl group transition-all hover:bg-white/5">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"
                className="text-[var(--text-muted)] group-hover:text-red-400 transition-colors flex-shrink-0">
                <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" />
              </svg>
              <span className="text-sm font-semibold text-[var(--text-muted)] group-hover:text-red-400 transition-colors">Sign Out</span>
            </button>
          </form>
        ) : (
          <Link href="/login" className="flex items-center gap-3 px-3 py-2.5 rounded-xl group transition-all hover:bg-white/5">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"
              className="text-[var(--text-muted)] group-hover:text-white transition-colors flex-shrink-0">
              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
            </svg>
            <span className="text-sm font-semibold text-[var(--text-muted)] group-hover:text-white transition-colors">Sign In</span>
          </Link>
        )}
      </nav>

      {/* Divider */}
      <div className="mx-4 mb-4" style={{ height: "1px", background: "var(--border-subtle)" }} />

      {/* ─── YOUR LIBRARY / PLAYLISTS ─── */}
      <div className="flex flex-col flex-1 min-h-0 gap-1 py-1">
        <PlaylistSection
          currentCategory={currentCategory || null}
          isLoggedIn={isLoggedIn}
          sidebarMode
        />
      </div>
    </aside>
  );
}
