"use client";

import { useState, useRef, useEffect } from "react";
import useSWR from "swr";
import Link from "next/link";
import { createAudioUploadUrl, finalizeTrackUpload, deleteTrackAction, updateTrackAction, recleanAllTitlesAction, backfillAudioSpecsAction, compressAllCoversAction, backfillMissingCoversAction, backfillMissingArtistImagesAction } from "./actions";
import { cleanTitle } from "@/lib/cleanTitle";
import AlbumManager from "@/components/AlbumManager";
import ArtistManager from "@/components/ArtistManager";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function hashString(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = str.charCodeAt(i) + ((h << 5) - h); h |= 0; }
  return Math.abs(h);
}
const PALETTES = [
  ["#6366f1","#8b5cf6"],["#14b8a6","#06b6d4"],["#f43f5e","#ec4899"],
  ["#f59e0b","#f97316"],["#10b981","#059669"],["#3b82f6","#6366f1"],
  ["#a855f7","#ec4899"],["#06b6d4","#3b82f6"],["#84cc16","#10b981"],["#f97316","#ef4444"],
];
const ICON_PATHS = [
  "M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z",
  "M12 1c-4.97 0-9 4.03-9 9v7c0 1.66 1.34 3 3 3h3v-8H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-4v8h3c1.66 0 3-1.34 3-3v-7c0-4.97-4.03-9-9-9z",
  "M10 20h4V4h-4v16zm-6 0h4v-8H4v8zM16 9v11h4V9h-4z",
  "M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z",
];

type TabId = "upload" | "tracks" | "albums" | "artists";
const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "upload",  label: "Upload",  icon: "M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z" },
  { id: "tracks",  label: "Tracks",  icon: "M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z" },
  { id: "albums",  label: "Albums",  icon: "M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" },
  { id: "artists", label: "Artists", icon: "M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" },
];

// Track Library renders one page at a time so a 400+ track library stays fast
// (DOM nodes + cover image requests are limited to a single page).
const PAGE_SIZE = 50;

function TrackMini({ title, category, coverUrl }: { title: string; category: string; coverUrl?: string }) {
  const [err, setErr] = useState(false);
  if (coverUrl && !err) {
    return (
      <img
        src={coverUrl}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setErr(true)}
        className="w-12 h-12 rounded-xl object-cover flex-shrink-0"
      />
    );
  }
  const pal = PALETTES[hashString(title + category) % PALETTES.length];
  const icon = ICON_PATHS[hashString(title) % ICON_PATHS.length];
  return (
    <div className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 flex items-center justify-center"
      style={{ background: `linear-gradient(135deg, ${pal[0]}, ${pal[1]})` }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="white" className="opacity-90"><path d={icon} /></svg>
    </div>
  );
}

function getAudioSrc(fileUrl: string) {
  return fileUrl.includes(".r2.dev/")
    ? `/api/audio/${fileUrl.split(".r2.dev/").pop()}`
    : fileUrl;
}

export default function AdminPage() {
  // Upload state
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [message, setMessage]   = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [categoryInput, setCategoryInput] = useState("");
  const fileInputRef   = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Library state
  const [searchQuery, setSearchQuery]       = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [editingId, setEditingId]           = useState<string | null>(null);
  const [editValues, setEditValues]         = useState({ title: "", artist: "", category: "" });
  const [savingId, setSavingId]             = useState<string | null>(null);
  const [previewingId, setPreviewingId]     = useState<string | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [recleaning, setRecleaning]         = useState(false);
  const [fetchingSpecs, setFetchingSpecs]   = useState(false);
  const [compressingCovers, setCompressingCovers] = useState(false);
  const [fetchingCovers, setFetchingCovers] = useState(false);
  const [fetchingArtists, setFetchingArtists] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement>(null);

  // Active tab — each major section is its own view instead of one long page.
  const [tab, setTab] = useState<TabId>("upload");
  const [page, setPage] = useState(1);

  const { data, error, mutate } = useSWR("/api/tracks", fetcher, { revalidateOnFocus: false });
  const { data: playlistData }  = useSWR("/api/playlists", fetcher, { revalidateOnFocus: false });

  const tracks: any[]   = data?.tracks || [];
  const playlists: { id: string; name: string }[] = playlistData?.playlists || [];
  const isUploading = uploadProgress.total > 0;

  const filteredTracks = searchQuery.trim()
    ? tracks.filter((t: any) => {
        const q = searchQuery.toLowerCase();
        return (
          cleanTitle(t.title).toLowerCase().includes(q) ||
          (t.artist || "").toLowerCase().includes(q) ||
          (t.album || "").toLowerCase().includes(q) ||
          (t.genre || "").toLowerCase().includes(q)
        );
      })
    : tracks;

  const pageCount = Math.max(1, Math.ceil(filteredTracks.length / PAGE_SIZE));
  const visibleTracks = filteredTracks.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // ── Preview audio ──────────────────────────────────────────────────────
  useEffect(() => {
    const audio = previewAudioRef.current;
    if (!audio) return;
    if (previewingId) {
      const track = tracks.find((t: any) => t.id === previewingId);
      if (!track) return;
      audio.src = getAudioSrc(track.file_url);
      audio.load();
      audio.play().then(() => setPreviewPlaying(true)).catch(() => setPreviewPlaying(false));
    } else {
      audio.pause();
      audio.src = "";
      setPreviewPlaying(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewingId]);

  // Reset to the first page whenever the search query changes.
  useEffect(() => { setPage(1); }, [searchQuery]);
  // Keep the page within range as the list shrinks (e.g. after deletes).
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);

  function togglePreview(trackId: string) {
    if (previewingId === trackId) {
      const audio = previewAudioRef.current;
      if (audio) {
        if (previewPlaying) { audio.pause(); setPreviewPlaying(false); }
        else { audio.play().then(() => setPreviewPlaying(true)).catch(() => {}); }
      }
    } else {
      setPreviewingId(trackId);
    }
  }

  function stopPreview() {
    setPreviewingId(null);
  }

  // ── Inline edit ──────────────────────────────────────────────────────
  function startEdit(track: any) {
    setEditingId(track.id);
    setEditValues({
      title:    cleanTitle(track.title),
      artist:   track.artist || "",
      category: track.category || "",
    });
    setConfirmingDeleteId(null);
  }

  async function saveEdit() {
    if (!editingId) return;
    setSavingId(editingId);
    const res = await updateTrackAction(editingId, editValues);
    setSavingId(null);
    if (res.success) {
      // Optimistic update local cache
      mutate({
        tracks: tracks.map((t: any) =>
          t.id === editingId
            ? { ...t, title: editValues.title, artist: editValues.artist, category: editValues.category }
            : t
        ),
      }, false);
      setEditingId(null);
    } else {
      setMessage({ type: "error", text: res.error || "Failed to save" });
      setTimeout(() => setMessage(null), 4000);
    }
  }

  function cancelEdit() { setEditingId(null); }

  // ── Re-clean all titles ───────────────────────────────────────────────
  async function handleReclean() {
    setRecleaning(true);
    const res = await recleanAllTitlesAction();
    setRecleaning(false);
    if (res.success) {
      mutate();
      setMessage({
        type: "success",
        text: res.updated ? `Cleaned ${res.updated} title${res.updated > 1 ? "s" : ""}.` : "All titles already clean.",
      });
    } else {
      setMessage({ type: "error", text: res.error || "Failed to re-clean titles" });
    }
    setTimeout(() => setMessage(null), 4000);
  }

  // ── Backfill audio specs (bit depth / sample rate) ────────────────────
  async function handleFetchSpecs() {
    setFetchingSpecs(true);
    const res = await backfillAudioSpecsAction();
    setFetchingSpecs(false);
    if (res.success) {
      mutate();
      setMessage({
        type: "success",
        text: res.updated ? `Fetched specs for ${res.updated} track${res.updated > 1 ? "s" : ""}.` : "All tracks already have specs.",
      });
    } else {
      setMessage({ type: "error", text: res.error || "Failed to fetch audio specs" });
    }
    setTimeout(() => setMessage(null), 4000);
  }

  // ── Compress all existing covers (one-time cleanup) ───────────────────
  async function handleCompressCovers() {
    setCompressingCovers(true);
    const res = await compressAllCoversAction();
    setCompressingCovers(false);
    if (res.success) {
      mutate();
      setMessage({
        type: "success",
        text: res.updated ? `Compressed ${res.updated} cover${res.updated > 1 ? "s" : ""}.` : "All covers already optimized.",
      });
    } else {
      setMessage({ type: "error", text: res.error || "Failed to compress covers" });
    }
    setTimeout(() => setMessage(null), 4000);
  }

  // ── Find missing covers (iTunes → Deezer lookup) ──────────────────────
  async function handleFetchCovers() {
    setFetchingCovers(true);
    const res = await backfillMissingCoversAction();
    setFetchingCovers(false);
    if (res.success) {
      mutate();
      const found = res.updated || 0;
      const missing = res.notFound || 0;
      setMessage({
        type: "success",
        text: found
          ? `Found covers for ${found} item${found > 1 ? "s" : ""}${missing ? `, ${missing} not found` : ""}.`
          : missing
          ? `No covers found (${missing} still missing).`
          : "All tracks already have covers.",
      });
    } else {
      setMessage({ type: "error", text: res.error || "Failed to find covers" });
    }
    setTimeout(() => setMessage(null), 4000);
  }

  // ── Find missing artist photos (Deezer lookup) ────────────────────────
  async function handleFetchArtists() {
    setFetchingArtists(true);
    const res = await backfillMissingArtistImagesAction();
    setFetchingArtists(false);
    if (res.success) {
      mutate();
      const found = res.updated || 0;
      const missing = res.notFound || 0;
      setMessage({
        type: "success",
        text: found
          ? `Found photos for ${found} artist${found > 1 ? "s" : ""}${missing ? `, ${missing} not found` : ""}.`
          : missing
          ? `No artist photos found (${missing} still missing).`
          : "All artists already have photos.",
      });
    } else {
      setMessage({ type: "error", text: res.error || "Failed to find artist photos" });
    }
    setTimeout(() => setMessage(null), 4000);
  }

  // ── File helpers ──────────────────────────────────────────────────────
  function handleFiles(files: FileList | File[]) {
    const arr = Array.from(files).filter(f => /\.(mp3|flac|wav|m4a)$/i.test(f.name));
    if (!arr.length) return;
    setSelectedFiles(prev => {
      const existing = new Set(prev.map(f => f.name));
      return [...prev, ...arr.filter(f => !existing.has(f.name))];
    });
  }

  async function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const newFiles: File[] = [];
    async function readEntry(entry: any) {
      if (entry.isFile) {
        const file = await new Promise<File>((res) => entry.file(res));
        if (/\.(mp3|flac|wav|m4a)$/i.test(file.name)) newFiles.push(file);
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        let entries: any[] = [];
        const readBatch = async () => {
          const batch = await new Promise<any[]>((res) => reader.readEntries(res));
          if (batch.length > 0) { entries = entries.concat(batch); await readBatch(); }
        };
        await readBatch();
        for (const child of entries) await readEntry(child);
      }
    }
    if (e.dataTransfer.items) {
      const promises = [];
      for (let i = 0; i < e.dataTransfer.items.length; i++) {
        const item = e.dataTransfer.items[i];
        if (item.kind === "file") {
          const entry = item.webkitGetAsEntry?.() ?? (item as any).getAsEntry?.() ?? null;
          if (entry) promises.push(readEntry(entry));
          else { const f = item.getAsFile(); if (f && /\.(mp3|flac|wav|m4a)$/i.test(f.name)) newFiles.push(f); }
        }
      }
      await Promise.all(promises);
    } else {
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const f = e.dataTransfer.files[i];
        if (/\.(mp3|flac|wav|m4a)$/i.test(f.name)) newFiles.push(f);
      }
    }
    if (newFiles.length > 0) {
      setSelectedFiles(prev => {
        const existing = new Set(prev.map(f => f.name));
        return [...prev, ...newFiles.filter(f => !existing.has(f.name))];
      });
    }
  }

  function removeFile(idx: number) { setSelectedFiles(prev => prev.filter((_, i) => i !== idx)); }

  // ── Upload ────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedFiles.length || !categoryInput.trim()) return;
    setMessage(null);
    setUploadProgress({ current: 0, total: selectedFiles.length });
    let ok = 0, fail = 0, dup = 0;
    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      const rawName = file.name.replace(/\.[^/.]+$/, "").replace(/_/g, " ");
      setUploadProgress({ current: i + 1, total: selectedFiles.length });
      // Two-step upload: the file goes STRAIGHT to R2 via a presigned PUT (so it
      // never passes through the Server Action, which Vercel caps at ~4.5MB and
      // 413s), then a tiny finalize call writes the DB row.
      const res = await (async () => {
        const created = await createAudioUploadUrl(file.name, file.type);
        if (!created.success || !created.url || !created.key) {
          return { success: false, error: created.error };
        }
        try {
          const put = await fetch(created.url, {
            method: "PUT",
            body: file,
            headers: { "Content-Type": created.contentType || file.type || "application/octet-stream" },
          });
          if (!put.ok) {
            return { success: false, error: `Storage upload failed (${put.status})` };
          }
        } catch (e: any) {
          return { success: false, error: e?.message || "Storage upload failed" };
        }
        return await finalizeTrackUpload({
          key: created.key,
          originalName: file.name,
          title: rawName,
          category: categoryInput.trim(),
        });
      })();
      if (res.success) ok++;
      else if ((res as any).duplicate) dup++;
      else fail++;
    }
    setUploadProgress({ current: 0, total: 0 });
    setSelectedFiles([]);
    mutate();
    // Build a summary: uploaded / duplicates skipped / failed
    const parts: string[] = [];
    if (ok)   parts.push(`${ok} uploaded`);
    if (dup)  parts.push(`${dup} duplicate${dup > 1 ? "s" : ""} skipped`);
    if (fail) parts.push(`${fail} failed`);
    setMessage({
      type: fail > 0 ? "error" : "success",
      text: parts.length ? `${parts.join(", ")}.` : "Nothing to upload.",
    });
    setTimeout(() => setMessage(null), 5000);
  }

  // ── Delete (optimistic) ───────────────────────────────────────────────
  async function handleDelete(id: string, fileUrl: string) {
    if (previewingId === id) stopPreview();
    setConfirmingDeleteId(null);
    mutate({ tracks: tracks.filter((t: any) => t.id !== id) }, false);
    const res = await deleteTrackAction(id, fileUrl);
    if (!res.success) {
      mutate();
      setMessage({ type: "error", text: "Failed to delete track." });
      setTimeout(() => setMessage(null), 4000);
    }
  }

  const progressPct = isUploading ? (uploadProgress.current / uploadProgress.total) * 100 : 0;

  const inputStyle = {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.12)",
    color: "white",
    borderRadius: "8px",
    padding: "5px 10px",
    fontSize: "12px",
    outline: "none",
    width: "100%",
  };

  return (
    <div className="min-h-screen font-sans relative overflow-x-hidden"
      style={{ background: "linear-gradient(135deg, #0d111c 0%, #111827 60%, #0a0f1a 100%)" }}>

      {/* Hidden preview audio */}
      <audio
        ref={previewAudioRef}
        crossOrigin="anonymous"
        onEnded={() => { setPreviewPlaying(false); setPreviewingId(null); }}
        onError={() => { setPreviewPlaying(false); }}
      />

      {/* Ambient glows */}
      <div className="fixed top-0 left-1/3 w-[700px] h-[700px] rounded-full pointer-events-none -z-10"
        style={{ background: "radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%)", filter: "blur(60px)" }} />
      <div className="fixed bottom-0 right-0 w-[500px] h-[500px] rounded-full pointer-events-none -z-10"
        style={{ background: "radial-gradient(circle, rgba(20,184,166,0.08) 0%, transparent 70%)", filter: "blur(60px)" }} />

      {/* ── HEADER ──────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 px-6 md:px-10 py-4 flex items-center justify-between"
        style={{ background: "rgba(13,17,28,0.85)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-center gap-4">
          <Link href="/player"
            className="w-9 h-9 rounded-full flex items-center justify-center transition-all hover:scale-110 active:scale-95"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="white" className="opacity-70">
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
            </svg>
          </Link>
          <div>
            <h1 className="text-lg font-black text-white tracking-tight">Admin Dashboard</h1>
            <p className="text-[11px]" style={{ color: "rgba(148,163,184,0.7)" }}>Zenify Cloud Music</p>
          </div>
        </div>
        <div className="hidden md:flex items-center gap-3">
          <div className="flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold"
            style={{ background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.2)", color: "#a5b4fc" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
            </svg>
            {tracks.length} Tracks
          </div>
          <div className="w-8 h-8 rounded-full flex items-center justify-center font-black text-sm text-white"
            style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}>A</div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 md:px-8 py-8 pb-24">
        {/* ── TAB BAR ──────────────────────────────────────────────────── */}
        <div className="flex items-center gap-1 p-1.5 mb-8 rounded-2xl w-full md:w-fit overflow-x-auto scrollbar-thin"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className="flex items-center gap-2 px-4 md:px-5 py-2.5 rounded-xl text-sm font-bold whitespace-nowrap transition-all active:scale-95"
                style={{
                  background: active ? "linear-gradient(135deg, #6366f1, #8b5cf6)" : "transparent",
                  color: active ? "white" : "rgba(148,163,184,0.7)",
                  boxShadow: active ? "0 6px 18px rgba(99,102,241,0.35)" : "none",
                }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d={t.icon} /></svg>
                {t.label}
              </button>
            );
          })}
        </div>

        {/* ══ UPLOAD TAB ═══════════════════════════════════════════════ */}
        {tab === "upload" && (
          <div className="max-w-2xl mx-auto rounded-3xl overflow-hidden relative"
            style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", backdropFilter: "blur(24px)" }}>
            <div className="h-1 w-full" style={{ background: "linear-gradient(90deg, #6366f1, #14b8a6, #f43f5e)" }} />
            <div className="p-6 md:p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-2xl flex items-center justify-center"
                  style={{ background: "linear-gradient(135deg, rgba(99,102,241,0.25), rgba(139,92,246,0.25))", border: "1px solid rgba(99,102,241,0.3)" }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="#a5b4fc">
                    <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/>
                  </svg>
                </div>
                <div>
                  <h2 className="font-black text-white text-lg">Upload Tracks</h2>
                  <p className="text-xs" style={{ color: "rgba(148,163,184,0.6)" }}>MP3 · FLAC · WAV · M4A</p>
                </div>
              </div>

              {message && (
                <div className={`mb-5 p-3.5 rounded-2xl flex items-start gap-3 text-sm font-medium ${
                  message.type === "success"
                    ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300"
                    : "bg-red-500/10 border border-red-500/20 text-red-300"
                }`}>
                  {message.type === "success"
                    ? <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="mt-0.5 flex-shrink-0"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>
                    : <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="mt-0.5 flex-shrink-0"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
                  }
                  <span>{message.text}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                {/* Playlist / Category */}
                <div>
                  <label className="block text-xs font-bold tracking-[0.15em] uppercase mb-2"
                    style={{ color: "rgba(148,163,184,0.7)" }}>Playlist / Category</label>
                  {playlists.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2.5">
                      {playlists.map(pl => (
                        <button key={pl.id} type="button" onClick={() => setCategoryInput(pl.name)}
                          className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all active:scale-95"
                          style={{
                            background: categoryInput === pl.name ? "rgba(99,102,241,0.25)" : "rgba(255,255,255,0.04)",
                            border: `1px solid ${categoryInput === pl.name ? "rgba(99,102,241,0.5)" : "rgba(255,255,255,0.08)"}`,
                            color: categoryInput === pl.name ? "#a5b4fc" : "rgba(148,163,184,0.6)",
                          }}>
                          {pl.name}
                        </button>
                      ))}
                    </div>
                  )}
                  <input
                    type="text" value={categoryInput} onChange={e => setCategoryInput(e.target.value)}
                    placeholder={playlists.length > 0 ? "Select above or type new..." : "e.g. On Repeat, Chill, Workout"}
                    maxLength={50}
                    className="w-full px-4 py-2.5 rounded-xl text-sm outline-none transition-all"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "white" }}
                    onFocus={e => (e.target.style.borderColor = "rgba(99,102,241,0.5)")}
                    onBlur={e => (e.target.style.borderColor = "rgba(255,255,255,0.1)")}
                  />
                </div>

                {/* Drag & Drop Zone */}
                <div>
                  <label className="block text-xs font-bold tracking-[0.15em] uppercase mb-2"
                    style={{ color: "rgba(148,163,184,0.7)" }}>Audio Files</label>
                  <div
                    className="relative rounded-2xl transition-all duration-200 cursor-pointer"
                    style={{
                      border: `2px dashed ${isDragging ? "#6366f1" : "rgba(255,255,255,0.1)"}`,
                      background: isDragging ? "rgba(99,102,241,0.08)" : "rgba(255,255,255,0.02)",
                      minHeight: selectedFiles.length > 0 ? "auto" : "160px",
                    }}
                    onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                    onClick={() => selectedFiles.length === 0 && fileInputRef.current?.click()}
                  >
                    <input ref={fileInputRef} type="file"
                      accept=".mp3,audio/mpeg,.flac,audio/flac,.wav,audio/wav,.m4a,audio/mp4"
                      multiple className="hidden"
                      onChange={e => e.target.files && handleFiles(e.target.files)} />
                    <input ref={folderInputRef} type="file"
                      accept=".mp3,audio/mpeg,.flac,audio/flac,.wav,audio/wav,.m4a,audio/mp4"
                      // @ts-expect-error React webkitdirectory attribute
                      webkitdirectory="" multiple className="hidden"
                      onChange={e => e.target.files && handleFiles(e.target.files)} />

                    {selectedFiles.length > 0 ? (
                      <div className="p-3 flex flex-col gap-2">
                        {selectedFiles.map((file, idx) => (
                          <div key={idx} className="flex items-center gap-3 px-3 py-2.5 rounded-xl group"
                            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                              style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
                                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                              </svg>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-white truncate">{file.name.replace(/\.[^/.]+$/, "")}</p>
                              <p className="text-[10px]" style={{ color: "rgba(148,163,184,0.5)" }}>
                                {(file.size / (1024 * 1024)).toFixed(1)} MB · {file.name.split(".").pop()?.toUpperCase()}
                              </p>
                            </div>
                            <button type="button" onClick={() => removeFile(idx)}
                              className="w-6 h-6 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                              style={{ background: "rgba(239,68,68,0.15)", color: "#f87171" }}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                              </svg>
                            </button>
                          </div>
                        ))}
                        <div className="flex gap-2">
                          <button type="button"
                            onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}
                            className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-semibold"
                            style={{ border: "1px dashed rgba(99,102,241,0.4)", color: "#818cf8" }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                            Add Files
                          </button>
                          <button type="button"
                            onClick={e => { e.stopPropagation(); folderInputRef.current?.click(); }}
                            className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-semibold"
                            style={{ border: "1px dashed rgba(20,184,166,0.4)", color: "#5eead4" }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-1 8h-3v3h-2v-3h-3v-2h3V9h2v3h3v2z"/></svg>
                            Add Folder
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none p-6">
                        <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
                          style={{ background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.2)" }}>
                          <svg width="28" height="28" viewBox="0 0 24 24" fill="#818cf8">
                            <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/>
                          </svg>
                        </div>
                        <div className="text-center mt-2">
                          <p className="font-bold text-white text-sm mb-2">Drop files or folder here</p>
                          <div className="flex items-center justify-center gap-3">
                            <button type="button"
                              onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}
                              className="px-4 py-1.5 rounded-full text-xs font-semibold hover:scale-105 active:scale-95"
                              style={{ background: "rgba(99,102,241,0.15)", color: "#a5b4fc" }}>
                              Browse Files
                            </button>
                            <button type="button"
                              onClick={e => { e.stopPropagation(); folderInputRef.current?.click(); }}
                              className="px-4 py-1.5 rounded-full text-xs font-semibold hover:scale-105 active:scale-95"
                              style={{ background: "rgba(20,184,166,0.15)", color: "#5eead4" }}>
                              Browse Folder
                            </button>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {["MP3","FLAC","WAV","M4A"].map(f => (
                            <span key={f} className="px-2 py-0.5 rounded-full text-[10px] font-bold"
                              style={{ background: "rgba(255,255,255,0.05)", color: "rgba(148,163,184,0.6)", border: "1px solid rgba(255,255,255,0.07)" }}>
                              {f}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Upload button */}
                <button type="submit"
                  disabled={isUploading || selectedFiles.length === 0 || !categoryInput.trim()}
                  className="relative w-full rounded-2xl font-black text-white overflow-hidden transition-all active:scale-[0.98]"
                  style={{
                    padding: "14px",
                    background: isUploading || selectedFiles.length === 0 || !categoryInput.trim()
                      ? "rgba(99,102,241,0.3)"
                      : "linear-gradient(135deg, #6366f1, #8b5cf6, #a855f7)",
                    cursor: isUploading || selectedFiles.length === 0 || !categoryInput.trim() ? "not-allowed" : "pointer",
                    boxShadow: selectedFiles.length > 0 && categoryInput.trim() && !isUploading ? "0 8px 24px rgba(99,102,241,0.35)" : "none",
                  }}>
                  {isUploading && (
                    <div className="absolute inset-0 transition-all duration-500"
                      style={{ width: `${progressPct}%`, background: "rgba(255,255,255,0.15)" }} />
                  )}
                  <span className="relative z-10 flex items-center justify-center gap-2.5 text-sm">
                    {isUploading ? (
                      <>
                        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="white" strokeWidth="4" fill="none"/>
                          <path className="opacity-75" fill="white" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                        </svg>
                        Uploading {uploadProgress.current} / {uploadProgress.total}
                      </>
                    ) : selectedFiles.length > 0 && categoryInput.trim() ? (
                      <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/>
                        </svg>
                        Upload {selectedFiles.length} Track{selectedFiles.length > 1 ? "s" : ""} → {categoryInput.trim()}
                      </>
                    ) : (
                      <span className="opacity-60">Select files &amp; playlist to upload</span>
                    )}
                  </span>
                </button>
              </form>
            </div>
          </div>
        )}

        {/* ══ TRACKS TAB ═══════════════════════════════════════════════ */}
        {tab === "tracks" && (
          <div className="relative">
            <div className="p-1 md:p-2">
              {message && (
                <div className={`mb-5 p-3.5 rounded-2xl flex items-start gap-3 text-sm font-medium ${
                  message.type === "success"
                    ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300"
                    : "bg-red-500/10 border border-red-500/20 text-red-300"
                }`}>
                  {message.type === "success"
                    ? <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="mt-0.5 flex-shrink-0"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>
                    : <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="mt-0.5 flex-shrink-0"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
                  }
                  <span>{message.text}</span>
                </div>
              )}
              {/* Header + Search */}
              <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl flex items-center justify-center"
                    style={{ background: "linear-gradient(135deg, rgba(20,184,166,0.25), rgba(99,102,241,0.25))", border: "1px solid rgba(20,184,166,0.3)" }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="#5eead4">
                      <path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"/>
                    </svg>
                  </div>
                  <div>
                    <h2 className="font-black text-white text-lg">Track Library</h2>
                    <p className="text-xs" style={{ color: "rgba(148,163,184,0.5)" }}>
                      {searchQuery ? `${filteredTracks.length} / ${tracks.length} tracks` : `${tracks.length} tracks`}
                    </p>
                  </div>
                </div>

                {/* Action controls group — kept together so spacing stays even */}
                <div className="flex items-center gap-2.5 flex-wrap justify-end flex-1 min-w-0">
                {/* Re-clean titles */}
                <button
                  onClick={handleReclean}
                  disabled={recleaning || tracks.length === 0}
                  title="Re-apply title cleanup to all stored tracks (fixes legacy names like '01 Kasih Aba Aba')"
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95 disabled:opacity-40"
                  style={{ background: "rgba(20,184,166,0.12)", border: "1px solid rgba(20,184,166,0.25)", color: "#5eead4" }}
                >
                  {recleaning ? (
                    <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 6V3L8 7l4 4V8c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l1.46 1.46C18.67 15.2 19 14.14 19 13c0-3.87-3.13-7-7-7zm0 12c-2.76 0-5-2.24-5-5 0-.65.13-1.26.36-1.83L5.9 9.71C5.33 10.8 5 11.86 5 13c0 3.87 3.13 7 7 7v3l4-4-4-4v3z" />
                    </svg>
                  )}
                  <span className="hidden sm:inline">{recleaning ? "Cleaning..." : "Re-clean titles"}</span>
                </button>

                {/* Fetch audio specs */}
                <button
                  onClick={handleFetchSpecs}
                  disabled={fetchingSpecs || tracks.length === 0}
                  title="Download each track's header from R2 and store bit depth + sample rate (for the Hi-Res badge)"
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95 disabled:opacity-40"
                  style={{ background: "rgba(20,184,166,0.12)", border: "1px solid rgba(20,184,166,0.25)", color: "#5eead4" }}
                >
                  {fetchingSpecs ? (
                    <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 3a9 9 0 109 9h-2a7 7 0 11-7-7V3zm7 0v6h-6l2.29-2.29a5 5 0 00-7.08 0L6.8 5.3a7 7 0 019.9 0L19 3z" />
                    </svg>
                  )}
                  <span className="hidden sm:inline">{fetchingSpecs ? "Fetching..." : "Fetch audio specs"}</span>
                </button>

                {/* Compress all covers */}
                <button
                  onClick={handleCompressCovers}
                  disabled={compressingCovers || tracks.length === 0}
                  title="Shrink every stored cover image (resize + JPEG compress) so they load faster. Safe to run repeatedly."
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95 disabled:opacity-40"
                  style={{ background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.25)", color: "#a5b4fc" }}
                >
                  {compressingCovers ? (
                    <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M19 13H5v-2h14v2zm-4-9H9v2h6V4zM9 20h6v-2H9v2zM7 9l-4 3 4 3V9zm10 6l4-3-4-3v6z" />
                    </svg>
                  )}
                  <span className="hidden sm:inline">{compressingCovers ? "Compressing..." : "Compress covers"}</span>
                </button>

                {/* Find missing covers (iTunes → Deezer) */}
                <button
                  onClick={handleFetchCovers}
                  disabled={fetchingCovers || tracks.length === 0}
                  title="Search iTunes (then Deezer) for album art of tracks that have no cover, download it server-side and store it in R2. Safe to run repeatedly; one lookup per album."
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95 disabled:opacity-40"
                  style={{ background: "rgba(236,72,153,0.12)", border: "1px solid rgba(236,72,153,0.25)", color: "#f9a8d4" }}
                >
                  {fetchingCovers ? (
                    <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 10-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1114 9.5 4.5 4.5 0 019.5 14z" />
                    </svg>
                  )}
                  <span className="hidden sm:inline">{fetchingCovers ? "Searching..." : "Find covers"}</span>
                </button>

                {/* Find missing artist photos (Deezer) */}
                <button
                  onClick={handleFetchArtists}
                  disabled={fetchingArtists || tracks.length === 0}
                  title="Search Deezer for a profile photo of artists that have none, download it server-side and store it in R2. Safe to run repeatedly; one lookup per artist."
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95 disabled:opacity-40"
                  style={{ background: "rgba(168,85,247,0.12)", border: "1px solid rgba(168,85,247,0.25)", color: "#d8b4fe" }}
                >
                  {fetchingArtists ? (
                    <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                    </svg>
                  )}
                  <span className="hidden sm:inline">{fetchingArtists ? "Searching..." : "Find artist images"}</span>
                </button>

                {/* Search */}
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl flex-1 min-w-[160px] max-w-[240px]"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ color: "rgba(148,163,184,0.5)", flexShrink: 0 }}>
                    <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                  </svg>
                  <input
                    type="text"
                    placeholder="Search tracks..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="bg-transparent border-none outline-none text-xs w-full"
                    style={{ color: "white" }}
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery("")} style={{ color: "rgba(148,163,184,0.5)" }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                      </svg>
                    </button>
                  )}
                </div>
                </div>
              </div>

              {error && (
                <div className="p-4 rounded-2xl flex items-center gap-3 text-sm mb-4"
                  style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)", color: "#fca5a5" }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
                  Failed to load tracks from server.
                </div>
              )}

              {!data && !error && (
                <div className="flex flex-col items-center justify-center py-20 gap-4">
                  <svg className="animate-spin w-8 h-8" viewBox="0 0 24 24" style={{ color: "#6366f1" }}>
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                  </svg>
                  <p className="text-sm" style={{ color: "rgba(148,163,184,0.6)" }}>Loading library...</p>
                </div>
              )}

              {tracks.length === 0 && data && (
                <div className="flex flex-col items-center justify-center py-16 text-center px-6 rounded-2xl"
                  style={{ border: "2px dashed rgba(255,255,255,0.06)" }}>
                  <div className="w-16 h-16 rounded-3xl flex items-center justify-center mb-4"
                    style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.15)" }}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="rgba(99,102,241,0.5)">
                      <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                    </svg>
                  </div>
                  <h3 className="font-black text-white mb-1">Library is empty</h3>
                  <p className="text-sm" style={{ color: "rgba(148,163,184,0.5)" }}>Upload your first track from the <span className="text-white font-semibold">Upload</span> tab.</p>
                </div>
              )}

              {filteredTracks.length === 0 && searchQuery && tracks.length > 0 && (
                <div className="py-10 text-center" style={{ color: "rgba(148,163,184,0.5)" }}>
                  <p className="text-sm">No tracks match "<span className="text-white">{searchQuery}</span>"</p>
                </div>
              )}

              {filteredTracks.length > 0 && (
                <>
                <div className="flex flex-col gap-0 overflow-y-auto scrollbar-thin" style={{ maxHeight: "clamp(320px, calc(100vh - 300px), 78vh)", paddingRight: "8px" }}>
                  {visibleTracks.map((track: any, idx: number) => {
                    const isConfirming = confirmingDeleteId === track.id;
                    const isEditing    = editingId === track.id;
                    const isSaving     = savingId === track.id;
                    const isPreviewing = previewingId === track.id;

                    return (
                      <div key={track.id}
                        className={`group transition-all overflow-hidden flex-shrink-0 ${
                          isEditing || isConfirming || isPreviewing ? "rounded-2xl my-1" : "rounded-lg"
                        }`}
                        style={{
                          background: isEditing    ? "rgba(99,102,241,0.08)"
                                    : isConfirming ? "rgba(239,68,68,0.07)"
                                    : isPreviewing ? "rgba(20,184,166,0.07)"
                                    : "transparent",
                          border: `1px solid ${
                            isEditing    ? "rgba(99,102,241,0.3)"
                            : isConfirming ? "rgba(239,68,68,0.25)"
                            : isPreviewing ? "rgba(20,184,166,0.3)"
                            : "transparent"
                          }`,
                          borderBottom: (isEditing || isConfirming || isPreviewing)
                            ? undefined
                            : "1px solid rgba(255,255,255,0.07)",
                        }}
                      >
                        {/* ── Normal / Preview Row ── */}
                        <div
                          className="flex items-center gap-4 px-3 py-2.5"
                          onMouseEnter={e => {
                            if (!isEditing && !isConfirming && !isPreviewing)
                              (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)";
                          }}
                          onMouseLeave={e => {
                            if (!isEditing && !isConfirming && !isPreviewing)
                              (e.currentTarget as HTMLElement).style.background = "transparent";
                          }}
                        >
                          {/* Index / Preview button */}
                          <button
                            onClick={() => togglePreview(track.id)}
                            className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-all"
                            style={{
                              background: isPreviewing ? "rgba(20,184,166,0.2)" : "transparent",
                              color: isPreviewing ? "#5eead4" : "rgba(148,163,184,0.3)",
                            }}
                            title={isPreviewing ? "Pause preview" : "Preview track"}
                          >
                            {isPreviewing && previewPlaying ? (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                              </svg>
                            ) : isPreviewing && !previewPlaying ? (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M8 5v14l11-7z"/>
                              </svg>
                            ) : (
                              <span className="text-[11px] font-mono group-hover:hidden">
                                {String((page - 1) * PAGE_SIZE + idx + 1).padStart(2, "0")}
                              </span>
                            )}
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"
                              className={`${isPreviewing ? "hidden" : "hidden group-hover:block"}`}>
                              <path d="M8 5v14l11-7z"/>
                            </svg>
                          </button>

                          {/* Cover */}
                          <TrackMini title={track.title} category={track.category} coverUrl={track.cover_url} />

                          {/* Info */}
                          <div className="flex-1 min-w-0 py-0.5">
                            <div className="flex items-center gap-2 leading-tight min-w-0">
                              <span className="font-bold text-sm text-white truncate min-w-0">
                                {cleanTitle(track.title)}
                              </span>
                              {track.file_url && (track.file_url.endsWith('.flac') || track.file_url.endsWith('.wav')) && (
                                <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[8px] font-black tracking-wider text-white"
                                  style={{ background: "linear-gradient(90deg, #14b8a6, #6366f1)" }}>
                                  HI-RES
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 mt-1.5 min-w-0 text-[11px]">
                              <span className="flex-shrink-0 max-w-[45%] truncate" style={{ color: "rgba(148,163,184,0.55)" }}>
                                {track.artist || "Unknown Artist"}
                              </span>
                              {track.album && (
                                <>
                                  <span className="flex-shrink-0" style={{ color: "rgba(148,163,184,0.25)" }}>·</span>
                                  <span className="truncate min-w-0" style={{ color: "rgba(148,163,184,0.4)" }}>
                                    {track.album}
                                  </span>
                                </>
                              )}
                              {track.year && (
                                <>
                                  <span className="flex-shrink-0" style={{ color: "rgba(148,163,184,0.25)" }}>·</span>
                                  <span className="flex-shrink-0 tabular-nums" style={{ color: "rgba(148,163,184,0.4)" }}>
                                    {track.year}
                                  </span>
                                </>
                              )}
                              {track.genre && (
                                <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide"
                                  style={{ background: "rgba(99,102,241,0.12)", color: "rgba(165,180,252,0.7)" }}>
                                  {track.genre}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Action buttons */}
                          {isConfirming ? (
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="text-[11px] font-semibold" style={{ color: "#f87171" }}>Delete?</span>
                              <button onClick={() => handleDelete(track.id, track.file_url)}
                                className="px-3 py-1.5 rounded-lg text-xs font-bold text-white active:scale-95"
                                style={{ background: "rgba(239,68,68,0.8)" }}>Yes</button>
                              <button onClick={() => setConfirmingDeleteId(null)}
                                className="px-3 py-1.5 rounded-lg text-xs font-bold active:scale-95"
                                style={{ background: "rgba(255,255,255,0.08)", color: "rgba(148,163,184,0.8)" }}>No</button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 flex-shrink-0 opacity-70 group-hover:opacity-100 transition-opacity">
                              {/* Edit */}
                              <button onClick={() => startEdit(track)} title="Edit metadata"
                                className="w-7 h-7 rounded-lg flex items-center justify-center transition-all active:scale-90"
                                style={{ background: "rgba(99,102,241,0.12)", color: "#a5b4fc" }}>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                                  <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                                </svg>
                              </button>
                              {/* Delete */}
                              <button onClick={() => setConfirmingDeleteId(track.id)} title="Delete track"
                                className="w-7 h-7 rounded-lg flex items-center justify-center transition-all active:scale-90"
                                style={{ background: "rgba(239,68,68,0.1)", color: "#f87171" }}>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                                  <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                                </svg>
                              </button>
                            </div>
                          )}
                        </div>

                        {/* ── Inline Edit Panel ── */}
                        {isEditing && (
                          <div className="px-4 pb-4 flex flex-col gap-3 border-t"
                            style={{ borderColor: "rgba(99,102,241,0.2)" }}>
                            <p className="text-[10px] font-bold tracking-[0.15em] uppercase mt-3"
                              style={{ color: "rgba(148,163,184,0.5)" }}>Edit Metadata</p>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="col-span-2">
                                <label className="text-[10px] font-semibold mb-1 block" style={{ color: "rgba(148,163,184,0.5)" }}>Title</label>
                                <input
                                  style={inputStyle}
                                  value={editValues.title}
                                  onChange={e => setEditValues(v => ({ ...v, title: e.target.value }))}
                                  onFocus={e => (e.target.style.borderColor = "rgba(99,102,241,0.5)")}
                                  onBlur={e => (e.target.style.borderColor = "rgba(255,255,255,0.12)")}
                                />
                              </div>
                              <div>
                                <label className="text-[10px] font-semibold mb-1 block" style={{ color: "rgba(148,163,184,0.5)" }}>Artist</label>
                                <input
                                  style={inputStyle}
                                  value={editValues.artist}
                                  onChange={e => setEditValues(v => ({ ...v, artist: e.target.value }))}
                                  onFocus={e => (e.target.style.borderColor = "rgba(99,102,241,0.5)")}
                                  onBlur={e => (e.target.style.borderColor = "rgba(255,255,255,0.12)")}
                                />
                              </div>
                              <div>
                                <label className="text-[10px] font-semibold mb-1 block" style={{ color: "rgba(148,163,184,0.5)" }}>Playlist</label>
                                <input
                                  style={inputStyle}
                                  value={editValues.category}
                                  list={`playlists-${track.id}`}
                                  onChange={e => setEditValues(v => ({ ...v, category: e.target.value }))}
                                  onFocus={e => (e.target.style.borderColor = "rgba(99,102,241,0.5)")}
                                  onBlur={e => (e.target.style.borderColor = "rgba(255,255,255,0.12)")}
                                />
                                <datalist id={`playlists-${track.id}`}>
                                  {playlists.map(pl => <option key={pl.id} value={pl.name} />)}
                                </datalist>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button onClick={cancelEdit}
                                className="flex-1 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95"
                                style={{ background: "rgba(255,255,255,0.05)", color: "rgba(148,163,184,0.7)" }}>
                                Cancel
                              </button>
                              <button onClick={saveEdit} disabled={isSaving}
                                className="flex-1 py-2 rounded-xl text-xs font-bold text-white transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
                                style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}>
                                {isSaving ? (
                                  <>
                                    <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="white" strokeWidth="4" fill="none"/>
                                      <path className="opacity-75" fill="white" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                                    </svg>
                                    Saving...
                                  </>
                                ) : "Save Changes"}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {pageCount > 1 && (
                  <div className="flex items-center justify-between gap-3 mt-4 flex-wrap">
                    <span className="text-xs" style={{ color: "rgba(148,163,184,0.5)" }}>
                      Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredTracks.length)} of {filteredTracks.length}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                        className="px-3 py-2 rounded-xl text-xs font-bold transition-all active:scale-95 disabled:opacity-30"
                        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(148,163,184,0.9)" }}>
                        ‹ Prev
                      </button>
                      <span className="px-3 py-2 text-xs font-bold" style={{ color: "white" }}>{page} / {pageCount}</span>
                      <button onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={page === pageCount}
                        className="px-3 py-2 rounded-xl text-xs font-bold transition-all active:scale-95 disabled:opacity-30"
                        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(148,163,184,0.9)" }}>
                        Next ›
                      </button>
                    </div>
                  </div>
                )}
                </>
              )}
            </div>
          </div>
        )}

        {/* ══ ALBUMS TAB ═══════════════════════════════════════════════ */}
        {tab === "albums" && <AlbumManager />}

        {/* ══ ARTISTS TAB ══════════════════════════════════════════════ */}
        {tab === "artists" && <ArtistManager />}
      </main>
    </div>
  );
}
