//go:build !windows

package main

// The tray, balloon notifications and the mini-player window mode are all Win32;
// these keep main.go compiling elsewhere.

func trayInit(hwnd uintptr)              {}
func trayRemove()                        {}
func trayUpdate(p presence, notify bool) {}
func trayNotifyHidden()                  {}
func winHideToTray(hwnd uintptr)         {}
func winShowFromTray(hwnd uintptr)       {}
func winToggleMini(hwnd uintptr) bool    { return false }
func winIsMini() bool                    { return false }

// trayCmdCh is never written to on non-Windows; main's consumer goroutine blocks
// harmlessly until the process exits.
var trayCmdCh = make(chan string, 4)

var quitting bool
