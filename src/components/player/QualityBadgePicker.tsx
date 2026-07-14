"use client";

import { useState, useRef, useEffect } from "react";
import { Track } from "@/lib/cloudflare";
import { describePlayback, formatAudioSpecs, isLosslessSource } from "@/lib/formatSpecs";
import { type StreamQuality } from "@/lib/useStreamQuality";

export default function QualityBadgePicker({
  track,
  quality,
  onChange,
}: {
  track: Track;
  quality: StreamQuality;
  onChange: (q: StreamQuality) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const playing = describePlayback(track, quality);
  const source = formatAudioSpecs(track, "lossless");
  const lossless = isLosslessSource(track);

  const options: { value: StreamQuality; title: string; desc: string }[] = [
    {
      value: "lossless",
      // The original file is only "lossless" if it actually is one — an MP3 or
      // AAC upload streams as-is, and calling that lossless would be a lie.
      title: lossless ? "Lossless" : "Original",
      desc: source ? `Original · ${source}` : "Original file",
    },
    { value: "320", title: "High", desc: "MP3 320 kbps · much lighter" },
    { value: "128", title: "Data Saver", desc: "MP3 128 kbps · smoothest on slow networks" },
  ];

  // Nothing verifiable to show, and no transcode selected — hide the badge
  // rather than invent numbers.
  if (!playing) return null;

  return (
    <div ref={ref} className="relative w-fit my-2">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Streaming quality"
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center rounded-md overflow-hidden shadow-md transition-transform hover:scale-105 active:scale-95 cursor-pointer"
      >
        <span className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-black tracking-wider text-white" style={{ background: "#0d9488" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M11 3v18h2V3h-2zM7 7v10h2V7H7zm8 2v6h2V9h-2zM3 10v4h2v-4H3zm16 1v2h2v-2h-2z"/></svg>
          <span>{playing.left}</span>
        </span>
        <span className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-black tracking-wider text-white" style={{ background: "#4338ca" }}>
          {playing.right}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className={`transition-transform ${open ? "rotate-180" : ""}`}>
            <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" />
          </svg>
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 lg:left-1/2 lg:-translate-x-1/2 top-full mt-3 z-[80] w-64 rounded-2xl p-2 shadow-[0_30px_60px_rgba(0,0,0,0.6)] backdrop-blur-2xl animate-in fade-in slide-in-from-top-2 duration-200"
          style={{ background: "rgba(15,23,42,0.6)", border: "1px solid rgba(255,255,255,0.1)" }}
        >
          {options.map((opt) => {
            const active = quality === opt.value;
            return (
              <button
                key={opt.value}
                role="option"
                aria-selected={active}
                onClick={() => { onChange(opt.value); setOpen(false); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-200 hover:bg-white/10 active:scale-95 ${active ? "bg-white/5" : ""}`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold" style={{ color: active ? "var(--accent, #2dd4bf)" : "#fff" }}>
                    {opt.title}
                  </p>
                  <p className="text-[11px] text-slate-400 font-medium">{opt.desc}</p>
                </div>
                {active && (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent, #2dd4bf)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="drop-shadow-md">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                )}
              </button>
            );
          })}
          <div className="mx-2 mt-2 mb-1 pt-2 border-t border-white/10">
            <p className="text-[10px] text-slate-400/80 font-medium text-center">
              Changing quality restarts the current song
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
