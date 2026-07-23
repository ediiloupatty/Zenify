//go:build windows

package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"
)

var (
	user32           = syscall.NewLazyDLL("user32.dll")
	pSetWindowPos    = user32.NewProc("SetWindowPos")
	pShowWindow      = user32.NewProc("ShowWindow")
	pReleaseCapture  = user32.NewProc("ReleaseCapture")
	pSendMessage     = user32.NewProc("SendMessageW")
	pGetWindowRect   = user32.NewProc("GetWindowRect")
	pMonitorFromWin  = user32.NewProc("MonitorFromWindow")
	pMonitorFromRect = user32.NewProc("MonitorFromRect")
	pGetMonitorInfo  = user32.NewProc("GetMonitorInfoW")
	pLoadImage       = user32.NewProc("LoadImageW")
	pGetWindowLong   = user32.NewProc("GetWindowLongPtrW")
	pSetWindowLong   = user32.NewProc("SetWindowLongPtrW")
	pCallWindowProc  = user32.NewProc("CallWindowProcW")
	pFindWindow                = user32.NewProc("FindWindowW")
	pSetForegroundWindow       = user32.NewProc("SetForegroundWindow")
	pGetDpiForWindow           = user32.NewProc("GetDpiForWindow")
	pSetProcessDpiAwarenessCtx = user32.NewProc("SetProcessDpiAwarenessContext")
	pGetModuleHandle           = syscall.NewLazyDLL("kernel32.dll").NewProc("GetModuleHandleW")
	pDwmSetWindowAttr          = syscall.NewLazyDLL("dwmapi.dll").NewProc("DwmSetWindowAttribute")
	pSetLayeredWinAttr         = user32.NewProc("SetLayeredWindowAttributes")
)

const (
	gwlpWndProc = ^uintptr(3)  // -4   GWL_WNDPROC
	gwlExStyle  = ^uintptr(19) // -20  GWL_EXSTYLE

	wsExLayered = 0x00080000 // WS_EX_LAYERED — required for per-window alpha
	lwaAlpha    = 0x00000002 // LWA_ALPHA — the whole window fades uniformly

	// Mini-player opacity: see-through while idle so a game behind stays visible,
	// fully opaque on hover so it's crisp to read and click. Low idle value =
	// strongly transparent (the panel reads as glass, not a solid box).
	miniAlphaIdle  = 150 // ~59%
	miniAlphaHover = 255

	swpNoSize      = 0x0001
	swpNoZorder    = 0x0004
	swpNoActivate  = 0x0010
	swpFrameChange = 0x0020

	swMinimize = 6

	offscreen = ^uintptr(31999) // 2^64 - 32000 → -32000 as a 32-bit coordinate

	wmNcCalcSize    = 0x0083
	wmNcHitTest     = 0x0084
	wmNcLButtonDown = 0x00A1
	wmClose         = 0x0010
	wmAppCommand    = 0x0319
	htCaption       = 2

	// APPCOMMAND media key codes (from WM_APPCOMMAND lparam >> 16)
	appCmdPlayPause = 14
	appCmdNextTrack = 11
	appCmdPrevTrack = 12
	appCmdStop      = 13
)

type rect struct{ Left, Top, Right, Bottom int32 }

type monitorInfo struct {
	CbSize    uint32
	RcMonitor rect
	RcWork    rect
	DwFlags   uint32
}

var (
	origWndProc uintptr
	wndProcCb   uintptr // keep the callback alive

	savedRect   rect
	isMaximized bool

	revealRect rect // where to place the window once content is ready
	revealed   bool // true after the first reveal; later reloads must not move/resize

	dpiSupported bool // true if GetDpiForWindow is available (Win10 1607+)
)

// mediaKeyCh delivers media key actions from WM_APPCOMMAND to the JS bridge.
var mediaKeyCh = make(chan string, 4)

func init() {
	// Declare per-monitor-V2 DPI awareness before any windows are created.
	// Win10 1703+; WebView2 requires 1809+ so this is always available.
	if pSetProcessDpiAwarenessCtx.Find() == nil {
		pSetProcessDpiAwarenessCtx.Call(^uintptr(3)) // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
	}
	dpiSupported = pGetDpiForWindow.Find() == nil
}

// getDPI returns the effective DPI for the window (96 = 100% scaling).
func getDPI(hwnd uintptr) int32 {
	if !dpiSupported {
		return 96
	}
	dpi, _, _ := pGetDpiForWindow.Call(hwnd)
	if dpi == 0 {
		return 96
	}
	return int32(dpi)
}

// decorateWindow turns the window frameless (so the web draws its own title bar)
// without leaving the leftover black non-client strip, and sets the dark hint +
// app icon. Window buttons / dragging come from the injected web bar via win*.
func decorateWindow(hwnd uintptr) {
	if hwnd == 0 {
		return
	}
	setDarkTitleBar(hwnd)
	setWindowIcon(hwnd)
	installFrameless(hwnd)
}

func setDarkTitleBar(hwnd uintptr) {
	var enabled int32 = 1
	for _, attr := range []uintptr{20, 19} {
		pDwmSetWindowAttr.Call(hwnd, attr, uintptr(unsafe.Pointer(&enabled)), unsafe.Sizeof(enabled))
	}
}

func setWindowIcon(hwnd uintptr) {
	hInst, _, _ := pGetModuleHandle.Call(0)
	const (
		imageIcon     = 1
		lrDefaultSize = 0x40
		lrShared      = 0x8000
		wmSetIcon     = 0x0080
	)
	hIcon, _, _ := pLoadImage.Call(hInst, 1, imageIcon, 0, 0, lrDefaultSize|lrShared)
	if hIcon == 0 {
		return
	}
	pSendMessage.Call(hwnd, wmSetIcon, 0, hIcon)
	pSendMessage.Call(hwnd, wmSetIcon, 1, hIcon)
}

// installFrameless subclasses the window so WM_NCCALCSIZE reports zero non-client
// area (the title bar / borders vanish — no black strip — and the web content
// fills the whole window). WM_NCHITTEST is handled to keep edge-resize working.
// hideOffscreen parks the window far off the visible desktop so WebView2 keeps
// rendering normally (no layered-window glitches) while the dark page paints.
// winReveal() then moves it to the centre of the screen — the user only ever
// sees the finished, dark UI. No white/black flash.
func hideOffscreen(hwnd uintptr) {
	pGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&revealRect)))
	pSetWindowPos.Call(hwnd, 0, offscreen, offscreen, 0, 0, swpNoSize|swpNoZorder|swpNoActivate)
}

// setMiniTranslucent turns the whole window semi-transparent (mini player) or
// solid again. WS_EX_LAYERED + LWA_ALPHA fades every pixel uniformly, so a game
// behind the overlay shows through while it idles. Whether WebView2's composited
// output honours the alpha depends on the Windows build; if it doesn't, the
// window simply stays opaque — no breakage, just no see-through.
func setMiniTranslucent(hwnd uintptr, on bool) {
	ex, _, _ := pGetWindowLong.Call(hwnd, gwlExStyle)
	if on {
		pSetWindowLong.Call(hwnd, gwlExStyle, ex|wsExLayered)
		setMiniAlpha(hwnd, miniAlphaIdle)
	} else {
		pSetWindowLong.Call(hwnd, gwlExStyle, ex&^wsExLayered)
	}
}

// miniAlphaCur is the alpha currently applied to the mini window; miniFadeGen is
// bumped on each new fade so a superseded animation knows to stop.
var (
	miniAlphaCur = int32(miniAlphaHover)
	miniFadeGen  int32
)

// setMiniAlpha adjusts the mini window's opacity (0–255). No-op unless the
// window is currently layered (i.e. in mini mode), so a stray hover event while
// full-size can't accidentally fade the main window.
func setMiniAlpha(hwnd uintptr, a byte) {
	if !isMini {
		return
	}
	atomic.StoreInt32(&miniAlphaCur, int32(a))
	pSetLayeredWinAttr.Call(hwnd, 0, uintptr(a), lwaAlpha)
}

// animateMiniAlpha glides the mini window from its current alpha to target over
// ~120ms so the idle↔hover transition feels smooth instead of snapping. Each
// call bumps the generation counter; an older fade goroutine sees the change and
// bails, so rapid enter/leave never fights itself.
func animateMiniAlpha(hwnd uintptr, target byte) {
	gen := atomic.AddInt32(&miniFadeGen, 1)
	start := byte(atomic.LoadInt32(&miniAlphaCur))
	if start == target || !isMini {
		return
	}
	go func() {
		const steps = 8
		for i := 1; i <= steps; i++ {
			if atomic.LoadInt32(&miniFadeGen) != gen || !isMini {
				return // superseded by a newer hover, or left mini mode
			}
			a := int(start) + (int(target)-int(start))*i/steps
			setMiniAlpha(hwnd, byte(a))
			time.Sleep(15 * time.Millisecond)
		}
	}()
}

// parkDuringInit moves the webview window off-screen the moment it is created,
// for the duration of webview.New(). The library shows + paints a blank white
// window and then pumps the message loop while WebView2 initialises; that pump
// services this (cross-thread) SetWindowPos, so the window is whisked off-screen
// before the white frame is ever seen. Stops when `stop` is closed (right after
// New() returns), after which main's own hideOffscreen keeps it parked.
func parkDuringInit(stop <-chan struct{}) {
	cls, _ := syscall.UTF16PtrFromString("webview")
	for {
		select {
		case <-stop:
			return
		default:
		}
		h, _, _ := pFindWindow.Call(uintptr(unsafe.Pointer(cls)), 0)
		if h != 0 {
			pSetWindowPos.Call(h, 0, offscreen, offscreen, 0, 0, swpNoSize|swpNoZorder|swpNoActivate)
		}
		time.Sleep(2 * time.Millisecond)
	}
}

func installFrameless(hwnd uintptr) {
	wndProcCb = syscall.NewCallback(wndProc)
	prev, _, _ := pSetWindowLong.Call(hwnd, gwlpWndProc, wndProcCb)
	origWndProc = prev
	// Force a frame recalculation so the new non-client size takes effect now.
	pSetWindowPos.Call(hwnd, 0, 0, 0, 0, 0, 0x0002|0x0001|swpNoZorder|swpFrameChange)
}

func wndProc(hwnd, msg, wparam, lparam uintptr) uintptr {
	// Messages whose ids the system hands out at runtime, so they can't be `case`
	// constants below. Both are guarded against a failed registration (id 0), which
	// would otherwise swallow every WM_NULL.
	switch {
	case msgZenifyShow != 0 && msg == msgZenifyShow:
		// A second Zenify was launched and asked us to surface rather than start a
		// rival copy of itself.
		winShowFromTray(hwnd)
		return 0
	case msgTaskbarButtonCreated != 0 && msg == msgTaskbarButtonCreated:
		// The shell has (re)created our taskbar button — the earliest point the
		// thumbbar buttons will stick.
		taskbarButtonCreated(hwnd)
		return 0
	}

	switch msg {
	case wmCommand:
		if taskbarCommand(wparam) {
			return 0
		}

	case wmNcCalcSize:
		if wparam != 0 {
			return 0 // claim the entire window as client area
		}
	case wmNcHitTest:
		return hitTest(hwnd, lparam)
	case wmAppCommand:
		cmd := int32((lparam >> 16) & 0xfff)
		var action string
		switch cmd {
		case appCmdPlayPause:
			action = "play-pause"
		case appCmdNextTrack:
			action = "next"
		case appCmdPrevTrack:
			action = "prev"
		case appCmdStop:
			action = "stop"
		}
		if action != "" {
			sendMediaKey(action)
			return 1 // handled
		}

	case wmTrayIcon:
		switch lparam {
		case wmRButtonUp:
			showTrayMenu(hwnd)
			return 0
		case wmLButtonUp, wmLButtonDblClk:
			winShowFromTray(hwnd)
			return 0
		}

	case wmGetMinMaxInfo:
		// webview's own proc clamps the window to its 520x400 minimum, which would
		// block the mini player. While mini, answer this ourselves and skip it.
		//
		// `go vet` flags the lparam conversion below as a possible unsafe.Pointer
		// misuse. Its rule exists because a uintptr holding a *Go* address can go
		// stale when the GC moves the object. This one is a MINMAXINFO the kernel
		// allocated and handed us; it is not Go memory, it cannot be moved, and it
		// stays valid for the duration of this message. This is the only way to
		// answer WM_GETMINMAXINFO, and it is the idiom every Win32 Go binding uses.
		if isMini {
			mmi := (*minMaxInfo)(unsafe.Pointer(lparam)) //nolint:govet // OS-owned struct, see above
			dpi := getDPI(hwnd)
			mmi.PtMinTrackSize.X = miniW * dpi / 96
			mmi.PtMinTrackSize.Y = miniH * dpi / 96
			return 0
		}

	case wmClose:
		// X / Alt+F4 fully quit (stop music + exit), per the user's preference.
		// requestQuit sets `quitting` and calls w.Terminate(), which comes back
		// through here — let that second pass fall through to the default proc so
		// the window actually destroys.
		if !quitting {
			saveWindowState(hwnd)
			if requestQuit != nil {
				requestQuit()
				return 0
			}
			// Fallback if the quit hook isn't wired: hide rather than lose playback.
			if trayActive {
				winHideToTray(hwnd)
				return 0
			}
		}
	}
	r, _, _ := pCallWindowProc.Call(origWndProc, hwnd, msg, wparam, lparam)
	return r
}

// hitTest re-creates an 8px resize border around the now-frameless window.
func hitTest(hwnd, lparam uintptr) uintptr {
	x := int32(int16(lparam & 0xffff))
	y := int32(int16((lparam >> 16) & 0xffff))

	var r rect
	pGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&r)))

	b := int32(8) * getDPI(hwnd) / 96 // scale for high-DPI displays
	left := x < r.Left+b
	right := x >= r.Right-b
	top := y < r.Top+b
	bottom := y >= r.Bottom-b

	const (
		htClient      = 1
		htLeft        = 10
		htRight       = 11
		htTop         = 12
		htTopLeft     = 13
		htTopRight    = 14
		htBottom      = 15
		htBottomLeft  = 16
		htBottomRight = 17
	)
	switch {
	case top && left:
		return htTopLeft
	case top && right:
		return htTopRight
	case bottom && left:
		return htBottomLeft
	case bottom && right:
		return htBottomRight
	case left:
		return htLeft
	case right:
		return htRight
	case top:
		return htTop
	case bottom:
		return htBottom
	}
	return htClient
}

// winReveal moves the (already fully-rendered) window from off-screen to the
// centre of the current monitor and focuses it. Called from JS once the page has
// loaded and painted.
func winReveal(hwnd uintptr) {
	if revealed {
		return
	}
	revealed = true

	// Started by the autostart entry: the user asked for the player to BE there at
	// login, not to be handed a window. Go straight to the tray — the page has
	// already painted by now, so clicking the icon opens instantly.
	if startHidden {
		winHideToTray(hwnd)
		return
	}

	// Try to restore the window state saved from the previous session.
	if state := loadWindowState(); state != nil {
		pSetWindowPos.Call(hwnd, 0,
			uintptr(state.Left), uintptr(state.Top),
			uintptr(state.Right-state.Left), uintptr(state.Bottom-state.Top),
			swpNoZorder)
		pSetForegroundWindow.Call(hwnd)
		if state.Maximized {
			winToggleMaximize(hwnd)
		}
		return
	}

	// Default: centre on the nearest monitor.
	w := revealRect.Right - revealRect.Left
	h := revealRect.Bottom - revealRect.Top
	if w <= 0 {
		w = 1100
	}
	if h <= 0 {
		h = 720
	}

	hmon, _, _ := pMonitorFromWin.Call(hwnd, 2 /*MONITOR_DEFAULTTONEAREST*/)
	var mi monitorInfo
	mi.CbSize = uint32(unsafe.Sizeof(mi))
	pGetMonitorInfo.Call(hmon, uintptr(unsafe.Pointer(&mi)))
	wa := mi.RcWork

	// Clamp to work area so the window always fits on screen (small displays).
	if waW := wa.Right - wa.Left; w > waW {
		w = waW
	}
	if waH := wa.Bottom - wa.Top; h > waH {
		h = waH
	}

	x := wa.Left + (wa.Right-wa.Left-w)/2
	y := wa.Top + (wa.Bottom-wa.Top-h)/2
	pSetWindowPos.Call(hwnd, 0, uintptr(x), uintptr(y), uintptr(w), uintptr(h), swpNoZorder)
	pSetForegroundWindow.Call(hwnd)
}

func winMinimize(hwnd uintptr) { pShowWindow.Call(hwnd, swMinimize) }

func winToggleMaximize(hwnd uintptr) {
	if isMaximized {
		pSetWindowPos.Call(hwnd, 0,
			uintptr(savedRect.Left), uintptr(savedRect.Top),
			uintptr(savedRect.Right-savedRect.Left), uintptr(savedRect.Bottom-savedRect.Top),
			swpNoZorder|swpFrameChange)
		isMaximized = false
		return
	}
	pGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&savedRect)))

	hmon, _, _ := pMonitorFromWin.Call(hwnd, 2 /*MONITOR_DEFAULTTONEAREST*/)
	var mi monitorInfo
	mi.CbSize = uint32(unsafe.Sizeof(mi))
	pGetMonitorInfo.Call(hmon, uintptr(unsafe.Pointer(&mi)))
	w := mi.RcWork
	pSetWindowPos.Call(hwnd, 0,
		uintptr(w.Left), uintptr(w.Top),
		uintptr(w.Right-w.Left), uintptr(w.Bottom-w.Top),
		swpNoZorder|swpFrameChange)
	isMaximized = true
}

func winDragStart(hwnd uintptr) {
	pReleaseCapture.Call()
	pSendMessage.Call(hwnd, wmNcLButtonDown, htCaption, 0)
}

// ─── Window state persistence ───────────────────────────────────────────────

type windowState struct {
	Left      int32 `json:"left"`
	Top       int32 `json:"top"`
	Right     int32 `json:"right"`
	Bottom    int32 `json:"bottom"`
	Maximized bool  `json:"maximized"`
}

func stateFile() string {
	return filepath.Join(os.Getenv("APPDATA"), "Zenify", "window.json")
}

func saveWindowState(hwnd uintptr) {
	var r rect
	if isMaximized {
		r = savedRect // use the pre-maximize rect
	} else {
		pGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&r)))
	}
	state := windowState{
		Left: r.Left, Top: r.Top, Right: r.Right, Bottom: r.Bottom,
		Maximized: isMaximized,
	}
	dir := filepath.Dir(stateFile())
	os.MkdirAll(dir, 0755)
	data, _ := json.Marshal(state)
	os.WriteFile(stateFile(), data, 0644)
}

func loadWindowState() *windowState {
	data, err := os.ReadFile(stateFile())
	if err != nil {
		return nil
	}
	var s windowState
	if json.Unmarshal(data, &s) != nil {
		return nil
	}
	// Sanity check: ensure the saved rect has a usable size.
	if s.Right-s.Left < 520 || s.Bottom-s.Top < 400 {
		return nil
	}
	// Verify the saved rect is still on a visible monitor (user may have
	// unplugged an external display). MONITOR_DEFAULTTONULL = 0.
	hmon, _, _ := pMonitorFromRect.Call(uintptr(unsafe.Pointer(&rect{
		Left: s.Left, Top: s.Top, Right: s.Right, Bottom: s.Bottom,
	})), 0)
	if hmon == 0 {
		return nil // off-screen → fall through to default centering
	}
	return &s
}

// ─── Environment Verification (WebView2) ────────────────────────────────────

func checkEnvironment() bool {
	if !hasWebView2() {
		showNoWebView2Error()
		return false
	}
	return true
}

func hasWebView2() bool {
	var h syscall.Handle
	err := syscall.RegOpenKeyEx(syscall.HKEY_LOCAL_MACHINE, syscall.StringToUTF16Ptr(`SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}`), 0, syscall.KEY_READ, &h)
	if err == nil {
		syscall.RegCloseKey(h)
		return true
	}
	err = syscall.RegOpenKeyEx(syscall.HKEY_LOCAL_MACHINE, syscall.StringToUTF16Ptr(`SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}`), 0, syscall.KEY_READ, &h)
	if err == nil {
		syscall.RegCloseKey(h)
		return true
	}
	err = syscall.RegOpenKeyEx(syscall.HKEY_CURRENT_USER, syscall.StringToUTF16Ptr(`Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}`), 0, syscall.KEY_READ, &h)
	if err == nil {
		syscall.RegCloseKey(h)
		return true
	}
	return false
}

func showNoWebView2Error() {
	title, _ := syscall.UTF16PtrFromString("Zenify - WebView2 Runtime Dibutuhkan")
	msg, _ := syscall.UTF16PtrFromString("Microsoft WebView2 Runtime tidak ditemukan di komputer ini.\n\nZenify membutuhkan WebView2 untuk menampilkan antarmuka aplikasi.\n\nKlik OK untuk membuka halaman download resmi dari Microsoft.")
	user32.NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(msg)), uintptr(unsafe.Pointer(title)), 0x00000030)
	exec.Command("rundll32", "url.dll,FileProtocolHandler", "https://developer.microsoft.com/microsoft-edge/webview2/").Start()
}
