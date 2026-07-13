# Zenify Desktop

Native shell (Go + WebView2) that wraps the online Zenify web app and adds the
things a browser tab simply cannot do:

| Feature                    | Why it needs a native process                                          |
| -------------------------- | --------------------------------------------------------------------- |
| **Discord Rich Presence**  | Needs Discord's local IPC socket.                                      |
| **Hardware media keys**    | `WM_APPCOMMAND` only reaches a real window.                           |
| **System tray**            | `Shell_NotifyIcon` — closing the window keeps the music playing.       |
| **Track-change balloons**  | Native notification-area toast, only when the window is in background. |
| **Mini player**            | A 360×132 always-on-top window; no browser can resize itself like that.|

See [`PLAN.md`](./PLAN.md) for the architecture.

## Tray, mini player & media keys

The tray icon is the app's real home. **Closing the window only hides it** — audio
keeps playing, and "Keluar" in the tray menu is the only true exit. Left-click the
icon to bring the window back; right-click for Putar/Jeda, next, previous, mini
player, and quit.

The **mini player** (title-bar button, or the tray menu) shrinks the window to a
compact always-on-top card in the bottom-right corner. It is an injected overlay
on top of the *same* page, not a second window — so playback is never torn down
and nothing has to be kept in sync.

Every control outside the page — media keys, tray menu, mini player buttons —
funnels through one JS helper (`window.__zenifyClick`) that clicks the player's own
buttons. There is no second playback implementation to drift out of sync.

## Prerequisites (Windows)

1. **Go** 1.21+ — https://go.dev/dl/
2. **A C compiler** (cgo is required by the webview binding). Easiest:
   [TDM-GCC](https://jmeubank.github.io/tdm-gcc/) or MSYS2 mingw-w64. After install,
   `gcc --version` must work in your shell.
3. **WebView2 Runtime** — already present on Windows 10/11; otherwise install the
   Evergreen runtime from Microsoft.
4. **Discord desktop** running and logged in.

## Discord Art Assets (one-time)

In the [Developer Portal](https://discord.com/developers/applications) →
your app → **Rich Presence → Art Assets**, upload three images with these exact keys:

| Key            | Image                          |
| -------------- | ------------------------------ |
| `zenify_logo`  | Zenify logo (large / fallback) |
| `playing`      | ▶️ small badge                 |
| `paused`       | ⏸️ small badge                 |

Asset changes can take a few minutes to propagate.

## Run (dev)

```sh
cd desktop
go mod tidy        # fetch webview_go + rich-go
# point at your deployed app (or run the Next.js dev server on :3000)
go run . -url https://YOUR-ZENIFY-URL
```

`-url` defaults to `http://localhost:3000` and can also be set via the `ZENIFY_URL`
env var.

## Build a standalone .exe

```sh
cd desktop
go build -ldflags="-H windowsgui" -o zenify-desktop.exe .
```

`-H windowsgui` hides the console window. Run `zenify-desktop.exe -url https://...`.

## Flags

| Flag             | Default                 | Meaning                                                                 |
| ---------------- | ----------------------- | ----------------------------------------------------------------------- |
| `-url`           | `http://localhost:3000` | Online Zenify app to load.                                              |
| `-dynamic-cover` | `false`                 | Send the album cover URL to Discord instead of `zenify_logo`. Only works once covers are on a stable public CDN (see cover plan Tahap 3); `r2.dev`/presigned URLs won't. |
| `-debug`         | `false`                 | Open the webview devtools.                                              |

## How the bridge works

The web app dispatches `CustomEvent('zenify:nowplaying', {detail})` on every
track / play-pause change (in `src/components/BottomPlayer.tsx`). In a browser
that event is harmless and unheard. Here, an injected init-script forwards the
detail to the Go-bound `window.zenifyPresence(...)`, which updates Discord, the
tray tooltip, the balloon, and the mini player. No localhost server, no web↔desktop
coupling beyond that one event.

Going the other way, Go pushes commands into the page:

| Go → page                                | Trigger                          |
| ---------------------------------------- | -------------------------------- |
| `CustomEvent('zenify:mediakey', action)` | Hardware media key, tray menu     |
| `window.__zenifyApplyMini(bool)`         | Mini player toggled              |

**The web app needs no changes for any of this** — the shell injects its own
title bar and mini player over the unmodified deployed site.

## Security

- The **Application ID** in `main.go` is public and safe to commit.
- RPC needs **no** Client Secret or Bot Token — don't create or store them.
