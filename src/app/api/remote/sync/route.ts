import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { drainCommands, setState } from "@/lib/remote";

export const dynamic = "force-dynamic";

// Laptop web player heartbeat: picks up any commands the phone queued since
// the last tick, and — only when the bridge included one — stores the
// now-playing state. The bridge sends state on change / every ~10s rather than
// on every tick, to keep D1 writes well under the free-tier daily budget.
// Session-authenticated: only the browser that's logged in and playing calls this.
export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => null);
    const s = body?.state;
    if (s && typeof s === "object") {
      await setState(email, {
        trackId: typeof s.trackId === "string" ? s.trackId : null,
        title: typeof s.title === "string" ? s.title : "",
        artist: typeof s.artist === "string" ? s.artist : "",
        album: typeof s.album === "string" ? s.album : "",
        cover: typeof s.cover === "string" ? s.cover : "",
        isPlaying: s.isPlaying === true,
      });
    }

    return NextResponse.json({ commands: await drainCommands(email) });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
