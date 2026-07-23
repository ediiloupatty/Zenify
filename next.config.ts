import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";

// Wraps the config only when ANALYZE=true, so normal dev/build is unaffected.
// Run `ANALYZE=true npm run build` to open the interactive bundle treemap and
// see which chunks are heaviest (e.g. after the dynamic-import split above).
const withBundleAnalyzer = bundleAnalyzer({ enabled: process.env.ANALYZE === "true" });

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '150mb',
    },
    // Tree-shake heavy packages more aggressively — reduces JS bundle parsed
    // by the browser on initial load without any code changes needed elsewhere.
    optimizePackageImports: ['swr', 'fuse.js', 'music-metadata'],
    // Keep visited pages in the client-side router cache so navigating back to
    // them renders instantly from memory (no server round-trip, no skeleton
    // flash) — the "Spotify feel". Data can be up to 3 min stale on revisits,
    // which is fine for a personal music library; server actions that mutate
    // (favorites, playlists) still bust the cache via revalidation.
    staleTimes: {
      dynamic: 180,
      static: 300,
    },
  },
  images: {
    // Prefer AVIF then WebP for album art — typically 40-60 % smaller than JPEG
    // with equal or better quality, reducing bandwidth and decode time.
    formats: ['image/avif', 'image/webp'],
    // Cache remote images for 24 hours so repeated loads hit the CDN instead of
    // re-fetching and re-optimising on every request.
    minimumCacheTTL: 86400,
    // Cover art is served from a few known origins: the R2 public bucket
    // (pub-*.r2.dev), the R2 S3 endpoint (*.r2.cloudflarestorage.com), an
    // optional custom CDN domain set via R2_CDN_URL, or our own /api/cover/*
    // proxy (same-origin, no pattern needed). Allow all of them so next/image
    // can optimize + serve responsive WebP/AVIF for album art everywhere.
    remotePatterns: [
      { protocol: "https", hostname: "**.r2.dev" },
      { protocol: "https", hostname: "**.r2.cloudflarestorage.com" },
      // Optional custom CDN domain (R2_CDN_URL). No-op if unset.
      ...(process.env.R2_CDN_URL
        ? [new URL(process.env.R2_CDN_URL).hostname].map((hostname) => ({
            protocol: "https" as const,
            hostname,
          }))
        : []),
    ],
  },
};

export default withBundleAnalyzer(nextConfig);
