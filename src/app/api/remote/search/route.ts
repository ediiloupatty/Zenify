import { NextResponse } from "next/server";
import { getTracksByCategory } from "@/lib/cloudflare";
import { emailFromRequest } from "@/lib/remote";
import { cleanTitle } from "@/lib/cleanTitle";

export const dynamic = "force-dynamic";

const LIMIT = 30;

// Phone → search the library by title/artist/album. Returns a trimmed shape;
// playback happens on the laptop, so the phone never needs file URLs.
export async function GET(request: Request) {
  const email = emailFromRequest(request);
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") || "").trim().toLowerCase();
  if (!q) {
    return NextResponse.json({ results: [] });
  }

  try {
    const tracks = await getTracksByCategory(null);
    const scored = tracks
      .map((t) => {
        const title = cleanTitle(t.title || "").toLowerCase();
        const artist = (t.artist || "").toLowerCase();
        const album = (t.album || "").toLowerCase();
        let score = 0;
        if (title.startsWith(q)) score += 6;
        else if (title.includes(q)) score += 4;
        if (artist.startsWith(q)) score += 5;
        else if (artist.includes(q)) score += 3;
        if (album.includes(q)) score += 1;
        return { t, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, LIMIT);

    return NextResponse.json({
      results: scored.map(({ t }) => ({
        id: t.id,
        title: cleanTitle(t.title || ""),
        artist: t.artist || "",
        album: t.album || "",
        cover: t.cover_url || "",
      })),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
