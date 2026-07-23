import Link from "next/link";
import { auth } from "@/auth";
import {
  getArtistInfo,
  getTracksByArtist,
  getAlbums,
  getUserFavorites,
} from "@/lib/cloudflare";
import ArtistView from "@/components/ArtistView";
import Sidebar from "@/components/Sidebar";
import DynamicBackground from "@/components/DynamicBackground";
import QueueAwareMain from "@/components/QueueAwareMain";
import TopHeader from "@/components/TopHeader";
import { hashString, PALETTES } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ArtistPage({
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

  const [info, tracks, allAlbums] = await Promise.all([
    getArtistInfo(name),
    getTracksByArtist(name),
    getAlbums(),
  ]);

  // An album belongs on this artist's page if the artist actually has a track on
  // it. Deriving the set from the artist's own tracks (same source as the track
  // list + header count) is robust against albums whose `artist` column resolves
  // to a different name — e.g. multi-artist/feat. albums where getAlbums()'s
  // MAX(artist) picks another contributor.
  const artistAlbumNames = new Set(
    tracks.map((t) => t.album).filter((a): a is string => !!a && a.trim() !== "")
  );
  const albums = allAlbums.filter((a) => artistAlbumNames.has(a.name));
  const [c1, c2] = PALETTES[hashString(name) % PALETTES.length];

  if (!info && tracks.length === 0) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center px-6 gap-5 text-center"
        style={{ background: "var(--bg-primary)", color: "var(--text-primary)" }}
      >
        <h1 className="text-2xl font-black">Artist not found</h1>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          No tracks by &quot;{name}&quot; in your library.
        </p>
        <Link href="/player" className="px-6 py-2.5 rounded-full font-semibold text-sm text-white" style={{ background: "var(--accent)" }}>
          Back to Player
        </Link>
      </div>
    );
  }

  const trackCount = info?.trackCount ?? tracks.length;
  const albumCount = info?.albumCount ?? albums.length;
  const popular = tracks.slice(0, 5);

  // Derive each album's year from its tracks (realtime — no hardcoded years).
  const albumsWithYear = albums.map((a) => ({
    ...a,
    year: tracks.find((t) => t.album === a.name)?.year,
  }));

  return (
    <div
      className="flex h-screen font-sans overflow-hidden relative"
      style={{ background: "var(--bg-primary)", color: "var(--text-primary)" }}
    >
      {/* Same default backdrop as the home page (tints to the cover while playing) */}
      <DynamicBackground />

      {/* Sidebar menu */}
      <Sidebar />

      {/* ── MAIN AREA ── */}
      <QueueAwareMain className="relative z-10 flex-1 flex flex-col overflow-hidden">
        <TopHeader />
        <ArtistView
          name={name}
          info={info}
          tracks={tracks}
          popular={popular}
          albums={albumsWithYear}
          trackCount={trackCount}
          albumCount={albumCount}
          userFavorites={userFavorites}
          isLoggedIn={isLoggedIn}
          c1={c1}
          c2={c2}
        />
      </QueueAwareMain>
    </div>
  );
}
