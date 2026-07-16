import { NextResponse } from "next/server";
import { getTrackById } from "@/lib/cloudflare";
import { emailFromRequest, pushCommand, type RemoteAction } from "@/lib/remote";

export const dynamic = "force-dynamic";

const ACTIONS: RemoteAction[] = ["play", "pause", "next", "prev", "playTrack"];

// Phone → queue a command for the laptop player.
// Body: { action: "play"|"pause"|"next"|"prev"|"playTrack", trackId? }
export async function POST(request: Request) {
  const email = emailFromRequest(request);
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const action = body?.action as RemoteAction;
  if (!ACTIONS.includes(action)) {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  try {
    if (action === "playTrack") {
      const trackId = typeof body?.trackId === "string" ? body.trackId : "";
      const track = trackId ? await getTrackById(trackId) : null;
      if (!track) {
        return NextResponse.json({ error: "Track not found" }, { status: 404 });
      }
      await pushCommand(email, action, track);
    } else {
      await pushCommand(email, action);
    }
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
