//go:build windows

package main

import (
	"syscall"
	"unsafe"
)

// Only one Zenify may run at a time, and a second launch surfaces the first.
//
// This matters more here than in most apps: closing the window only hides it to
// the tray, so the natural way to "reopen" Zenify — double-clicking the shortcut
// again — used to start a whole second copy. Two tray icons, two Discord
// presences overwriting each other's activity, and two songs playing at once.
//
// The handover is a broadcast, not a FindWindow: webview owns the window class
// and title, so there is no stable handle to look up, and HWND_BROADCAST reaches
// top-level windows even while they are hidden — which is precisely the state we
// need to recover from.

var (
	kernel32     = syscall.NewLazyDLL("kernel32.dll")
	pCreateMutex = kernel32.NewProc("CreateMutexW")

	pRegisterWindowMsg     = user32.NewProc("RegisterWindowMessageW")
	pPostMessage           = user32.NewProc("PostMessageW")
	pAllowSetForegroundWin = user32.NewProc("AllowSetForegroundWindow")
)

const (
	errAlreadyExists = 183 // ERROR_ALREADY_EXISTS
	hwndBroadcast    = 0xffff
	asfwAny          = ^uintptr(0) // -1: let any process take the foreground
)

// msgZenifyShow is a system-wide message id — every process registering this same
// string gets the same number, which is how the second instance addresses the
// first without knowing its window handle. 0 means registration failed.
var msgZenifyShow = registerMessage("ZenifyShowWindow")

// Held for the process lifetime. Never closed: the OS releases it on exit, which
// is the only moment another instance is allowed to take over.
var singletonMutex uintptr

func registerMessage(name string) uintptr {
	s, err := syscall.UTF16PtrFromString(name)
	if err != nil {
		return 0
	}
	id, _, _ := pRegisterWindowMsg.Call(uintptr(unsafe.Pointer(s)))
	return id
}

// claimSingleInstance reports whether this process should go on to open a window.
// When it returns false, a Zenify is already running and has been asked to come
// to the front, so this one exits without a trace.
func claimSingleInstance() bool {
	name, err := syscall.UTF16PtrFromString(`Local\ZenifyDesktopSingleton`)
	if err != nil {
		return true // can't tell — starting is the friendlier failure
	}
	h, _, lastErr := pCreateMutex.Call(0, 1, uintptr(unsafe.Pointer(name)))
	if h == 0 {
		return true
	}
	if errno, ok := lastErr.(syscall.Errno); ok && errno == errAlreadyExists {
		// The running copy is usually sitting in the tray, so it is not the
		// foreground window and Windows would otherwise refuse it the foreground —
		// its taskbar button would just blink. This hands our foreground right over.
		pAllowSetForegroundWin.Call(asfwAny)
		if msgZenifyShow != 0 {
			pPostMessage.Call(hwndBroadcast, msgZenifyShow, 0, 0)
		}
		return false
	}
	singletonMutex = h
	return true
}
