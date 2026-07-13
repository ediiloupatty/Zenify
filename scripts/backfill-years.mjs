// Recover release years that were stored as `1`.
//
// The Go uploader read the year with dhowden/tag, whose Vorbis Year() switches on
// the *length* of the date comment and only handles 4, 7 and 10. Anything else
// leaves the layout empty, time.Parse fails, the error is discarded, and it
// returns the zero time's year — 1. 2805 rows were filed under the year 1.
//
// The real year is still sitting in the files. A FLAC keeps its metadata blocks
// at the very front, so a ranged GET of the first chunk is enough — we never
// download the audio. Rows we still can't read a plausible year for are set to
// NULL, because no year beats a fake one.
//
//   node scripts/backfill-years.mjs --dry-run   # report only, write nothing
//   node scripts/backfill-years.mjs             # apply

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import * as mm from "music-metadata";
import dotenv from "dotenv";

dotenv.config();

const DRY_RUN = process.argv.includes("--dry-run");
const HEAD_BYTES = 256 * 1024; // metadata blocks (incl. cover art) live up front
const CONCURRENCY = 8;

const {
  CLOUDFLARE_ACCOUNT_ID,
  CLOUDFLARE_API_TOKEN,
  D1_DATABASE_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET_NAME,
} = process.env;

const MIN_YEAR = 1900;
const MAX_YEAR = new Date().getFullYear() + 1;
const plausible = (y) => Number.isInteger(y) && y >= MIN_YEAR && y <= MAX_YEAR;

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

// This run makes thousands of round trips, so a single transient timeout must not
// take the whole thing down — losing 2000 recovered years to one flaky connection
// would be absurd. Re-running is safe regardless: the query below only selects
// rows that still have an implausible year, so anything already fixed is skipped.
async function withRetry(label, fn, attempts = 4) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      // A missing object is an answer, not a hiccup — retrying it just wastes time.
      if (err.name === "NoSuchKey" || /does not exist/i.test(err.message)) throw err;
      if (i >= attempts) throw err;
      const backoff = 500 * 2 ** (i - 1);
      console.warn(`  ~ ${label} failed (${err.message}); retry ${i}/${attempts - 1} in ${backoff}ms`);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
}

async function d1(sql, params = []) {
  return withRetry("d1", async () => {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database/${D1_DATABASE_ID}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sql, params }),
      }
    );
    const json = await res.json();
    if (!json.success) throw new Error(JSON.stringify(json.errors));
    return json.result[0].results;
  });
}

// tracks.file_url is the public R2 URL; the object key is everything after the host.
function keyFromUrl(fileUrl) {
  try {
    return decodeURIComponent(new URL(fileUrl).pathname.replace(/^\//, ""));
  } catch {
    return null;
  }
}

async function readYear(key) {
  const buf = await withRetry("r2", async () => {
    const res = await s3.send(
      new GetObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
        Range: `bytes=0-${HEAD_BYTES - 1}`,
      })
    );
    return Buffer.from(await res.Body.transformToByteArray());
  });

  // The buffer is a deliberately truncated file, so the parser will complain that
  // the stream ended early — after it has already read the metadata blocks it
  // needs. Take what it gives us and ignore the ending.
  let common;
  try {
    ({ common } = await mm.parseBuffer(buf, undefined, { duration: false }));
  } catch (err) {
    if (!common) throw err;
  }
  if (!common) return null;

  if (plausible(common.year)) return common.year;

  // music-metadata exposes the raw date under `common.date` ("2021-05-14",
  // "2021-05-14T00:00:00Z", ...). Pull the first plausible 4-digit run out of it.
  for (const raw of [common.date, common.originaldate, common.originalyear]) {
    if (typeof raw !== "string") continue;
    for (const m of raw.match(/\d{4}/g) ?? []) {
      const y = Number(m);
      if (plausible(y)) return y;
    }
  }
  return null;
}

const rows = await d1(
  `SELECT id, title, artist, file_url FROM tracks
   WHERE year IS NOT NULL AND (year < ${MIN_YEAR} OR year > ${MAX_YEAR})`
);
console.log(`${rows.length} rows carry an implausible year${DRY_RUN ? " (dry run)" : ""}\n`);

let recovered = 0;
let nulled = 0;
let failed = 0;
let done = 0;

async function handle(row) {
  const key = keyFromUrl(row.file_url);
  let year = null;
  try {
    if (key) year = await readYear(key);
  } catch (err) {
    failed++;
    if (failed <= 5) console.warn(`  ! ${row.title}: ${err.message}`);
  }

  if (!DRY_RUN) {
    await d1(`UPDATE tracks SET year = ? WHERE id = ?`, [year, row.id]);
  }
  if (year) {
    recovered++;
    if (recovered <= 10) console.log(`  ✓ ${row.artist} — ${row.title}: ${year}`);
  } else {
    nulled++;
  }

  if (++done % 200 === 0) console.log(`  … ${done}/${rows.length}`);
}

// Bounded fan-out: workers pull from a shared cursor.
let cursor = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < rows.length) await handle(rows[cursor++]);
  })
);

console.log(`\nrecovered a real year : ${recovered}`);
console.log(`set to NULL (unknown) : ${nulled}`);
console.log(`R2 read errors        : ${failed}`);
if (DRY_RUN) console.log("\ndry run — nothing was written");
