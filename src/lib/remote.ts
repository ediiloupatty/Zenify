import crypto from "crypto";
import { queryD1, type Track } from "./cloudflare";

// ─── Remote control (phone → laptop) ────────────────────────────────────────
// The phone app authenticates once (POST /api/remote/login) and gets a signed
// token. Commands it sends are queued per user; the laptop's web player drains
// the queue via POST /api/remote/sync (session-authenticated) and reports its
// now-playing state back, which the phone reads via GET /api/remote/state.
//
// Queue + state live in D1, NOT process memory: the app is deployed on Vercel
// (serverless), where every request may hit a different instance, so there is
// no shared memory to lean on. D1 write budget is protected by the bridge only
// reporting state on change / every ~10s (see RemoteBridge).
//
// Tokens are stateless (HMAC) so no storage or session table is needed.

export type RemoteAction = "play" | "pause" | "next" | "prev" | "playTrack";

export type RemoteCommand = {
  id: number;
  action: RemoteAction;
  track?: Track; // full track payload for playTrack, so the player needs no extra fetch
};

export type RemoteState = {
  trackId: string | null;
  title: string;
  artist: string;
  album: string;
  cover: string;
  isPlaying: boolean;
  updatedAt: number; // ms epoch, set on the server when reported
};

// Commands older than this are dropped instead of delivered — stale taps
// shouldn't replay as a burst when the laptop comes back after a while.
const COMMAND_TTL_MS = 2 * 60 * 1000;

// ─── Schema (lazy, once per server process) ─────────────────────────────────

let initPromise: Promise<void> | null = null;
function ensureTables(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    await queryD1(`
      CREATE TABLE IF NOT EXISTS remote_commands (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_email TEXT NOT NULL,
        action TEXT NOT NULL,
        track_json TEXT,
        created_at INTEGER NOT NULL
      );
    `);
    await queryD1(
      `CREATE INDEX IF NOT EXISTS idx_remote_cmd_email ON remote_commands (user_email, id);`,
      [],
      { silent: true }
    );
    await queryD1(`
      CREATE TABLE IF NOT EXISTS remote_state (
        user_email TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  })().catch((err) => {
    initPromise = null; // let a later request retry
    throw err;
  });
  return initPromise;
}

// ─── Command queue ──────────────────────────────────────────────────────────

export async function pushCommand(
  email: string,
  action: RemoteAction,
  track?: Track
): Promise<void> {
  await ensureTables();
  // Prune anything stale first so an offline laptop never accumulates a backlog.
  await queryD1(
    `DELETE FROM remote_commands WHERE user_email = ? AND created_at < ?`,
    [email, Date.now() - COMMAND_TTL_MS]
  );
  await queryD1(
    `INSERT INTO remote_commands (user_email, action, track_json, created_at) VALUES (?, ?, ?, ?)`,
    [email, action, track ? JSON.stringify(track) : null, Date.now()]
  );
}

export async function drainCommands(email: string): Promise<RemoteCommand[]> {
  await ensureTables();
  const rows = await queryD1(
    `SELECT id, action, track_json, created_at FROM remote_commands WHERE user_email = ? ORDER BY id`,
    [email]
  );
  if (!rows || rows.length === 0) return [];

  const maxId = rows[rows.length - 1].id;
  await queryD1(
    `DELETE FROM remote_commands WHERE user_email = ? AND id <= ?`,
    [email, maxId]
  );

  const cutoff = Date.now() - COMMAND_TTL_MS;
  const out: RemoteCommand[] = [];
  for (const row of rows) {
    if (row.created_at < cutoff) continue;
    let track: Track | undefined;
    if (row.track_json) {
      try { track = JSON.parse(row.track_json); } catch { continue; }
    }
    out.push({ id: row.id, action: row.action, ...(track ? { track } : {}) });
  }
  return out;
}

// ─── Now-playing state ──────────────────────────────────────────────────────

export async function setState(
  email: string,
  state: Omit<RemoteState, "updatedAt">
): Promise<void> {
  await ensureTables();
  await queryD1(
    `INSERT INTO remote_state (user_email, payload, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_email) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
    [email, JSON.stringify(state), Date.now()]
  );
}

export async function getState(email: string): Promise<RemoteState | null> {
  await ensureTables();
  const rows = await queryD1(
    `SELECT payload, updated_at FROM remote_state WHERE user_email = ?`,
    [email]
  );
  const row = rows?.[0];
  if (!row) return null;
  try {
    return { ...JSON.parse(row.payload), updatedAt: row.updated_at };
  } catch {
    return null;
  }
}

// ─── Stateless auth tokens ──────────────────────────────────────────────────
// token = base64url(email).expiryMs.hmac — verified against AUTH_SECRET.

const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return s;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function issueToken(email: string): string {
  const payload = `${Buffer.from(email, "utf8").toString("base64url")}.${Date.now() + TOKEN_TTL_MS}`;
  return `${payload}.${sign(payload)}`;
}

// Returns the email the token was issued for, or null if invalid/expired.
export function verifyToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [emailB64, expStr, mac] = parts;
  const payload = `${emailB64}.${expStr}`;
  const expected = sign(payload);
  if (mac.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  if (!/^\d+$/.test(expStr) || Date.now() > Number(expStr)) return null;
  try {
    return Buffer.from(emailB64, "base64url").toString("utf8") || null;
  } catch {
    return null;
  }
}

// Convenience: pull the bearer token off a request and resolve the email.
export function emailFromRequest(request: Request): string | null {
  const h = request.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return verifyToken(m?.[1]);
}
