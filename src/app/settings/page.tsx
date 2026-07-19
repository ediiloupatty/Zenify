"use client";

import { useTheme } from "@/context/ThemeContext";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getCurrentUserAction, signOutAction } from "@/app/actions/settings";
import { useAudioCache, formatBytes } from "@/lib/useAudioCache";
import { useStreamQuality } from "@/lib/useStreamQuality";
import { useDirectMode } from "@/lib/useDirectMode";
import { useToast } from "@/context/ToastContext";

type UserInfo = {
  name: string;
  username: string;
  email: string;
  createdAt: string;
} | null;

export default function SettingsPage() {
  const { reducedMotion, toggleReducedMotion, performanceMode, setPerformanceMode, liteActive } = useTheme();
  const [user, setUser] = useState<UserInfo>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const { isOnline, stats, swReady, refreshStats, clearCache } = useAudioCache();
  const [clearing, setClearing] = useState(false);
  const [streamQuality, setStreamQuality] = useStreamQuality();
  const [directMode, setDirectMode] = useDirectMode();
  const { showToast } = useToast();

  useEffect(() => {
    getCurrentUserAction().then((u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  const isLoggedIn = !!user;

  return (
    <div className="flex flex-col" style={{ color: "var(--text-primary)" }}>
      {/* Content */}
      <div className="flex-1 px-5 py-6 pb-48 max-w-lg mx-auto w-full flex flex-col gap-6">

        <div className="flex items-center gap-4 mb-2">
          <Link
            href="/player"
            className="w-9 h-9 rounded-full flex md:hidden items-center justify-center transition-all active:scale-95 flex-shrink-0"
            style={{ background: "var(--bg-card)", color: "var(--text-secondary)" }}
            title="Back to player"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
            </svg>
          </Link>
          <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
            Settings
          </h1>
        </div>

        {/* ── Account & Profile Section ── */}
        <section>
          <h2
            className="text-xs font-black tracking-[0.25em] uppercase mb-3"
            style={{ color: "var(--text-muted)" }}
          >
            Account
          </h2>
          <div
            className="rounded-2xl overflow-hidden"
            style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}
          >
            {loading ? (
              <div className="px-4 py-5 flex items-center gap-3">
                <div
                  className="w-11 h-11 rounded-full animate-pulse"
                  style={{ background: "var(--bg-card)" }}
                />
                <div className="flex-1 flex flex-col gap-2">
                  <div
                    className="h-4 w-28 rounded animate-pulse"
                    style={{ background: "var(--bg-card)" }}
                  />
                  <div
                    className="h-3 w-40 rounded animate-pulse"
                    style={{ background: "var(--bg-card)" }}
                  />
                </div>
              </div>
            ) : isLoggedIn ? (
              <>
                {/* User Info Header */}
                <div className="px-4 py-4 flex items-center gap-3">
                  <div
                    className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-lg text-white"
                    style={{ background: "linear-gradient(135deg, #14b8a6, #06b6d4)" }}
                  >
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate" style={{ color: "var(--text-primary)" }}>
                      {user.name}
                    </p>
                    <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                      {user.email}
                    </p>
                  </div>
                  <Link
                    href="/profile"
                    className="text-xs font-semibold px-3 py-1.5 rounded-full transition-colors"
                    style={{ background: "var(--bg-card)", color: "var(--text-secondary)" }}
                  >
                    View
                  </Link>
                </div>

                <div style={{ height: "1px", background: "var(--border-subtle)", margin: "0 1rem" }} />

                {/* Edit Profile */}
                <Link
                  href="/settings/profile"
                  className="flex items-center justify-between px-4 py-4 transition-all active:scale-[0.99]"
                  style={{ color: "var(--text-primary)" }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center"
                      style={{ background: "var(--bg-card)", color: "var(--text-secondary)" }}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                      </svg>
                    </div>
                    <div>
                      <p className="font-semibold text-sm">Edit Profile</p>
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                        Name, username
                      </p>
                    </div>
                  </div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ color: "var(--text-muted)" }}>
                    <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" />
                  </svg>
                </Link>

                <div style={{ height: "1px", background: "var(--border-subtle)", margin: "0 1rem" }} />

                {/* Change Password */}
                <Link
                  href="/settings/password"
                  className="flex items-center justify-between px-4 py-4 transition-all active:scale-[0.99]"
                  style={{ color: "var(--text-primary)" }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center"
                      style={{ background: "var(--bg-card)", color: "var(--text-secondary)" }}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" />
                      </svg>
                    </div>
                    <div>
                      <p className="font-semibold text-sm">Change Password</p>
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                        Update your password
                      </p>
                    </div>
                  </div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ color: "var(--text-muted)" }}>
                    <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" />
                  </svg>
                </Link>

                <div style={{ height: "1px", background: "var(--border-subtle)", margin: "0 1rem" }} />

                {/* Sign Out */}
                <button
                  onClick={async () => {
                    setSigningOut(true);
                    await signOutAction();
                  }}
                  disabled={signingOut}
                  className="w-full flex items-center justify-between px-4 py-4 transition-all active:scale-[0.99] text-left"
                  style={{ color: "var(--text-primary)" }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center"
                      style={{ background: "var(--bg-card)", color: "var(--text-secondary)" }}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" />
                      </svg>
                    </div>
                    <p className="font-semibold text-sm">
                      {signingOut ? "Signing out..." : "Sign Out"}
                    </p>
                  </div>
                </button>

                <div style={{ height: "1px", background: "var(--border-subtle)", margin: "0 1rem" }} />

                {/* Delete Account */}
                <Link
                  href="/settings/delete-account"
                  className="flex items-center justify-between px-4 py-4 transition-all active:scale-[0.99]"
                  style={{ color: "#ef4444" }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center"
                      style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                      </svg>
                    </div>
                    <div>
                      <p className="font-semibold text-sm">Delete Account</p>
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                        Permanently delete your account
                      </p>
                    </div>
                  </div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ color: "var(--text-muted)" }}>
                    <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" />
                  </svg>
                </Link>
              </>
            ) : (
              /* Not logged in */
              <Link
                href="/login"
                className="flex items-center justify-between px-4 py-4 transition-all active:scale-[0.99]"
                style={{ color: "var(--text-primary)" }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center"
                    style={{ background: "var(--bg-card)", color: "var(--text-secondary)" }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-semibold text-sm">Sign In</p>
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                      Sign in to manage your account
                    </p>
                  </div>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ color: "var(--text-muted)" }}>
                  <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" />
                </svg>
              </Link>
            )}
          </div>
        </section>

        {/* ── Appearance Section ── */}
        <section>
          <h2
            className="text-xs font-black tracking-[0.25em] uppercase mb-3"
            style={{ color: "var(--text-muted)" }}
          >
            Appearance
          </h2>
          <div
            className="rounded-2xl overflow-hidden"
            style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}
          >
            {/* Reduced Motion Toggle */}
            <div className="flex items-center justify-between px-4 py-4">
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: "var(--bg-card)", color: "var(--text-secondary)" }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M13.49 5.48c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm-3.6 13.9l1-4.4 2.1 2v6h2v-7.5l-2.1-2 .6-3c1.3 1.5 3.3 2.5 5.5 2.5v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1l-5.2 2.2v4.7h2v-3.4l1.8-.7-1.6 8.1-4.9-1-.4 2 7 1.4z" />
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>
                    Reduce Motion
                  </p>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {reducedMotion ? "Animations disabled" : "Animations enabled"}
                  </p>
                </div>
              </div>
              <button
                onClick={toggleReducedMotion}
                className="relative w-12 h-6 rounded-full transition-all duration-300 focus:outline-none"
                style={{
                  background: reducedMotion ? "var(--accent)" : "var(--bg-card-hover)",
                  border: "1px solid var(--border-card)",
                }}
              >
                <span
                  className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-all duration-300"
                  style={{ left: reducedMotion ? "calc(100% - 1.375rem)" : "0.125rem" }}
                />
              </button>
            </div>

            <div style={{ height: "1px", background: "var(--border-subtle)", margin: "0 1rem" }} />

            {/* Performance Mode */}
            <div className="px-4 py-4">
              <div className="flex items-center gap-3 mb-3">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: "var(--bg-card)", color: "var(--text-secondary)" }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M13 2L3 14h7v8l10-12h-7z" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>
                    Performance Mode
                  </p>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {performanceMode === "auto"
                      ? `Auto — ${liteActive ? "lite (lighter on this device)" : "full glass"}`
                      : performanceMode === "on"
                        ? "Lite — glass effects off, lightest"
                        : "Off — full glass effects"}
                  </p>
                </div>
              </div>
              {/* Tri-state segmented control */}
              <div
                className="grid grid-cols-3 gap-1 p-1 rounded-xl"
                style={{ background: "var(--bg-card)" }}
              >
                {([
                  { value: "auto", label: "Auto" },
                  { value: "off", label: "Full" },
                  { value: "on", label: "Lite" },
                ] as const).map((opt) => {
                  const active = performanceMode === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setPerformanceMode(opt.value)}
                      className="py-1.5 rounded-lg text-xs font-bold transition-colors"
                      style={{
                        background: active ? "var(--accent)" : "transparent",
                        color: active ? "#fff" : "var(--text-secondary)",
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* ── Playback Section ── */}
        <section>
          <h2
            className="text-xs font-black tracking-[0.25em] uppercase mb-3"
            style={{ color: "var(--text-muted)" }}
          >
            Playback
          </h2>
          <div
            className="rounded-2xl overflow-hidden"
            style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}
          >
            {/* Streaming Quality */}
            <div className="px-4 py-4">
              <div className="flex items-center gap-3 mb-3">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: "var(--bg-card)", color: "var(--text-secondary)" }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M11 3v18h2V3h-2zM7 7v10h2V7H7zm8 2v6h2V9h-2zM3 10v4h2v-4H3zm16 1v2h2v-2h-2z" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>
                    Streaming Quality
                  </p>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {streamQuality === "lossless"
                      ? "Lossless — original hi-res file, heaviest on slow networks"
                      : streamQuality === "320"
                        ? "High — MP3 320 kbps, near-lossless at a fraction of the size"
                        : "Data saver — MP3 128 kbps, smoothest on slow networks"}
                  </p>
                </div>
              </div>
              {/* Tri-state segmented control */}
              <div
                className="grid grid-cols-3 gap-1 p-1 rounded-xl"
                style={{ background: "var(--bg-card)" }}
              >
                {([
                  { value: "lossless", label: "Lossless" },
                  { value: "320", label: "320 kbps" },
                  { value: "128", label: "128 kbps" },
                ] as const).map((opt) => {
                  const active = streamQuality === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setStreamQuality(opt.value)}
                      className="py-1.5 rounded-lg text-xs font-bold transition-colors"
                      style={{
                        background: active ? "var(--accent)" : "transparent",
                        color: active ? "#fff" : "var(--text-secondary)",
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ height: "1px", background: "var(--border-subtle)", margin: "0 1rem" }} />

            {/* Direct Mode */}
            <div className="flex items-center justify-between px-4 py-4">
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: "var(--bg-card)", color: "var(--text-secondary)" }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 1a9 9 0 0 0-9 9v7a3 3 0 0 0 3 3h1a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H5v-2a7 7 0 0 1 14 0v2h-2a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1a3 3 0 0 0 3-3v-7a9 9 0 0 0-9-9z" />
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>
                    Direct Mode
                  </p>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {directMode
                      ? "Untouched audio path — volume locked at 100%, visualizer & crossfade off"
                      : "Off — visualizer, crossfade, and volume control active"}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  const next = !directMode;
                  setDirectMode(next);
                  if (
                    next &&
                    (window as { __zenifyAudioGraphActive?: boolean }).__zenifyAudioGraphActive
                  ) {
                    showToast("Reload the app to fully apply Direct Mode", "info");
                  }
                }}
                className="relative w-12 h-6 rounded-full transition-all duration-300 focus:outline-none"
                style={{
                  background: directMode ? "var(--accent)" : "var(--bg-card-hover)",
                  border: "1px solid var(--border-card)",
                }}
              >
                <span
                  className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-all duration-300"
                  style={{ left: directMode ? "calc(100% - 1.375rem)" : "0.125rem" }}
                />
              </button>
            </div>
          </div>
        </section>

        {/* ── Storage & Cache Section ── */}
        <section>
          <h2
            className="text-xs font-black tracking-[0.25em] uppercase mb-3"
            style={{ color: "var(--text-muted)" }}
          >
            Storage & Offline
          </h2>
          <div
            className="rounded-2xl overflow-hidden"
            style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}
          >
            {/* Online/Offline Status */}
            <div className="flex items-center justify-between px-4 py-4">
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: "var(--bg-card)", color: "var(--text-secondary)" }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    {isOnline ? (
                      <path d="M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8l3 3 3-3c-1.65-1.66-4.34-1.66-6 0zm-4-4l2 2c2.76-2.76 7.24-2.76 10 0l2-2C15.14 9.14 8.87 9.14 5 13z" />
                    ) : (
                      <path d="M22.99 9C19.15 5.16 13.8 3.76 8.84 4.78l2.52 2.52c3.47-.17 6.99 1.05 9.63 3.7l2-2zM18.99 13c-1.29-1.29-2.84-2.13-4.49-2.56l3.53 3.53.96-.97zM2 3.05L5.07 6.1C3.6 6.82 2.22 7.78 1 9l2 2c1.02-1.02 2.17-1.82 3.38-2.42l2.52 2.52C7.61 11.7 6.44 12.51 5.45 13l2 2c1.13-.93 2.4-1.63 3.78-2.08l2.74 2.74c-1.18.16-2.33.57-3.38 1.25L12 18.17l1.41 1.41 1.41-1.41c.81-.81 1.86-1.19 2.91-1.28l4.46 4.46 1.42-1.41L3.41 1.64 2 3.05z" />
                    )}
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>
                    Connection Status
                  </p>
                  <p className="text-xs" style={{ color: isOnline ? "#10b981" : "#ef4444" }}>
                    {isOnline ? "Online" : "Offline — playing cached songs"}
                  </p>
                </div>
              </div>
              <div
                className="w-2.5 h-2.5 rounded-full"
                style={{ background: isOnline ? "#10b981" : "#ef4444" }}
              />
            </div>

            <div style={{ height: "1px", background: "var(--border-subtle)", margin: "0 1rem" }} />

            {/* Cached Songs Info */}
            <div className="flex items-center justify-between px-4 py-4">
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: "var(--bg-card)", color: "var(--text-secondary)" }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z" />
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>
                    Cached Songs
                  </p>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {swReady && stats
                      ? `${stats.trackCount} songs · ${formatBytes(stats.totalSize)}`
                      : swReady
                        ? "No cached songs yet"
                        : "Service Worker loading..."}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  refreshStats();
                }}
                className="text-xs font-semibold px-3 py-1.5 rounded-full transition-colors"
                style={{ background: "var(--bg-card)", color: "var(--text-secondary)" }}
              >
                Refresh
              </button>
            </div>

            <div style={{ height: "1px", background: "var(--border-subtle)", margin: "0 1rem" }} />

            {/* Clear Cache */}
            <button
              onClick={async () => {
                setClearing(true);
                clearCache();
                setTimeout(() => {
                  refreshStats();
                  setClearing(false);
                }, 500);
              }}
              disabled={clearing || !swReady || (stats?.trackCount === 0)}
              className="w-full flex items-center justify-between px-4 py-4 transition-all active:scale-[0.99] text-left disabled:opacity-40"
              style={{ color: "#ef4444" }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-sm">
                    {clearing ? "Clearing..." : "Clear Audio Cache"}
                  </p>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    Remove all cached songs to free storage
                  </p>
                </div>
              </div>
            </button>
          </div>
        </section>

        {/* ── About Section ── */}
        <section>
          <h2
            className="text-xs font-black tracking-[0.25em] uppercase mb-3"
            style={{ color: "var(--text-muted)" }}
          >
            About
          </h2>
          <div
            className="rounded-2xl px-4 py-5 flex items-center gap-4"
            style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}
          >
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
              style={{ background: "linear-gradient(135deg, var(--accent), #6366f1)" }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
              </svg>
            </div>
            <div>
              <p className="font-bold text-base" style={{ color: "var(--text-primary)" }}>Zenify Cloud Music</p>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>Version 1.0.0 · Hi-Res Audio Player</p>
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}
