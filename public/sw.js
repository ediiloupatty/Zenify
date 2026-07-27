// Zenify Service Worker — offline support.
//
// Four caches, split by what the content actually is:
//
//   AUDIO / COVER — the media itself. Global content (a FLAC is the same file for
//     every user), expensive to re-download, so it survives sign-out.
//   SHELL — Next.js build output (/_next/static/**) and public assets. Content-
//     hashed and immutable, never user-specific, so cache-first with no expiry.
//   DATA — HTML documents, RSC payloads and /api GET responses. These DO contain
//     the signed-in user's library, so they are wiped the moment anyone lands on
//     /login (which is exactly where sign-out redirects to). Without that, the
//     next person to sign in on this machine would be served the previous user's
//     playlists out of cache.

const AUDIO_CACHE = "zenify-audio-v1";
const COVER_CACHE = "zenify-covers-v1";
const SHELL_CACHE = "zenify-shell-v1";
const DATA_CACHE = "zenify-data-v1";

const CURRENT_CACHES = [AUDIO_CACHE, COVER_CACHE, SHELL_CACHE, DATA_CACHE];

// Max cache size in bytes (2 GB default — adjustable)
const MAX_CACHE_BYTES = 2 * 1024 * 1024 * 1024;

// Hard ceiling on cached songs, as a backstop for responses that arrive without
// a Content-Length (they measure as 0 and would otherwise never trigger byte
// eviction, letting the cache grow until the browser evicts the whole origin).
const MAX_AUDIO_ENTRIES = 400;

// Covers are small but there is one per album, and nothing ever removed them —
// an all-day browse through a large library adds an entry for every cover seen.
const MAX_COVER_ENTRIES = 800;

// Patterns to cache
const AUDIO_PATTERN = /^\/api\/(audio|local-audio)\//;
const COVER_PATTERN = /^\/api\/cover\//;
const SHELL_PATTERN = /^\/(_next\/static\/|covers\/|.*\.(png|svg|webp|ico|woff2?)$)/;

// Install: activate immediately without waiting
self.addEventListener("install", () => {
  self.skipWaiting();
});

// Activate: claim all clients and drop caches from older SW versions.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith("zenify-") && !CURRENT_CACHES.includes(n))
             .map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Only handle same-origin requests.
  if (url.origin !== self.location.origin) return;

  // Never touch writes. Server actions (favorites, playlists, sign-in) are POSTs
  // and must always hit the network — caching or replaying them would be wrong.
  if (request.method !== "GET") return;

  if (AUDIO_PATTERN.test(url.pathname)) {
    event.respondWith(handleAudioRequest(request));
  } else if (COVER_PATTERN.test(url.pathname)) {
    event.respondWith(handleCoverRequest(request));
  } else if (SHELL_PATTERN.test(url.pathname)) {
    event.respondWith(cacheFirst(SHELL_CACHE, request));
  } else if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request, url));
  } else {
    // /api GETs and Next.js RSC payloads (?_rsc=) for client-side navigation.
    event.respondWith(networkFirst(DATA_CACHE, request));
  }
});

// Store a navigation response for offline use.
//
// The Cache API flatly refuses any Response whose `redirected` flag is set, and
// cache.put() rejects — silently, since nothing awaits it. That bites here because
// a signed-out visit to /player redirects to /login, so the page you most need
// offline is exactly the one that fails to store. Rebuilding the Response from its
// body clears the flag, and we key it by the URL we actually landed on.
async function cacheDocument(cache, request, response) {
  try {
    if (!response.redirected) {
      await cache.put(request, response.clone());
      return;
    }
    const clean = new Response(response.clone().body, {
      status: 200,
      statusText: "OK",
      headers: response.headers,
    });
    await cache.put(response.url, clean);
  } catch {
    // A page we can't cache is not a page we should fail on.
  }
}

// Immutable, content-hashed build output: if it's cached, it's correct.
async function cacheFirst(cacheName, request) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone()).catch(() => {});
    return response;
  } catch {
    return new Response("", { status: 504, statusText: "Offline" });
  }
}

// Fresh when we can, cached when we can't. Never serve stale data to someone who
// actually has a connection.
async function networkFirst(cacheName, request) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone()).catch(() => {});
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ offline: true }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}

async function handleNavigation(request, url) {
  // Reaching /login means the previous session is over (sign-out redirects here).
  // Drop every user-specific response before the next person signs in.
  if (url.pathname === "/login") {
    await caches.delete(DATA_CACHE);
  }

  const cache = await caches.open(DATA_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cacheDocument(cache, request, response);
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;

    // Last resort: any page shell we do have, else a plain message.
    const fallback = (await cache.match("/player")) || (await cache.match("/"));
    if (fallback) return fallback;
    return new Response(
      "<!doctype html><meta charset=utf-8><title>Zenify — Offline</title>" +
        '<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;' +
        'background:#0a0c11;color:#94a3b8;font-family:system-ui,sans-serif;text-align:center">' +
        "<div><h1 style=\"color:#f8fafc;font-size:20px;margin:0 0 8px\">Kamu sedang offline</h1>" +
        "<p style=\"margin:0;font-size:14px\">Buka Zenify sekali saat online, lalu halaman dan lagu yang " +
        "sudah kamu putar bisa diakses tanpa internet.</p></div>",
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }
}

// Full-file downloads currently in flight, keyed by song URL. Without this, a
// slow connection used to spawn a brand-new full download on EVERY range-request
// that missed the (not-yet-populated) cache, so one song could be pulled 3–5×.
// Now at most one background full-download runs per song.
const inflightFull = new Set();

// Kick off (at most once per song) a single background download of the full file
// so it's available offline next time. De-duplicated via inflightFull.
function populateFullCache(cache, cacheKey, reqHeaders) {
  const key = cacheKey.url;
  if (inflightFull.has(key)) return;
  inflightFull.add(key);

  const fullHeaders = filterHeaders(reqHeaders, ["range"]);
  fullHeaders.set("X-Full-Audio", "1");
  const fullRequest = new Request(key, { method: "GET", headers: fullHeaders });

  fetch(fullRequest)
    .then((res) => {
      if (res.status === 200) {
        return cache.put(cacheKey, res.clone()).then(() => evictIfNeeded());
      }
    })
    .catch(() => {})
    .finally(() => inflightFull.delete(key));
}

// Audio: cache-first strategy. If cached, serve from cache. Otherwise fetch,
// cache the full response for next time, and return it.
async function handleAudioRequest(request) {
  const cache = await caches.open(AUDIO_CACHE);

  // For range requests, check if we have the full resource cached.
  // If so, we can satisfy range requests from the cached full response.
  const cacheKey = stripRange(request);
  const cached = await cache.match(cacheKey);

  if (cached) {
    // If this is a range request, slice the cached response
    const rangeHeader = request.headers.get("range");
    if (rangeHeader) {
      return handleRangeFromCache(cached, rangeHeader);
    }
    return cached;
  }

  // Not cached — fetch directly from network to ensure instant playback (fast TTFB).
  try {
    const streamResponse = await fetch(request);

    // If the network already handed us the FULL file (a non-range request, e.g.
    // a `preload` warm-up), cache THAT directly — no second download needed.
    if (streamResponse.status === 200) {
      cache.put(cacheKey, streamResponse.clone()).then(() => evictIfNeeded()).catch(() => {});
      return streamResponse;
    }

    // Otherwise it's a partial (206) playback stream. Populate the offline cache
    // with a single de-duplicated background full-download, then return the stream.
    populateFullCache(cache, cacheKey, request.headers);

    return streamResponse;
  } catch (err) {
    // Network failed and no cache — return offline error
    return new Response("Audio not available offline", {
      status: 503,
      statusText: "Service Unavailable",
    });
  }
}

// Covers: cache-first, simpler since no range requests
async function handleCoverRequest(request) {
  const cache = await caches.open(COVER_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone())
        .then(() => evictByCount(COVER_CACHE, MAX_COVER_ENTRIES))
        .catch(() => {});
    }
    return response;
  } catch {
    return new Response("Cover not available offline", { status: 503 });
  }
}

// Create a key without the Range header so we store/lookup the full resource
function stripRange(request) {
  return new Request(request.url, {
    method: request.method,
    headers: filterHeaders(request.headers, ["range"]),
  });
}

// Filter out specific headers
function filterHeaders(headers, remove) {
  const filtered = new Headers();
  for (const [key, value] of headers.entries()) {
    if (!remove.includes(key.toLowerCase())) {
      filtered.set(key, value);
    }
  }
  return filtered;
}

// Serve a byte range from a cached full response.
//
// Via Blob, not ArrayBuffer. `arrayBuffer()` pulled the whole song into memory
// and `.slice()` on it copied the requested part again — a 40 MB FLAC meant an
// 80 MB allocation for every seek, and the player issues range requests freely.
// A Blob stays backed by the cache on disk and `Blob.slice()` is a lazy view, so
// only the bytes actually sent are ever read.
async function handleRangeFromCache(cachedResponse, rangeHeader) {
  const blob = await cachedResponse.blob();
  const total = blob.size;
  const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
  const start = match ? parseInt(match[1], 10) : 0;
  const end = match && match[2] ? parseInt(match[2], 10) : total - 1;
  const slice = blob.slice(start, end + 1);

  return new Response(slice, {
    status: 206,
    headers: {
      "Content-Type": cachedResponse.headers.get("Content-Type") || "application/octet-stream",
      "Content-Range": `bytes ${start}-${end}/${total}`,
      "Accept-Ranges": "bytes",
      "Content-Length": String(slice.size),
    },
  });
}

// Serve a byte range from a fresh network fetch (full response)
async function handleRangeFromFetch(response, rangeHeader) {
  const body = await response.arrayBuffer();
  const total = body.byteLength;
  const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
  const start = match ? parseInt(match[1], 10) : 0;
  const end = match && match[2] ? parseInt(match[2], 10) : total - 1;
  const slice = body.slice(start, end + 1);

  return new Response(slice, {
    status: 206,
    headers: {
      "Content-Type": response.headers.get("Content-Type") || "application/octet-stream",
      "Content-Range": `bytes ${start}-${end}/${total}`,
      "Accept-Ranges": "bytes",
      "Content-Length": String(slice.byteLength),
    },
  });
}

// Size of a cached entry, WITHOUT touching its body.
//
// This is the whole reason a long session stays responsive. The obvious way to
// measure a cached response is `(await response.blob()).size` — but that reads
// the entire body off disk. Doing it for every entry, on every newly cached
// song, meant that once the cache filled up each new track dragged ~2 GB of
// FLAC through memory before playback could settle. That is precisely the "it
// gets sluggish after a few hours" symptom: the cost grew with how much you had
// already listened to. `cache.match()` resolves without reading the body, so
// reading Content-Length off the headers is effectively free.
function cachedSize(response) {
  const len = response.headers.get("content-length");
  const n = len ? parseInt(len, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// List the audio cache with sizes, oldest first (Cache API preserves insertion
// order). Header reads only — no bodies.
async function measureAudioCache(cache) {
  const keys = await cache.keys();
  const entries = [];
  let totalSize = 0;
  for (const request of keys) {
    const response = await cache.match(request);
    if (!response) continue;
    const size = cachedSize(response);
    entries.push({ request, size });
    totalSize += size;
  }
  return { entries, totalSize };
}

// Evict oldest entries if the audio cache exceeds MAX_CACHE_BYTES (or, for
// responses of unknown size, MAX_AUDIO_ENTRIES). Oldest-first, since the Cache
// API hands keys back in insertion order.
async function evictIfNeeded() {
  const cache = await caches.open(AUDIO_CACHE);
  const { entries, totalSize } = await measureAudioCache(cache);

  let size = totalSize;
  let count = entries.length;
  let i = 0;
  while ((size > MAX_CACHE_BYTES || count > MAX_AUDIO_ENTRIES) && i < entries.length) {
    const oldest = entries[i++];
    await cache.delete(oldest.request);
    size -= oldest.size;
    count--;
  }
}

// Trim a cache to a maximum number of entries, oldest first. Used for covers,
// where every entry is small and counting them is enough.
async function evictByCount(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - maxEntries; i++) {
    await cache.delete(keys[i]);
  }
}

// Listen for messages from the app (cache management)
self.addEventListener("message", async (event) => {
  const { type, payload } = event.data || {};

  switch (type) {
    case "GET_CACHE_STATS": {
      // Header-based, same as eviction — opening Settings used to read every
      // cached song off disk just to print a total.
      const cache = await caches.open(AUDIO_CACHE);
      const { entries, totalSize } = await measureAudioCache(cache);
      const tracks = entries.map(({ request, size }) => ({
        url: new URL(request.url).pathname,
        size,
      }));

      event.source.postMessage({
        type: "CACHE_STATS",
        payload: { totalSize, trackCount: tracks.length, tracks },
      });
      break;
    }

    case "CLEAR_AUDIO_CACHE": {
      await caches.delete(AUDIO_CACHE);
      event.source.postMessage({ type: "CACHE_CLEARED" });
      break;
    }

    case "DELETE_CACHED_TRACK": {
      if (payload?.url) {
        const cache = await caches.open(AUDIO_CACHE);
        const keys = await cache.keys();
        for (const req of keys) {
          if (new URL(req.url).pathname === payload.url) {
            await cache.delete(req);
            break;
          }
        }
        event.source.postMessage({ type: "TRACK_DELETED", payload: { url: payload.url } });
      }
      break;
    }

    default:
      break;
  }
});
