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
	"net/url"
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

// Art-asset key uploaded in the Discord Developer Portal (Rich Presence → Art
// Assets). Referenced by name, not by URL.
//
// There is deliberately no small "playing"/"paused" badge: Discord already stops
// the progress bar when we drop the timestamps on pause, so the badge only
// restated what the card was showing anyway — and it required uploading two more
// art assets by hand to work at all.
const assetLogo = "zenify_logo" // large image / fallback cover

// Discord activity types. The default RPC activity is 0 ("Playing", rendered as
// a game); 2 is "Listening", which Discord renders as "Listening to Zenify" with
// album art and a progress bar — the Spotify-style card. rich-go's payload has
// no `type` field, so we build and send the SET_ACTIVITY frame ourselves over its
// low-level ipc package (the handshake still goes through client.Login).
const activityTypeListening = 2

// status_display_type picks what the member list shows next to the ♫ icon:
// 0 = app name ("Zenify"), 1 = state (artist), 2 = details (track title).
// Spotify shows the track title there, so we mirror that with 2.
const statusDisplayDetails = 2

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
	Type              int           `json:"type"`
	StatusDisplayType int           `json:"status_display_type"`
	Details           string        `json:"details,omitempty"`
	State             string        `json:"state,omitempty"`
	Assets            dcAssets      `json:"assets,omitempty"`
	Timestamps        *dcTimestamps `json:"timestamps,omitempty"`
	Buttons           []dcButton    `json:"buttons,omitempty"`
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
	Quality  string  `json:"quality"`  // "FLAC · 16-bit 44.1 kHz" / "MP3 · 128 kbps"
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

// startHidden suppresses the initial reveal, leaving the app running in the tray.
// Set by -minimized, which is how the autostart entry launches us.
var startHidden bool

// requestQuit performs a full quit (stop audio, save geometry, drop tray, tear
// down the webview). It's set to a closure in main() once the audio engine and
// window exist; the WM_CLOSE handler (chrome_windows.go) calls it so the X button
// / Alt+F4 fully exit instead of hiding to the tray.
var requestQuit func()

func main() {
	// Named appURL, not url: a variable called `url` would shadow the net/url
	// package that playerURL below relies on.
	appURL := flag.String("url", envOr("ZENIFY_URL", defaultURL),
		"URL of the online Zenify web app to load")

	debug := flag.Bool("debug", false, "open the webview devtools")
	logPresence := flag.Bool("log-presence", false,
		"log every Discord activity frame to stdout (kept separate from -debug: opening "+
			"devtools changes how the page behaves, which is exactly what you don't want "+
			"while diagnosing what the page reported)")
	minimized := flag.Bool("minimized", false,
		"start hidden in the tray instead of opening a window (what the autostart entry uses)")
	flag.Parse()

	// A second copy would mean two tray icons, two Discord presences overwriting
	// each other, and two songs playing at once. If one is already running it has
	// just been told to come to the front, so there is nothing left for us to do.
	if !claimSingleInstance() {
		return
	}

	startHidden = *minimized

	if !checkEnvironment() {
		os.Exit(1)
	}

	// Print the exact frame we hand Discord. The card shows three lines and gives
	// no clue which field landed where, so without this the only way to check a
	// presence change is to squint at the popout.
	debugPresence = *logPresence

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

	// Taskbar thumbnail transport + the play/pause badge on the app icon. The
	// buttons only attach once the shell announces the taskbar button, which the
	// wndProc waits for; this just records the window and draws the glyphs.
	taskbarInit(hwnd)

	// Park the window off-screen so WebView2 renders the dark page without any
	// visible flash; the injected script calls winReveal() once it has painted.
	hideOffscreen(hwnd)
	w.Bind("winReveal", func() { winReveal(hwnd) })

	// Window controls invoked from the injected titlebar.
	w.Bind("winMinimize", func() { winMinimize(hwnd) })
	w.Bind("winToggleMaximize", func() { winToggleMaximize(hwnd) })
	w.Bind("winDragStart", func() { winDragStart(hwnd) })
	// The X button fully quits (stop music + exit), per the user's preference.
	// Wired to requestQuit, which is set to quitApp once the audio engine exists.
	w.Bind("winClose", func() {
		if requestQuit != nil {
			requestQuit()
		}
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

	// The mini overlay bumps to full opacity while hovered (readable/clickable)
	// and fades back when the pointer leaves (see-through over a game).
	w.Bind("winMiniHover", func(over bool) {
		a := byte(miniAlphaIdle)
		if over {
			a = miniAlphaHover
		}
		setMiniAlpha(hwnd, a)
	})

	// Native audio engine (Direct Mode on desktop): the page drives playback
	// through these bindings and hears back via zenify:native CustomEvents.
	// Events must cross onto the UI thread before touching the webview.
	eng := newAudioEngine(func(js string) {
		w.Dispatch(func() { w.Eval(js) })
	})
	w.Bind("nativeLoad", func(url string) { eng.Load(url) })
	w.Bind("nativePlay", func() { eng.Play() })
	w.Bind("nativePause", func() { eng.Pause() })
	w.Bind("nativeSeek", func(sec float64) { eng.Seek(sec) })
	w.Bind("nativeStop", func() { eng.Stop() })
	w.Bind("nativeSetExclusive", func(on bool) { eng.SetExclusive(on) })
	w.Bind("nativePrefetch", func(url string) { eng.Prefetch(url) })
	w.Bind("nativeClearCache", func() { eng.ClearCache() })
	w.Bind("nativeCacheStats", func() cacheStats { return eng.CacheStats() })

	// Full quit: stop playback (releases the audio device), persist the window
	// geometry, drop the tray icon, and tear the webview down. Guarded so the
	// re-entrant WM_CLOSE that w.Terminate() triggers can't run it twice.
	quitApp := func() {
		if quitting {
			return
		}
		quitting = true
		eng.Stop()
		saveWindowState(hwnd)
		trayRemove()
		w.Terminate()
	}
	requestQuit = quitApp

	// Exposed to the page as window.zenifyPresence(detail). webview unmarshals the
	// JS object argument straight into our struct. We hand off without blocking.
	lastTrackID := ""
	w.Bind("zenifyPresence", func(p presence) {
		// Balloon only on a genuine track change, not on every play/pause toggle —
		// otherwise pausing would spam a notification.
		changed := p.ID != "" && p.ID != lastTrackID
		lastTrackID = p.ID
		trayUpdate(p, changed && p.State == "playing")
		taskbarUpdate(p)
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
					quitApp()
				}
			})
		}
	}()

	w.Navigate(playerURL(*appURL))
	w.Run()
}

// playerURL points a bare origin at /player, leaving a URL that already names a
// page alone. Matching on the raw string instead of the path would mangle the
// app's own deep link — ".../player?play=<id>", the one the Discord button hands
// out — into ".../player?play=<id>/player", because the query, not the path, is
// what the string ends with.
func playerURL(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" {
		return raw // not something we can reason about; navigate as given
	}
	if path := strings.TrimRight(u.Path, "/"); path == "" {
		u.Path = "/player"
	}
	return u.String()
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

	// Discord renders a Listening card as three lines: details, state, then
	// large_text. That third line used to carry the album — which for 207 of the
	// library's tracks IS the title (they're singles), so the card spent a whole
	// line repeating itself. Genre is empty for every track and `year` is 1 for
	// most of them, so neither can fill it. The audio quality can: it's populated
	// for nearly every track, and it's the one thing Spotify's card cannot say.
	act := &dcActivity{
		Type: activityTypeListening,
		// Show the track title (details) in the member list, like Spotify does,
		// instead of the app name.
		StatusDisplayType: statusDisplayDetails,
		Details:           clamp(p.Title),
		Assets: dcAssets{
			LargeImage: large,
			LargeText:  clamp(p.Quality),
		},
	}
	if p.Artist != "" {
		act.State = clamp("by " + p.Artist)
	}

	switch p.State {
	case "playing":
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
		// No timestamps: Discord freezes the progress bar, which is the pause cue.
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

// debugPresence logs every activity frame when -debug is passed.
var debugPresence bool

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
	if debugPresence {
		log.Printf("discord activity: %s", payload)
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
