import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { queryD1 } from "@/lib/cloudflare";
import { issueToken } from "@/lib/remote";

export const dynamic = "force-dynamic";

// Phone app login: same credential check as the NextAuth provider (src/auth.ts),
// but returns a bearer token instead of a cookie session.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const username = typeof body?.username === "string" ? body.username.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!username || !password) {
      return NextResponse.json({ error: "Username dan password wajib diisi" }, { status: 400 });
    }

    const users = await queryD1(
      "SELECT * FROM users WHERE username = ? OR email = ?",
      [username, username]
    );
    const user = users?.[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return NextResponse.json({ error: "Username atau password salah" }, { status: 401 });
    }

    return NextResponse.json({
      token: issueToken(user.email),
      name: user.name,
      email: user.email,
    });
  } catch (error: any) {
    console.error("Remote login error:", error);
    return NextResponse.json({ error: "Login gagal, coba lagi" }, { status: 500 });
  }
}
