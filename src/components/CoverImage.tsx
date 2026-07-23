// No "use client": pure presentational (no hooks/handlers), so it stays a shared
// component — it renders on the server when a server component uses it, and only
// joins the client bundle where a client component imports it.
import Image from "next/image";

interface CoverImageProps {
  src: string;
  alt: string;
  /** Extra classes on the wrapper div (e.g. "drop-shadow-2xl") */
  className?: string;
  /** Extra classes applied to the inner Image/img (e.g. "object-top fade-in") */
  imageClassName?: string;
  /** Priority loading for above-the-fold images (default false) */
  priority?: boolean;
}

/**
 * Reusable cover-art component that wraps `next/image`.
 *
 * • Uses `fill` mode so it fits whatever container wraps it.
 * • Automatically optimises images (WebP/AVIF, responsive sizing) — including
 *   our same-origin `/api/cover/*` proxy: the Next optimiser fetches that path
 *   server-side and follows its 302 to R2 (server isn't ISP-blocked), then
 *   serves optimised bytes same-origin. So album art everywhere gets AVIF +
 *   per-viewport sizing instead of the full-resolution original.
 * • Falls back to a plain `<img>` only for sources the optimiser can't fetch:
 *   `data:` / `blob:` URIs.
 */
export default function CoverImage({
  src,
  alt,
  className,
  imageClassName,
  priority = false,
}: CoverImageProps) {
  // Only URIs the Image Optimization API can't fetch bypass it. Everything else
  // — remote R2/CDN URLs and the same-origin /api/cover proxy — is optimised.
  const isInlineUri = src?.startsWith("data:") || src?.startsWith("blob:");

  if (isInlineUri) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt}
        className={`w-full h-full object-cover ${imageClassName ?? ""}`}
        loading={priority ? undefined : "lazy"}
        decoding="async"
      />
    );
  }

  return (
    <div className={`relative w-full h-full ${className ?? ""}`}>
      <Image
        src={src}
        alt={alt}
        fill
        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
        className={`object-cover ${imageClassName ?? ""}`}
        priority={priority}
        loading={priority ? undefined : "lazy"}
      />
    </div>
  );
}
