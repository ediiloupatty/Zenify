// Zenify Desktop — a thin native shell that wraps the already-online Zenify web
// app in a WebView2 window and bridges "now playing" updates to Discord Rich
// Presence over the local Discord IPC socket (impossible from a plain browser).
//
// How it fits together:
//   - The web page dispatches `CustomEvent('zenify:nowplaying', {detail})` on
//     every track / play-pause change (see src/components/BottomPlayer.tsx).
//   - The init-script injected below listens for that event and calls the Go
//     function `zenifyPresence`, which we expose with w.Bind.
//   - A dedicated goroutine owns the Discord connection and serializes
//     SetActivity calls (rich-go is not safe for concurrent use).
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/hugolgst/rich-go/client"
	"github.com/hugolgst/rich-go/ipc"
	webview "github.com/webview/webview_go"
)

// Public Discord Application ID for Zenify. Safe to commit — it is NOT a secret
// (unlike a Client Secret / Bot Token, neither of which RPC needs).
const discordAppID = "1520363130478133369"

// Art-asset keys uploaded in the Discord Developer Portal (Rich Presence → Art
// Assets). These are referenced by name, not by URL.
const (
	assetLogo    = "zenify_logo" // large image / fallback cover
	assetPlaying = "playing"     // small badge while playing
	assetPaused  = "paused"      // small badge while paused
)

// Discord activity types. The default RPC activity is 0 ("Playing", rendered as
// a game); 2 is "Listening", which Discord renders as "Listening to Zenify" with
// album art and a progress bar — the Spotify-style card. rich-go's payload has
// no `type` field, so we build and send the SET_ACTIVITY frame ourselves over its
// low-level ipc package (the handshake still goes through client.Login).
const activityTypeListening = 2

type dcFrame struct {
	Cmd   string `json:"cmd"`
	Args  dcArgs `json:"args"`
	Nonce string `json:"nonce"`
}
type dcArgs struct {
	Pid      int         `json:"pid"`
	Activity *dcActivity `json:"activity"`
}
type dcActivity struct {
	Type       int           `json:"type"`
	Details    string        `json:"details,omitempty"`
	State      string        `json:"state,omitempty"`
	Assets     dcAssets      `json:"assets,omitempty"`
	Timestamps *dcTimestamps `json:"timestamps,omitempty"`
	Buttons    []dcButton    `json:"buttons,omitempty"`
}
type dcAssets struct {
	LargeImage string `json:"large_image,omitempty"`
	LargeText  string `json:"large_text,omitempty"`
	SmallImage string `json:"small_image,omitempty"`
	SmallText  string `json:"small_text,omitempty"`
}
type dcTimestamps struct {
	Start *int64 `json:"start,omitempty"`
	End   *int64 `json:"end,omitempty"`
}
type dcButton struct {
	Label string `json:"label,omitempty"`
	Url   string `json:"url,omitempty"`
}

// presence is the JSON shape emitted by the web page's CustomEvent detail.
type presence struct {
	ID       string  `json:"id"`
	Title    string  `json:"title"`
	Artist   string  `json:"artist"`
	Album    string  `json:"album"`
	Cover    string  `json:"cover"`    // absolute https URL, may be empty
	State    string  `json:"state"`    // "playing" | "paused" | "stopped"
	Position float64 `json:"position"` // seconds into the track
	Duration float64 `json:"duration"` // total track length in seconds
	AppURL   string  `json:"appUrl"`   // origin of the web app for deep-link
}

// defaultURL is the web app the desktop loads. For production builds, bake the
// deployed URL in at compile time with:
//
//	go build -ldflags "-X main.defaultURL=https://your-zenify-url"
//
// so end users never need to pass -url. Falls back to localhost for dev.
var defaultURL = "http://localhost:3000"

func main() {
	url := flag.String("url", envOr("ZENIFY_URL", defaultURL),
		"URL of the online Zenify web app to load")

	debug := flag.Bool("debug", false, "open the webview devtools")
	flag.Parse()

	if !checkEnvironment() {
		os.Exit(1)
	}

	// The worker owns the Discord connection so the UI thread never blocks on IPC.
	updates := make(chan presence, 1)
	go discordWorker(updates)

	// webview_create() shows its window and pumps the message loop while WebView2
	// initialises (async) — painting a blank WHITE frame for the whole init. That
	// happens inside webview.New(), before our off-screen parking can run. So park
	// the window the instant it appears: a watcher goroutine moves it off-screen,
	// and the cross-thread SetWindowPos is serviced by webview's own init pump, so
	// the white init frame is never visible.
	stopPark := make(chan struct{})
	go parkDuringInit(stopPark)

	w := webview.New(*debug)
	close(stopPark)
	defer w.Destroy()
	w.SetTitle("Zenify")
	w.SetSize(1100, 720, webview.HintNone)
	w.SetSize(520, 400, webview.HintMin)

	// Frameless dark window + embedded app icon (Windows only; no-op elsewhere).
	hwnd := uintptr(w.Window())
	decorateWindow(hwnd)

	// System tray: hover tooltip, right-click transport menu, and a balloon on
	// track change. Registered after decorateWindow so the subclassed wndProc is
	// already in place to receive the icon's callback messages.
	trayInit(hwnd)
	defer trayRemove()

	// Park the window off-screen so WebView2 renders the dark page without any
	// visible flash; the injected script calls winReveal() once it has painted.
	hideOffscreen(hwnd)
	w.Bind("winReveal", func() { winReveal(hwnd) })

	// Window controls invoked from the injected titlebar.
	w.Bind("winMinimize", func() { winMinimize(hwnd) })
	w.Bind("winToggleMaximize", func() { winToggleMaximize(hwnd) })
	w.Bind("winDragStart", func() { winDragStart(hwnd) })
	// Closing a music player shouldn't kill the music. The window only hides; the
	// tray menu's "Keluar" is the real exit.
	w.Bind("winClose", func() {
		saveWindowState(hwnd)
		winHideToTray(hwnd)
	})

	// Swap between the full window and the compact always-on-top mini player,
	// telling the page to swap its layout to match.
	toggleMini := func() {
		mini := "false"
		if winToggleMini(hwnd) {
			mini = "true"
		}
		w.Eval("try{window.__zenifyApplyMini(" + mini + ")}catch(_){}")
	}
	w.Bind("winToggleMini", func() { toggleMini() })
	w.Bind("winIsMini", func() bool { return winIsMini() })

	// Exposed to the page as window.zenifyPresence(detail). webview unmarshals the
	// JS object argument straight into our struct. We hand off without blocking.
	lastTrackID := ""
	w.Bind("zenifyPresence", func(p presence) {
		// Balloon only on a genuine track change, not on every play/pause toggle —
		// otherwise pausing would spam a notification.
		changed := p.ID != "" && p.ID != lastTrackID
		lastTrackID = p.ID
		trayUpdate(p, changed && p.State == "playing")
		send(updates, p)
	})

	// Runs before every page's own scripts, on each navigation. It (1) bridges the
	// web's now-playing event to Discord and (2) injects the custom title bar, so
	// the desktop owns its chrome no matter which URL is loaded — the online web
	// app needs no changes.
	w.Init(titlebarJS)

	// Forward media key presses (captured by WM_APPCOMMAND in the wndProc) to the
	// web page as zenify:mediakey CustomEvents so the player can react to hardware
	// Play/Pause, Next, Prev, and Stop buttons.
	go func() {
		for action := range mediaKeyCh {
			a := action
			w.Dispatch(func() {
				w.Eval(`try{window.dispatchEvent(new CustomEvent('zenify:mediakey',{detail:'` + a + `'}))}catch(_){}`)
			})
		}
	}()

	// Tray menu commands that need the window or the webview. The tray's transport
	// entries (play/pause, next, prev) don't come through here — they're pushed
	// onto mediaKeyCh above, so they take the identical path to the hardware keys.
	go func() {
		for cmd := range trayCmdCh {
			c := cmd
			w.Dispatch(func() {
				switch c {
				case "show":
					winShowFromTray(hwnd)
				case "mini":
					toggleMini()
				case "quit":
					quitting = true
					saveWindowState(hwnd)
					trayRemove()
					w.Terminate()
				}
			})
		}
	}()

	targetURL := strings.TrimRight(*url, "/")
	if !strings.HasSuffix(targetURL, "/player") {
		targetURL += "/player"
	}
	w.Navigate(targetURL)
	w.Run()
}

// send delivers the latest presence without ever blocking the UI thread,
// coalescing so a burst keeps only the newest snapshot.
func send(ch chan presence, p presence) {
	for {
		select {
		case ch <- p:
			return
		default:
			select {
			case <-ch: // drop the stale one, then retry with the newest
			default:
			}
		}
	}
}

// discordWorker connects lazily (Discord may not be running yet) and applies
// each presence update. On any IPC error it drops the connection and reconnects
// on the next update, throttled by a short backoff.
func discordWorker(updates <-chan presence) {
	connected := false
	var lastTry time.Time

	ensure := func() bool {
		if connected {
			return true
		}
		if time.Since(lastTry) < 5*time.Second {
			return false
		}
		lastTry = time.Now()
		if err := client.Login(discordAppID); err != nil {
			log.Printf("discord: not connected yet (%v) — is Discord running?", err)
			return false
		}
		connected = true
		log.Println("discord: connected")
		return true
	}

	for p := range updates {
		if !ensure() {
			continue
		}
		if err := setActivity(buildActivity(p)); err != nil {
			log.Printf("discord: SetActivity failed (%v) — will reconnect", err)
			connected = false
		}
	}
}

// buildActivity maps a now-playing snapshot to a Discord activity. Discord
// requires any present details/state string to be 2–128 chars; shorter values
// are omitted rather than rejected.
func buildActivity(p presence) *dcActivity {
	// Fetch a stable public cover URL from iTunes so Discord can display album
	// art without needing a custom CDN. Falls back to the static zenify_logo asset.
	large := assetLogo
	if p.Title != "" || p.Artist != "" {
		if u := fetchCoverURL(p.Artist, p.Title, p.Album); u != "" {
			large = u
		}
	}

	act := &dcActivity{
		Type:    activityTypeListening,
		Details: clamp(p.Title),
		Assets: dcAssets{
			LargeImage: large,
			LargeText:  clamp(p.Album),
		},
	}
	if p.Artist != "" {
		act.State = clamp("by " + p.Artist)
	}

	switch p.State {
	case "playing":
		act.Assets.SmallImage = assetPlaying
		act.Assets.SmallText = "Playing"
		// Start = now - position gives Discord an "elapsed" timer; adding End makes
		// it a countdown with a progress bar (in milliseconds, per the RPC spec).
		now := time.Now()
		start := now.Add(-time.Duration(p.Position * float64(time.Second)))
		startMs := start.UnixMilli()
		act.Timestamps = &dcTimestamps{Start: &startMs}
		if p.Duration > 0 {
			endMs := start.Add(time.Duration(p.Duration * float64(time.Second))).UnixMilli()
			act.Timestamps.End = &endMs
		}
	case "paused":
		act.Assets.SmallImage = assetPaused
		act.Assets.SmallText = "Paused"
	default: // "stopped" / empty — idle
		if act.Details == "" {
			act.Details = "Idle"
		}
	}

	// "Play on Zenify" button — deep-links directly to the track.
	// Discord requires the URL to be a real https link, so we only add it when
	// the app is running against a deployed (https) origin.
	if p.AppURL != "" && p.ID != "" && strings.HasPrefix(p.AppURL, "https://") {
		act.Buttons = []dcButton{
			{Label: "Play on Zenify", Url: strings.TrimRight(p.AppURL, "/") + "/player?play=" + p.ID},
		}
	}

	return act
}

// setActivity sends a SET_ACTIVITY frame over the (already handshaked) Discord
// IPC socket. We send it directly instead of via client.SetActivity so we can
// include the `type` field that rich-go's payload struct omits.
func setActivity(act *dcActivity) error {
	payload, err := json.Marshal(dcFrame{
		Cmd:   "SET_ACTIVITY",
		Args:  dcArgs{Pid: os.Getpid(), Activity: act},
		Nonce: strconv.FormatInt(time.Now().UnixNano(), 10),
	})
	if err != nil {
		return err
	}
	resp := ipc.Send(1, string(payload)) // opcode 1 = FRAME
	// ipc.Send swallows socket errors internally (prints to stdout). An empty
	// response or one containing an ERROR event means the pipe is broken or
	// Discord rejected the payload — either way the caller should reconnect.
	if resp == "" {
		return fmt.Errorf("empty IPC response (socket likely closed)")
	}
	if strings.Contains(resp, `"ERROR"`) {
		return fmt.Errorf("discord error: %s", resp)
	}
	return nil
}

// clamp returns s only if it satisfies Discord's 2–128 char rule, else "".
func clamp(s string) string {
	s = strings.TrimSpace(s)
	runes := []rune(s)
	if len(runes) < 2 {
		return ""
	}
	if len(runes) > 128 {
		return string(runes[:128])
	}
	return s
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
