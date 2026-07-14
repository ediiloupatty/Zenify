import Link from "next/link";
import PlaylistSection from "@/components/PlaylistSection";
import HomeContent from "@/components/HomeContent";
import Sidebar from "@/components/Sidebar";
import { getTracksByCategory, getTracksByAlbum, getRecentlyPlayed, getUserFavorites, getArtists, getPlaylists, getPlaylistById, getPlaylistTracks, getTrackById, getDailyMixes, getAlbums, Track } from "@/lib/cloudflare";
import { pickRandom } from "@/lib/pickRandom";
import { auth, signOut } from "@/auth";
import PlaylistDetail from "@/components/PlaylistDetail";
import DynamicBackground from "@/components/DynamicBackground";
import ZenifyGlyph from "@/components/ZenifyGlyph";
import TopHeader from "@/components/TopHeader";
import AutoPlayTrack from "@/components/AutoPlayTrack";
import MainContentWrapper from "@/components/MainContentWrapper";

export default async function PlayerHome({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const resolvedParams = await searchParams;
  const currentCategory = (resolvedParams?.category as string) || null;
  const currentAlbum = (resolvedParams?.album as string) || null;
  const currentPlaylistId = (resolvedParams?.playlist as string) || null;
  const playTrackId = (resolvedParams?.play as string) || null;

  // Auth first: the user's email scopes the personal fetches below (playlists,
  // recently played) and must be known before they run.
  const session = await auth();
  const userEmail = session?.user?.email || null;

  // Run ALL independent fetches in parallel to avoid waterfall latency
  const [autoPlayTrack, playlist, tracks, recentlyPlayed, artists, playlists, albums] =
    await Promise.all([
      playTrackId ? getTrackById(playTrackId) : null,
      currentPlaylistId ? getPlaylistById(currentPlaylistId, userEmail) : null,
      currentAlbum
        ? getTracksByAlbum(currentAlbum)
        : getTracksByCategory(currentCategory),
      getRecentlyPlayed(userEmail, 9),
      getArtists(),
      getPlaylists(userEmail),
      getAlbums(),
    ]);

  // Home's song table used to be "Recently Added", which only ever changed when a
  // song was uploaded — so for a library that isn't growing it was frozen. Random
  // picks instead, drawn from the library we already fetched above (no extra
  // query), reshuffled on every visit.
  const randomTracks = pickRandom(tracks, 12);

  // These depend on results above, run in parallel where possible
  const [playlistTracks, userFavorites, rawMixes] = await Promise.all([
    playlist ? getPlaylistTracks(playlist.id, playlist.name) : Promise.resolve([]),
    userEmail ? getUserFavorites(userEmail) : Promise.resolve([]),
    !currentPlaylistId ? getDailyMixes(userEmail, tracks) : Promise.resolve([]),
  ]);
  const isLoggedIn = !!session?.user;

  const mixesPayload = rawMixes.map((m) => ({
    ...m,
    coverTracks: m.coverTracks.map((t) => ({
      id: t.id,
      cover_url: t.cover_url,
      title: t.title,
      artist: t.artist,
      category: t.category,
    })),
  }));

  return (
    <div
      className="flex h-screen font-sans overflow-hidden relative gap-2"
      style={{ background: "var(--bg-primary)", color: "var(--text-primary)" }}
    >
      <DynamicBackground />
      {autoPlayTrack && <AutoPlayTrack track={autoPlayTrack} />}

      <Sidebar currentCategory={currentCategory} />

      {/* ─── MAIN AREA ────────────────────────────────────────────── */}
      <div className="relative z-50 flex-1 flex flex-col overflow-hidden">

        {/* TOP BAR */}
        <TopHeader isHome />

        {/* SCROLLABLE CONTENT */}
        <MainContentWrapper>
          <div className="w-full">
            {playlist ? (
              <PlaylistDetail playlist={playlist} tracks={playlistTracks} />
            ) : (
              <HomeContent
                tracks={tracks}
                currentCategory={currentCategory}
                currentAlbum={currentAlbum}
                recentlyPlayed={recentlyPlayed}
                randomTracks={randomTracks}
                artists={artists}
                playlists={playlists}
                userFavorites={userFavorites}
                isLoggedIn={isLoggedIn}
                dailyMixes={mixesPayload}
                initialAlbums={albums}
              />
            )}
          </div>
        </MainContentWrapper>
      </div>
    </div>
  );
}
