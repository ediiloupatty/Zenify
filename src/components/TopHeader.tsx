import Link from "next/link";
import { auth } from "@/auth";
import ZenifyGlyph from "@/components/ZenifyGlyph";
import AISearchBarWrapper from "@/components/AISearchBarWrapper";

export default async function TopHeader({ isHome = false }: { isHome?: boolean }) {
  const session = await auth();
  const isLoggedIn = !!session?.user;

  return (
    <header
      className="glass-chrome chrome-tinted flex items-center justify-between px-4 md:px-8 pt-5 md:pt-7 pb-4 md:pb-5 flex-shrink-0 gap-3 backdrop-blur-xl transition-all duration-500 z-50 relative"
      style={{
        background: "transparent",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        borderBottom: "1px solid var(--border-subtle)",
      }}
    >
      {/* Mobile logo / back button */}
      <div className="md:hidden flex items-center justify-center flex-shrink-0">
        {!isHome ? (
          <Link
            href="/player"
            className="w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-110 active:scale-95 flex-shrink-0"
            style={{ background: "var(--bg-card)", color: "var(--text-secondary)" }}
            title="Back to player"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
            </svg>
          </Link>
        ) : isLoggedIn ? (
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center relative shadow-md"
            style={{ background: "linear-gradient(135deg, var(--accent), #6366f1)" }}
          >
            <span className="font-bold text-white text-xs">{session?.user?.name?.charAt(0) || "U"}</span>
            <span className="absolute top-0 right-0 w-2 h-2 rounded-full border"
              style={{ background: "var(--accent)", borderColor: "var(--bg-primary)" }} />
          </div>
        ) : (
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center shadow-md"
            style={{ background: "linear-gradient(135deg, var(--accent), #6366f1)" }}
          >
            <ZenifyGlyph size={18} />
          </div>
        )}
      </div>

      {/* Search */}
      {isHome ? (
        <div className="flex-1 max-w-[480px]" id="search-header-slot" />
      ) : (
        <AISearchBarWrapper />
      )}

      {/* Notification / Theme toggle */}
      <div className="flex items-center gap-2">
        <button
          className="w-10 h-10 rounded-full flex items-center justify-center relative transition-all"
          style={{ background: "var(--bg-card)", color: "var(--text-secondary)" }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
          </svg>
          <span
            className="absolute top-2 right-2 w-2 h-2 rounded-full border animate-pulse"
            style={{ background: "var(--accent)", borderColor: "var(--bg-primary)" }}
          />
        </button>
      </div>
    </header>
  );
}
