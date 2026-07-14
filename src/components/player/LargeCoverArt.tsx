"use client";

import CoverImage from "@/components/CoverImage";
import { hashString, COVER_PALETTES, MUSIC_ICON_PATHS } from "./playerUtils";

export default function LargeCoverArt({
  title,
  category,
  coverUrl,
  size = "lg",
}: {
  title: string;
  category: string;
  coverUrl?: string;
  size?: "sm" | "lg";
}) {
  if (coverUrl) {
    return <CoverImage src={coverUrl} alt={title} className="drop-shadow-2xl" />;
  }

  const palIdx = hashString(title + category) % COVER_PALETTES.length;
  const iconIdx = hashString(title) % MUSIC_ICON_PATHS.length;
  const palette = COVER_PALETTES[palIdx];
  const iconPath = MUSIC_ICON_PATHS[iconIdx];
  const iconSize = size === "lg" ? 80 : 28;

  return (
    <div
      className="w-full h-full relative flex items-center justify-center overflow-hidden"
      style={{
        background: `radial-gradient(ellipse at 30% 30%, ${palette.from}, ${palette.mid} 50%, ${palette.to})`,
      }}
    >
      {/* decorative circles */}
      <div className="absolute -top-8 -right-8 w-40 h-40 rounded-full opacity-20" style={{ background: palette.from, filter: "blur(30px)" }} />
      <div className="absolute -bottom-8 -left-8 w-32 h-32 rounded-full opacity-15" style={{ background: palette.to, filter: "blur(25px)" }} />
      {/* vinyl ring */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-3/4 h-3/4 rounded-full border border-white/10 opacity-40" />
        <div className="absolute w-1/2 h-1/2 rounded-full border border-white/8 opacity-30" />
      </div>
      <svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 24 24"
        fill="white"
        className="relative z-10 drop-shadow-2xl opacity-85"
      >
        <path d={iconPath} />
      </svg>
    </div>
  );
}
