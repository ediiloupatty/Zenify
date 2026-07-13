"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useSyncExternalStore } from "react";

// The landing page is the only surface with marketing copy, so it carries its
// own two-language dictionary instead of pulling in an i18n framework. The
// choice lives in localStorage (per browser) — there is no /en or /id route.
type Lang = "en" | "id";

const STORAGE_KEY = "zenify_landing_lang";
const CHANGE_EVENT = "zenify-lang-change";

type FeatureGroup = { title: string; items: string[] };

type Copy = {
  nav: { features: string; docs: string };
  hero: {
    eyebrow: string;
    titleTop: string;
    titleBottom: string;
    blurb: string;
    download: string;
    webPlayer: string;
    requirement: string;
    price: string;
  };
  features: {
    eyebrow: string;
    headingLead: string;
    headingAccent: string;
    groups: FeatureGroup[];
  };
  footer: { tagline: string; webPlayer: string };
};

const COPY: Record<Lang, Copy> = {
  en: {
    nav: { features: "features", docs: "docs" },
    hero: {
      eyebrow: "A minimal music player for Windows",
      titleTop: "MUSIC,",
      titleBottom: "REIMAGINED.",
      blurb:
        "Zenify is a lightweight desktop music player that helps you organize, play, and enjoy your music beautifully.",
      download: "DOWNLOAD FOR WINDOWS",
      webPlayer: "OPEN WEB PLAYER",
      requirement: "Windows 10 or later",
      price: "Free to use",
    },
    features: {
      eyebrow: "Everything inside",
      headingLead: "Every feature, ",
      headingAccent: "nothing hidden.",
      groups: [
        {
          title: "Playback",
          items: [
            "A full-screen player, a compact bottom bar, and a queue you can drag to reorder",
            "Smart shuffle that weights the next song by genre, mood and how much you play it",
            "Artist cooldown, genre spread and recency decay, so a shuffle never turns monotonous",
            "Crossfade between every track, always on",
            "Repeat off / all / one, and a Previous button that walks real history",
            "A live audio visualizer driven by the Web Audio API",
            "Sleep timer — 15, 30, 45, 60 minutes, or stop at the end of the track",
            "Volume, queue and position survive a reload",
            "Share any song as a link that opens Zenify and plays it",
            "Cover art tints the player with its own dominant colour",
            "Duplicates are collapsed out of the queue automatically",
          ],
        },
        {
          title: "Lyrics",
          items: [
            "Time-synced lyrics that scroll line by line",
            "Matched automatically, and guarded by duration so you never get another song's words",
            "Nudge the offset when a file runs early or late",
            "Plain lyrics as a fallback when no synced version exists",
          ],
        },
        {
          title: "Audio Quality",
          items: [
            "Lossless FLAC, WAV and AIFF played straight through, with no re-encoding",
            "Choose your stream: lossless, 320 kbps or 128 kbps",
            "A Hi-Res badge showing the real bit depth and sample rate",
            "The badge never lies — stream a transcode and it says so",
          ],
        },
        {
          title: "Library & Discovery",
          items: [
            "Browse by song, album or artist",
            "Artist pages with a photo, bio, popular tracks and full discography",
            "Daily Mixes built from what you actually listen to",
            "Favorites, recently played, and play counts",
            "Playlists — create them, add to them, move tracks between them, delete them",
            "Instant fuzzy search across the whole library",
            "AI search: describe a mood in plain language and get songs back",
          ],
        },
        {
          title: "Offline & PWA",
          items: [
            "Install it as an app — no store, no wrapper",
            "Songs and covers you play are cached for offline listening, up to 2 GB",
            "See exactly what is cached, and clear it in one tap",
            "Keeps playing when the network drops",
          ],
        },
        {
          title: "Account & Privacy",
          items: [
            "Email sign-up and login, with hashed passwords",
            "Your favorites, playlists and history belong to your account alone",
            "Edit your profile and change your password",
            "Delete your account, and everything in it, for real",
          ],
        },
        {
          title: "Performance & Feel",
          items: [
            "Lite mode drops the heavy glass blur automatically on weaker machines",
            "A reduced-motion toggle for when animation is too much",
            "Skeleton loading everywhere, and long lists render incrementally",
            "Sidebar on desktop, bottom navigation on mobile",
          ],
        },
        {
          title: "Windows Desktop App",
          items: [
            "A native shell (Go + WebView2) wrapped around the same player",
            "Discord Rich Presence — “Listening to Zenify”, with cover art and a live progress bar",
            "Hardware media keys for play, pause and skip",
            "A system tray icon: closing the window only hides it, the music keeps going",
            "Taskbar thumbnail controls and a play/pause badge on the icon",
            "A mini player — a 360×132 card that stays on top",
            "Track-change notifications while the window is in the background",
            "Starts with Windows, runs as a single instance, ships as a one-click installer",
          ],
        },
        {
          title: "Admin & Library Tools",
          items: [
            "Drag a whole folder in to upload — tags, covers and durations are read for you",
            "Edit any track's metadata, or delete it from storage and database at once",
            "Set album covers, artist photos and artist bios by hand",
            "Backfill missing covers from iTunes and Deezer, and artist photos from Deezer",
            "Read bit depth and sample rate back out of the files to feed the Hi-Res badge",
            "Compress every stored cover, and re-clean messy filenames in bulk",
            "A Go uploader CLI for bulk imports, with de-duplication and retries",
          ],
        },
      ],
    },
    footer: {
      tagline: "Minimal music player for Windows.",
      webPlayer: "Web Player",
    },
  },

  id: {
    nav: { features: "fitur", docs: "dokumentasi" },
    hero: {
      eyebrow: "Pemutar musik minimalis untuk Windows",
      titleTop: "MUSIK,",
      titleBottom: "DIRANCANG ULANG.",
      blurb:
        "Zenify adalah pemutar musik desktop yang ringan — menata, memutar, dan membuat koleksi musikmu enak dinikmati.",
      download: "UNDUH UNTUK WINDOWS",
      webPlayer: "BUKA WEB PLAYER",
      requirement: "Windows 10 atau lebih baru",
      price: "Gratis dipakai",
    },
    features: {
      eyebrow: "Semua yang ada di dalamnya",
      headingLead: "Semua fitur, ",
      headingAccent: "tanpa terkecuali.",
      groups: [
        {
          title: "Pemutaran",
          items: [
            "Player layar penuh, bilah bawah yang ringkas, dan antrean yang bisa kamu seret untuk disusun ulang",
            "Shuffle cerdas yang menimbang lagu berikutnya dari genre, suasana, dan seberapa sering kamu memutarnya",
            "Jeda antar-artis, sebaran genre, dan peluruhan lagu yang baru diputar, supaya shuffle tak pernah terasa monoton",
            "Crossfade di setiap pergantian lagu, selalu aktif",
            "Repeat off / all / one, dan tombol Previous yang menelusuri riwayat sungguhan",
            "Visualizer audio langsung yang digerakkan Web Audio API",
            "Sleep timer — 15, 30, 45, 60 menit, atau berhenti di akhir lagu",
            "Volume, antrean, dan posisi lagu bertahan setelah halaman dimuat ulang",
            "Bagikan lagu sebagai tautan yang langsung membuka Zenify dan memutarnya",
            "Sampul album mewarnai player dengan warna dominannya sendiri",
            "Lagu kembar otomatis disingkirkan dari antrean",
          ],
        },
        {
          title: "Lirik",
          items: [
            "Lirik tersinkron yang bergulir baris demi baris",
            "Dicocokkan otomatis, dan dijaga oleh durasi supaya kamu tak pernah dapat lirik lagu lain",
            "Geser offset-nya saat lirik berjalan terlalu cepat atau terlalu lambat",
            "Lirik biasa sebagai cadangan bila versi tersinkronnya tidak ada",
          ],
        },
        {
          title: "Kualitas Audio",
          items: [
            "FLAC, WAV, dan AIFF lossless diputar apa adanya, tanpa dikompres ulang",
            "Pilih aliranmu sendiri: lossless, 320 kbps, atau 128 kbps",
            "Badge Hi-Res yang menampilkan bit depth dan sample rate yang sebenarnya",
            "Badge-nya tidak pernah berbohong — kalau yang mengalir transcode, ia mengatakannya",
          ],
        },
        {
          title: "Pustaka & Penemuan",
          items: [
            "Jelajahi lewat lagu, album, atau artis",
            "Halaman artis lengkap dengan foto, bio, lagu populer, dan diskografi penuh",
            "Daily Mix yang disusun dari apa yang benar-benar kamu dengarkan",
            "Favorit, baru diputar, dan hitungan pemutaran",
            "Playlist — buat, isi, pindahkan lagu antar-playlist, hapus",
            "Pencarian fuzzy seketika ke seluruh pustaka",
            "Pencarian AI: sebutkan suasananya dengan bahasa sehari-hari, lagunya muncul",
          ],
        },
        {
          title: "Offline & PWA",
          items: [
            "Pasang sebagai aplikasi — tanpa toko aplikasi, tanpa pembungkus",
            "Lagu dan sampul yang kamu putar disimpan untuk didengarkan offline, sampai 2 GB",
            "Lihat persis apa yang tersimpan, dan bersihkan dengan sekali ketuk",
            "Tetap berjalan saat jaringan terputus",
          ],
        },
        {
          title: "Akun & Privasi",
          items: [
            "Daftar dan masuk lewat email, dengan kata sandi yang di-hash",
            "Favorit, playlist, dan riwayatmu hanya milik akunmu sendiri",
            "Ubah profilmu dan ganti kata sandimu",
            "Hapus akunmu berikut seluruh isinya, sungguh-sungguh terhapus",
          ],
        },
        {
          title: "Performa & Rasa",
          items: [
            "Mode lite otomatis mematikan efek kaca yang berat di perangkat lemah",
            "Sakelar reduced-motion untuk saat animasi terasa berlebihan",
            "Skeleton di mana-mana, dan daftar panjang dirender bertahap",
            "Sidebar di desktop, navigasi bawah di ponsel",
          ],
        },
        {
          title: "Aplikasi Desktop Windows",
          items: [
            "Cangkang native (Go + WebView2) yang membungkus player yang sama persis",
            "Discord Rich Presence — “Listening to Zenify”, lengkap dengan sampul dan bilah progres",
            "Tombol media di keyboard untuk putar, jeda, dan lompat lagu",
            "Ikon system tray: menutup jendela hanya menyembunyikannya, musiknya terus jalan",
            "Kontrol di thumbnail taskbar dan badge putar/jeda pada ikonnya",
            "Mini player — kartu 360×132 yang selalu di atas jendela lain",
            "Notifikasi ganti lagu saat jendelanya sedang di latar belakang",
            "Ikut menyala bersama Windows, berjalan satu instance, dikemas jadi installer sekali klik",
          ],
        },
        {
          title: "Admin & Perkakas Pustaka",
          items: [
            "Seret satu folder penuh untuk mengunggah — tag, sampul, dan durasi dibaca otomatis",
            "Ubah metadata lagu mana pun, atau hapus sekaligus dari penyimpanan dan basis data",
            "Atur sendiri sampul album, foto artis, dan bio artis",
            "Lengkapi sampul yang hilang dari iTunes dan Deezer, foto artis dari Deezer",
            "Baca bit depth dan sample rate langsung dari berkasnya untuk mengisi badge Hi-Res",
            "Kompres semua sampul tersimpan, dan rapikan nama berkas yang berantakan secara massal",
            "Uploader CLI berbasis Go untuk impor massal, lengkap dengan dedup dan percobaan ulang",
          ],
        },
      ],
    },
    footer: {
      tagline: "Pemutar musik minimalis untuk Windows.",
      webPlayer: "Web Player",
    },
  },
};

function LangToggle({
  lang,
  onChange,
  className = "",
}: {
  lang: Lang;
  onChange: (next: Lang) => void;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center border border-slate-700 text-xs font-bold tracking-wider ${className}`}
    >
      {(["en", "id"] as const).map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => onChange(code)}
          aria-pressed={lang === code}
          className={`px-3 py-1.5 transition-colors ${
            lang === code
              ? "bg-[#14b8a6] text-[#1d2230]"
              : "text-slate-400 hover:text-white"
          }`}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

// Same shape as lib/useStreamQuality: localStorage is the store, a custom event
// carries same-tab changes and the native `storage` event carries other-tab
// ones. The server snapshot is "en", so SSR and hydration agree and React swaps
// to the saved choice on its own — no setState inside an effect.
function readLang(): Lang {
  try {
    if (localStorage.getItem(STORAGE_KEY) === "id") return "id";
  } catch {}
  return "en";
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export default function LandingContent() {
  const lang = useSyncExternalStore(subscribe, readLang, () => "en" as const);

  const chooseLang = useCallback((next: Lang) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  // Keep <html lang> honest for screen readers and translation prompts.
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const t = COPY[lang];

  return (
    <div className="min-h-screen font-sans bg-[#1d2230] text-slate-100 selection:bg-[#14b8a6] selection:text-white flex flex-col relative overflow-hidden">

      {/* ─── BACKGROUND IMAGE WITH BLUR EFFECT ────────────────── */}
      <div className="absolute inset-0 w-full h-full pointer-events-none select-none z-0 overflow-hidden">
        <Image
          src="/background.webp"
          alt="Zenify Background"
          fill
          priority
          quality={75}
          className="object-cover object-center opacity-40 filter blur-[25px] scale-110 transform"
        />
        {/* Subtle overlay gradient to ensure text readability */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#1d2230]/75 via-[#1d2230]/60 to-[#171a26]/95" />
      </div>

      {/* ─── NAVBAR (Fixed & Bulletproof) ──────────────────────── */}
      <header className="fixed top-0 left-0 right-0 z-50 w-full px-8 md:px-16 py-6 bg-[#1d2230]/85 backdrop-blur-md border-b border-slate-800/80 transition-all">
        <div className="max-w-[1400px] mx-auto flex items-center justify-between w-full">
          <Link href="/" className="flex items-center gap-3 group">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-[#14b8a6] transition-transform group-hover:scale-110">
              <path d="M12 2L12 22" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M6 7L6 17" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M18 7L18 17" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M3 10L3 14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M21 10L21 14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            <span className="font-bold text-xl tracking-wide text-white">
              Zenify
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-10 text-sm font-medium text-slate-400">
            <a href="#features" className="hover:text-white transition-colors">{t.nav.features}</a>
            <a href="https://github.com/ediiloupatty/Zenify" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">github</a>
            <Link href="/docs" className="hover:text-white transition-colors font-semibold text-[#14b8a6]">{t.nav.docs}</Link>
            <LangToggle lang={lang} onChange={chooseLang} />
          </nav>

          <div className="flex md:hidden items-center gap-4">
            <Link href="/docs" className="text-sm font-bold text-[#14b8a6] hover:underline">
              {t.nav.docs}
            </Link>
            <LangToggle lang={lang} onChange={chooseLang} />
          </div>
        </div>
      </header>

      {/* ─── HERO SECTION ──────────────────────────────────────── */}
      <section id="about" className="relative z-10 flex-1 px-8 md:px-16 pt-36 pb-24 max-w-[1400px] mx-auto w-full flex flex-col items-start justify-center text-left">
        <p className="rise-in text-sm font-semibold text-slate-400 mb-6 tracking-wide uppercase">
          {t.hero.eyebrow}
        </p>

        <h1 className="rise-in rise-in-d1 text-6xl sm:text-7xl md:text-8xl lg:text-9xl font-light tracking-tight leading-none mb-10">
          <span className="block text-white mb-2">{t.hero.titleTop}</span>
          <span className="block text-[#14b8a6]">{t.hero.titleBottom}</span>
        </h1>

        {/* Clean horizontal line */}
        <div className="rise-in rise-in-d2 w-16 h-[2px] bg-slate-500/60 mb-10" />

        <p className="rise-in rise-in-d2 text-xl text-slate-300 leading-relaxed mb-12 font-normal max-w-2xl">
          {t.hero.blurb}
        </p>

        {/* Primary: download the Windows app. Secondary: open the web player. */}
        <div id="download" className="rise-in rise-in-d3 flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
          <a
            href="https://github.com/ediiloupatty/Zenify/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-4 px-10 py-5 bg-[#14b8a6] text-[#1d2230] hover:bg-[#0f9d8f] transition-all font-bold tracking-wider text-base shadow-[0_0_30px_rgba(20,184,166,0.25)]"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 0h8v8h-8v-8z" />
            </svg>
            <span>{t.hero.download}</span>
          </a>
          <Link
            href="/player"
            className="inline-flex items-center justify-center gap-3 px-10 py-5 bg-transparent border border-slate-600 text-slate-200 hover:border-white hover:text-white transition-all font-semibold tracking-wider text-base"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M5 4.5v15l13-7.5-13-7.5z" fill="currentColor" />
            </svg>
            <span>{t.hero.webPlayer}</span>
          </Link>
        </div>

        <div className="rise-in rise-in-d4 mt-8 flex items-center gap-4 text-sm text-slate-400 font-medium">
          <span>{t.hero.requirement}</span>
          <span>•</span>
          <span>{t.hero.price}</span>
        </div>
      </section>


      {/* ─── DIVIDER ───────────────────────────────────────────── */}
      <div className="relative z-10 max-w-[1400px] mx-auto px-8 md:px-16 w-full">
        <div className="w-full border-t border-slate-700/50 my-12" />
      </div>

      {/* ─── FEATURES ──────────────────────────────────────────── */}
      <section id="features" className="relative z-10 max-w-[1400px] mx-auto px-8 md:px-16 pb-28 w-full">
        <div className="max-w-2xl mb-16">
          <p className="text-sm font-semibold text-slate-400 mb-5 tracking-wide uppercase">
            {t.features.eyebrow}
          </p>
          <h2 className="text-4xl sm:text-5xl font-light tracking-tight leading-tight">
            <span className="text-white">{t.features.headingLead}</span>
            <span className="text-[#14b8a6]">{t.features.headingAccent}</span>
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-12 gap-y-14">
          {t.features.groups.map((group, i) => (
            <div key={group.title} className="flex flex-col">
              <span className="text-base font-bold text-[#14b8a6] mb-2 font-mono">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="text-xl font-bold text-white mb-4 tracking-tight">{group.title}</h3>
              <ul className="flex flex-col gap-2.5">
                {group.items.map((item) => (
                  <li key={item} className="flex gap-3 text-slate-400 text-sm leading-relaxed">
                    <span aria-hidden="true" className="text-[#14b8a6]/60 select-none">—</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ─── FOOTER ────────────────────────────────────────────── */}
      <footer className="relative z-10 w-full border-t border-slate-800/80 bg-[#171a26]/90 py-10 px-8 md:px-16 mt-auto">
        <div className="max-w-[1400px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500 font-medium">
          <div className="flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-[#14b8a6]">
              <path d="M12 2L12 22" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M6 7L6 17" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M18 7L18 17" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            <span className="text-slate-400 font-bold tracking-wide">Zenify</span>
          </div>
          <span>© {new Date().getFullYear()} Zenify. {t.footer.tagline}</span>
          <div className="flex items-center gap-6 font-semibold">
            <a href="https://github.com/ediiloupatty/Zenify" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">GitHub</a>
            <Link href="/player" className="hover:text-white transition-colors">{t.footer.webPlayer}</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
