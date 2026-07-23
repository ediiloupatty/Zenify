import Link from "next/link";
import { auth } from "@/auth";
import { getTracksByAlbum, getUserFavorites } from "@/lib/cloudflare";
import Sidebar from "@/components/Sidebar";
import DynamicBackground from "@/components/DynamicBackground";
import AlbumDetail from "@/components/AlbumDetail";
import QueueAwareMain from "@/components/QueueAwareMain";
import TopHeader from "@/components/TopHeader";

export const dynamic = "force-dynamic";

export default async function AlbumPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name: rawName } = await params;
  const name = decodeURIComponent(rawName);

  const session = await auth();
  const isLoggedIn = !!session?.user;
  const userFavorites =
    isLoggedIn && session.user?.email ? await getUserFavorites(session.user.email) : [];

  const tracks = await getTracksByAlbum(name);

  if (tracks.length === 0) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center px-6 gap-5 text-center"
        style={{ background: "var(--bg-primary)", color: "var(--text-primary)" }}
      >
        <h1 className="text-2xl font-black">Album not found</h1>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          No tracks in &quot;{name}&quot;.
        </p>
        <Link href="/player" className="px-6 py-2.5 rounded-full font-semibold text-sm text-white" style={{ background: "var(--accent)" }}>
          Back to Player
        </Link>
      </div>
    );
  }

  const artist = tracks.find((t) => t.artist)?.artist;
  const year = tracks.find((t) => t.year)?.year;
  const coverUrl = tracks.find((t) => t.cover_url)?.cover_url;

  return (
    <div
      className="flex h-screen font-sans overflow-hidden relative"
      style={{ background: "var(--bg-primary)", color: "var(--text-primary)" }}
    >
      <DynamicBackground />
      <Sidebar />

      <QueueAwareMain className="relative z-10 flex-1 flex flex-col overflow-hidden">
        <TopHeader />
        <AlbumDetail
          name={name}
          tracks={tracks}
          artist={artist}
          year={year}
          coverUrl={coverUrl}
          userFavorites={userFavorites}
          isLoggedIn={isLoggedIn}
        />
      </QueueAwareMain>
    </div>
  );
}
