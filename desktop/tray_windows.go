//go:build windows

package main

// System tray icon, its right-click menu, balloon notifications on track change,
// and the compact "mini player" window mode.
//
// The tray is what makes Zenify behave like a real music player rather than a
// browser tab: closing the window only hides it (audio keeps going) and the app
// stays reachable from the notification area. Only "Keluar" in the tray menu
// really exits.
//
// Menu transport commands are pushed onto mediaKeyCh — the exact same channel the
// hardware media keys use — so the tray drives playback through one code path
// instead of inventing a second one. Window-level commands go to trayCmdCh, which
// main consumes (it owns the webview handle).

import (
	"syscall"
	"unsafe"
)

var (
	shell32          = syscall.NewLazyDLL("shell32.dll")
	pShellNotifyIcon = shell32.NewProc("Shell_NotifyIconW")

	pCreatePopupMenu  = user32.NewProc("CreatePopupMenu")
	pAppendMenu       = user32.NewProc("AppendMenuW")
	pTrackPopupMenu   = user32.NewProc("TrackPopupMenu")
	pDestroyMenu      = user32.NewProc("DestroyMenu")
	pGetCursorPos     = user32.NewProc("GetCursorPos")
	pGetSystemMetrics = user32.NewProc("GetSystemMetrics")
	pIsWindowVisible  = user32.NewProc("IsWindowVisible")
	pGetForegroundWin = user32.NewProc("GetForegroundWindow")
)

const (
	// Our tray callback message. Anything from WM_APP (0x8000) up is free for an
	// app to define; the wndProc below routes it.
	wmTrayIcon = 0x8000 + 1

	wmGetMinMaxInfo = 0x0024
	wmLButtonUp     = 0x0202
	wmLButtonDblClk = 0x0203
	wmRButtonUp     = 0x0205

	nimAdd    = 0x0
	nimModify = 0x1
	nimDelete = 0x2

	nifMessage = 0x01
	nifIcon    = 0x02
	nifTip     = 0x04
	nifInfo    = 0x10
	nifGUID    = 0x20

	niifNone = 0x00

	// TrackPopupMenu flags: report the chosen id as the return value instead of
	// posting WM_COMMAND, so the whole menu is handled in one place.
	tpmRightButton = 0x0002
	tpmReturnCmd   = 0x0100

	mfString    = 0x0000
	mfSeparator = 0x0800
	mfGrayed    = 0x0001
	mfChecked   = 0x0008

	swRestore  = 9
	swHide     = 0
	swShowNoAc = 4 // SW_SHOWNOACTIVATE

	swpShowWindow = 0x0040

	hwndTopmost   = ^uintptr(0) // -1
	hwndNoTopmost = ^uintptr(1) // -2

	smCxSmIcon = 49
	smCySmIcon = 50

	// Tray menu command ids.
	idPlayPause = 0xA001
	idNext      = 0xA002
	idPrev      = 0xA003
	idMini      = 0xA004
	idShow      = 0xA005
	idQuit      = 0xA006
	idAutostart = 0xA007
)

// NOTIFYICONDATAW. Field order and padding match the C struct exactly on x64, so
// unsafe.Sizeof gives a cbSize the shell accepts.
type notifyIconData struct {
	CbSize           uint32
	HWnd             uintptr
	UID              uint32
	UFlags           uint32
	UCallbackMessage uint32
	HIcon            uintptr
	SzTip            [128]uint16
	DwState          uint32
	DwStateMask      uint32
	SzInfo           [256]uint16
	UVersion         uint32
	SzInfoTitle      [64]uint16
	DwInfoFlags      uint32
	GuidItem         [16]byte
	HBalloonIcon     uintptr
}

type point struct{ X, Y int32 }

type minMaxInfo struct {
	PtReserved     point
	PtMaxSize      point
	PtMaxPosition  point
	PtMinTrackSize point
	PtMaxTrackSize point
}

// trayCmdCh carries window-level tray commands ("show", "mini", "quit") to main,
// which owns the webview and can act on them.
var trayCmdCh = make(chan string, 4)

var (
	trayData    notifyIconData
	trayActive  bool
	quitting    bool
	trayPlaying bool // drives the Play/Pause label in the menu

	isMini      bool
	preMiniRect rect
)

// trayGUID gives the icon one identity across processes. Without it, a copy that
// dies without NIM_DELETE (Task Manager kill, crash, hard shutdown) leaves a
// ghost icon behind, and the next launch registers a brand-new one — the
// "two or more Zenify icons" effect. Any fixed random bytes work; the shell only
// compares them.
var trayGUID = [16]byte{
	0x9d, 0x41, 0x8c, 0x2f, 0x6b, 0x7a, 0x4d, 0x03,
	0xb2, 0x51, 0xe0, 0x9a, 0x77, 0x1c, 0x24, 0x68,
}

// trayGUIDMode records whether the icon was registered by GUID; every later
// Shell_NotifyIcon call must then keep NIF_GUID set, or the shell would look the
// icon up by (hwnd, uid) and miss.
var trayGUIDMode bool

func trayFlags(f uint32) uint32 {
	if trayGUIDMode {
		f |= nifGUID
	}
	return f
}

// ─── Tray icon ──────────────────────────────────────────────────────────────

func trayInit(hwnd uintptr) {
	hInst, _, _ := pGetModuleHandle.Call(0)
	cx, _, _ := pGetSystemMetrics.Call(smCxSmIcon)
	cy, _, _ := pGetSystemMetrics.Call(smCySmIcon)
	// Resource id 1 is the app icon compiled in via zenify.rc / zenify.syso.
	hIcon, _, _ := pLoadImage.Call(hInst, 1, 1 /*IMAGE_ICON*/, cx, cy, 0x8000 /*LR_SHARED*/)

	trayData = notifyIconData{
		HWnd:             hwnd,
		UID:              1,
		UFlags:           nifMessage | nifIcon | nifTip,
		UCallbackMessage: wmTrayIcon,
		HIcon:            hIcon,
	}
	trayData.CbSize = uint32(unsafe.Sizeof(trayData))
	setTip(&trayData, "Zenify")

	trayData.GuidItem = trayGUID
	trayData.UFlags |= nifGUID
	trayGUIDMode = true

	r, _, _ := pShellNotifyIcon.Call(nimAdd, uintptr(unsafe.Pointer(&trayData)))
	if r == 0 {
		// A stale registration (a ghost icon from a killed copy) still owns the
		// GUID — delete it, then take its place.
		pShellNotifyIcon.Call(nimDelete, uintptr(unsafe.Pointer(&trayData)))
		r, _, _ = pShellNotifyIcon.Call(nimAdd, uintptr(unsafe.Pointer(&trayData)))
	}
	if r == 0 {
		// The shell ties a GUID to the exe's path, so a build run from a different
		// folder (dev tree vs installed copy) can be refused even after the delete.
		// Losing the tray entirely is worse than losing dedupe: fall back to the
		// plain (hwnd, uid) identity.
		trayGUIDMode = false
		trayData.GuidItem = [16]byte{}
		trayData.UFlags &^= nifGUID
		r, _, _ = pShellNotifyIcon.Call(nimAdd, uintptr(unsafe.Pointer(&trayData)))
	}
	trayActive = r != 0
}

func trayRemove() {
	if !trayActive {
		return
	}
	trayData.UFlags = trayFlags(0)
	pShellNotifyIcon.Call(nimDelete, uintptr(unsafe.Pointer(&trayData)))
	trayActive = false
}

// trayUpdate refreshes the hover tooltip and, when the track actually changed
// while the window is in the background, pops a balloon. Called from the webview
// binding (UI thread) on every now-playing change.
func trayUpdate(p presence, notify bool) {
	if !trayActive {
		return
	}
	trayPlaying = p.State == "playing"

	label := "Zenify"
	if p.Title != "" {
		label = p.Title
		if p.Artist != "" {
			label += " — " + p.Artist
		}
	}
	setTip(&trayData, label)
	trayData.UFlags = trayFlags(nifMessage | nifIcon | nifTip)
	pShellNotifyIcon.Call(nimModify, uintptr(unsafe.Pointer(&trayData)))

	if !notify || p.Title == "" {
		return
	}
	// Don't interrupt the user with a toast for a window they're already looking at.
	if fg, _, _ := pGetForegroundWin.Call(); fg == trayData.HWnd {
		return
	}

	setInfoTitle(&trayData, p.Title)
	body := p.Artist
	if body == "" {
		body = "Zenify"
	}
	setInfo(&trayData, body)
	trayData.DwInfoFlags = niifNone
	trayData.UFlags = trayFlags(nifInfo)
	pShellNotifyIcon.Call(nimModify, uintptr(unsafe.Pointer(&trayData)))
}

// trayNotifyHidden pops a balloon the first time the window is closed to the
// tray in this run, so "X" leaving the music playing reads as a feature instead
// of a bug. Once is enough — repeating it on every close would be nagging.
var hiddenHintShown bool

func trayNotifyHidden() {
	if !trayActive || hiddenHintShown {
		return
	}
	hiddenHintShown = true
	setInfoTitle(&trayData, "Zenify masih berjalan")
	setInfo(&trayData, "Musik tetap diputar dari tray. Klik kanan ikon Zenify → \"Keluar\" untuk menutup sepenuhnya.")
	trayData.DwInfoFlags = niifNone
	trayData.UFlags = trayFlags(nifInfo)
	pShellNotifyIcon.Call(nimModify, uintptr(unsafe.Pointer(&trayData)))
}

// ─── Tray menu ──────────────────────────────────────────────────────────────

func showTrayMenu(hwnd uintptr) {
	hmenu, _, _ := pCreatePopupMenu.Call()
	if hmenu == 0 {
		return
	}
	defer pDestroyMenu.Call(hmenu)

	playLabel := "Putar"
	if trayPlaying {
		playLabel = "Jeda"
	}
	miniLabel := "Mini player"
	if isMini {
		miniLabel = "Keluar dari mini player"
	}

	autoFlags := uintptr(mfString)
	if autostartEnabled() {
		autoFlags |= mfChecked
	}

	appendMenu(hmenu, mfString, idPlayPause, playLabel)
	appendMenu(hmenu, mfString, idNext, "Lagu berikutnya")
	appendMenu(hmenu, mfString, idPrev, "Lagu sebelumnya")
	appendMenu(hmenu, mfSeparator, 0, "")
	appendMenu(hmenu, mfString, idMini, miniLabel)
	appendMenu(hmenu, mfString, idShow, "Buka Zenify")
	appendMenu(hmenu, mfSeparator, 0, "")
	appendMenu(hmenu, autoFlags, idAutostart, "Jalankan saat Windows menyala")
	appendMenu(hmenu, mfSeparator, 0, "")
	appendMenu(hmenu, mfString, idQuit, "Keluar")

	var pt point
	pGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))

	// Required, or the menu won't dismiss when the user clicks elsewhere.
	pSetForegroundWindow.Call(hwnd)

	cmd, _, _ := pTrackPopupMenu.Call(
		hmenu, tpmRightButton|tpmReturnCmd,
		uintptr(pt.X), uintptr(pt.Y), 0, hwnd, 0,
	)

	switch cmd {
	case idPlayPause:
		sendMediaKey("play-pause")
	case idNext:
		sendMediaKey("next")
	case idPrev:
		sendMediaKey("prev")
	case idMini:
		sendTrayCmd("mini")
	case idShow:
		sendTrayCmd("show")
	case idAutostart:
		// Read-then-flip rather than tracking it in a variable: the user can also
		// revoke this from Task Manager's Startup tab, and the registry is the only
		// thing that knows the truth.
		autostartSet(!autostartEnabled())
	case idQuit:
		sendTrayCmd("quit")
	}
}

func appendMenu(hmenu uintptr, flags, id uintptr, text string) {
	var p uintptr
	if text != "" {
		s, err := syscall.UTF16PtrFromString(text)
		if err != nil {
			return
		}
		p = uintptr(unsafe.Pointer(s))
	}
	pAppendMenu.Call(hmenu, flags, id, p)
}

// ─── Window show / hide / mini ──────────────────────────────────────────────

func winHideToTray(hwnd uintptr) {
	// Without a tray icon there'd be no way back, so fall back to minimizing.
	if !trayActive {
		winMinimize(hwnd)
		return
	}
	pShowWindow.Call(hwnd, swHide)
}

func winShowFromTray(hwnd uintptr) {
	pShowWindow.Call(hwnd, swRestore)
	pSetForegroundWindow.Call(hwnd)
}

func winIsVisible(hwnd uintptr) bool {
	r, _, _ := pIsWindowVisible.Call(hwnd)
	return r != 0
}

// winToggleMini shrinks the window into a compact always-on-top player parked in
// the bottom-right corner, and back. Returns the new mini state so the caller can
// tell the page to swap its layout.
func winToggleMini(hwnd uintptr) bool {
	if isMini {
		isMini = false // clear first: WM_GETMINMAXINFO fires during SetWindowPos
		pSetWindowPos.Call(hwnd, hwndNoTopmost,
			uintptr(preMiniRect.Left), uintptr(preMiniRect.Top),
			uintptr(preMiniRect.Right-preMiniRect.Left),
			uintptr(preMiniRect.Bottom-preMiniRect.Top),
			swpFrameChange|swpShowWindow)
		pSetForegroundWindow.Call(hwnd)
		return false
	}

	if isMaximized {
		winToggleMaximize(hwnd) // restore first, so we have a sane rect to come back to
	}
	pGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&preMiniRect)))

	dpi := getDPI(hwnd)
	w := miniW * dpi / 96
	h := miniH * dpi / 96
	margin := int32(16) * dpi / 96

	hmon, _, _ := pMonitorFromWin.Call(hwnd, 2 /*MONITOR_DEFAULTTONEAREST*/)
	var mi monitorInfo
	mi.CbSize = uint32(unsafe.Sizeof(mi))
	pGetMonitorInfo.Call(hmon, uintptr(unsafe.Pointer(&mi)))
	wa := mi.RcWork

	isMini = true
	pSetWindowPos.Call(hwnd, hwndTopmost,
		uintptr(wa.Right-w-margin), uintptr(wa.Bottom-h-margin),
		uintptr(w), uintptr(h),
		swpFrameChange|swpShowWindow)
	return true
}

// winIsMini lets the page re-apply the mini layout after a navigation, which
// wipes the injected overlay while the window stays shrunk.
func winIsMini() bool { return isMini }

// The mini player's size in logical pixels; the injected overlay in inject.go is
// laid out to match.
const (
	miniW = int32(360)
	miniH = int32(132)
)

// ─── helpers ────────────────────────────────────────────────────────────────

func sendMediaKey(action string) {
	select {
	case mediaKeyCh <- action:
	default:
	}
}

func sendTrayCmd(cmd string) {
	select {
	case trayCmdCh <- cmd:
	default:
	}
}

func setTip(d *notifyIconData, s string)       { copyUTF16(d.SzTip[:], s) }
func setInfo(d *notifyIconData, s string)      { copyUTF16(d.SzInfo[:], s) }
func setInfoTitle(d *notifyIconData, s string) { copyUTF16(d.SzInfoTitle[:], s) }

// copyUTF16 writes s into a fixed-size UTF-16 buffer, truncating to leave room
// for the NUL terminator the shell expects.
func copyUTF16(dst []uint16, s string) {
	for i := range dst {
		dst[i] = 0
	}
	u := syscall.StringToUTF16(s)
	if len(u) > len(dst) {
		u = u[:len(dst)]
		u[len(u)-1] = 0
	}
	copy(dst, u)
}
