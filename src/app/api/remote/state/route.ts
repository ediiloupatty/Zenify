import { NextResponse } from "next/server";
import { emailFromRequest, getState } from "@/lib/remote";

export const dynamic = "force-dynamic";

// How stale a reported state can be before the laptop counts as offline.
// The bridge heartbeats state every ~10s, so 25s = two missed beats.
const ONLINE_WINDOW_MS = 25_000;

// Phone → read the laptop's now-playing state.
export async function GET(request: Request) {
  const email = emailFromRequest(request);
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const state = await getState(email);
    const online = !!state && Date.now() - state.updatedAt < ONLINE_WINDOW_MS;
    return NextResponse.json({ online, state });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
