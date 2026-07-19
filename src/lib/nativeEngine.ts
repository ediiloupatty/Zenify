"use client";

// Bridge to the desktop shell's native audio engine (desktop/engine.go).
//
// When the player runs inside Zenify Desktop with Direct Mode on, audio is not
// played by the browser at all: the page sends the track URL to the Go engine
// (WASAPI via miniaudio) and hears position/duration/ended back through
// `zenify:native` CustomEvents that the shell dispatches into the page.
//
// The rest of the player was written against an HTMLAudioElement, and touching
// every call site would bloat the diff forever — so this module exposes
// `nativeAudioShim`, an object with the element's read/write surface the code
// actually uses (currentTime, duration, paused, play, pause, volume, src...).
// The engine hook points audioRef at it while native playback is active, and
// every existing seek, lyric tick and keyboard shortcut keeps working
// untouched. Position interpolates between the engine's 250ms reports, so
// per-frame readers (lyrics) see a smooth clock.

export type NativeEventDetail = {
  type: "loaded" | "position" | "ended" | "error";
  duration?: number;
  pos?: number;
  playing?: boolean;
  sampleRate?: number;
  bits?: number;
  channels?: number;
  message?: string;
};

type NativeBindings = {
  nativeLoad: (url: string) => Promise<void>;
  nativePlay: () => Promise<void>;
  nativePause: () => Promise<void>;
  nativeSeek: (sec: number) => Promise<void>;
  nativeStop: () => Promise<void>;
};

function bindings(): NativeBindings | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Partial<NativeBindings>;
  return typeof w.nativeLoad === "function" ? (w as NativeBindings) : null;
}

/** True when the page runs inside the desktop shell with the engine bound. */
export function nativeEngineAvailable(): boolean {
  return bindings() !== null;
}

// ── Shim state ──────────────────────────────────────────────────────────────

const st = {
  src: "",
  duration: 0,
  paused: true,
  basePos: 0, // engine-confirmed position…
  baseAt: 0, // …taken at this performance.now()
};

function nowPos(): number {
  if (st.paused) return st.basePos;
  return st.basePos + (performance.now() - st.baseAt) / 1000;
}

function commitPos(pos: number, playing: boolean) {
  st.basePos = pos;
  st.baseAt = performance.now();
  st.paused = !playing;
}

export const nativeAudioShim = {
  get currentTime() {
    return nowPos();
  },
  set currentTime(v: number) {
    commitPos(v, !st.paused);
    bindings()?.nativeSeek(v);
  },
  get duration() {
    return st.duration;
  },
  get paused() {
    return st.paused;
  },
  get playbackRate() {
    return 1;
  },
  // The native path is bit-transparent by definition — volume stays at 1.0,
  // exactly like Direct Mode already promises in the browser.
  get volume() {
    return 1;
  },
  set volume(_v: number) {},
  get src() {
    return st.src;
  },
  set src(_v: string) {},
  get currentSrc() {
    return st.src;
  },
  get error(): MediaError | null {
    return null;
  },
  play(): Promise<void> {
    commitPos(nowPos(), true);
    bindings()?.nativePlay();
    return Promise.resolve();
  },
  pause() {
    commitPos(nowPos(), false);
    bindings()?.nativePause();
  },
};

// ── Commands ────────────────────────────────────────────────────────────────

export function nativeLoad(url: string) {
  st.src = url;
  st.duration = 0;
  commitPos(0, false);
  bindings()?.nativeLoad(url);
}

export function nativeStop() {
  st.src = "";
  st.duration = 0;
  commitPos(0, false);
  bindings()?.nativeStop();
}

// ── Events ──────────────────────────────────────────────────────────────────

/** Subscribe to engine events. Shim state updates before `cb` runs, so
 *  handlers reading the shim (via audioRef) always see fresh values. */
export function onNativeEvent(cb: (d: NativeEventDetail) => void): () => void {
  const handler = (e: Event) => {
    const d = (e as CustomEvent<NativeEventDetail>).detail;
    if (!d || typeof d.type !== "string") return;
    switch (d.type) {
      case "loaded":
        st.duration = d.duration || 0;
        commitPos(0, false);
        break;
      case "position":
        commitPos(d.pos || 0, !!d.playing);
        break;
      case "ended":
        commitPos(st.duration || nowPos(), false);
        break;
    }
    cb(d);
  };
  window.addEventListener("zenify:native", handler);
  return () => window.removeEventListener("zenify:native", handler);
}
