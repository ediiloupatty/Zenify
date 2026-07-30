//go:build !windows

package main

// Window-chrome controls are Windows-only; these are no-ops elsewhere.
func decorateWindow(hwnd uintptr)           {}
func hideOffscreen(hwnd uintptr)            {}
func parkDuringInit(stop <-chan struct{})   {}
func winReveal(hwnd uintptr)                {}
func winMinimize(hwnd uintptr)              {}
func winToggleMaximize(hwnd uintptr)        {}
func winDragStart(hwnd uintptr, x, y int32) {}
func saveWindowState(hwnd uintptr)          {}
func checkEnvironment() bool                { return true }

// The mini player's per-window alpha is a Win32 layered-window trick with no
// portable equivalent; main.go calls these unconditionally.
const (
	miniAlphaIdle  = 105
	miniAlphaHover = 255
)

func animateMiniAlpha(hwnd uintptr, target byte) {}
func watchMiniHover(hwnd uintptr)                {}
func stopMiniHoverWatch()                        {}

// mediaKeyCh is never written to on non-Windows; the goroutine in main blocks
// harmlessly until the process exits.
var mediaKeyCh = make(chan string, 4)
