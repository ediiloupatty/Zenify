import type { Track } from "@/lib/cloudflare";
import type { StreamQuality } from "@/lib/useStreamQuality";

// Single source of truth for the quality badge. Every surface (bottom bar,
// fullscreen picker, queue panel) goes through here so the same track can never
// be labelled two different ways.
//
// The rule: describe the bytes the listener is actually decoding, and say
// nothing when we don't know. A badge that guesses is worse than no badge.

export type PlaybackSpecs = {
  left: string; // bit depth, or the codec name when bit depth is meaningless
  right: string; // sample rate, or the bitrate when streaming a transcode
  hiRes: boolean;
};

const CONTAINERS: { re: RegExp; label: string; lossy: boolean }[] = [
  { re: /\.flac$/i, label: "FLAC", lossy: false },
  { re: /\.wav$/i, label: "WAV", lossy: false },
  { re: /\.aiff?$/i, label: "AIFF", lossy: false },
  { re: /\.mp3$/i, label: "MP3", lossy: true },
  { re: /\.(m4a|aac)$/i, label: "AAC", lossy: true },
  { re: /\.(ogg|oga|opus)$/i, label: "OGG", lossy: true },
];

// file_url can arrive raw (…/track.flac) or as a proxy/signed URL carrying a
// query string, so match on the path only.
export function audioFormat(fileUrl?: string): { label: string; lossy: boolean } | null {
  if (!fileUrl) return null;
  const path = fileUrl.split(/[?#]/)[0];
  return CONTAINERS.find((c) => c.re.test(path)) ?? null;
}

export function formatKhz(sampleRate: number): string {
  const khz = sampleRate / 1000;
  // 44.1 stays 44.1; 48.0 becomes 48.
  return Number.isInteger(khz) ? String(khz) : khz.toFixed(1);
}

export function describePlayback(
  track: Pick<Track, "file_url" | "bit_depth" | "sample_rate">,
  quality: StreamQuality = "lossless"
): PlaybackSpecs | null {
  // Streaming a transcoded variant: we are decoding an MP3, so the source
  // file's bit depth and sample rate describe nothing the listener can hear.
  if (quality !== "lossless") {
    return { left: "MP3", right: `${quality} kbps`, hiRes: false };
  }

  const fmt = audioFormat(track.file_url);
  const rate = track.sample_rate ? `${formatKhz(track.sample_rate)} kHz` : null;

  // Bit depth is a property of PCM. MP3/AAC don't have one — the decoder just
  // reports the 16-bit buffer it renders into, which is why these tracks landed
  // in the DB tagged "16-bit". Label them by codec instead of dressing a lossy
  // file up as CD-quality.
  if (fmt?.lossy) {
    return { left: fmt.label, right: rate ?? "Lossy", hiRes: false };
  }

  if (track.bit_depth && track.sample_rate) {
    return {
      left: `${track.bit_depth}-bit`,
      right: rate!,
      hiRes: track.bit_depth >= 24 || track.sample_rate > 44100,
    };
  }

  // Lossless container whose specs were never backfilled. Name the format we
  // can prove from the file, and leave the numbers out.
  if (fmt) {
    return { left: fmt.label, right: rate ?? "Lossless", hiRes: false };
  }

  return null;
}

export function isLosslessSource(track: Pick<Track, "file_url">): boolean {
  return audioFormat(track.file_url)?.lossy === false;
}

export function formatAudioSpecs(
  track: Pick<Track, "file_url" | "bit_depth" | "sample_rate">,
  quality: StreamQuality = "lossless"
): string | null {
  const specs = describePlayback(track, quality);
  return specs && `${specs.left} ${specs.right}`;
}
